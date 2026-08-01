import type { BBox, Vec3, MeshFieldData } from './types';
export type { MeshFieldData };

/**
 * Signed distance from a triangle mesh (#87, layer 1).
 *
 * ## The representation is a baked grid, and that is a design decision
 *
 * The obvious implementation is a BVH the evaluator queries directly: exact
 * distance, no resolution to choose. It is not what this does, because the
 * shader has to compute the *same function*. #85 was precisely the bug where
 * one node kind meant two different solids on the two sides, and a BVH is not
 * something the fragment shader can walk.
 *
 * So the mesh is baked once into a grid of signed distances, and both
 * evaluators trilinearly interpolate that same grid — the CPU from a
 * `Float32Array`, the GPU from a texture built from it. They agree by
 * construction rather than by two implementations being kept in step. The BVH
 * exists, but only at bake time.
 *
 * The cost is honest and worth stating: the field is accurate to the grid, not
 * to the mesh. At the default resolution a feature smaller than a voxel is
 * rounded off, and a sharp edge is rounded to roughly a voxel. Raising the
 * resolution costs memory cubically and texture size on the GPU.
 *
 * ## Signs
 *
 * Unsigned distance comes from the BVH. The sign comes from ray parity against
 * the same BVH — count crossings along a ray from the query point; odd means
 * inside. Chosen over an angle-weighted pseudonormal because it degrades
 * gracefully: a pseudonormal is exact for a closed, consistently-oriented mesh
 * and produces confidently wrong signs for anything else, whereas parity on a
 * mesh with a small hole is wrong only for rays that happen to pass through it.
 * Printed parts are not always watertight, and an importer that inverts a model
 * because of one flipped facet is worse than one that is slightly noisy.
 */

/** Padding around the mesh, as a fraction of its diagonal. */
const PAD_FRACTION = 0.06;

// --- BVH ---------------------------------------------------------------

interface BVH {
  /** Per node: minx,miny,minz,maxx,maxy,maxz */
  bounds: Float32Array;
  /** Per node: left child index, or -1 for a leaf. */
  left: Int32Array;
  right: Int32Array;
  /** Per leaf: [start, count) into `order`. */
  start: Int32Array;
  count: Int32Array;
  /** Triangle indices, permuted so each leaf's are contiguous. */
  order: Int32Array;
  positions: Float32Array;
  nodeCount: number;
}

const LEAF_SIZE = 8;

function buildBVH(positions: Float32Array, triangleCount: number): BVH {
  const order = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) order[i] = i;

  // Centroids and per-triangle bounds, computed once.
  const cent = new Float32Array(triangleCount * 3);
  const triMin = new Float32Array(triangleCount * 3);
  const triMax = new Float32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    for (let a = 0; a < 3; a++) {
      const v0 = positions[t * 9 + a];
      const v1 = positions[t * 9 + 3 + a];
      const v2 = positions[t * 9 + 6 + a];
      cent[t * 3 + a] = (v0 + v1 + v2) / 3;
      triMin[t * 3 + a] = Math.min(v0, v1, v2);
      triMax[t * 3 + a] = Math.max(v0, v1, v2);
    }
  }

  // Bounded by leaves, not by LEAF_SIZE. A midpoint split does not balance —
  // it can put a single triangle on one side — so leaves are only guaranteed
  // to be non-empty, giving at most `triangleCount` of them and at most
  // `triangleCount - 1` internal nodes above them.
  const maxNodes = 2 * triangleCount + 1;
  const bvh: BVH = {
    bounds: new Float32Array(maxNodes * 6),
    left: new Int32Array(maxNodes).fill(-1),
    right: new Int32Array(maxNodes).fill(-1),
    start: new Int32Array(maxNodes),
    count: new Int32Array(maxNodes),
    order,
    positions,
    nodeCount: 0,
  };

  const scratch = new Int32Array(triangleCount);

  function build(lo: number, hi: number): number {
    const node = bvh.nodeCount++;
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = lo; i < hi; i++) {
      const t = order[i];
      if (triMin[t * 3] < minx) minx = triMin[t * 3];
      if (triMin[t * 3 + 1] < miny) miny = triMin[t * 3 + 1];
      if (triMin[t * 3 + 2] < minz) minz = triMin[t * 3 + 2];
      if (triMax[t * 3] > maxx) maxx = triMax[t * 3];
      if (triMax[t * 3 + 1] > maxy) maxy = triMax[t * 3 + 1];
      if (triMax[t * 3 + 2] > maxz) maxz = triMax[t * 3 + 2];
    }
    bvh.bounds.set([minx, miny, minz, maxx, maxy, maxz], node * 6);

    if (hi - lo <= LEAF_SIZE) {
      bvh.start[node] = lo;
      bvh.count[node] = hi - lo;
      return node;
    }

    // Split on the widest axis at the centroid midpoint. Median-of-centroids
    // would balance better; midpoint is cheaper and the difference does not
    // show up at bake time, which happens once per import.
    const ex = maxx - minx, ey = maxy - miny, ez = maxz - minz;
    const axis = ex > ey ? (ex > ez ? 0 : 2) : ey > ez ? 1 : 2;
    const mid = (bvh.bounds[node * 6 + axis] + bvh.bounds[node * 6 + 3 + axis]) / 2;

    let n = 0;
    let m = 0;
    for (let i = lo; i < hi; i++) {
      if (cent[order[i] * 3 + axis] < mid) scratch[n++] = order[i];
    }
    for (let i = lo; i < hi; i++) {
      if (cent[order[i] * 3 + axis] >= mid) scratch[n + m++] = order[i];
    }
    // Every centroid on one side: fall back to a halving split so recursion
    // terminates. Happens with coincident centroids, which real meshes have.
    if (n === 0 || m === 0) {
      n = Math.floor((hi - lo) / 2);
    } else {
      for (let i = 0; i < hi - lo; i++) order[lo + i] = scratch[i];
    }

    bvh.start[node] = -1;
    bvh.count[node] = 0;
    bvh.left[node] = build(lo, lo + n);
    bvh.right[node] = build(lo + n, hi);
    return node;
  }

  if (triangleCount > 0) build(0, triangleCount);
  return bvh;
}

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection). */
function pointTriangleDist2(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = apx - v * abx, qy = apy - v * aby, qz = apz - v * abz;
    return qx * qx + qy * qy + qz * qz;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = apx - w * acx, qy = apy - w * acy, qz = apz - w * acz;
    return qx * qx + qy * qy + qz * qz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    // Closest point is b + w*(c - b), so the offset from p is
    // w*(c - b) - (p - b). The other regions happen to be sign-symmetric under
    // squaring; this one is not, and getting it backwards measures to a
    // reflected point — which showed up as a box corner reporting 7.8mm of
    // clearance where there was 1.4mm.
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = w * (cx - bx) - bpx;
    const qy = w * (cy - by) - bpy;
    const qz = w * (cz - bz) - bpz;
    return qx * qx + qy * qy + qz * qz;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = apx - (v * abx + w * acx);
  const qy = apy - (v * aby + w * acy);
  const qz = apz - (v * abz + w * acz);
  return qx * qx + qy * qy + qz * qz;
}

/** Squared distance from a point to an AABB — 0 when inside. */
function pointBoxDist2(b: Float32Array, o: number, x: number, y: number, z: number): number {
  const dx = x < b[o] ? b[o] - x : x > b[o + 3] ? x - b[o + 3] : 0;
  const dy = y < b[o + 1] ? b[o + 1] - y : y > b[o + 4] ? y - b[o + 4] : 0;
  const dz = z < b[o + 2] ? b[o + 2] - z : z > b[o + 5] ? z - b[o + 5] : 0;
  return dx * dx + dy * dy + dz * dz;
}

function closestDistance(bvh: BVH, x: number, y: number, z: number): number {
  if (bvh.nodeCount === 0) return Infinity;
  let best = Infinity;
  const stack = [0];
  const P = bvh.positions;
  while (stack.length) {
    const node = stack.pop()!;
    if (pointBoxDist2(bvh.bounds, node * 6, x, y, z) >= best) continue;
    if (bvh.count[node] > 0) {
      const s = bvh.start[node];
      for (let i = s; i < s + bvh.count[node]; i++) {
        const t = bvh.order[i] * 9;
        const d2 = pointTriangleDist2(
          x, y, z,
          P[t], P[t + 1], P[t + 2],
          P[t + 3], P[t + 4], P[t + 5],
          P[t + 6], P[t + 7], P[t + 8],
        );
        if (d2 < best) best = d2;
      }
    } else {
      stack.push(bvh.left[node], bvh.right[node]);
    }
  }
  return Math.sqrt(best);
}

/** Möller-Trumbore, counting a hit only strictly in front of the origin. */
function rayHitsTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  // Parallel, or edge-on. Skipped rather than resolved: the caller votes over
  // several directions, so one abstention is cheaper than a wrong answer.
  if (det > -1e-12 && det < 1e-12) return false;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9;
}

function rayBoxHit(b: Float32Array, o: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number): boolean {
  let t0 = (b[o] - ox) * ix, t1 = (b[o + 3] - ox) * ix;
  let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
  t0 = (b[o + 1] - oy) * iy; t1 = (b[o + 4] - oy) * iy;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  t0 = (b[o + 2] - oz) * iz; t1 = (b[o + 5] - oz) * iz;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  return tmax >= Math.max(tmin, 0);
}

function crossingsAlong(bvh: BVH, x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
  let hits = 0;
  const ix = 1 / (dx || 1e-30), iy = 1 / (dy || 1e-30), iz = 1 / (dz || 1e-30);
  const stack = [0];
  const P = bvh.positions;
  while (stack.length) {
    const node = stack.pop()!;
    if (!rayBoxHit(bvh.bounds, node * 6, x, y, z, ix, iy, iz)) continue;
    if (bvh.count[node] > 0) {
      const s = bvh.start[node];
      for (let i = s; i < s + bvh.count[node]; i++) {
        const t = bvh.order[i] * 9;
        if (rayHitsTriangle(
          x, y, z, dx, dy, dz,
          P[t], P[t + 1], P[t + 2],
          P[t + 3], P[t + 4], P[t + 5],
          P[t + 6], P[t + 7], P[t + 8],
        )) hits++;
      }
    } else {
      stack.push(bvh.left[node], bvh.right[node]);
    }
  }
  return hits;
}

/**
 * Three fixed, deliberately irrational directions, majority vote.
 *
 * One ray is enough for a perfect mesh and wrong for a real one: a ray that
 * grazes an edge or slips through a crack flips the sign of that sample, which
 * shows up as a speck of inverted material. Voting turns a single bad ray into
 * a lost vote. The directions are fixed rather than random so a bake is
 * reproducible — the same mesh must always give the same field, or two runs of
 * the same import disagree.
 */
const VOTE_DIRS: Vec3[] = [
  [0.5257311, 0.8506508, 0.0],
  [-0.3568221, 0.4911235, 0.7946545],
  [0.2763932, -0.4472136, 0.8506508],
];

function isInside(bvh: BVH, x: number, y: number, z: number): boolean {
  let votes = 0;
  for (const d of VOTE_DIRS) {
    if (crossingsAlong(bvh, x, y, z, d[0], d[1], d[2]) % 2 === 1) votes++;
  }
  return votes >= 2;
}

/** Axis-aligned bounds of the triangle soup, padded. */
export function meshBounds(positions: Float32Array): BBox {
  if (positions.length === 0) return { min: [-1, -1, -1], max: [1, 1, 1] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  // Padding so the grid has room to hold positive distances outside the
  // surface. Without it the field is clamped at the mesh's own box and the
  // marcher gets a zero gradient the instant it steps outside.
  const pad = Math.max(diag * PAD_FRACTION, 1e-6);
  return {
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

/**
 * Bake a mesh into a signed-distance grid.
 *
 * `res` samples per axis, so cost is `res^3` closest-point queries. The
 * defaults in `meshNode.ts` keep that in the low millions.
 */
export function bakeMeshField(positions: Float32Array, res: number): MeshFieldData {
  const triangleCount = Math.floor(positions.length / 9);
  const bbox = meshBounds(positions);
  const data = new Float32Array(res * res * res);
  if (triangleCount === 0) {
    // No geometry: an empty field must report "nothing here", not "everything
    // here", or an empty import swallows the model it was unioned into.
    data.fill(Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]));
    return { bbox, res, data };
  }

  const bvh = buildBVH(positions, triangleCount);
  const sx = (bbox.max[0] - bbox.min[0]) / (res - 1);
  const sy = (bbox.max[1] - bbox.min[1]) / (res - 1);
  const sz = (bbox.max[2] - bbox.min[2]) / (res - 1);

  for (let k = 0; k < res; k++) {
    const z = bbox.min[2] + k * sz;
    for (let j = 0; j < res; j++) {
      const y = bbox.min[1] + j * sy;
      for (let i = 0; i < res; i++) {
        const x = bbox.min[0] + i * sx;
        const d = closestDistance(bvh, x, y, z);
        data[k * res * res + j * res + i] = isInside(bvh, x, y, z) ? -d : d;
      }
    }
  }
  return { bbox, res, data };
}

/**
 * Trilinear sample of a baked field.
 *
 * This is the function the shader mirrors, so any change here is a change to
 * `codegen.ts` as well — `sdf-parity` will say so.
 *
 * Outside the grid, two bounds are available and the tighter of them is used.
 * The surface lies inside the box, so the distance to the box itself is a
 * floor; and the field is 1-Lipschitz, so the clamped sample minus the distance
 * travelled to reach it is another. Both under-estimate, which is the direction
 * sphere tracing requires — an over-estimate steps through geometry.
 *
 * Adding the two, which is the obvious thing to write, is exactly wrong: by the
 * triangle inequality that is an *upper* bound on the true distance, and a
 * marcher fed upper bounds skips surfaces. This was caught by the "never
 * reports more clearance than there is" test rather than by reading it.
 */
export function sampleMeshField(field: MeshFieldData, x: number, y: number, z: number): number {
  const { bbox, res, data } = field;
  const sx = (res - 1) / (bbox.max[0] - bbox.min[0]);
  const sy = (res - 1) / (bbox.max[1] - bbox.min[1]);
  const sz = (res - 1) / (bbox.max[2] - bbox.min[2]);

  let gx = (x - bbox.min[0]) * sx;
  let gy = (y - bbox.min[1]) * sy;
  let gz = (z - bbox.min[2]) * sz;

  // Distance from the grid box, added back after clamping.
  const ox = gx < 0 ? -gx / sx : gx > res - 1 ? (gx - (res - 1)) / sx : 0;
  const oy = gy < 0 ? -gy / sy : gy > res - 1 ? (gy - (res - 1)) / sy : 0;
  const oz = gz < 0 ? -gz / sz : gz > res - 1 ? (gz - (res - 1)) / sz : 0;
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);

  gx = Math.min(Math.max(gx, 0), res - 1);
  gy = Math.min(Math.max(gy, 0), res - 1);
  gz = Math.min(Math.max(gz, 0), res - 1);

  const i0 = Math.min(Math.floor(gx), res - 2), j0 = Math.min(Math.floor(gy), res - 2), k0 = Math.min(Math.floor(gz), res - 2);
  const fx = gx - i0, fy = gy - j0, fz = gz - k0;
  const r2 = res * res;
  const at = (i: number, j: number, k: number) => data[k * r2 + j * res + i];

  const c00 = at(i0, j0, k0) * (1 - fx) + at(i0 + 1, j0, k0) * fx;
  const c10 = at(i0, j0 + 1, k0) * (1 - fx) + at(i0 + 1, j0 + 1, k0) * fx;
  const c01 = at(i0, j0, k0 + 1) * (1 - fx) + at(i0 + 1, j0, k0 + 1) * fx;
  const c11 = at(i0, j0 + 1, k0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1, k0 + 1) * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  const value = c0 * (1 - fz) + c1 * fz;
  if (outside > 0) return Math.max(outside, value - outside);
  return value;
}

/**
 * Manifold Dual Contouring — one vertex per surface patch per cell, placed
 * at the QEF minimizer of that patch's edge crossings.
 *
 * Plain dual contouring places a single vertex per cell, which pinches the
 * mesh into non-manifold vertices whenever a cell contains two separate
 * surface sheets (e.g. corners 0 and 6 inside, everything else outside).
 * Here the cell's crossing edges are grouped into patches using the marching
 * cubes triangle table — edges that belong to the same MC surface component
 * share a vertex, edges on different components get separate vertices — so
 * each sheet stays its own sheet (Nielson, "Dual Marching Cubes").
 *
 * Vertex placement uses the truncated-SVD QEF from qef.ts, which reproduces
 * sharp edges and corners exactly instead of pulling them toward the cell
 * centroid the way a Tikhonov-regularized solve does.
 */

import type { SDFNode, BBox, Vec3 } from './types';
import { evaluateSDF } from './evaluate';
import { solveQEF } from './qef';
import { clusterByOctree, addSample, solveCluster, QEF_STRIDE } from './cluster';
import { TRI_TABLE } from './tables';
import type { MeshResult } from './marchingCubes';

/**
 * Root-finding iterations per edge crossing.
 *
 * Four, not the eight this used to bisect. Bisection ignores the two endpoint
 * values the grid already holds and halves the bracket blindly; false position
 * uses them, and an SDF along a single grid edge is very nearly linear, so it
 * lands close on the first step. The Illinois modification below keeps the
 * bracket guaranteed while restoring the superlinear convergence plain false
 * position loses when one endpoint sticks.
 *
 * This is the inner loop of dual contouring — measuring A2 showed the cost is
 * concentrated in the evaluations per crossing, not in the scan that finds
 * them (see #88).
 */
const ROOT_ITERS = 4;

/**
 * SDF gradient by the tetrahedron technique: four samples, not the six a
 * central difference on three axes needs.
 *
 * Only the direction is used — every caller normalises — so the factor-of-two
 * scale a central difference carries is irrelevant, and so is the fact that
 * this returns a different scale again.
 */
function sdfGradient(sdf: SDFNode, p: Vec3, eps: number): Vec3 {
  const a = evaluateSDF(sdf, [p[0] + eps, p[1] - eps, p[2] - eps]);
  const b = evaluateSDF(sdf, [p[0] - eps, p[1] - eps, p[2] + eps]);
  const c = evaluateSDF(sdf, [p[0] - eps, p[1] + eps, p[2] - eps]);
  const d = evaluateSDF(sdf, [p[0] + eps, p[1] + eps, p[2] + eps]);
  return [a - b - c + d, -a - b + c + d, -a + b - c + d];
}

// Cell edge connectivity and corner offsets (matches tables.ts layout)
const EC: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const CO: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/**
 * For each cube configuration, the crossing edges grouped into surface
 * patches (connected components of the MC triangulation). Precomputed once
 * from TRI_TABLE. PATCHES[config] = array of patches, each an array of edge
 * indices; EDGE_PATCH[config][edge] = patch index or -1.
 */
const PATCHES: number[][][] = [];
const EDGE_PATCH: Int8Array[] = [];

for (let config = 0; config < 256; config++) {
  const tris = TRI_TABLE[config];
  const parent = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const present = new Array<boolean>(12).fill(false);

  const find = (e: number): number => {
    while (parent[e] !== e) { parent[e] = parent[parent[e]]; e = parent[e]; }
    return e;
  };

  for (let t = 0; t < tris.length; t += 3) {
    const e0 = tris[t], e1 = tris[t + 1], e2 = tris[t + 2];
    present[e0] = present[e1] = present[e2] = true;
    parent[find(e1)] = find(e0);
    parent[find(e2)] = find(e0);
  }

  const patchOfRoot = new Map<number, number>();
  const patches: number[][] = [];
  const edgePatch = new Int8Array(12).fill(-1);
  for (let e = 0; e < 12; e++) {
    if (!present[e]) continue;
    const root = find(e);
    let pi = patchOfRoot.get(root);
    if (pi === undefined) {
      pi = patches.length;
      patchOfRoot.set(root, pi);
      patches.push([]);
    }
    patches[pi].push(e);
    edgePatch[e] = pi;
  }
  PATCHES.push(patches);
  EDGE_PATCH.push(edgePatch);
}

/**
 * Blocks the octree could not prove empty, from `evaluateCPUWithProgress`.
 *
 * Optional: without it every cell in the grid is visited, which is what this
 * did before and is still what the tests compare against.
 */
export interface ActiveBlocks {
  nb: number;
  bits: Uint8Array;
}

/**
 * @param clusterError  When > 0, cells whose surface a single point can
 *   represent within this distance share one vertex, so a flat face costs two
 *   triangles instead of thousands. See `cluster.ts` for why this is crack-free
 *   where adaptive dual contouring is not. Omit (or pass 0) for the dense
 *   one-vertex-per-cell mesh, which is what the geometry tests assert against.
 */
export function dualContour(grid: Float32Array, res: number, bbox: BBox, sdf: SDFNode, onProgress?: (pct: number) => void, active?: ActiveBlocks, clusterError = 0): MeshResult {
  const clustering = clusterError > 0;
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;
  const ox = bbox.min[0] + dx * 0.5;
  const oy = bbox.min[1] + dy * 0.5;
  const oz = bbox.min[2] + dz * 0.5;
  const r2 = res * res;
  const eps = Math.min(dx, dy, dz) * 0.01;

  /**
   * Walk the cells worth visiting, in exactly the order a dense walk would.
   *
   * Order is not cosmetic here: pass 1 numbers vertices as it meets them, so
   * visiting blocks block-major instead of z-major produces the same surface
   * with a different vertex numbering. The first version of this did that, and
   * the equality test below caught it. So the z and y loops stay dense — 65k
   * iterations at res 256, nothing — and only the x runs are skipped, at block
   * granularity.
   *
   * At 256 the dense walk is 33M cell visits to find roughly 360k active ones,
   * 98% of it reading eight corners to learn the cell is empty. The block size
   * is derived from `res` and the mask's own dimensions rather than agreed by
   * constant, so the two cannot drift apart.
   */
  function forEachCell(fn: (x: number, y: number, z: number) => void, report?: (frac: number) => void) {
    const last = res - 1;
    const blk = active ? Math.ceil(res / active.nb) : 0;
    for (let z = 0; z < last; z++) {
      report?.(z / last);
      const bz = active ? (z / blk) | 0 : 0;
      for (let y = 0; y < last; y++) {
        if (!active) {
          for (let x = 0; x < last; x++) fn(x, y, z);
          continue;
        }
        const by = (y / blk) | 0;
        const rowBase = (bz * active.nb + by) * active.nb;
        for (let bx = 0; bx < active.nb; bx++) {
          if (!active.bits[rowBase + bx]) continue;
          const x1 = Math.min((bx + 1) * blk, last);
          for (let x = bx * blk; x < x1; x++) fn(x, y, z);
        }
      }
    }
  }

  function gv(x: number, y: number, z: number): number {
    if (x < 0 || x >= res || y < 0 || y >= res || z < 0 || z >= res) return 1;
    return grid[z * r2 + y * res + x];
  }

  /**
   * Find the zero crossing on a grid edge by Illinois false position, then one
   * final interpolation inside the surviving bracket.
   *
   * Endpoint values come from the grid, which holds exact SDF samples at those
   * points — so the first estimate is already informed rather than a blind
   * midpoint. The bracket is maintained throughout, so this cannot leave the
   * edge or converge to the wrong side; Illinois' halving of the stale
   * endpoint is what stops the classic false-position stall where one end
   * never moves and convergence degrades to linear.
   */
  function findCrossing(
    x1: number, y1: number, z1: number, v1: number,
    x2: number, y2: number, z2: number, v2: number,
  ): { pos: Vec3; normal: Vec3 } {
    let lx: number, ly: number, lz: number, vl: number; // inside (negative)
    let hx: number, hy: number, hz: number, vh: number; // outside (positive)
    if (v1 < 0) {
      lx = ox + x1 * dx; ly = oy + y1 * dy; lz = oz + z1 * dz; vl = v1;
      hx = ox + x2 * dx; hy = oy + y2 * dy; hz = oz + z2 * dz; vh = v2;
    } else {
      lx = ox + x2 * dx; ly = oy + y2 * dy; lz = oz + z2 * dz; vl = v2;
      hx = ox + x1 * dx; hy = oy + y1 * dy; hz = oz + z1 * dz; vh = v1;
    }
    let lastSide = 0;
    for (let i = 0; i < ROOT_ITERS; i++) {
      const denom = vl - vh;
      // Clamped away from the ends: an interpolation landing exactly on an
      // endpoint would stop the bracket shrinking at all.
      let t = Math.abs(denom) > 1e-20 ? vl / denom : 0.5;
      if (!(t > 0.02 && t < 0.98)) t = 0.5;
      const mx = lx + (hx - lx) * t, my = ly + (hy - ly) * t, mz = lz + (hz - lz) * t;
      const vm = evaluateSDF(sdf, [mx, my, mz]);
      if (vm < 0) {
        lx = mx; ly = my; lz = mz; vl = vm;
        if (lastSide === -1) vh *= 0.5;
        lastSide = -1;
      } else {
        hx = mx; hy = my; hz = mz; vh = vm;
        if (lastSide === 1) vl *= 0.5;
        lastSide = 1;
      }
    }
    // Final interpolation inside the surviving bracket.
    const t = vh - vl > 1e-20 ? vl / (vl - vh) : 0.5;
    const pos: Vec3 = [lx + (hx - lx) * t, ly + (hy - ly) * t, lz + (hz - lz) * t];
    const g = sdfGradient(sdf, pos, eps);
    const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
    return { pos, normal: [g[0] / len, g[1] / len, g[2] / len] };
  }

  // Edge crossing cache: key = (min_corner_flat_index * 3 + dir)
  // Each grid edge is shared by up to 4 cells; caching avoids redundant
  // bisection + gradient evaluations.
  const edgeCache = new Map<number, { pos: Vec3; normal: Vec3 }>();

  function cachedCrossing(
    x1: number, y1: number, z1: number, v1: number,
    x2: number, y2: number, z2: number, v2: number,
  ): { pos: Vec3; normal: Vec3 } {
    const dir = x1 !== x2 ? 0 : y1 !== y2 ? 1 : 2;
    const mx = Math.min(x1, x2), my = Math.min(y1, y2), mz = Math.min(z1, z2);
    const key = (mz * r2 + my * res + mx) * 3 + dir;
    const cached = edgeCache.get(key);
    if (cached) return cached;
    const result = findCrossing(x1, y1, z1, v1, x2, y2, z2, v2);
    edgeCache.set(key, result);
    return result;
  }

  // --- Step 1: One vertex per surface patch per cell ---
  // cellBase[cell] = index of the cell's first patch vertex (-1 = no surface).
  // Patch k's vertex is cellBase + k. Cells with a single patch are the
  // overwhelming majority, so the per-edge patch map is only stored for
  // multi-patch cells; a missing entry means "patch 0".
  const cellBase = new Int32Array(res * res * res).fill(-1);
  const multiPatchCells = new Map<number, Int8Array>();
  const positions: number[] = [];
  const normals: number[] = [];
  let vertCount = 0;

  // Only collected when clustering: the cell each vertex came from, its hermite
  // QEF, and whether it may merge at all. Left empty otherwise so the dense
  // path pays nothing for a feature it is not using.
  const vertCellList: number[] = [];
  const vertQList: number[] = [];
  const mergeableList: number[] = [];

  let lastPct = -1;
  forEachCell((x, y, z) => {
    {
      {
        const corners = [
          gv(x, y, z), gv(x + 1, y, z), gv(x + 1, y + 1, z), gv(x, y + 1, z),
          gv(x, y, z + 1), gv(x + 1, y, z + 1), gv(x + 1, y + 1, z + 1), gv(x, y + 1, z + 1),
        ];

        let config = 0;
        for (let c = 0; c < 8; c++) if (corners[c] < 0) config |= 1 << c;
        const patches = PATCHES[config];
        if (patches.length === 0) return;

        const cellIdx = z * r2 + y * res + x;
        cellBase[cellIdx] = vertCount;
        if (patches.length > 1) multiPatchCells.set(cellIdx, EDGE_PATCH[config]);

        for (const patchEdges of patches) {
          const crossPoints: Vec3[] = [];
          const crossNormals: Vec3[] = [];
          for (const e of patchEdges) {
            const [c1, c2] = EC[e];
            const o1 = CO[c1], o2 = CO[c2];
            const { pos, normal } = cachedCrossing(
              x + o1[0], y + o1[1], z + o1[2], corners[c1],
              x + o2[0], y + o2[1], z + o2[2], corners[c2],
            );
            crossPoints.push(pos);
            crossNormals.push(normal);
          }

          // Mass point = centroid of this patch's intersections
          const mp: Vec3 = [0, 0, 0];
          for (const p of crossPoints) { mp[0] += p[0]; mp[1] += p[1]; mp[2] += p[2]; }
          mp[0] /= crossPoints.length; mp[1] /= crossPoints.length; mp[2] /= crossPoints.length;

          let v = solveQEF(crossPoints, crossNormals, mp);

          // Clamp strictly to the cell so neighboring cells' surfaces
          // cannot cross each other.
          const cxMin = ox + x * dx, cxMax = ox + (x + 1) * dx;
          const cyMin = oy + y * dy, cyMax = oy + (y + 1) * dy;
          const czMin = oz + z * dz, czMax = oz + (z + 1) * dz;
          v = [
            Math.max(cxMin, Math.min(cxMax, v[0])),
            Math.max(cyMin, Math.min(cyMax, v[1])),
            Math.max(czMin, Math.min(czMax, v[2])),
          ];

          const g = sdfGradient(sdf, v, eps);
          const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;

          if (clustering) {
            const q = new Float64Array(QEF_STRIDE);
            for (let i = 0; i < crossPoints.length; i++) addSample(q, 0, crossPoints[i], crossNormals[i]);
            for (let i = 0; i < QEF_STRIDE; i++) vertQList.push(q[i]);
            vertCellList.push(cellIdx);
            // A cell with several patches holds several surface sheets; merging
            // them is the non-manifold pinch the patch split exists to prevent.
            mergeableList.push(patches.length > 1 ? 0 : 1);
          }

          vertCount++;
          positions.push(v[0], v[1], v[2]);
          normals.push(-g[0] / len, -g[1] / len, -g[2] / len);
        }
      }
    }
  }, (frac) => {
    if (!onProgress) return;
    const pct = Math.round(frac * 100);
    if (pct > lastPct) { lastPct = pct; onProgress(pct); }
  });

  // --- Step 1b: Collapse cells that one vertex can represent ---------------
  //
  // Only the identity of the vertex each cell names changes. Step 2 still emits
  // exactly one quad per sign-changing grid edge over the same four cells, so
  // the mesh stays closed by construction and there are no cracks to stitch.
  let vertexRemap: Int32Array | null = null;
  if (clustering && vertCount > 0) {
    const cluster = clusterByOctree(
      vertCount,
      Int32Array.from(vertCellList),
      Float64Array.from(vertQList),
      Uint8Array.from(mergeableList),
      res,
      clusterError,
    );

    const newPos = new Float64Array(cluster.count * 3);
    const newNorm = new Float64Array(cluster.count * 3);
    // A cluster of one keeps step 1's vertex exactly, so a mesh where nothing
    // collapsed is identical to the dense one rather than merely close.
    const representative = new Int32Array(cluster.count).fill(-1);
    for (let v = vertCount - 1; v >= 0; v--) representative[cluster.remap[v]] = v;

    for (let c = 0; c < cluster.count; c++) {
      const rep = representative[c];
      if (cluster.size[c] === 1) {
        newPos[c * 3] = positions[rep * 3];
        newPos[c * 3 + 1] = positions[rep * 3 + 1];
        newPos[c * 3 + 2] = positions[rep * 3 + 2];
        newNorm[c * 3] = normals[rep * 3];
        newNorm[c * 3 + 1] = normals[rep * 3 + 1];
        newNorm[c * 3 + 2] = normals[rep * 3 + 2];
        continue;
      }
      let p = solveCluster(cluster.qef, c * QEF_STRIDE);
      // Clamped into the node it represents, for the same reason step 1 clamps
      // into the cell: a vertex outside its own region can cross a neighbour's.
      const key = cluster.key[c], size = 1 << cluster.level[c];
      const nz = (key / r2) | 0, ny = ((key % r2) / res) | 0, nx = key % res;
      p = [
        Math.max(ox + nx * dx, Math.min(ox + (nx + size) * dx, p[0])),
        Math.max(oy + ny * dy, Math.min(oy + (ny + size) * dy, p[1])),
        Math.max(oz + nz * dz, Math.min(oz + (nz + size) * dz, p[2])),
      ];
      newPos[c * 3] = p[0]; newPos[c * 3 + 1] = p[1]; newPos[c * 3 + 2] = p[2];
      const cg = sdfGradient(sdf, p, eps);
      const cl = Math.sqrt(cg[0] * cg[0] + cg[1] * cg[1] + cg[2] * cg[2]) || 1;
      newNorm[c * 3] = -cg[0] / cl; newNorm[c * 3 + 1] = -cg[1] / cl; newNorm[c * 3 + 2] = -cg[2] / cl;
    }

    positions.length = 0;
    normals.length = 0;
    for (let i = 0; i < newPos.length; i++) { positions.push(newPos[i]); normals.push(newNorm[i]); }
    vertexRemap = cluster.remap;
  }

  // --- Step 2: Emit quads for each sign-changing grid edge ---
  // The 4 cells sharing the edge each contribute the vertex of the patch
  // that contains this edge (looked up through the cell's local edge index).
  const indices: number[] = [];

  function vertexFor(cx: number, cy: number, cz: number, localEdge: number): number {
    const cellIdx = cz * r2 + cy * res + cx;
    const base = cellBase[cellIdx];
    if (base < 0) return -1;
    const edgePatch = multiPatchCells.get(cellIdx);
    let v: number;
    if (edgePatch === undefined) {
      v = base;
    } else {
      const patch = edgePatch[localEdge];
      if (patch < 0) return -1;
      v = base + patch;
    }
    return vertexRemap === null ? v : vertexRemap[v];
  }

  function triDot(a: number, b: number, c: number, d: number): number {
    // Dot of the unit normals of triangles (a,b,c) and (a,c,d)
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const px = positions[d * 3], py = positions[d * 3 + 1], pz = positions[d * 3 + 2];
    const n1x = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const n1y = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const n1z = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const n2x = (cy - ay) * (pz - az) - (cz - az) * (py - ay);
    const n2y = (cz - az) * (px - ax) - (cx - ax) * (pz - az);
    const n2z = (cx - ax) * (py - ay) - (cy - ay) * (px - ax);
    const l1 = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z);
    const l2 = Math.sqrt(n2x * n2x + n2y * n2y + n2z * n2z);
    if (l1 < 1e-20 || l2 < 1e-20) return -2; // degenerate split — avoid
    return (n1x * n2x + n1y * n2y + n1z * n2z) / (l1 * l2);
  }

  /**
   * Emit a quad over ring r0..r3, split along whichever diagonal keeps the
   * two triangles most coplanar (avoids folds and slivers on curved areas).
   */
  function emitQuad(r0: number, r1: number, r2q: number, r3: number) {
    if (r0 < 0 || r1 < 0 || r2q < 0 || r3 < 0) return;
    if (vertexRemap !== null) {
      // Clustering merges ring corners. Dropping duplicates in place preserves
      // the winding, and a ring left with fewer than three distinct vertices
      // had no area. This is where the triangle count actually falls: the quad
      // is never emitted rather than being removed by a later pass.
      if (r0 === r1 || r1 === r2q || r2q === r3 || r3 === r0 || r0 === r2q || r1 === r3) {
        const ring = [r0, r1, r2q, r3];
        const uniq: number[] = [];
        for (let i = 0; i < 4; i++) if (ring[i] !== ring[(i + 3) % 4]) uniq.push(ring[i]);
        if (uniq.length < 3) return;
        if (uniq.length === 3) {
          if (uniq[0] === uniq[1] || uniq[1] === uniq[2] || uniq[0] === uniq[2]) return;
          indices.push(uniq[0], uniq[1], uniq[2]);
          return;
        }
        r0 = uniq[0]; r1 = uniq[1]; r2q = uniq[2]; r3 = uniq[3];
      }
    }
    const qA = triDot(r0, r1, r2q, r3); // diagonal r0-r2
    const qB = triDot(r1, r2q, r3, r0); // diagonal r1-r3
    if (qB > qA) {
      indices.push(r1, r2q, r3);
      indices.push(r1, r3, r0);
    } else {
      indices.push(r0, r1, r2q);
      indices.push(r0, r2q, r3);
    }
  }

  forEachCell((x, y, z) => {
    {
      {
        const v00 = gv(x, y, z);

        // X-edge: (x,y,z)→(x+1,y,z); local edge in each adjacent cell:
        //   (x,y,z)=0, (x,y,z-1)=4, (x,y-1,z-1)=6, (x,y-1,z)=2
        if (x < res - 2 && y > 0 && z > 0) {
          const v10 = gv(x + 1, y, z);
          if ((v00 < 0) !== (v10 < 0)) {
            const a = vertexFor(x, y, z, 0);
            const b = vertexFor(x, y, z - 1, 4);
            const c = vertexFor(x, y - 1, z - 1, 6);
            const d = vertexFor(x, y - 1, z, 2);
            if (v00 < 0) emitQuad(a, d, c, b);
            else emitQuad(a, b, c, d);
          }
        }

        // Y-edge: (x,y,z)→(x,y+1,z); local edges:
        //   (x,y,z)=3, (x-1,y,z)=1, (x-1,y,z-1)=5, (x,y,z-1)=7
        if (y < res - 2 && x > 0 && z > 0) {
          const v01 = gv(x, y + 1, z);
          if ((v00 < 0) !== (v01 < 0)) {
            const a = vertexFor(x, y, z, 3);
            const b = vertexFor(x - 1, y, z, 1);
            const c = vertexFor(x - 1, y, z - 1, 5);
            const d = vertexFor(x, y, z - 1, 7);
            if (v00 < 0) emitQuad(a, d, c, b);
            else emitQuad(a, b, c, d);
          }
        }

        // Z-edge: (x,y,z)→(x,y,z+1); local edges:
        //   (x,y,z)=8, (x,y-1,z)=11, (x-1,y-1,z)=10, (x-1,y,z)=9
        if (z < res - 2 && x > 0 && y > 0) {
          const v001 = gv(x, y, z + 1);
          if ((v00 < 0) !== (v001 < 0)) {
            const a = vertexFor(x, y, z, 8);
            const b = vertexFor(x, y - 1, z, 11);
            const c = vertexFor(x - 1, y - 1, z, 10);
            const d = vertexFor(x - 1, y, z, 9);
            if (v00 < 0) emitQuad(a, d, c, b);
            else emitQuad(a, b, c, d);
          }
        }
      }
    }
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

import type { SDFNode, BBox, Vec3 } from './types';
import { evaluateSDF } from './evaluate';
import { EDGE_TABLE, TRI_TABLE } from './tables';

export interface MeshResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  thickness?: Float32Array;
}

const EC: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const CO: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

const EDGE_DIRS = [0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2];

const BISECT_ITERS = 6;
const SHARP_ANGLE_COS = Math.cos(1.05); // ~60 degrees

/** Compute SDF gradient (unnormalized) at a point via central differences */
function sdfGradient(sdf: SDFNode, p: Vec3, eps: number): Vec3 {
  return [
    evaluateSDF(sdf, [p[0] + eps, p[1], p[2]]) - evaluateSDF(sdf, [p[0] - eps, p[1], p[2]]),
    evaluateSDF(sdf, [p[0], p[1] + eps, p[2]]) - evaluateSDF(sdf, [p[0], p[1] - eps, p[2]]),
    evaluateSDF(sdf, [p[0], p[1], p[2] + eps]) - evaluateSDF(sdf, [p[0], p[1], p[2] - eps]),
  ];
}

export function marchingCubes(grid: Float32Array, res: number, bbox: BBox, sdf?: SDFNode): MeshResult {
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;
  const ox = bbox.min[0] + dx * 0.5;
  const oy = bbox.min[1] + dy * 0.5;
  const oz = bbox.min[2] + dz * 0.5;
  const r2 = res * res;

  const eps = Math.min(dx, dy, dz) * 0.01;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  const cache = new Map<number, number>();

  function gv(x: number, y: number, z: number): number {
    if (x < 0 || x >= res || y < 0 || y >= res || z < 0 || z >= res) return 1;
    return grid[z * r2 + y * res + x];
  }

  function addVert(
    x1: number, y1: number, z1: number, v1: number,
    x2: number, y2: number, z2: number, v2: number,
    eDir: number,
  ): number {
    const mx = Math.min(x1, x2), my = Math.min(y1, y2), mz = Math.min(z1, z2);
    const key = (mz * r2 + my * res + mx) * 3 + eDir;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const t = Math.abs(v1) / (Math.abs(v1) + Math.abs(v2) + 1e-20);
    let px = ox + (x1 + (x2 - x1) * t) * dx;
    let py = oy + (y1 + (y2 - y1) * t) * dy;
    let pz = oz + (z1 + (z2 - z1) * t) * dz;

    if (sdf) {
      // Bisection refinement using the actual SDF
      let lx: number, ly: number, lz: number;
      let hx: number, hy: number, hz: number;
      if (v1 < 0) {
        lx = ox + x1 * dx; ly = oy + y1 * dy; lz = oz + z1 * dz;
        hx = ox + x2 * dx; hy = oy + y2 * dy; hz = oz + z2 * dz;
      } else {
        lx = ox + x2 * dx; ly = oy + y2 * dy; lz = oz + z2 * dz;
        hx = ox + x1 * dx; hy = oy + y1 * dy; hz = oz + z1 * dz;
      }
      for (let i = 0; i < BISECT_ITERS; i++) {
        const mx2 = (lx + hx) * 0.5, my2 = (ly + hy) * 0.5, mz2 = (lz + hz) * 0.5;
        const val = evaluateSDF(sdf, [mx2, my2, mz2]);
        if (val < 0) { lx = mx2; ly = my2; lz = mz2; }
        else { hx = mx2; hy = my2; hz = mz2; }
      }
      px = (lx + hx) * 0.5;
      py = (ly + hy) * 0.5;
      pz = (lz + hz) * 0.5;

      // SDF-based normal
      const g = sdfGradient(sdf, [px, py, pz], eps);
      const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
      positions.push(px, py, pz);
      normals.push(-g[0] / len, -g[1] / len, -g[2] / len);
    } else {
      positions.push(px, py, pz);
      const ix = Math.max(1, Math.min(res - 2, Math.round((px - bbox.min[0]) / dx - 0.5)));
      const iy = Math.max(1, Math.min(res - 2, Math.round((py - bbox.min[1]) / dy - 0.5)));
      const iz = Math.max(1, Math.min(res - 2, Math.round((pz - bbox.min[2]) / dz - 0.5)));
      const nx = gv(ix + 1, iy, iz) - gv(ix - 1, iy, iz);
      const ny = gv(ix, iy + 1, iz) - gv(ix, iy - 1, iz);
      const nz = gv(ix, iy, iz + 1) - gv(ix, iy, iz - 1);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals.push(-nx / len, -ny / len, -nz / len);
    }

    const idx = vertCount++;
    cache.set(key, idx);
    return idx;
  }

  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        let cubeIdx = 0;
        const v0 = grid[z * r2 + y * res + x];
        const v1 = grid[z * r2 + y * res + x + 1];
        const v2 = grid[z * r2 + (y + 1) * res + x + 1];
        const v3 = grid[z * r2 + (y + 1) * res + x];
        const v4 = grid[(z + 1) * r2 + y * res + x];
        const v5 = grid[(z + 1) * r2 + y * res + x + 1];
        const v6 = grid[(z + 1) * r2 + (y + 1) * res + x + 1];
        const v7 = grid[(z + 1) * r2 + (y + 1) * res + x];
        const vals = [v0, v1, v2, v3, v4, v5, v6, v7];

        if (v0 < 0) cubeIdx |= 1;
        if (v1 < 0) cubeIdx |= 2;
        if (v2 < 0) cubeIdx |= 4;
        if (v3 < 0) cubeIdx |= 8;
        if (v4 < 0) cubeIdx |= 16;
        if (v5 < 0) cubeIdx |= 32;
        if (v6 < 0) cubeIdx |= 64;
        if (v7 < 0) cubeIdx |= 128;

        if (cubeIdx === 0 || cubeIdx === 255) continue;
        const edges = EDGE_TABLE[cubeIdx];
        if (edges === 0) continue;

        const ev: number[] = new Array(12);
        for (let e = 0; e < 12; e++) {
          if (edges & (1 << e)) {
            const [c1, c2] = EC[e];
            ev[e] = addVert(
              x + CO[c1][0], y + CO[c1][1], z + CO[c1][2], vals[c1],
              x + CO[c2][0], y + CO[c2][1], z + CO[c2][2], vals[c2],
              EDGE_DIRS[e],
            );
          }
        }

        const triRow = TRI_TABLE[cubeIdx];
        for (let t = 0; t < triRow.length; t += 3) {
          const a = ev[triRow[t]], b = ev[triRow[t + 1]], c = ev[triRow[t + 2]];
          if (a === b || b === c || a === c) continue;
          const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
          const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
          const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
          const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
          const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
          const crossX = e1y * e2z - e1z * e2y;
          const crossY = e1z * e2x - e1x * e2z;
          const crossZ = e1x * e2y - e1y * e2x;
          const area2 = crossX * crossX + crossY * crossY + crossZ * crossZ;
          if (area2 < 1e-20) continue;
          indices.push(a, c, b);
        }
      }
    }
  }

  // Sharp feature vertex repositioning — works on output mesh topology.
  // For each vertex, collect normals from adjacent faces. If normals diverge
  // (sharp feature), solve a QEF on the face planes to find the feature point.
  if (sdf) {
    const numVerts = vertCount;
    const numTris = indices.length / 3;

    // Compute face normals
    const faceN: [number, number, number][] = new Array(numTris);
    for (let t = 0; t < numTris; t++) {
      const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
      const e1x = positions[i1 * 3] - positions[i0 * 3];
      const e1y = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      const e1z = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      const e2x = positions[i2 * 3] - positions[i0 * 3];
      const e2y = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      const e2z = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      faceN[t] = [nx / len, ny / len, nz / len];
    }

    // vertex → adjacent face indices
    const vertFaces: number[][] = new Array(numVerts);
    for (let i = 0; i < numVerts; i++) vertFaces[i] = [];
    for (let t = 0; t < numTris; t++) {
      vertFaces[indices[t * 3]].push(t);
      vertFaces[indices[t * 3 + 1]].push(t);
      vertFaces[indices[t * 3 + 2]].push(t);
    }

    const maxDisp = Math.max(dx, dy, dz) * 1.5;

    for (let vi = 0; vi < numVerts; vi++) {
      const faces = vertFaces[vi];
      if (faces.length < 2) continue;

      // Check if any pair of adjacent face normals diverges beyond threshold
      let sharp = false;
      for (let i = 0; i < faces.length && !sharp; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const [ax, ay, az] = faceN[faces[i]];
          const [bx, by, bz] = faceN[faces[j]];
          if (ax * bx + ay * by + az * bz < SHARP_ANGLE_COS) { sharp = true; break; }
        }
      }
      if (!sharp) continue;

      // Collect face planes as tangent planes for QEF.
      // Each face contributes its normal and a point on the face (the vertex itself
      // projected onto the face plane).
      // Use unique normals only (faces on the same flat region share a normal).
      const planes: { nx: number; ny: number; nz: number; d: number }[] = [];
      for (const f of faces) {
        const [nx, ny, nz] = faceN[f];
        // Check if we already have this normal
        let dup = false;
        for (const p of planes) {
          if (p.nx * nx + p.ny * ny + p.nz * nz > 0.999) { dup = true; break; }
        }
        if (dup) continue;
        // Plane equation: n . x = d, where d = n . (any vertex of the face)
        const fv = indices[f * 3];
        const d = nx * positions[fv * 3] + ny * positions[fv * 3 + 1] + nz * positions[fv * 3 + 2];
        planes.push({ nx, ny, nz, d });
      }
      if (planes.length < 2) continue;

      // Solve QEF: minimize sum_i (n_i . x - d_i)^2
      // Normal equations: A^T A x = A^T b
      let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
      let b0 = 0, b1 = 0, b2 = 0;
      for (const pl of planes) {
        a00 += pl.nx * pl.nx; a01 += pl.nx * pl.ny; a02 += pl.nx * pl.nz;
        a11 += pl.ny * pl.ny; a12 += pl.ny * pl.nz; a22 += pl.nz * pl.nz;
        b0 += pl.nx * pl.d; b1 += pl.ny * pl.d; b2 += pl.nz * pl.d;
      }

      // Tikhonov regularization toward the current vertex position
      const cx = positions[vi * 3], cy = positions[vi * 3 + 1], cz = positions[vi * 3 + 2];
      const w = 0.01 * planes.length;
      a00 += w; a11 += w; a22 += w;
      b0 += w * cx; b1 += w * cy; b2 += w * cz;

      const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
      if (Math.abs(det) < 1e-12) continue;

      const inv = 1 / det;
      const qx = ((a11 * a22 - a12 * a12) * b0 + (a02 * a12 - a01 * a22) * b1 + (a01 * a12 - a02 * a11) * b2) * inv;
      const qy = ((a02 * a12 - a01 * a22) * b0 + (a00 * a22 - a02 * a02) * b1 + (a01 * a02 - a00 * a12) * b2) * inv;
      const qz = ((a01 * a12 - a02 * a11) * b0 + (a01 * a02 - a00 * a12) * b1 + (a00 * a11 - a01 * a01) * b2) * inv;

      // Clamp displacement
      positions[vi * 3] = Math.max(cx - maxDisp, Math.min(cx + maxDisp, qx));
      positions[vi * 3 + 1] = Math.max(cy - maxDisp, Math.min(cy + maxDisp, qy));
      positions[vi * 3 + 2] = Math.max(cz - maxDisp, Math.min(cz + maxDisp, qz));

      // Recompute normal at new position
      const gn = sdfGradient(sdf, [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]], eps);
      const len = Math.sqrt(gn[0] * gn[0] + gn[1] * gn[1] + gn[2] * gn[2]) || 1;
      normals[vi * 3] = -gn[0] / len;
      normals[vi * 3 + 1] = -gn[1] / len;
      normals[vi * 3 + 2] = -gn[2] / len;
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

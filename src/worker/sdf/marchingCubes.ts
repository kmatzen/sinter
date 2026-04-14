import type { BBox } from './types';
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

export function marchingCubes(grid: Float32Array, res: number, bbox: BBox): MeshResult {
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;
  const ox = bbox.min[0] + dx * 0.5;
  const oy = bbox.min[1] + dy * 0.5;
  const oz = bbox.min[2] + dz * 0.5;
  const r2 = res * res;

  // Use plain arrays (fast enough, avoids buffer overflows)
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  // Edge cache: key = (min_corner_index * 3 + edgeDir)
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
    const px = ox + (x1 + (x2 - x1) * t) * dx;
    const py = oy + (y1 + (y2 - y1) * t) * dy;
    const pz = oz + (z1 + (z2 - z1) * t) * dz;
    positions.push(px, py, pz);

    // Gradient-based normal
    const ix = Math.max(1, Math.min(res - 2, Math.round((px - bbox.min[0]) / dx - 0.5)));
    const iy = Math.max(1, Math.min(res - 2, Math.round((py - bbox.min[1]) / dy - 0.5)));
    const iz = Math.max(1, Math.min(res - 2, Math.round((pz - bbox.min[2]) / dz - 0.5)));
    const nx = gv(ix + 1, iy, iz) - gv(ix - 1, iy, iz);
    const ny = gv(ix, iy + 1, iz) - gv(ix, iy - 1, iz);
    const nz = gv(ix, iy, iz + 1) - gv(ix, iy, iz - 1);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals.push(-nx / len, -ny / len, -nz / len);

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
          // Skip degenerate triangles (duplicate vertices)
          if (a === b || b === c || a === c) continue;
          // Skip zero-area triangles
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
          indices.push(a, c, b); // swap winding: TRI_TABLE assumes positive=inside, we use negative=inside
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

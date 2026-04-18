/**
 * Dual Contouring — places one vertex per cell at the QEF minimizer
 * of all edge crossings, naturally capturing sharp edges and corners.
 *
 * Unlike marching cubes (vertices on grid edges), DC vertices can sit
 * anywhere inside a cell, so they land directly on creases where two
 * surface planes intersect.
 */

import type { SDFNode, BBox, Vec3 } from './types';
import { evaluateSDF } from './evaluate';
import type { MeshResult } from './marchingCubes';

const BISECT_ITERS = 6;

/** Compute SDF gradient via central differences */
function sdfGradient(sdf: SDFNode, p: Vec3, eps: number): Vec3 {
  return [
    evaluateSDF(sdf, [p[0] + eps, p[1], p[2]]) - evaluateSDF(sdf, [p[0] - eps, p[1], p[2]]),
    evaluateSDF(sdf, [p[0], p[1] + eps, p[2]]) - evaluateSDF(sdf, [p[0], p[1] - eps, p[2]]),
    evaluateSDF(sdf, [p[0], p[1], p[2] + eps]) - evaluateSDF(sdf, [p[0], p[1], p[2] - eps]),
  ];
}

/**
 * Solve QEF: minimize sum_i (n_i . (x - p_i))^2 with Tikhonov
 * regularization toward the mass point (centroid of intersections).
 */
function solveQEF(
  points: Vec3[], normals: Vec3[], massPoint: Vec3,
): Vec3 {
  let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
  let b0 = 0, b1 = 0, b2 = 0;

  for (let i = 0; i < points.length; i++) {
    const [nx, ny, nz] = normals[i];
    const d = nx * points[i][0] + ny * points[i][1] + nz * points[i][2];
    a00 += nx * nx; a01 += nx * ny; a02 += nx * nz;
    a11 += ny * ny; a12 += ny * nz; a22 += nz * nz;
    b0 += nx * d; b1 += ny * d; b2 += nz * d;
  }

  // Regularization toward mass point
  const w = 0.01 * points.length;
  a00 += w; a11 += w; a22 += w;
  b0 += w * massPoint[0]; b1 += w * massPoint[1]; b2 += w * massPoint[2];

  const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
  if (Math.abs(det) < 1e-12) return massPoint;

  const inv = 1 / det;
  return [
    ((a11 * a22 - a12 * a12) * b0 + (a02 * a12 - a01 * a22) * b1 + (a01 * a12 - a02 * a11) * b2) * inv,
    ((a02 * a12 - a01 * a22) * b0 + (a00 * a22 - a02 * a02) * b1 + (a01 * a02 - a00 * a12) * b2) * inv,
    ((a01 * a12 - a02 * a11) * b0 + (a01 * a02 - a00 * a12) * b1 + (a00 * a11 - a01 * a01) * b2) * inv,
  ];
}

export function dualContour(grid: Float32Array, res: number, bbox: BBox, sdf: SDFNode): MeshResult {
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;
  const ox = bbox.min[0] + dx * 0.5;
  const oy = bbox.min[1] + dy * 0.5;
  const oz = bbox.min[2] + dz * 0.5;
  const r2 = res * res;
  const eps = Math.min(dx, dy, dz) * 0.01;

  function gv(x: number, y: number, z: number): number {
    if (x < 0 || x >= res || y < 0 || y >= res || z < 0 || z >= res) return 1;
    return grid[z * r2 + y * res + x];
  }

  /** Find zero crossing on a grid edge via bisection */
  function findCrossing(
    x1: number, y1: number, z1: number, v1: number,
    x2: number, y2: number, z2: number, _v2: number,
  ): { pos: Vec3; normal: Vec3 } {
    // World-space endpoints
    let lx: number, ly: number, lz: number; // inside (negative)
    let hx: number, hy: number, hz: number; // outside (positive)
    if (v1 < 0) {
      lx = ox + x1 * dx; ly = oy + y1 * dy; lz = oz + z1 * dz;
      hx = ox + x2 * dx; hy = oy + y2 * dy; hz = oz + z2 * dz;
    } else {
      lx = ox + x2 * dx; ly = oy + y2 * dy; lz = oz + z2 * dz;
      hx = ox + x1 * dx; hy = oy + y1 * dy; hz = oz + z1 * dz;
    }
    for (let i = 0; i < BISECT_ITERS; i++) {
      const mx = (lx + hx) * 0.5, my = (ly + hy) * 0.5, mz = (lz + hz) * 0.5;
      if (evaluateSDF(sdf, [mx, my, mz]) < 0) { lx = mx; ly = my; lz = mz; }
      else { hx = mx; hy = my; hz = mz; }
    }
    const pos: Vec3 = [(lx + hx) * 0.5, (ly + hy) * 0.5, (lz + hz) * 0.5];
    const g = sdfGradient(sdf, pos, eps);
    const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
    return { pos, normal: [g[0] / len, g[1] / len, g[2] / len] };
  }

  // --- Step 1: Compute one vertex per active cell ---
  // cellVert[z][y][x] = vertex index, or -1 if cell has no sign change
  // Active cell: any of its 12 edges has a sign change
  const cellVert = new Int32Array(res * res * res).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  let vertCount = 0;

  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        const corners = [
          gv(x, y, z), gv(x + 1, y, z), gv(x + 1, y + 1, z), gv(x, y + 1, z),
          gv(x, y, z + 1), gv(x + 1, y, z + 1), gv(x + 1, y + 1, z + 1), gv(x, y + 1, z + 1),
        ];

        // Check sign changes on all 12 edges
        const edgeCorners: [number, number][] = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7],
        ];
        const cornerOffsets: [number, number, number][] = [
          [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
          [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
        ];

        const crossPoints: Vec3[] = [];
        const crossNormals: Vec3[] = [];

        for (const [c1, c2] of edgeCorners) {
          if ((corners[c1] < 0) !== (corners[c2] < 0)) {
            const o1 = cornerOffsets[c1], o2 = cornerOffsets[c2];
            const { pos, normal } = findCrossing(
              x + o1[0], y + o1[1], z + o1[2], corners[c1],
              x + o2[0], y + o2[1], z + o2[2], corners[c2],
            );
            crossPoints.push(pos);
            crossNormals.push(normal);
          }
        }

        if (crossPoints.length === 0) continue;

        // Mass point = centroid of intersections
        const mp: Vec3 = [0, 0, 0];
        for (const p of crossPoints) { mp[0] += p[0]; mp[1] += p[1]; mp[2] += p[2]; }
        mp[0] /= crossPoints.length; mp[1] /= crossPoints.length; mp[2] /= crossPoints.length;

        // Solve QEF
        let v = solveQEF(crossPoints, crossNormals, mp);

        // Clamp to cell bounds (with small margin)
        const margin = 0.1;
        const cxMin = ox + x * dx - dx * margin, cxMax = ox + (x + 1) * dx + dx * margin;
        const cyMin = oy + y * dy - dy * margin, cyMax = oy + (y + 1) * dy + dy * margin;
        const czMin = oz + z * dz - dz * margin, czMax = oz + (z + 1) * dz + dz * margin;
        v = [
          Math.max(cxMin, Math.min(cxMax, v[0])),
          Math.max(cyMin, Math.min(cyMax, v[1])),
          Math.max(czMin, Math.min(czMax, v[2])),
        ];

        // Compute vertex normal from SDF gradient
        const g = sdfGradient(sdf, v, eps);
        const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;

        const vi = vertCount++;
        cellVert[z * r2 + y * res + x] = vi;
        positions.push(v[0], v[1], v[2]);
        normals.push(-g[0] / len, -g[1] / len, -g[2] / len);
      }
    }
  }

  // --- Step 2: Emit quads for each sign-changing grid edge ---
  const indices: number[] = [];

  // For each internal grid edge with a sign change, connect the 4 cells
  // that share that edge. The 4 cells form a quad.
  //
  // X-edges: edge from (x,y,z) to (x+1,y,z)
  //   shared by cells (x,y,z), (x,y-1,z), (x,y,z-1), (x,y-1,z-1)
  // Y-edges: edge from (x,y,z) to (x,y+1,z)
  //   shared by cells (x,y,z), (x-1,y,z), (x,y,z-1), (x-1,y,z-1)
  // Z-edges: edge from (x,y,z) to (x,y,z+1)
  //   shared by cells (x,y,z), (x-1,y,z), (x,y-1,z), (x-1,y-1,z)

  function emitQuad(v0: number, v1: number, v2: number, v3: number, flip: boolean) {
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip) {
      indices.push(v0, v2, v1);
      indices.push(v0, v3, v2);
    } else {
      indices.push(v0, v1, v2);
      indices.push(v0, v2, v3);
    }
  }

  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        const v00 = gv(x, y, z);

        // X-edge: (x,y,z)→(x+1,y,z)
        if (x < res - 2 && y > 0 && z > 0) {
          const v10 = gv(x + 1, y, z);
          if ((v00 < 0) !== (v10 < 0)) {
            emitQuad(
              cellVert[z * r2 + y * res + x],
              cellVert[(z - 1) * r2 + y * res + x],
              cellVert[(z - 1) * r2 + (y - 1) * res + x],
              cellVert[z * r2 + (y - 1) * res + x],
              v00 < 0,
            );
          }
        }

        // Y-edge: (x,y,z)→(x,y+1,z)
        if (y < res - 2 && x > 0 && z > 0) {
          const v01 = gv(x, y + 1, z);
          if ((v00 < 0) !== (v01 < 0)) {
            emitQuad(
              cellVert[z * r2 + y * res + x],
              cellVert[z * r2 + y * res + (x - 1)],
              cellVert[(z - 1) * r2 + y * res + (x - 1)],
              cellVert[(z - 1) * r2 + y * res + x],
              v00 < 0,
            );
          }
        }

        // Z-edge: (x,y,z)→(x,y,z+1)
        if (z < res - 2 && x > 0 && y > 0) {
          const v001 = gv(x, y, z + 1);
          if ((v00 < 0) !== (v001 < 0)) {
            emitQuad(
              cellVert[z * r2 + y * res + x],
              cellVert[z * r2 + (y - 1) * res + x],
              cellVert[z * r2 + (y - 1) * res + (x - 1)],
              cellVert[z * r2 + y * res + (x - 1)],
              v00 < 0,
            );
          }
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

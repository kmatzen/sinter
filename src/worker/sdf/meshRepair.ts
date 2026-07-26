/**
 * Mesh validation and refinement passes run before export.
 *
 * - analyzeMesh: watertightness / manifoldness diagnostics
 * - removeDegenerateTriangles: drops zero-area and repeated-index faces
 * - projectVerticesToSurface: Newton-snaps vertices onto the SDF zero set,
 *   removing the residual grid bias left by contouring + simplification
 */

import type { SDFNode, Vec3 } from './types';
import { evaluateSDF } from './evaluate';
import type { MeshResult } from './marchingCubes';

export interface MeshDiagnostics {
  vertexCount: number;
  triangleCount: number;
  /** Edges referenced by exactly one triangle (holes) */
  boundaryEdges: number;
  /** Edges referenced by three or more triangles */
  nonManifoldEdges: number;
  /** Edges whose two triangles wind the same direction (inconsistent orientation) */
  inconsistentEdges: number;
  /** Triangles with a repeated vertex index */
  degenerateTriangles: number;
  /** Closed, edge-manifold, consistently oriented */
  watertight: boolean;
}

export function analyzeMesh(mesh: MeshResult): MeshDiagnostics {
  const { positions, indices } = mesh;
  const numTris = indices.length / 3;

  // For each undirected edge, count how often it appears in each direction.
  // Key: lo * 2^32-ish namespace via string to stay safe for large meshes.
  const edges = new Map<string, { fwd: number; rev: number }>();
  let degenerateTriangles = 0;

  for (let t = 0; t < numTris; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a === b || b === c || a === c) { degenerateTriangles++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = `${lo},${hi}`;
      let rec = edges.get(key);
      if (!rec) { rec = { fwd: 0, rev: 0 }; edges.set(key, rec); }
      if (u === lo) rec.fwd++;
      else rec.rev++;
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const rec of edges.values()) {
    const total = rec.fwd + rec.rev;
    if (total === 1) boundaryEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (rec.fwd !== 1 || rec.rev !== 1) inconsistentEdges++;
  }

  return {
    vertexCount: positions.length / 3,
    triangleCount: numTris,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    degenerateTriangles,
    watertight:
      numTris > 0 &&
      boundaryEdges === 0 &&
      nonManifoldEdges === 0 &&
      inconsistentEdges === 0 &&
      degenerateTriangles === 0,
  };
}

/**
 * Remove triangles with repeated indices or an area below `minArea`.
 * Vertices are kept as-is (unreferenced vertices are dropped by compaction).
 */
export function removeDegenerateTriangles(mesh: MeshResult, minArea = 0): MeshResult {
  const { positions, normals, indices } = mesh;
  const numTris = indices.length / 3;
  const keptIdx: number[] = [];

  for (let t = 0; t < numTris; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    if (minArea > 0) {
      const e1x = positions[b * 3] - positions[a * 3];
      const e1y = positions[b * 3 + 1] - positions[a * 3 + 1];
      const e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
      const e2x = positions[c * 3] - positions[a * 3];
      const e2y = positions[c * 3 + 1] - positions[a * 3 + 1];
      const e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      if (Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5 < minArea) continue;
    }
    keptIdx.push(a, b, c);
  }

  if (keptIdx.length === indices.length) return mesh;

  // Compact vertices to those still referenced
  const remap = new Int32Array(positions.length / 3).fill(-1);
  const outPos: number[] = [];
  const outNorm: number[] = [];
  const outIdx = new Uint32Array(keptIdx.length);
  let next = 0;
  for (let i = 0; i < keptIdx.length; i++) {
    const v = keptIdx[i];
    if (remap[v] < 0) {
      remap[v] = next++;
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      outNorm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
    }
    outIdx[i] = remap[v];
  }

  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNorm),
    indices: outIdx,
  };
}

/**
 * Newton-project every vertex onto the SDF zero set: v <- v - f(v) g/|g|^2.
 * Total displacement is clamped to `maxDisplacement`, and vertices whose
 * SDF value is already large (relative to the clamp) are left alone —
 * moving those would mean the vertex belongs to a feature the projection
 * cannot see, not surface bias.
 *
 * Vertex normals are refreshed from the SDF gradient at the final position
 * (negated, matching the contouring convention).
 */
export function projectVerticesToSurface(
  mesh: MeshResult,
  sdf: SDFNode,
  maxDisplacement: number,
  iterations = 3,
): MeshResult {
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const numVerts = positions.length / 3;
  const eps = Math.max(maxDisplacement * 0.01, 1e-6);

  const grad = (p: Vec3): Vec3 => [
    evaluateSDF(sdf, [p[0] + eps, p[1], p[2]]) - evaluateSDF(sdf, [p[0] - eps, p[1], p[2]]),
    evaluateSDF(sdf, [p[0], p[1] + eps, p[2]]) - evaluateSDF(sdf, [p[0], p[1] - eps, p[2]]),
    evaluateSDF(sdf, [p[0], p[1], p[2] + eps]) - evaluateSDF(sdf, [p[0], p[1], p[2] - eps]),
  ];

  for (let i = 0; i < numVerts; i++) {
    const sx = positions[i * 3], sy = positions[i * 3 + 1], sz = positions[i * 3 + 2];
    let px = sx, py = sy, pz = sz;

    const d0 = evaluateSDF(sdf, [px, py, pz]);
    if (Math.abs(d0) > maxDisplacement * 2) continue; // not surface bias — leave it

    for (let it = 0; it < iterations; it++) {
      const d = evaluateSDF(sdf, [px, py, pz]);
      if (Math.abs(d) < 1e-9) break;
      const g = grad([px, py, pz]);
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (g2 < 1e-20) break;
      // g is the unscaled central difference (true gradient times 2*eps),
      // so the Newton step d * grad/|grad|^2 becomes d * g * 2*eps / |g|^2.
      const s = (d * 2 * eps) / g2;
      px -= g[0] * s;
      py -= g[1] * s;
      pz -= g[2] * s;
    }

    // Clamp total displacement
    const mx = px - sx, my = py - sy, mz = pz - sz;
    const moved = Math.sqrt(mx * mx + my * my + mz * mz);
    if (moved > maxDisplacement) {
      const s = maxDisplacement / moved;
      px = sx + mx * s; py = sy + my * s; pz = sz + mz * s;
    }

    // Keep the move only if it actually got closer to the surface
    if (Math.abs(evaluateSDF(sdf, [px, py, pz])) >= Math.abs(d0)) continue;

    positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
    const g = grad([px, py, pz]);
    const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
    normals[i * 3] = -g[0] / len;
    normals[i * 3 + 1] = -g[1] / len;
    normals[i * 3 + 2] = -g[2] / len;
  }

  return { ...mesh, positions, normals };
}

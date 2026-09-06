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
import type { BuildDirection, ExportPreflightOptions, OverhangDiagnostics } from '../../types/geometry';

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
  /** Triangle indices that do not reference an existing vertex */
  invalidIndices: number;
  /** Vertices containing NaN or Infinity */
  nonFiniteVertices: number;
  /** Triangles whose three positions enclose effectively no area */
  zeroAreaTriangles: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  dimensions: [number, number, number];
  /** Closed, edge-manifold, consistently oriented */
  watertight: boolean;
}

export function analyzeMesh(mesh: MeshResult): MeshDiagnostics {
  const { positions, indices } = mesh;
  const numTris = indices.length / 3;
  const vertexCount = positions.length / 3;

  // For each undirected edge, count how often it appears in each direction.
  // Key: lo * 2^32-ish namespace via string to stay safe for large meshes.
  const edges = new Map<string, { fwd: number; rev: number }>();
  let degenerateTriangles = 0;
  let invalidIndices = 0;
  let zeroAreaTriangles = 0;
  let nonFiniteVertices = 0;
  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (![x, y, z].every(Number.isFinite)) { nonFiniteVertices++; continue; }
    boundsMin[0] = Math.min(boundsMin[0], x); boundsMax[0] = Math.max(boundsMax[0], x);
    boundsMin[1] = Math.min(boundsMin[1], y); boundsMax[1] = Math.max(boundsMax[1], y);
    boundsMin[2] = Math.min(boundsMin[2], z); boundsMax[2] = Math.max(boundsMax[2], z);
  }

  for (let t = 0; t < numTris; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a === b || b === c || a === c) { degenerateTriangles++; continue; }
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) { invalidIndices++; continue; }
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) continue;
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz <= 1e-24) { zeroAreaTriangles++; continue; }
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
    vertexCount,
    triangleCount: numTris,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    degenerateTriangles,
    invalidIndices,
    nonFiniteVertices,
    zeroAreaTriangles,
    boundsMin: Number.isFinite(boundsMin[0]) ? boundsMin : [0, 0, 0],
    boundsMax: Number.isFinite(boundsMax[0]) ? boundsMax : [0, 0, 0],
    dimensions: Number.isFinite(boundsMin[0])
      ? [boundsMax[0] - boundsMin[0], boundsMax[1] - boundsMin[1], boundsMax[2] - boundsMin[2]]
      : [0, 0, 0],
    watertight:
      numTris > 0 &&
      boundaryEdges === 0 &&
      nonManifoldEdges === 0 &&
      inconsistentEdges === 0 &&
      degenerateTriangles === 0 &&
      invalidIndices === 0 &&
      nonFiniteVertices === 0 &&
      zeroAreaTriangles === 0,
  };
}

const BUILD_VECTORS: Record<BuildDirection, [number, number, number]> = {
  x: [1, 0, 0], '-x': [-1, 0, 0], y: [0, 1, 0], '-y': [0, -1, 0], z: [0, 0, 1], '-z': [0, 0, -1],
};

/** Analyze downward-facing support risk on the exact export triangles. */
export function analyzeOverhangs(mesh: MeshResult, options: ExportPreflightOptions, maxAffectedIds = 256): OverhangDiagnostics {
  const build = BUILD_VECTORS[options.buildDirection] ?? BUILD_VECTORS.z;
  const angle = Math.min(89, Math.max(0, options.overhangAngle));
  // Slicer-style threshold: 0° flags every downward face; increasing the
  // angle permits steeper slopes, while a horizontal underside remains risky.
  const limit = -Math.sin(angle * Math.PI / 180);
  const affectedTriangleIds: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let riskyTriangles = 0;
  let analyzedTriangles = 0;
  const vertexCount = mesh.positions.length / 3;
  const triangleCount = Math.floor(mesh.indices.length / 3);
  for (let t = 0; t < triangleCount; t++) {
    const ids = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    if (ids.some((id) => id >= vertexCount)) continue;
    const a = ids[0] * 3, b = ids[1] * 3, c = ids[2] * 3, p = mesh.positions;
    if (![p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]].every(Number.isFinite)) continue;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...normal);
    if (length <= 1e-12) continue;
    analyzedTriangles++;
    const dot = (normal[0] * build[0] + normal[1] * build[1] + normal[2] * build[2]) / length;
    if (dot > limit) continue;
    riskyTriangles++;
    if (affectedTriangleIds.length < maxAffectedIds) affectedTriangleIds.push(t);
    for (const index of ids) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[index * 3 + axis]);
      max[axis] = Math.max(max[axis], p[index * 3 + axis]);
    }
  }
  return {
    overhangAngle: angle, buildDirection: options.buildDirection, riskyTriangles, analyzedTriangles, affectedTriangleIds,
    affectedBounds: riskyTriangles ? { min, max } : null,
    affectedIdsTruncated: riskyTriangles > affectedTriangleIds.length,
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

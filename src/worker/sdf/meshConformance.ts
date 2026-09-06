import type { MeshResult } from './marchingCubes';
import type { BBox, SDFNode, Vec3 } from './types';
import { evaluateSDF } from './evaluate';
import type { ExportConformance } from '../../types/geometry';

export interface ConformanceBudget { maxMeshSamples?: number; sourceGrid?: number; maxSourceSamples?: number; maxDistanceTests?: number }

function pointTriangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(...sub(p, [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]])); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(...sub(p, [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]])); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Math.hypot(...sub(p, [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]));
  }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return Math.hypot(...sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}

function vertex(mesh: MeshResult, index: number): Vec3 {
  return [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
}

function nearestMeshDistance(mesh: MeshResult, point: Vec3): number {
  let best = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    best = Math.min(best, pointTriangleDistance(point, vertex(mesh, mesh.indices[i]), vertex(mesh, mesh.indices[i + 1]), vertex(mesh, mesh.indices[i + 2])));
  }
  return best;
}

function stats(values: number[]): { max: number; rms: number } {
  if (!values.length) return { max: Infinity, rms: Infinity };
  return { max: Math.max(...values), rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) };
}

// Implicit fields preserve their zero set under conservative scaling, but the
// raw value is not necessarily a world-space distance (an anisotropically
// scaled sphere is the common counterexample). Normalize by the local gradient
// so conformance is reported in physical millimeters.
function implicitSurfaceDistance(sdf: SDFNode, p: Vec3, tolerance: number): number {
  const raw = evaluateSDF(sdf, p);
  const e = Math.max(1e-5, tolerance * 0.1);
  const dx = evaluateSDF(sdf, [p[0] + e, p[1], p[2]]) - evaluateSDF(sdf, [p[0] - e, p[1], p[2]]);
  const dy = evaluateSDF(sdf, [p[0], p[1] + e, p[2]]) - evaluateSDF(sdf, [p[0], p[1] - e, p[2]]);
  const dz = evaluateSDF(sdf, [p[0], p[1], p[2] + e]) - evaluateSDF(sdf, [p[0], p[1], p[2] - e]);
  const gradient = Math.hypot(dx, dy, dz) / (2 * e);
  return Math.abs(raw) / Math.max(gradient, 1e-9);
}

/** Deterministic, bounded bidirectional surface sampling in physical millimeters. */
export function verifyMeshConformance(mesh: MeshResult, sdf: SDFNode, bbox: BBox, tolerance: number, budget: ConformanceBudget = {}): ExportConformance {
  const maxMesh = budget.maxMeshSamples ?? 4096;
  const meshValues: number[] = [];
  const triangleCount = mesh.indices.length / 3;
  const stride = Math.max(1, Math.ceil(triangleCount / Math.max(1, Math.floor(maxMesh / 4))));
  for (let t = 0; t < triangleCount; t += stride) {
    const a = vertex(mesh, mesh.indices[t * 3]), b = vertex(mesh, mesh.indices[t * 3 + 1]), c = vertex(mesh, mesh.indices[t * 3 + 2]);
    for (const p of [a, b, c, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] as Vec3]) {
      meshValues.push(implicitSurfaceDistance(sdf, p, tolerance));
    }
  }

  const n = Math.max(6, Math.min(40, Math.round(budget.sourceGrid ?? 20)));
  // Brute-force point-to-triangle distance is exact, but quadratic. Keep the
  // total bounded independent of mesh size; cancellation terminates the worker.
  const maxSource = Math.min(budget.maxSourceSamples ?? 2048,
    Math.max(1, Math.floor((budget.maxDistanceTests ?? 4_000_000) / Math.max(1, triangleCount))));
  const values = new Float64Array(n * n * n);
  const at = (x: number, y: number, z: number) => (z * n + y) * n + x;
  const point = (x: number, y: number, z: number): Vec3 => [
    bbox.min[0] + (bbox.max[0] - bbox.min[0]) * x / (n - 1),
    bbox.min[1] + (bbox.max[1] - bbox.min[1]) * y / (n - 1),
    bbox.min[2] + (bbox.max[2] - bbox.min[2]) * z / (n - 1),
  ];
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) values[at(x, y, z)] = evaluateSDF(sdf, point(x, y, z));
  const crossings: Vec3[] = [];
  const addEdge = (a: Vec3, av: number, b: Vec3, bv: number) => {
    if ((av < 0) === (bv < 0) || crossings.length >= maxSource) return;
    const t = av / (av - bv);
    crossings.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  };
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const p = point(x, y, z), v = values[at(x, y, z)];
    if (x + 1 < n) addEdge(p, v, point(x + 1, y, z), values[at(x + 1, y, z)]);
    if (y + 1 < n) addEdge(p, v, point(x, y + 1, z), values[at(x, y + 1, z)]);
    if (z + 1 < n) addEdge(p, v, point(x, y, z + 1), values[at(x, y, z + 1)]);
  }
  const sourceValues = crossings.map((p) => nearestMeshDistance(mesh, p));
  const forward = stats(meshValues), reverse = stats(sourceValues);
  const combined = [...meshValues, ...sourceValues];
  const all = stats(combined);
  const finite = Number.isFinite(all.max) && meshValues.length > 0 && sourceValues.length > 0;
  return {
    status: !finite ? 'inconclusive' : all.max <= tolerance ? 'verified' : 'failed', tolerance,
    meshToSourceMax: forward.max, meshToSourceRms: forward.rms,
    sourceToMeshMax: reverse.max, sourceToMeshRms: reverse.rms,
    maxDeviation: all.max, rmsDeviation: all.rms,
    meshSamples: meshValues.length, sourceSamples: sourceValues.length,
  };
}

export function combineConformance(parts: ExportConformance[]): ExportConformance {
  if (!parts.length) throw new Error('No conformance results to combine');
  const meshSamples = parts.reduce((sum, part) => sum + part.meshSamples, 0);
  const sourceSamples = parts.reduce((sum, part) => sum + part.sourceSamples, 0);
  const sumSquares = (key: 'meshToSourceRms' | 'sourceToMeshRms', count: 'meshSamples' | 'sourceSamples') =>
    parts.reduce((sum, part) => sum + part[key] ** 2 * part[count], 0);
  const total = meshSamples + sourceSamples;
  const status = parts.some((part) => part.status === 'failed') ? 'failed'
    : parts.some((part) => part.status === 'inconclusive') ? 'inconclusive' : 'verified';
  return {
    status,
    tolerance: Math.max(...parts.map((part) => part.tolerance)),
    meshToSourceMax: Math.max(...parts.map((part) => part.meshToSourceMax)),
    meshToSourceRms: Math.sqrt(sumSquares('meshToSourceRms', 'meshSamples') / Math.max(1, meshSamples)),
    sourceToMeshMax: Math.max(...parts.map((part) => part.sourceToMeshMax)),
    sourceToMeshRms: Math.sqrt(sumSquares('sourceToMeshRms', 'sourceSamples') / Math.max(1, sourceSamples)),
    maxDeviation: Math.max(...parts.map((part) => part.maxDeviation)),
    rmsDeviation: Math.sqrt((sumSquares('meshToSourceRms', 'meshSamples') + sumSquares('sourceToMeshRms', 'sourceSamples')) / Math.max(1, total)),
    meshSamples, sourceSamples,
  };
}

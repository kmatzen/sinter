import type { SDFNodeUI } from './operations';
import { toSDFNode } from '../worker/sdf/convert';
import { computeBounds } from '../worker/sdf/bounds';

export type Point3 = [number, number, number];
export interface MeasurementAnchor {
  nodeId: string;
  normalized: Point3;
  fallback: Point3;
  /** Root-to-leaf ownership path for target-relative anchors; absent on legacy world-fixed pins. */
  path?: string[];
  patternInstances?: Record<string, number>;
  mirrorSigns?: Record<string, Point3>;
}
export interface PinnedMeasurement {
  id: string;
  anchors: MeasurementAnchor[];
  createdAt: string;
}

export interface MeasurementResult {
  points: Point3[];
  distance?: number;
  delta?: Point3;
  angle?: number;
}

export function anchorPoint(anchor: MeasurementAnchor, min?: Point3, max?: Point3): Point3 {
  if (!min || !max) return anchor.fallback;
  return [0, 1, 2].map((axis) => min[axis] + anchor.normalized[axis] * (max[axis] - min[axis])) as Point3;
}

export function makeAnchor(
  point: Point3, nodeId: string, min?: Point3, max?: Point3,
  metadata?: Pick<MeasurementAnchor, 'path' | 'patternInstances' | 'mirrorSigns'>,
  fallback: Point3 = point,
): MeasurementAnchor {
  const normalized = [0, 1, 2].map((axis) => {
    const span = min && max ? max[axis] - min[axis] : 0;
    return span && min ? (point[axis] - min[axis]) / span : 0.5;
  }) as Point3;
  return { nodeId, normalized, fallback: [...fallback], ...metadata };
}

export function makeTargetMeasurementAnchor(
  tree: SDFNodeUI,
  attribution: { path: string[]; localPoint: Point3; patternInstances: Record<string, number>; mirrorSigns: Record<string, Point3> },
  fallback: Point3,
): MeasurementAnchor | null {
  const nodeId = attribution.path[attribution.path.length - 1];
  if (!nodeId) return null;
  const leaf = findMeasurementNode(tree, nodeId);
  const sdf = leaf ? toSDFNode(leaf) : null;
  if (!sdf) return null;
  const bounds = computeBounds(sdf);
  if ([...bounds.min, ...bounds.max].some((value) => !Number.isFinite(value))) return null;
  return makeAnchor(attribution.localPoint, nodeId, bounds.min, bounds.max, {
    path: [...attribution.path],
    patternInstances: { ...attribution.patternInstances },
    mirrorSigns: Object.fromEntries(Object.entries(attribution.mirrorSigns).map(([id, signs]) => [id, [...signs] as Point3])),
  }, fallback);
}

function currentPathToNode(tree: SDFNodeUI, nodeId: string): SDFNodeUI[] | null {
  if (!tree.enabled) return null;
  if (tree.id === nodeId) return [tree];
  for (const child of tree.children) {
    const suffix = currentPathToNode(child, nodeId);
    if (suffix) return [tree, ...suffix];
  }
  return null;
}

function rotateForward(point: Point3, node: SDFNodeUI): Point3 {
  let [x, y, z] = point;
  for (const [axis, degrees] of [['x', node.params.x], ['y', node.params.y], ['z', node.params.z]] as const) {
    if (!degrees) continue;
    const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    if (axis === 'x') [y, z] = [y * c - z * s, y * s + z * c];
    else if (axis === 'y') [x, z] = [x * c + z * s, -x * s + z * c];
    else [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}

/** Resolve a new target-relative anchor into world space; legacy anchors stay at their fallback. */
export function resolveMeasurementAnchor(tree: SDFNodeUI | null, anchor: MeasurementAnchor): Point3 | null {
  if (!tree || !findMeasurementNode(tree, anchor.nodeId)) return null;
  if (!anchor.path) return [...anchor.fallback];
  // Use the current ownership path so wrapping/reparenting the target applies
  // its new ancestors and does not falsely look like deletion. The stored path
  // distinguishes target-relative anchors from legacy world-fixed records and
  // retains provenance for diagnostics/migration.
  const nodes = currentPathToNode(tree, anchor.nodeId);
  if (!nodes || nodes[nodes.length - 1]?.id !== anchor.nodeId) return null;
  const leaf = toSDFNode(nodes[nodes.length - 1]!);
  if (!leaf) return null;
  const bounds = computeBounds(leaf);
  if ([...bounds.min, ...bounds.max].some((value) => !Number.isFinite(value))) return null;
  let point = anchorPoint(anchor, bounds.min, bounds.max);

  for (let index = nodes.length - 2; index >= 0; index--) {
    const node = nodes[index];
    const p = node.params;
    if (node.kind === 'translate') point = [point[0] + p.x, point[1] + p.y, point[2] + p.z];
    else if (node.kind === 'scale') point = [point[0] * p.x, point[1] * p.y, point[2] * p.z];
    else if (node.kind === 'rotate') point = rotateForward(point, node);
    else if (node.kind === 'mirror') {
      const signs = anchor.mirrorSigns?.[node.id];
      if (!signs) return null;
      point = [p.mirrorX ? Math.abs(point[0]) * signs[0] : point[0], p.mirrorY ? Math.abs(point[1]) * signs[1] : point[1], p.mirrorZ ? Math.abs(point[2]) * signs[2] : point[2]];
    } else if (node.kind === 'linearPattern') {
      const instance = anchor.patternInstances?.[node.id];
      if (!Number.isInteger(instance) || instance! < 0 || instance! >= p.count) return null;
      const length = Math.hypot(p.axisX, p.axisY, p.axisZ);
      if (length < 1e-8) return null;
      const offset = instance! * p.spacing / length;
      point = [point[0] + p.axisX * offset, point[1] + p.axisY * offset, point[2] + p.axisZ * offset];
    } else if (node.kind === 'circularPattern') {
      const raw = anchor.patternInstances?.[node.id];
      if (!Number.isInteger(raw)) return null;
      const instance = ((raw! % p.count) + p.count) % p.count;
      const angle = instance * Math.PI * 2 / p.count, c = Math.cos(angle), s = Math.sin(angle);
      const isX = Math.abs(p.axisX) > Math.abs(p.axisY) && Math.abs(p.axisX) > Math.abs(p.axisZ);
      const isZ = !isX && Math.abs(p.axisZ) > Math.abs(p.axisY);
      if (isX) point = [point[0], point[1] * c - point[2] * s, point[1] * s + point[2] * c];
      else if (isZ) point = [point[0] * c - point[1] * s, point[0] * s + point[1] * c, point[2]];
      else point = [point[0] * c - point[2] * s, point[1], point[0] * s + point[2] * c];
    }
  }
  return point;
}

export function resolveMeasurementAnchors(tree: SDFNodeUI | null, anchors: MeasurementAnchor[]): Point3[] | null {
  const points = anchors.map((anchor) => resolveMeasurementAnchor(tree, anchor));
  return points.some((point) => point === null) ? null : points as Point3[];
}

export function measurePoints(points: Point3[]): MeasurementResult {
  return measureAnchors(points.map((fallback, index) => ({ nodeId: String(index), normalized: [0.5, 0.5, 0.5], fallback })));
}

export function measureAnchors(anchors: MeasurementAnchor[], min?: Point3, max?: Point3): MeasurementResult {
  const points = anchors.map((anchor) => anchorPoint(anchor, min, max));
  if (points.length < 2) return { points };
  const delta = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]] as Point3;
  const distance = Math.hypot(...delta);
  if (points.length < 3) return { points, delta, distance };
  const a = [points[0][0] - points[1][0], points[0][1] - points[1][1], points[0][2] - points[1][2]];
  const b = [points[2][0] - points[1][0], points[2][1] - points[1][1], points[2][2] - points[1][2]];
  const lengths = Math.hypot(...a) * Math.hypot(...b);
  const cosine = lengths > 1e-12 ? Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / lengths)) : 1;
  return { points, delta, distance, angle: Math.acos(cosine) * 180 / Math.PI };
}

export function findMeasurementNode(tree: SDFNodeUI | null, id: string): SDFNodeUI | null {
  if (!tree) return null;
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findMeasurementNode(child, id);
    if (found) return found;
  }
  return null;
}

export function exactRadialMeasurement(node: SDFNodeUI | null): { radius: number; diameter: number; label: string } | null {
  if (!node || !['sphere', 'cylinder', 'cone', 'capsule'].includes(node.kind)) return null;
  const radius = node.params.radius;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return { radius, diameter: radius * 2, label: node.kind === 'cylinder' ? 'Cylinder' : node.label };
}

export function formatMeasurement(valueMm: number, unit: 'mm' | 'in', precision: number): string {
  const value = unit === 'in' ? valueMm / 25.4 : valueMm;
  return `${value.toFixed(Math.max(0, Math.min(6, precision)))} ${unit}`;
}

import type { SDFNodeUI } from './operations';

export type Point3 = [number, number, number];
export interface MeasurementAnchor {
  nodeId: string;
  normalized: Point3;
  fallback: Point3;
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

export function makeAnchor(point: Point3, nodeId: string, min?: Point3, max?: Point3): MeasurementAnchor {
  const normalized = [0, 1, 2].map((axis) => {
    const span = min && max ? max[axis] - min[axis] : 0;
    return span && min ? (point[axis] - min[axis]) / span : 0.5;
  }) as Point3;
  return { nodeId, normalized, fallback: [...point] };
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

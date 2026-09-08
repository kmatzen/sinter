import type { RegionalPrimitiveEvidence } from './csgRecovery';
import type { SDFNode, Vec3 } from './types';

export interface RegionalPatternEvidence extends RegionalPrimitiveEvidence {
  pattern: 'linear' | 'circular' | 'mirror';
  instanceResiduals: Array<{ regionKeys: string[]; surfaceRms: number; surfaceMax: number }>;
}

interface PlacedPrimitive { evidence: RegionalPrimitiveEvidence; center: Vec3; shape: string }

function placedPrimitive(evidence: RegionalPrimitiveEvidence): PlacedPrimitive | null {
  const node = evidence.node;
  if (node.kind === 'transform') {
    const { tx, ty, tz, rx, ry, rz, sx, sy, sz, child } = node;
    if (!['box', 'sphere', 'cylinder', 'capsule'].includes(child.kind)) return null;
    return { evidence, center: [tx, ty, tz], shape: JSON.stringify({ child, rx, ry, rz, sx, sy, sz }) };
  }
  if (!['box', 'sphere', 'cylinder', 'capsule'].includes(node.kind)) return null;
  return { evidence, center: [0, 0, 0], shape: JSON.stringify(node) };
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const compareVec = (a: Vec3, b: Vec3) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, value: number): Vec3 => [a[0] * value, a[1] * value, a[2] * value];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function groupedPlaced(evidence: RegionalPrimitiveEvidence[]): PlacedPrimitive[][] {
  const groups = new Map<string, PlacedPrimitive[]>();
  for (const item of evidence.map(placedPrimitive).filter((value): value is PlacedPrimitive => value !== null)) {
    const key = `${item.evidence.polarity}:${item.shape}`, group = groups.get(key) ?? [];
    group.push(item); groups.set(key, group);
  }
  return [...groups.values()];
}

function patternResult(pattern: RegionalPatternEvidence['pattern'], node: SDFNode, ordered: PlacedPrimitive[]): RegionalPatternEvidence {
  const source = ordered[0].evidence;
  return {
    node, pattern, polarity: source.polarity, regionKeys: ordered.flatMap((item) => item.evidence.regionKeys),
    surfaceRms: Math.sqrt(ordered.reduce((sum, item) => sum + item.evidence.surfaceRms ** 2, 0) / ordered.length),
    surfaceMax: Math.max(...ordered.map((item) => item.evidence.surfaceMax)), occupancyAgreement: Math.min(...ordered.map((item) => item.evidence.occupancyAgreement)),
    instanceResiduals: ordered.map((item) => ({ regionKeys: item.evidence.regionKeys, surfaceRms: item.evidence.surfaceRms, surfaceMax: item.evidence.surfaceMax })),
  };
}

/** Detect exact-shape, equal-spacing sequences. Approximate primitive grouping
 * belongs upstream in regional fitting; pattern recovery must not hide
 * dimension drift by silently averaging unlike features. */
export function recoverLinearPatterns(evidence: RegionalPrimitiveEvidence[], relativeTolerance = 1e-4): RegionalPatternEvidence[] {
  const patterns: RegionalPatternEvidence[] = [];
  for (const group of groupedPlaced(evidence)) {
    if (group.length < 3) continue;
    let first = group[0], last = group[1], span = distance(first.center, last.center);
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const next = distance(group[i].center, group[j].center);
      if (next > span) { first = group[i]; last = group[j]; span = next; }
    }
    if (compareVec(first.center, last.center) > 0) [first, last] = [last, first];
    if (!(span > 1e-9)) continue;
    const delta = subtract(last.center, first.center), axis = delta.map((value) => value / span) as Vec3;
    const ordered = group.map((item) => {
      const relative = subtract(item.center, first.center), projection = dot(relative, axis);
      const radial = Math.hypot(relative[0] - axis[0] * projection, relative[1] - axis[1] * projection, relative[2] - axis[2] * projection);
      return { item, projection, radial };
    }).sort((a, b) => a.projection - b.projection || a.item.evidence.regionKeys.join('/').localeCompare(b.item.evidence.regionKeys.join('/')));
    const tolerance = Math.max(1e-8, span * relativeTolerance);
    if (ordered.some((item) => item.radial > tolerance)) continue;
    const spacing = span / (ordered.length - 1);
    if (ordered.some((item, index) => Math.abs(item.projection - spacing * index) > tolerance)) continue;
    const source = ordered[0].item.evidence;
    const node: SDFNode = { kind: 'linearPattern', child: source.node, axis, count: ordered.length, spacing };
    patterns.push(patternResult('linear', node, ordered.map(({ item }) => item)));
  }
  return patterns.sort((a, b) => a.regionKeys.join('/').localeCompare(b.regionKeys.join('/')));
}

function withRelativeCenter(node: SDFNode, center: Vec3): SDFNode | null {
  if (node.kind !== 'transform') return center.every((value) => Math.abs(value) < 1e-9) ? node : null;
  return { ...node, tx: node.tx - center[0], ty: node.ty - center[1], tz: node.tz - center[2] };
}

export function recoverCircularPatterns(evidence: RegionalPrimitiveEvidence[], relativeTolerance = 1e-4): RegionalPatternEvidence[] {
  const patterns: RegionalPatternEvidence[] = [];
  for (const group of groupedPlaced(evidence)) {
    if (group.length < 3) continue;
    const points = [...group].sort((a, b) => compareVec(a.center, b.center));
    const a = subtract(points[1].center, points[0].center), b = subtract(points[2].center, points[0].center), rawNormal = cross(a, b), normalLength = Math.hypot(...rawNormal);
    if (!(normalLength > 1e-9)) continue;
    let axis = scale(rawNormal, 1 / normalLength);
    let pivot = 0; for (let i = 1; i < 3; i++) if (Math.abs(axis[i]) > Math.abs(axis[pivot])) pivot = i;
    if (axis[pivot] < 0) axis = scale(axis, -1);
    const n2 = dot(rawNormal, rawNormal), aa = dot(a, a), bb = dot(b, b);
    const center = add(points[0].center, scale(add(scale(cross(b, rawNormal), aa), scale(cross(rawNormal, a), bb)), 1 / (2 * n2)));
    const radius = distance(center, points[0].center), tolerance = Math.max(1e-8, radius * relativeTolerance);
    if (!(radius > 1e-9) || points.some((point) => Math.abs(dot(subtract(point.center, center), axis)) > tolerance || Math.abs(distance(point.center, center) - radius) > tolerance)) continue;
    const u = scale(subtract(points[0].center, center), 1 / radius), v = cross(axis, u);
    const ordered = points.map((item) => ({ item, angle: (Math.atan2(dot(subtract(item.center, center), v), dot(subtract(item.center, center), u)) + 2 * Math.PI) % (2 * Math.PI) })).sort((x, y) => x.angle - y.angle);
    const expected = 2 * Math.PI / ordered.length;
    const gaps = ordered.map((item, index) => ((ordered[(index + 1) % ordered.length].angle - item.angle + 2 * Math.PI) % (2 * Math.PI)));
    if (gaps.some((gap) => Math.abs(gap - expected) > relativeTolerance)) continue;
    const child = withRelativeCenter(ordered[0].item.evidence.node, center); if (!child) continue;
    const circular: SDFNode = { kind: 'circularPattern', child, axis, count: ordered.length };
    const node: SDFNode = center.some((value) => Math.abs(value) > 1e-9)
      ? { kind: 'transform', child: circular, tx: center[0], ty: center[1], tz: center[2], rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }
      : circular;
    patterns.push(patternResult('circular', node, ordered.map(({ item }) => item)));
  }
  return patterns.sort((a, b) => a.regionKeys.join('/').localeCompare(b.regionKeys.join('/')));
}

export function recoverMirrorPatterns(evidence: RegionalPrimitiveEvidence[], relativeTolerance = 1e-4): RegionalPatternEvidence[] {
  const patterns: RegionalPatternEvidence[] = [];
  for (const group of groupedPlaced(evidence)) {
    if (group.length !== 2) continue;
    const ordered = [...group].sort((a, b) => compareVec(a.center, b.center));
    const scaleValue = Math.max(1, ...ordered.flatMap((item) => item.center.map(Math.abs))), tolerance = scaleValue * relativeTolerance;
    const mirrored = [0, 1, 2].filter((axis) => Math.abs(ordered[0].center[axis] - ordered[1].center[axis]) > tolerance);
    if (mirrored.length !== 1) continue;
    const mirrorAxis = mirrored[0], plane = (ordered[0].center[mirrorAxis] + ordered[1].center[mirrorAxis]) / 2;
    const source = ordered.find((item) => item.center[mirrorAxis] > plane)!;
    if (source.evidence.node.kind !== 'transform' || source.evidence.node.rx || source.evidence.node.ry || source.evidence.node.rz) continue;
    const child = { ...source.evidence.node, tx: mirrorAxis === 0 ? source.evidence.node.tx - plane : source.evidence.node.tx, ty: mirrorAxis === 1 ? source.evidence.node.ty - plane : source.evidence.node.ty, tz: mirrorAxis === 2 ? source.evidence.node.tz - plane : source.evidence.node.tz };
    const axes: Vec3 = [mirrorAxis === 0 ? 1 : 0, mirrorAxis === 1 ? 1 : 0, mirrorAxis === 2 ? 1 : 0];
    const mirror: SDFNode = { kind: 'mirror', child, axes };
    const translation: Vec3 = [mirrorAxis === 0 ? plane : 0, mirrorAxis === 1 ? plane : 0, mirrorAxis === 2 ? plane : 0];
    const node: SDFNode = Math.abs(plane) > tolerance
      ? { kind: 'transform', child: mirror, tx: translation[0], ty: translation[1], tz: translation[2], rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }
      : mirror;
    patterns.push(patternResult('mirror', node, ordered));
  }
  return patterns.sort((a, b) => a.regionKeys.join('/').localeCompare(b.regionKeys.join('/')));
}

/** Choose the largest deterministic set of non-overlapping pattern
 * explanations and replace their explicit instances for CSG assembly. */
export function compressRegionalPatterns(evidence: RegionalPrimitiveEvidence[]): { evidence: RegionalPrimitiveEvidence[]; patterns: RegionalPatternEvidence[] } {
  const candidates = [...recoverLinearPatterns(evidence), ...recoverCircularPatterns(evidence), ...recoverMirrorPatterns(evidence)]
    .sort((a, b) => b.instanceResiduals.length - a.instanceResiduals.length || ['linear','circular','mirror'].indexOf(a.pattern) - ['linear','circular','mirror'].indexOf(b.pattern) || a.regionKeys.join('/').localeCompare(b.regionKeys.join('/')));
  const consumed = new Set<string>(), patterns: RegionalPatternEvidence[] = [];
  for (const candidate of candidates) {
    if (candidate.regionKeys.some((key) => consumed.has(key))) continue;
    candidate.regionKeys.forEach((key) => consumed.add(key)); patterns.push(candidate);
  }
  return { evidence: [...evidence.filter((candidate) => candidate.regionKeys.every((key) => !consumed.has(key))), ...patterns], patterns };
}

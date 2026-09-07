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

/** Detect exact-shape, equal-spacing sequences. Approximate primitive grouping
 * belongs upstream in regional fitting; pattern recovery must not hide
 * dimension drift by silently averaging unlike features. */
export function recoverLinearPatterns(evidence: RegionalPrimitiveEvidence[], relativeTolerance = 1e-4): RegionalPatternEvidence[] {
  const placed = evidence.map(placedPrimitive).filter((value): value is PlacedPrimitive => value !== null);
  const groups = new Map<string, PlacedPrimitive[]>();
  for (const item of placed) {
    const key = `${item.evidence.polarity}:${item.shape}`, group = groups.get(key) ?? [];
    group.push(item); groups.set(key, group);
  }
  const patterns: RegionalPatternEvidence[] = [];
  for (const group of groups.values()) {
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
    patterns.push({
      node, pattern: 'linear', polarity: source.polarity,
      regionKeys: ordered.flatMap(({ item }) => item.evidence.regionKeys),
      surfaceRms: Math.sqrt(ordered.reduce((sum, { item }) => sum + item.evidence.surfaceRms ** 2, 0) / ordered.length),
      surfaceMax: Math.max(...ordered.map(({ item }) => item.evidence.surfaceMax)),
      occupancyAgreement: Math.min(...ordered.map(({ item }) => item.evidence.occupancyAgreement)),
      instanceResiduals: ordered.map(({ item }) => ({ regionKeys: item.evidence.regionKeys, surfaceRms: item.evidence.surfaceRms, surfaceMax: item.evidence.surfaceMax })),
    });
  }
  return patterns.sort((a, b) => a.regionKeys.join('/').localeCompare(b.regionKeys.join('/')));
}

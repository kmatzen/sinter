import type { MeshRegionSurfaceFit } from '../../types/geometry';
import { sampleMeshField } from './meshField';
import { evalAt as evaluateNodeAt } from './evaluate';
import type { MeshFieldData, SDFNode, Vec3 } from './types';

export interface RegionalPrimitiveEvidence {
  node: SDFNode;
  polarity: 'add' | 'subtract';
  regionKeys: string[];
  surfaceRms: number;
  surfaceMax: number;
  /** Fraction of paired inside/outside probes agreeing with this polarity. */
  occupancyAgreement: number;
}

export interface RegionalCsgResult {
  node: SDFNode;
  surfaceRms: number;
  surfaceMax: number;
  relativeError: number;
  acceptable: boolean;
  baseContributor?: Pick<RegionalBoxBase, 'regionKeys' | 'surfaceRms' | 'surfaceMax'>;
  contributors: Array<Pick<RegionalPrimitiveEvidence, 'polarity' | 'regionKeys' | 'surfaceRms' | 'surfaceMax'>>;
}

export interface RegionalBoxBase {
  node: SDFNode;
  regionKeys: string[];
  surfaceRms: number;
  surfaceMax: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, value: number): Vec3 => [a[0] * value, a[1] * value, a[2] * value];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const length = Math.hypot(...a); return length > 0 ? scale(a, 1 / length) : [1, 0, 0]; };

function eulerForAxis(axis: Vec3): Vec3 {
  const y = Math.max(-1, Math.min(1, axis[1])), rx = Math.acos(y), sine = Math.sin(rx);
  const ry = sine < 1e-9 ? 0 : Math.atan2(axis[0], axis[2]);
  return [rx * 180 / Math.PI, ry * 180 / Math.PI, 0];
}

function placedCylinder(parameters: Extract<MeshRegionSurfaceFit['parameters'], { kind: 'cylinder' }>): SDFNode {
  const midpoint = (parameters.axialMin + parameters.axialMax) / 2;
  const center = add(parameters.origin, scale(parameters.axis, midpoint)), rotation = eulerForAxis(parameters.axis);
  return {
    kind: 'transform', child: { kind: 'cylinder', radius: parameters.radius, height: parameters.axialMax - parameters.axialMin },
    tx: center[0], ty: center[1], tz: center[2], rx: rotation[0], ry: rotation[1], rz: rotation[2], sx: 1, sy: 1, sz: 1,
  };
}

function placedSphere(parameters: Extract<MeshRegionSurfaceFit['parameters'], { kind: 'sphere' }>): SDFNode {
  return { kind: 'transform', child: { kind: 'sphere', radius: parameters.radius }, tx: parameters.center[0], ty: parameters.center[1], tz: parameters.center[2], rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
}

function placedCapsule(parameters: Extract<MeshRegionSurfaceFit['parameters'], { kind: 'capsule' }>): SDFNode {
  const midpoint = (parameters.axialMin + parameters.axialMax) / 2;
  const center = add(parameters.origin, scale(parameters.axis, midpoint)), rotation = eulerForAxis(parameters.axis);
  return {
    kind: 'transform', child: { kind: 'capsule', radius: parameters.radius, height: parameters.axialMax - parameters.axialMin },
    tx: center[0], ty: center[1], tz: center[2], rx: rotation[0], ry: rotation[1], rz: rotation[2], sx: 1, sy: 1, sz: 1,
  };
}

function probeAgreement(field: MeshFieldData, pairs: Array<[Vec3, Vec3]>, polarity: 'add' | 'subtract'): number {
  let agreements = 0;
  for (const [towardPrimitive, awayFromPrimitive] of pairs) {
    const inner = sampleMeshField(field, ...towardPrimitive), outer = sampleMeshField(field, ...awayFromPrimitive);
    if (polarity === 'add' ? inner < 0 && outer > 0 : inner > 0 && outer < 0) agreements++;
  }
  return pairs.length ? agreements / pairs.length : 0;
}

function epsilonFor(field: MeshFieldData): number {
  return Math.max(1e-5, ...[0, 1, 2].map((axis) => (field.bbox.max[axis] - field.bbox.min[axis]) / Math.max(1, field.res - 1))) * 1.5;
}

/** Create primitive candidates only where signed-field probes corroborate the
 * source winding's additive/cavity interpretation. */
export function recoverRegionalPrimitiveEvidence(field: MeshFieldData, fits: MeshRegionSurfaceFit[]): RegionalPrimitiveEvidence[] {
  const epsilon = epsilonFor(field), recovered: RegionalPrimitiveEvidence[] = [];
  for (const fit of fits) {
    const parameters = fit.parameters;
    if (parameters.kind === 'plane') continue;
    const polarity = parameters.outward ? 'add' : 'subtract';
    let node: SDFNode, pairs: Array<[Vec3, Vec3]> = [];
    if (parameters.kind === 'sphere') {
      node = placedSphere(parameters);
      const directions: Vec3[] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      pairs = directions.map((direction) => [add(parameters.center, scale(direction, parameters.radius - epsilon)), add(parameters.center, scale(direction, parameters.radius + epsilon))]);
    } else {
      node = parameters.kind === 'capsule' ? placedCapsule(parameters) : placedCylinder(parameters);
      const seed: Vec3 = Math.abs(parameters.axis[0]) < 0.8 ? [1,0,0] : [0,1,0];
      const u = unit(cross(parameters.axis, seed)), v = cross(parameters.axis, u);
      const axial = (parameters.axialMin + parameters.axialMax) / 2, center = add(parameters.origin, scale(parameters.axis, axial));
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI / 6, radial = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
        pairs.push([add(center, scale(radial, parameters.radius - epsilon)), add(center, scale(radial, parameters.radius + epsilon))]);
      }
    }
    const occupancyAgreement = probeAgreement(field, pairs, polarity);
    if (occupancyAgreement < 0.75) continue;
    recovered.push({ node, polarity, regionKeys: [fit.regionKey], surfaceRms: fit.surfaceRms, surfaceMax: fit.surfaceMax, occupancyAgreement });
  }
  return recovered.sort((a, b) => a.regionKeys[0].localeCompare(b.regionKeys[0]));
}

function fieldSurfacePoints(field: MeshFieldData): Vec3[] {
  const points: Vec3[] = [], { bbox, res } = field, steps = Math.min(28, res - 1);
  const at = (i: number, j: number, k: number): Vec3 => [
    bbox.min[0] + (bbox.max[0] - bbox.min[0]) * i / steps,
    bbox.min[1] + (bbox.max[1] - bbox.min[1]) * j / steps,
    bbox.min[2] + (bbox.max[2] - bbox.min[2]) * k / steps,
  ];
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) for (let k = 0; k <= steps; k++) {
    const a = at(i, j, k), fa = sampleMeshField(field, ...a);
    for (const delta of [[1,0,0],[0,1,0],[0,0,1]] as const) {
      if (i + delta[0] > steps || j + delta[1] > steps || k + delta[2] > steps) continue;
      const b = at(i + delta[0], j + delta[1], k + delta[2]), fb = sampleMeshField(field, ...b);
      if ((fa < 0) === (fb < 0)) continue;
      const fraction = Math.abs(fa) / (Math.abs(fa) + Math.abs(fb));
      points.push([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction]);
    }
  }
  if (points.length <= 1_000) return points;
  const stride = Math.ceil(points.length / 1_000);
  return points.filter((_, index) => index % stride === 0);
}

function treeSurfaceResidual(node: SDFNode, points: Vec3[], diagonal: number) {
  let sum = 0, surfaceMax = 0;
  for (const point of points) { const distance = Math.abs(evaluateNode(node, point)); sum += distance * distance; surfaceMax = Math.max(surfaceMax, distance); }
  const surfaceRms = points.length ? Math.sqrt(sum / points.length) : Infinity;
  return { surfaceRms, surfaceMax, relativeError: surfaceMax / diagonal };
}

// Kept local to avoid importing the higher-level public evaluator and creating
// an otherwise unnecessary tuple allocation at every surface sample.
const evaluateNode = (node: SDFNode, point: Vec3) => evaluateNodeAt(node, point[0], point[1], point[2]);

/** Recover an axis-aligned closed box from the largest opposing planar faces.
 * Smaller coplanar faces (for example a boss cap) cannot displace a base face;
 * the complete-tree residual remains the final acceptance authority. */
export function recoverPlanarBoxBase(fits: MeshRegionSurfaceFit[]): RegionalBoxBase | null {
  type Face = { fit: MeshRegionSurfaceFit; axis: number; sign: -1 | 1; area: number; coordinate: number };
  const faces: Face[] = [];
  for (const fit of fits) {
    if (fit.parameters.kind !== 'plane') continue;
    const normal = fit.parameters.normal, axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    if (Math.abs(normal[axis]) < 0.999) continue;
    const extents = fit.bounds.max.map((value, index) => value - fit.bounds.min[index]);
    const tangent = extents.filter((_, index) => index !== axis);
    faces.push({ fit, axis, sign: normal[axis] < 0 ? -1 : 1, area: tangent[0] * tangent[1], coordinate: fit.parameters.origin[axis] });
  }
  const selected: Face[] = [];
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1] as const) {
    const candidates = faces.filter((face) => face.axis === axis && face.sign === sign)
      .sort((a, b) => b.area - a.area || a.fit.regionKey.localeCompare(b.fit.regionKey));
    if (!candidates.length) return null;
    selected.push(candidates[0]);
  }
  const lo: Vec3 = [0,0,0], hi: Vec3 = [0,0,0];
  for (let axis = 0; axis < 3; axis++) {
    lo[axis] = selected.find((face) => face.axis === axis && face.sign < 0)!.coordinate;
    hi[axis] = selected.find((face) => face.axis === axis && face.sign > 0)!.coordinate;
    if (!(hi[axis] > lo[axis])) return null;
  }
  const center: Vec3 = lo.map((value, axis) => (value + hi[axis]) / 2) as Vec3;
  const child: SDFNode = { kind: 'box', size: lo.map((value, axis) => hi[axis] - value) as Vec3 };
  const node: SDFNode = center.some((value) => Math.abs(value) > 1e-9)
    ? { kind: 'transform', child, tx: center[0], ty: center[1], tz: center[2], rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }
    : child;
  return {
    node,
    regionKeys: selected.map((face) => face.fit.regionKey).sort(),
    surfaceRms: Math.sqrt(selected.reduce((sum, face) => sum + face.fit.surfaceRms ** 2, 0) / selected.length),
    surfaceMax: Math.max(...selected.map((face) => face.fit.surfaceMax)),
  };
}

/** Assemble occupancy-verified regional primitives around a supplied base and
 * accept the tree only when the complete imported surface corroborates it. */
export function assembleRegionalCsgTree(field: MeshFieldData, base: SDFNode, evidence: RegionalPrimitiveEvidence[], maximumRelativeError = 0.01): RegionalCsgResult | null {
  if (!evidence.length) return null;
  let node = base;
  const ordered = [...evidence].sort((a, b) => {
    const phase = (value: RegionalPrimitiveEvidence) => value.polarity === 'add' ? 0 : 1;
    return phase(a) - phase(b) || a.regionKeys.join('/').localeCompare(b.regionKeys.join('/'));
  });
  const diagonal = Math.hypot(field.bbox.max[0] - field.bbox.min[0], field.bbox.max[1] - field.bbox.min[1], field.bbox.max[2] - field.bbox.min[2]);
  const points = fieldSurfacePoints(field); if (!points.length || !(diagonal > 0)) return null;
  const build = (contributors: RegionalPrimitiveEvidence[]) => contributors.reduce<SDFNode>((tree, candidate) => candidate.polarity === 'subtract'
    ? { kind: 'subtract', a: tree, b: candidate.node, k: 0 }
    : { kind: 'union', a: tree, b: candidate.node, k: 0 }, base);
  let accepted = [...ordered];
  node = build(accepted);
  let residual = treeSurfaceResidual(node, points, diagonal), baseResidual = treeSurfaceResidual(base, points, diagonal);
  if (residual.surfaceRms >= baseResidual.surfaceRms * 0.98) return null;
  // Leave-one-out pruning evaluates each node in the context of the complete
  // tree. Greedy insertion is unsound: an outer additive envelope may only
  // become visibly necessary after a later cavity is subtracted from it.
  for (const candidate of [...accepted]) {
    const without = accepted.filter((value) => value !== candidate), trial = build(without);
    const trialResidual = treeSurfaceResidual(trial, points, diagonal);
    if (trialResidual.surfaceRms <= residual.surfaceRms * 1.02) { accepted = without; node = trial; residual = trialResidual; }
  }
  if (!accepted.length) return null;
  return {
    node, ...residual, acceptable: residual.relativeError <= maximumRelativeError,
    contributors: accepted.map(({ polarity, regionKeys, surfaceRms, surfaceMax }) => ({ polarity, regionKeys, surfaceRms, surfaceMax })),
  };
}

/** Compare independently inferred bases by the complete reconstructed tree,
 * preserving planar source evidence for the winning base. */
export function assembleBestRegionalCsgTree(
  field: MeshFieldData,
  bases: Array<{ node: SDFNode; contributor?: RegionalBoxBase }>,
  evidence: RegionalPrimitiveEvidence[],
): RegionalCsgResult | null {
  return bases.map(({ node, contributor }) => {
    const result = assembleRegionalCsgTree(field, node, evidence);
    return result && contributor ? { ...result, baseContributor: { regionKeys: contributor.regionKeys, surfaceRms: contributor.surfaceRms, surfaceMax: contributor.surfaceMax } } : result;
  }).filter((candidate) => candidate !== null)
    .sort((a, b) => a.relativeError - b.relativeError || a.surfaceRms - b.surfaceRms)[0] ?? null;
}

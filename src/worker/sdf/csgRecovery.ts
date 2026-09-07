import type { MeshRegionSurfaceFit } from '../../types/geometry';
import { sampleMeshField } from './meshField';
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
      node = placedCylinder(parameters);
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

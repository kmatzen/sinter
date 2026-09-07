import { describe, expect, it } from 'vitest';
import type { MeshRegionSurfaceFit } from '../../types/geometry';
import { recoverRegionalPrimitiveEvidence } from './csgRecovery';
import { evaluateSDF } from './evaluate';
import type { MeshFieldData, SDFNode } from './types';

function fieldFor(node: SDFNode, res = 41): MeshFieldData {
  const bbox = { min: [-12, -12, -12] as [number,number,number], max: [12, 12, 12] as [number,number,number] };
  const data = new Float32Array(res ** 3);
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const point: [number,number,number] = [bbox.min[0] + x * 24 / (res - 1), bbox.min[1] + y * 24 / (res - 1), bbox.min[2] + z * 24 / (res - 1)];
    data[z * res * res + y * res + x] = evaluateSDF(node, point);
  }
  return { bbox, res, data };
}

const cylinderFit = (outward: boolean): MeshRegionSurfaceFit => ({
  regionKey: 'cylinder-wall', triangleIds: [0, 1], bounds: { min: [-3,-5,-3], max: [3,5,3] },
  parameters: { kind: 'cylinder', origin: [0,0,0], axis: [0,1,0], radius: 3, axialMin: -5, axialMax: 5, outward },
  surfaceRms: 0.01, surfaceMax: 0.02, relativeError: 0.001,
});

describe('regional CSG evidence', () => {
  it('accepts an additive cylinder only when field occupancy corroborates it', () => {
    const field = fieldFor({ kind: 'cylinder', radius: 3, height: 10 });
    const recovered = recoverRegionalPrimitiveEvidence(field, [cylinderFit(true)]);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].polarity).toBe('add');
    expect(recovered[0].occupancyAgreement).toBe(1);
    expect(recoverRegionalPrimitiveEvidence(field, [cylinderFit(false)])).toEqual([]);
  });

  it('accepts an inward cylindrical wall as a subtractive through-hole', () => {
    const cutter: SDFNode = { kind: 'cylinder', radius: 3, height: 14 };
    const plate: SDFNode = { kind: 'subtract', a: { kind: 'box', size: [18, 10, 18] }, b: cutter, k: 0 };
    const recovered = recoverRegionalPrimitiveEvidence(fieldFor(plate), [cylinderFit(false)]);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].polarity).toBe('subtract');
    expect(recovered[0].occupancyAgreement).toBe(1);
  });

  it('recovers additive spheres and rejects contradictory winding evidence', () => {
    const fit: MeshRegionSurfaceFit = { regionKey: 'sphere', triangleIds: [4], bounds: { min: [-4,-4,-4], max: [4,4,4] }, parameters: { kind: 'sphere', center: [0,0,0], radius: 4, outward: true }, surfaceRms: 0, surfaceMax: 0, relativeError: 0 };
    const field = fieldFor({ kind: 'sphere', radius: 4 });
    expect(recoverRegionalPrimitiveEvidence(field, [fit])).toHaveLength(1);
    expect(recoverRegionalPrimitiveEvidence(field, [{ ...fit, parameters: { ...fit.parameters, outward: false } } as MeshRegionSurfaceFit])).toEqual([]);
  });
});

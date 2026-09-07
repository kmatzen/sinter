import { describe, expect, it } from 'vitest';
import type { MeshRegionSurfaceFit } from '../../types/geometry';
import { assembleRegionalCsgTree, recoverRegionalPrimitiveEvidence } from './csgRecovery';
import { evaluateSDF } from './evaluate';
import { bakeMeshField } from './meshField';
import { segmentMeshSurfaces } from './meshSegmentation';
import { fitSegmentedSurfaces } from './regionFit';
import { fitPrimitive } from './fitPrimitive';
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

function tubeSoup(outer = 8, inner = 3, height = 10, segments = 32): Float32Array {
  const triangles: number[][][] = [], point = (radius: number, index: number, y: number) => [radius * Math.cos(index * 2 * Math.PI / segments), y, radius * Math.sin(index * 2 * Math.PI / segments)];
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    const ob = point(outer,index,-height/2), onb = point(outer,next,-height/2), ot = point(outer,index,height/2), ont = point(outer,next,height/2);
    const ib = point(inner,index,-height/2), inb = point(inner,next,-height/2), it = point(inner,index,height/2), int = point(inner,next,height/2);
    triangles.push([ot,onb,ob],[ot,ont,onb], [it,ont,ot],[it,int,ont], [ib,onb,inb],[ib,ob,onb], [it,inb,int],[it,ib,inb]);
  }
  return new Float32Array(triangles.flat(2));
}

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

  it('assembles and validates a plate with a subtractive through-hole', () => {
    const base: SDFNode = { kind: 'box', size: [18, 10, 18] };
    const cutter: SDFNode = { kind: 'cylinder', radius: 3, height: 14 };
    const target: SDFNode = { kind: 'subtract', a: base, b: cutter, k: 0 };
    const field = fieldFor(target), evidence = recoverRegionalPrimitiveEvidence(field, [cylinderFit(false)]);
    const result = assembleRegionalCsgTree(field, base, evidence)!;
    expect(result.node).toMatchObject({ kind: 'subtract' });
    expect(result.acceptable).toBe(true);
    expect(result.relativeError).toBeLessThan(0.01);
    expect(result.contributors).toEqual([expect.objectContaining({ polarity: 'subtract', regionKeys: ['cylinder-wall'] })]);
  });

  it('assembles and validates a box with an additive cylindrical boss', () => {
    const base: SDFNode = { kind: 'box', size: [18, 4, 18] };
    const boss: SDFNode = { kind: 'transform', child: { kind: 'cylinder', radius: 3, height: 5 }, tx: 0, ty: 3.5, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
    const target: SDFNode = { kind: 'union', a: base, b: boss, k: 0 };
    const fit: MeshRegionSurfaceFit = {
      regionKey: 'boss-wall', triangleIds: [8, 9], bounds: { min: [-3,1,-3], max: [3,6,3] },
      parameters: { kind: 'cylinder', origin: [0,3.5,0], axis: [0,1,0], radius: 3, axialMin: -2.5, axialMax: 2.5, outward: true },
      surfaceRms: 0.01, surfaceMax: 0.02, relativeError: 0.001,
    };
    const field = fieldFor(target), evidence = recoverRegionalPrimitiveEvidence(field, [fit]);
    const result = assembleRegionalCsgTree(field, base, evidence)!;
    expect(result.node).toMatchObject({ kind: 'union' });
    expect(result.acceptable).toBe(true);
    expect(result.relativeError).toBeLessThan(0.01);
  });

  it('rejects redundant evidence that does not improve the base', () => {
    const base: SDFNode = { kind: 'sphere', radius: 4 };
    const fit: MeshRegionSurfaceFit = { regionKey: 'same-sphere', triangleIds: [1], bounds: { min: [-4,-4,-4], max: [4,4,4] }, parameters: { kind: 'sphere', center: [0,0,0], radius: 4, outward: true }, surfaceRms: 0, surfaceMax: 0, relativeError: 0 };
    const field = fieldFor(base), evidence = recoverRegionalPrimitiveEvidence(field, [fit]);
    expect(assembleRegionalCsgTree(field, base, evidence)).toBeNull();
  });

  it('verifies the additive and cavity walls of an imported tube', () => {
    const positions = tubeSoup(), segmentation = segmentMeshSurfaces(positions);
    const fits = fitSegmentedSurfaces(positions, segmentation.regions).filter((fit) => fit !== null);
    const cylinders = fits.filter((fit) => fit.parameters.kind === 'cylinder');
    expect(cylinders.map((fit) => fit.parameters.kind === 'cylinder' && [Math.round(fit.parameters.radius), fit.parameters.outward])).toEqual([[3, false], [8, true]]);
    const field = bakeMeshField(positions, 48), evidence = recoverRegionalPrimitiveEvidence(field, fits);
    expect(evidence.map((candidate) => candidate.polarity).sort()).toEqual(['add', 'subtract']);
    const assembled = assembleRegionalCsgTree(field, { kind: 'cylinder', radius: 5.5, height: 10 }, [...evidence].reverse())!;
    expect(assembled.node.kind).toBe('subtract');
    expect(assembled.acceptable).toBe(true);
    expect(assembled.contributors.map((candidate) => candidate.polarity)).toEqual(['add', 'subtract']);
    const whole = fitPrimitive(field)!, workerEquivalent = assembleRegionalCsgTree(field, whole.node, evidence)!;
    expect(workerEquivalent.acceptable, JSON.stringify({ whole, workerEquivalent })).toBe(true);
  });
});

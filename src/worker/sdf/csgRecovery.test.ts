import { describe, expect, it } from 'vitest';
import type { MeshRegionSurfaceFit } from '../../types/geometry';
import { assembleBestRegionalCsgTree, assembleRegionalCsgTree, recoverPlanarBoxBase, recoverRegionalPrimitiveEvidence } from './csgRecovery';
import type { RegionalPrimitiveEvidence } from './csgRecovery';
import { evaluateSDF } from './evaluate';
import { bakeMeshField } from './meshField';
import { segmentMeshSurfaces } from './meshSegmentation';
import { fitSegmentedSurfaces } from './regionFit';
import { fitPrimitive } from './fitPrimitive';
import { compressRegionalPatterns } from './patternRecovery';
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

function boxBossSoup(half = 9, baseBottom = -2, baseTop = 2, bossRadius = 3, bossTop = 6, segments = 32): Float32Array {
  const triangles: number[][][] = [], center = (y: number) => [0, y, 0];
  const inner = (index: number, y: number) => [bossRadius * Math.cos(index * 2 * Math.PI / segments), y, bossRadius * Math.sin(index * 2 * Math.PI / segments)];
  const outer = (index: number, y: number) => {
    const angle = index * 2 * Math.PI / segments, x = Math.cos(angle), z = Math.sin(angle), factor = half / Math.max(Math.abs(x), Math.abs(z));
    return [x * factor, y, z * factor];
  };
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    const ob = outer(index, baseBottom), onb = outer(next, baseBottom), ot = outer(index, baseTop), ont = outer(next, baseTop);
    const it = inner(index, baseTop), int = inner(next, baseTop), ib = inner(index, bossTop), inb = inner(next, bossTop);
    triangles.push(
      [center(baseBottom), ob, onb],
      [ob, ot, ont], [ob, ont, onb],
      [ot, int, ont], [ot, it, int],
      [it, ib, inb], [it, inb, int],
      [center(bossTop), inb, ib],
    );
  }
  return new Float32Array(triangles.flat(2));
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

  it('recovers a box-with-boss tree through the imported-mesh pipeline', () => {
    const positions = boxBossSoup(), field = bakeMeshField(positions, 40), whole = fitPrimitive(field)!;
    const segmentation = segmentMeshSurfaces(positions), fits = fitSegmentedSurfaces(positions, segmentation.regions).filter((fit) => fit !== null);
    const evidence = compressRegionalPatterns(recoverRegionalPrimitiveEvidence(field, fits)).evidence;
    const planarBase = recoverPlanarBoxBase(fits)!;
    expect(planarBase.node).toMatchObject({ kind: 'box', size: [18, 4, 18] });
    const result = assembleBestRegionalCsgTree(field, [{ node: planarBase.node, contributor: planarBase }, { node: whole.node }], evidence);
    expect(result, JSON.stringify({ whole, regions: segmentation.regions.map((region) => ({ triangles: region.triangleIds.length, normal: region.normal })), fits: fits.map((fit) => fit.parameters), evidence })).not.toBeNull();
    expect(result!.acceptable, JSON.stringify({ whole, evidence, result })).toBe(true);
    expect(result!.node.kind).toBe('union');
    expect(result!.contributors.some((candidate) => candidate.polarity === 'add')).toBe(true);
    expect(result!.baseContributor).toEqual(expect.objectContaining({ regionKeys: expect.any(Array), surfaceMax: expect.any(Number), surfaceRms: expect.any(Number) }));
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

  it('validates a compressed linear pattern as part of the complete CSG tree', () => {
    const base: SDFNode = { kind: 'box', size: [20, 3, 12] };
    const standoff = (x: number): SDFNode => ({
      kind: 'transform', child: { kind: 'cylinder', radius: 1.5, height: 5 },
      tx: x, ty: 4, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    });
    const explicit = [-6, 0, 6].map((x, index): RegionalPrimitiveEvidence => ({
      node: standoff(x), polarity: 'add', regionKeys: [`standoff-${index}`],
      surfaceRms: 0.01, surfaceMax: 0.02, occupancyAgreement: 1,
    }));
    const target = explicit.reduce<SDFNode>((node, candidate) => ({ kind: 'union', a: node, b: candidate.node, k: 0 }), base);
    const compressed = compressRegionalPatterns(explicit);
    expect(compressed.patterns).toHaveLength(1);
    expect(compressed.evidence).toHaveLength(1);
    expect(compressed.evidence[0].node.kind).toBe('linearPattern');

    const result = assembleRegionalCsgTree(fieldFor(target), base, compressed.evidence)!;
    expect(result.acceptable).toBe(true);
    expect(result.relativeError).toBeLessThan(0.01);
    expect(result.contributors).toEqual([expect.objectContaining({
      polarity: 'add', regionKeys: ['standoff-0', 'standoff-1', 'standoff-2'],
    })]);
  });

  it.each([
    ['circular', [[6,0], [0,6], [-6,0], [0,-6]]],
    ['mirror', [[-5,0], [5,0]]],
  ] as const)('validates a compressed %s pattern against the complete field', (pattern, centers) => {
    const base: SDFNode = { kind: 'box', size: [20, 2, 20] };
    const explicit = centers.map(([x, z], index): RegionalPrimitiveEvidence => ({
      node: { kind: 'transform', child: { kind: 'cylinder', radius: 1.5, height: 4 }, tx: x, ty: 2.5, tz: z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      polarity: 'add', regionKeys: [`${pattern}-${index}`], surfaceRms: 0.01, surfaceMax: 0.02, occupancyAgreement: 1,
    }));
    const target = explicit.reduce<SDFNode>((node, candidate) => ({ kind: 'union', a: node, b: candidate.node, k: 0 }), base);
    const compressed = compressRegionalPatterns(explicit);
    expect(compressed.patterns.map((candidate) => candidate.pattern)).toEqual([pattern]);
    const result = assembleRegionalCsgTree(fieldFor(target), base, compressed.evidence)!;
    expect(result.acceptable, JSON.stringify(result)).toBe(true);
    expect(result.relativeError).toBeLessThan(0.01);
    expect(result.contributors[0].regionKeys).toHaveLength(centers.length);
  });
});

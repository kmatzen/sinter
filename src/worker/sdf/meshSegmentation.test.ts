import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { regionTriangleSoup, segmentMeshSurfaces } from './meshSegmentation';

const triangle = (...points: number[][]) => points.flat();
const box = new Float32Array([
  ...triangle([0,0,0],[1,1,0],[1,0,0]), ...triangle([0,0,0],[0,1,0],[1,1,0]),
  ...triangle([0,0,1],[1,0,1],[1,1,1]), ...triangle([0,0,1],[1,1,1],[0,1,1]),
  ...triangle([0,0,0],[1,0,0],[1,0,1]), ...triangle([0,0,0],[1,0,1],[0,0,1]),
  ...triangle([0,1,0],[0,1,1],[1,1,1]), ...triangle([0,1,0],[1,1,1],[1,1,0]),
  ...triangle([0,0,0],[0,0,1],[0,1,1]), ...triangle([0,0,0],[0,1,1],[0,1,0]),
  ...triangle([1,0,0],[1,1,0],[1,1,1]), ...triangle([1,0,0],[1,1,1],[1,0,1]),
]);

describe('mesh surface segmentation', () => {
  it('merges tessellation seams but preserves the six sharp box faces', () => {
    const result = segmentMeshSurfaces(box);
    expect(result.regions).toHaveLength(6);
    expect(result.regions.map((region) => region.triangleIds.length)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(result.regions.every((region) => region.eligible && region.area === 1)).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('is geometrically canonical under arbitrary triangle order', () => {
    fc.assert(fc.property(fc.shuffledSubarray([...Array(12).keys()], { minLength: 12, maxLength: 12 }), (order) => {
      const shuffled = new Float32Array(order.flatMap((id) => [...box.slice(id * 9, id * 9 + 9)]));
      const original = segmentMeshSurfaces(box), next = segmentMeshSurfaces(shuffled);
      return JSON.stringify(next.regions.map((region) => region.key)) === JSON.stringify(original.regions.map((region) => region.key));
    }), { numRuns: 100 });
  });

  it('assigns every triangle exactly once and reports open, non-manifold, and degenerate input', () => {
    const extra = new Float32Array([...box, ...box.slice(0, 9), 0,0,0, 0,0,0, 0,0,0]);
    const result = segmentMeshSurfaces(extra);
    const assigned = result.regions.flatMap((region) => region.triangleIds).sort((a, b) => a - b);
    expect(assigned).toEqual([...Array(result.triangleCount).keys()]);
    expect(result.diagnostics.join(' ')).toMatch(/non-manifold.*degenerate/i);
  });

  it('rejects malformed or non-finite triangle soup actionably', () => {
    expect(() => segmentMeshSurfaces(new Float32Array(8))).toThrow(/whole Float32 triangles/);
    expect(() => segmentMeshSurfaces(new Float32Array([0,0,0, 1,0,0, 0,Number.NaN,0]))).toThrow(/not finite/);
  });

  it('extracts exact source triangles and rejects corrupt mappings', () => {
    const result = segmentMeshSurfaces(box);
    const region = result.regions[0];
    const extracted = regionTriangleSoup(box, region);
    expect(extracted).toHaveLength(region.triangleIds.length * 9);
    expect(() => regionTriangleSoup(box, { ...region, triangleIds: [0, 0] })).toThrow(/duplicate source triangle ids/);
    expect(() => regionTriangleSoup(box, { ...region, triangleIds: [999] })).toThrow(/invalid.*triangle ids/);
  });
});

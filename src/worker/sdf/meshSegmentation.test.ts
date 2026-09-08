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

function ring(outer: number, inner: number, height: number, segments = 16): Float32Array {
  const values: number[] = [];
  const point = (radius: number, index: number, z: number) => [radius * Math.cos(index * 2 * Math.PI / segments), radius * Math.sin(index * 2 * Math.PI / segments), z];
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    const ob = point(outer, index, -height / 2), onb = point(outer, next, -height / 2);
    const ot = point(outer, index, height / 2), ont = point(outer, next, height / 2);
    const ib = point(inner, index, -height / 2), inb = point(inner, next, -height / 2);
    const it = point(inner, index, height / 2), int = point(inner, next, height / 2);
    values.push(...triangle(ot, ob, onb), ...triangle(ot, onb, ont));
    if (inner === 0) {
      values.push(...triangle([0,0,height / 2], ot, ont), ...triangle([0,0,-height / 2], onb, ob));
    } else {
      values.push(...triangle(it, ot, ont), ...triangle(it, ont, int));
      values.push(...triangle(ib, inb, onb), ...triangle(ib, onb, ob));
      values.push(...triangle(it, int, inb), ...triangle(it, inb, ib));
    }
  }
  return new Float32Array(values);
}

function translated(source: Float32Array, x: number, y: number, z: number): Float32Array {
  const output = new Float32Array(source);
  for (let index = 0; index < output.length; index += 3) { output[index] += x; output[index + 1] += y; output[index + 2] += z; }
  return output;
}

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

  it('keeps smooth cylinders coherent and separates annular-hole surfaces', () => {
    const cylinder = segmentMeshSurfaces(ring(4, 0, 3));
    expect(cylinder.regions).toHaveLength(3);
    expect(cylinder.diagnostics).toEqual([]);
    const washer = segmentMeshSurfaces(ring(5, 2, 2));
    expect(washer.regions).toHaveLength(4);
    expect(washer.regions.map((region) => region.triangleIds.length).sort((a, b) => a - b)).toEqual([32, 32, 32, 32]);
    expect(washer.diagnostics).toEqual([]);
  });

  it('does not join disconnected repeated solids', () => {
    const repeated = new Float32Array([...translated(box, -3, 0, 0), ...translated(box, 3, 0, 0)]);
    const result = segmentMeshSurfaces(repeated);
    expect(result.regions).toHaveLength(12);
    expect(result.regions.flatMap((region) => region.triangleIds)).toHaveLength(24);
    expect(result.diagnostics).toEqual([]);
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

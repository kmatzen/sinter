import { describe, it, expect } from 'vitest';
import { computeBounds } from './bounds';
import type { SDFNode } from './types';

describe('computeBounds', () => {
  it('box centered at origin', () => {
    const box: SDFNode = { kind: 'box', size: [10, 20, 30] };
    const bb = computeBounds(box);
    expect(bb.min).toEqual([-5, -10, -15]);
    expect(bb.max).toEqual([5, 10, 15]);
  });

  it('sphere centered at origin', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 7 };
    const bb = computeBounds(sphere);
    expect(bb.min).toEqual([-7, -7, -7]);
    expect(bb.max).toEqual([7, 7, 7]);
  });

  it('translated box', () => {
    const node: SDFNode = {
      kind: 'transform',
      child: { kind: 'box', size: [10, 10, 10] },
      tx: 20, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    };
    const bb = computeBounds(node);
    expect(bb.min[0]).toBeCloseTo(15);
    expect(bb.max[0]).toBeCloseTo(25);
  });

  it('union expands bounds', () => {
    const a: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const b: SDFNode = {
      kind: 'transform', child: { kind: 'box', size: [10, 10, 10] },
      tx: 20, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    };
    const union: SDFNode = { kind: 'union', a, b, k: 0 };
    const bb = computeBounds(union);
    expect(bb.min[0]).toBeLessThanOrEqual(-5);
    expect(bb.max[0]).toBeGreaterThanOrEqual(25);
  });

  it('shell adds margin', () => {
    const shell: SDFNode = { kind: 'shell', child: { kind: 'box', size: [10, 10, 10] }, thickness: 4 };
    const bb = computeBounds(shell);
    expect(bb.min[0]).toBeLessThan(-5);
    expect(bb.max[0]).toBeGreaterThan(5);
  });

  it('mirror doubles across axis', () => {
    const node: SDFNode = {
      kind: 'mirror',
      child: {
        kind: 'transform',
        child: { kind: 'sphere', radius: 3 },
        tx: 10, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      },
      axes: [1, 0, 0],
    };
    const bb = computeBounds(node);
    expect(bb.min[0]).toBeLessThanOrEqual(-13);
    expect(bb.max[0]).toBeGreaterThanOrEqual(13);
  });

  it('intersect tightens bounds', () => {
    const a: SDFNode = { kind: 'box', size: [20, 20, 20] };
    const b: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const inter: SDFNode = { kind: 'intersect', a, b, k: 0 };
    const bb = computeBounds(inter);
    expect(bb.max[0]).toBeLessThanOrEqual(5);
    expect(bb.max[1]).toBeLessThanOrEqual(5);
  });
});

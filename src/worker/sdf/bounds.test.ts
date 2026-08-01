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

  it('cylinder centered at origin', () => {
    const bb = computeBounds({ kind: 'cylinder', radius: 4, height: 10 });
    expect(bb.min).toEqual([-4, -5, -4]);
    expect(bb.max).toEqual([4, 5, 4]);
  });

  it('torus bounds use major+minor radius', () => {
    const bb = computeBounds({ kind: 'torus', major: 10, minor: 2 });
    expect(bb.min).toEqual([-12, -2, -12]);
    expect(bb.max).toEqual([12, 2, 12]);
  });

  it('cone bounds like a cylinder envelope', () => {
    const bb = computeBounds({ kind: 'cone', radius: 5, height: 8 });
    expect(bb.min).toEqual([-5, -4, -5]);
    expect(bb.max).toEqual([5, 4, 5]);
  });

  it('capsule bounds like a cylinder envelope', () => {
    const bb = computeBounds({ kind: 'capsule', radius: 3, height: 6 });
    expect(bb.min).toEqual([-3, -3, -3]);
    expect(bb.max).toEqual([3, 3, 3]);
  });

  it('ellipsoid centered at origin', () => {
    const bb = computeBounds({ kind: 'ellipsoid', size: [10, 20, 30] });
    expect(bb.min).toEqual([-5, -10, -15]);
    expect(bb.max).toEqual([5, 10, 15]);
  });

  it('subtract keeps the base bounds expanded by k', () => {
    const a: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const b: SDFNode = { kind: 'sphere', radius: 100 };
    const bb = computeBounds({ kind: 'subtract', a, b, k: 1 });
    expect(bb.min).toEqual([-6, -6, -6]);
    expect(bb.max).toEqual([6, 6, 6]);
  });

  it('offset expands by absolute distance', () => {
    const bb = computeBounds({ kind: 'offset', child: { kind: 'box', size: [10, 10, 10] }, distance: -3 });
    expect(bb.min).toEqual([-8, -8, -8]);
    expect(bb.max).toEqual([8, 8, 8]);
  });

  it('round expands by radius', () => {
    const bb = computeBounds({ kind: 'round', child: { kind: 'box', size: [10, 10, 10] }, radius: 2 });
    expect(bb.min).toEqual([-7, -7, -7]);
    expect(bb.max).toEqual([7, 7, 7]);
  });

  it('rotated transform rotates all three axes', () => {
    const node: SDFNode = {
      kind: 'transform',
      child: { kind: 'box', size: [10, 10, 10] },
      tx: 0, ty: 0, tz: 0, rx: 90, ry: 90, rz: 90, sx: 1, sy: 1, sz: 1,
    };
    const bb = computeBounds(node);
    expect(bb.min[0]).toBeCloseTo(-5);
    expect(bb.max[0]).toBeCloseTo(5);
  });

  it('linearPattern expands along its axis', () => {
    const bb = computeBounds({
      kind: 'linearPattern',
      child: { kind: 'box', size: [2, 2, 2] },
      axis: [1, 0, 0], count: 4, spacing: 10,
    });
    expect(bb.min[0]).toBeCloseTo(-1);
    expect(bb.max[0]).toBeCloseTo(31);
  });

  it('linearPattern falls back to Y axis for a zero-length axis vector', () => {
    const bb = computeBounds({
      kind: 'linearPattern',
      child: { kind: 'box', size: [2, 2, 2] },
      axis: [0, 0, 0], count: 3, spacing: 5,
    });
    expect(bb.min[1]).toBeCloseTo(-1);
    expect(bb.max[1]).toBeCloseTo(11);
  });

  it('circularPattern around Y axis rotates in the XZ plane', () => {
    const bb = computeBounds({
      kind: 'circularPattern',
      child: { kind: 'transform', child: { kind: 'sphere', radius: 1 }, tx: 5, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      axis: [0, 1, 0], count: 8,
    });
    const expectedR = Math.sqrt(6 * 6 + 1 * 1);
    expect(bb.max[0]).toBeCloseTo(expectedR);
    expect(bb.max[2]).toBeCloseTo(expectedR);
    expect(bb.min[1]).toBeCloseTo(-1);
    expect(bb.max[1]).toBeCloseTo(1);
  });

  it('circularPattern around X axis rotates in the YZ plane', () => {
    const bb = computeBounds({
      kind: 'circularPattern',
      child: { kind: 'transform', child: { kind: 'sphere', radius: 1 }, tx: 0, ty: 5, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      axis: [1, 0, 0], count: 8,
    });
    const expectedR = Math.sqrt(6 * 6 + 1 * 1);
    expect(bb.max[1]).toBeCloseTo(expectedR);
    expect(bb.max[2]).toBeCloseTo(expectedR);
  });

  it('circularPattern around Z axis rotates in the XY plane', () => {
    const bb = computeBounds({
      kind: 'circularPattern',
      child: { kind: 'transform', child: { kind: 'sphere', radius: 1 }, tx: 5, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      axis: [0, 0, 1], count: 8,
    });
    const expectedR = Math.sqrt(6 * 6 + 1 * 1);
    expect(bb.max[0]).toBeCloseTo(expectedR);
    expect(bb.max[1]).toBeCloseTo(expectedR);
  });

  it('text with outlines uses its glyph metrics', () => {
    const bb = computeBounds({
      kind: 'text', text: 'A', size: 10, depth: 4, font: 'sans',
      glyphSegments: [{ type: 'L', x0: 0, y0: 0, x1: 8, y1: 0 }],
      glyphWidth: 8, glyphAscent: 7, glyphDescent: -1,
    });
    expect(bb.min).toEqual([-4, -4, -2]);
    expect(bb.max).toEqual([4, 4, 2]);
  });

  /**
   * Metrics alone do not make a glyph. Without outlines both evaluators draw
   * the character-width box, so the bound has to describe that box — reading
   * the metrics here would have the bound describe a different solid from the
   * one rendered and exported. `hasGlyphOutlines` is the single predicate all
   * three sides key off, precisely so this cannot drift.
   */
  it('text with metrics but no outlines uses the character-width box', () => {
    const bb = computeBounds({
      kind: 'text', text: 'A', size: 10, depth: 4, font: 'sans',
      glyphWidth: 8, glyphAscent: 7, glyphDescent: -1,
    });
    expect(bb.min).toEqual([-3, -5, -2]);
    expect(bb.max).toEqual([3, 5, 2]);
  });

  it('text falls back to a character-width estimate without glyph metrics', () => {
    const bb = computeBounds({ kind: 'text', text: 'AB', size: 10, depth: 4, font: 'sans' });
    expect(bb.min[0]).toBeCloseTo(-6);
    expect(bb.max[0]).toBeCloseTo(6);
    expect(bb.min[1]).toBeCloseTo(-5);
    expect(bb.max[1]).toBeCloseTo(5);
  });

  it('halfSpace is unbounded on its own', () => {
    // Previously a fixed +/-1000 box, which silently clipped any model larger
    // than that.  A half-space genuinely has no bounds; `intersect` takes the
    // tighter of the two per axis, so infinity defers to the other child —
    // and an intersect is the only way a halfSpace enters the tree.
    const bb = computeBounds({ kind: 'halfSpace', axis: 'x', position: 0, flip: false });
    expect(bb.min).toEqual([-Infinity, -Infinity, -Infinity]);
    expect(bb.max).toEqual([Infinity, Infinity, Infinity]);
  });

  it("an intersect with a halfSpace keeps the other child's extent", () => {
    const bb = computeBounds({
      kind: 'intersect', k: 0,
      a: { kind: 'box', size: [4000, 100, 100] },
      b: { kind: 'halfSpace', axis: 'x', position: 0, flip: false },
    });
    expect(bb.min[0]).toBe(-2000);
    expect(bb.max[0]).toBe(2000);
  });

  it('_far returns a degenerate bounding box', () => {
    const bb = computeBounds({ kind: '_far' });
    expect(bb.min).toEqual([0, 0, 0]);
    expect(bb.max).toEqual([0, 0, 0]);
  });
});

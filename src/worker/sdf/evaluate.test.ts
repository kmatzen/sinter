import { describe, it, expect } from 'vitest';
import { evaluateSDF } from './evaluate';
import type { SDFNode, Vec3 } from './types';

describe('evaluateSDF', () => {
  describe('world-space modifier dimensions', () => {
    const scaledBox: SDFNode = {
      kind: 'transform', child: { kind: 'box', size: [20, 20, 20] },
      tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 6, sy: 1, sz: 2,
    };

    it.each([
      ['X', [62, 0, 0] as Vec3],
      ['Y', [0, 12, 0] as Vec3],
      ['Z', [0, 0, 22] as Vec3],
    ])('keeps a 2 mm round at 2 mm on the %s face', (_axis, point) => {
      expect(evaluateSDF({ kind: 'round', child: scaledBox, radius: 2 }, point)).toBeCloseTo(0, 3);
    });

    it('keeps offset and shell thickness physical under non-uniform scale', () => {
      expect(evaluateSDF({ kind: 'offset', child: scaledBox, distance: 2 }, [62, 0, 0])).toBeCloseTo(0, 3);
      const shell: SDFNode = { kind: 'shell', child: scaledBox, thickness: 4 };
      expect(evaluateSDF(shell, [62, 0, 0])).toBeCloseTo(0, 3);
      expect(evaluateSDF(shell, [58, 0, 0])).toBeCloseTo(0, 3);
    });

    it('composes nested physical modifiers', () => {
      const nested: SDFNode = { kind: 'round', radius: 2, child: { kind: 'offset', distance: 1, child: scaledBox } };
      expect(evaluateSDF(nested, [63, 0, 0])).toBeCloseTo(0, 2);
    });

    it('corrects ellipsoid fields on differently oriented principal surfaces', () => {
      const rounded: SDFNode = { kind: 'round', radius: 2, child: { kind: 'ellipsoid', size: [10, 20, 30] } };
      expect(evaluateSDF(rounded, [7, 0, 0])).toBeCloseTo(0, 2);
      expect(evaluateSDF(rounded, [0, 12, 0])).toBeCloseTo(0, 2);
      expect(evaluateSDF(rounded, [0, 0, 17])).toBeCloseTo(0, 2);
    });

    it.each(['union', 'subtract', 'intersect'] as const)('supports %s children', (kind) => {
      const other: SDFNode = kind === 'intersect'
        ? { kind: 'box', size: [200, 200, 200] }
        : kind === 'subtract'
          ? { kind: 'sphere', radius: 3 }
          : { kind: 'transform', child: { kind: 'sphere', radius: 3 }, tx: 0, ty: 100, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
      const child: SDFNode = { kind, a: scaledBox, b: other, k: 0 };
      expect(evaluateSDF({ kind: 'round', child, radius: 2 }, [62, 0, 0])).toBeCloseTo(0, 2);
    });

    it('supports smooth booleans and patterns', () => {
      const smooth: SDFNode = {
        kind: 'union', a: scaledBox,
        b: { kind: 'transform', child: { kind: 'sphere', radius: 5 }, tx: 0, ty: 30, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
        k: 1,
      };
      expect(evaluateSDF({ kind: 'offset', child: smooth, distance: 2 }, [62, 0, 0])).toBeCloseTo(0, 2);
      const pattern: SDFNode = { kind: 'linearPattern', child: scaledBox, axis: [0, 1, 0], count: 2, spacing: 100 };
      expect(evaluateSDF({ kind: 'round', child: pattern, radius: 2 }, [62, 100, 0])).toBeCloseTo(0, 2);
    });
  });

  describe('primitives', () => {
    it('box: center is inside', () => {
      const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
      expect(evaluateSDF(box, [0, 0, 0])).toBeLessThan(0);
    });

    it('box: surface is approximately zero', () => {
      const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
      expect(Math.abs(evaluateSDF(box, [5, 0, 0]))).toBeLessThan(0.01);
    });

    it('box: outside is positive', () => {
      const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
      expect(evaluateSDF(box, [10, 0, 0])).toBeGreaterThan(0);
    });

    it('sphere: center is inside', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 5 };
      expect(evaluateSDF(sphere, [0, 0, 0])).toBeLessThan(0);
    });

    it('sphere: surface is zero', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 5 };
      expect(Math.abs(evaluateSDF(sphere, [5, 0, 0]))).toBeLessThan(0.01);
    });

    it('sphere: outside is positive', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 5 };
      expect(evaluateSDF(sphere, [10, 0, 0])).toBeGreaterThan(0);
    });

    it('cylinder: center is inside', () => {
      const cyl: SDFNode = { kind: 'cylinder', radius: 5, height: 10 };
      expect(evaluateSDF(cyl, [0, 0, 0])).toBeLessThan(0);
    });

    it('cylinder: outside radially is positive', () => {
      const cyl: SDFNode = { kind: 'cylinder', radius: 5, height: 10 };
      expect(evaluateSDF(cyl, [10, 0, 0])).toBeGreaterThan(0);
    });

    it('torus: center of tube is inside', () => {
      const torus: SDFNode = { kind: 'torus', major: 10, minor: 3 };
      expect(evaluateSDF(torus, [10, 0, 0])).toBeLessThan(0);
    });

    it('cone: inside near the base, outside far away', () => {
      const cone: SDFNode = { kind: 'cone', radius: 5, height: 10 };
      expect(evaluateSDF(cone, [0, -4, 0])).toBeLessThan(0);
      expect(evaluateSDF(cone, [100, 0, 0])).toBeGreaterThan(0);
    });

    it('capsule: center and surface distances', () => {
      const capsule: SDFNode = { kind: 'capsule', radius: 2, height: 10 };
      expect(evaluateSDF(capsule, [0, 0, 0])).toBeCloseTo(-2);
      expect(evaluateSDF(capsule, [2, 0, 0])).toBeCloseTo(0);
    });

    it('ellipsoid: center is inside, surface approx zero, and the degenerate center case', () => {
      const ell: SDFNode = { kind: 'ellipsoid', size: [10, 20, 30] };
      expect(evaluateSDF(ell, [0, 0, 0])).toBeCloseTo(-5);
      expect(Math.abs(evaluateSDF(ell, [5, 0, 0]))).toBeLessThan(0.5);
    });
  });

  describe('booleans', () => {
    const boxA: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const boxB: SDFNode = { kind: 'transform', child: { kind: 'box', size: [10, 10, 10] }, tx: 8, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };

    it('union: point in either shape is inside', () => {
      const union: SDFNode = { kind: 'union', a: boxA, b: boxB, k: 0 };
      expect(evaluateSDF(union, [0, 0, 0])).toBeLessThan(0);
      expect(evaluateSDF(union, [10, 0, 0])).toBeLessThan(0);
    });

    it('subtract: point in A but not B is inside', () => {
      const sub: SDFNode = { kind: 'subtract', a: boxA, b: boxB, k: 0 };
      expect(evaluateSDF(sub, [-3, 0, 0])).toBeLessThan(0);
    });

    it('intersect: point in both is inside', () => {
      const inter: SDFNode = { kind: 'intersect', a: boxA, b: boxB, k: 0 };
      expect(evaluateSDF(inter, [4, 0, 0])).toBeLessThan(0);
    });

    it('smooth union produces blend region', () => {
      const sharp: SDFNode = { kind: 'union', a: boxA, b: boxB, k: 0 };
      const smooth: SDFNode = { kind: 'union', a: boxA, b: boxB, k: 3 };
      // At the junction boundary, smooth union should be more negative (blended inward)
      const p: Vec3 = [4, 4, 4]; // near the corner/junction region
      const sharpVal = evaluateSDF(sharp, p);
      const smoothVal = evaluateSDF(smooth, p);
      expect(smoothVal).toBeLessThanOrEqual(sharpVal);
    });

    it('smooth subtract and intersect evaluate without throwing', () => {
      const smoothSub: SDFNode = { kind: 'subtract', a: boxA, b: boxB, k: 2 };
      expect(typeof evaluateSDF(smoothSub, [-3, 0, 0])).toBe('number');

      const smoothInter: SDFNode = { kind: 'intersect', a: boxA, b: boxB, k: 2 };
      expect(typeof evaluateSDF(smoothInter, [4, 0, 0])).toBe('number');
    });
  });

  describe('modifiers', () => {
    it('shell: center of solid box becomes outside', () => {
      const box: SDFNode = { kind: 'box', size: [20, 20, 20] };
      const shell: SDFNode = { kind: 'shell', child: box, thickness: 2 };
      // Center of shelled box should be positive (hollow inside)
      expect(evaluateSDF(shell, [0, 0, 0])).toBeGreaterThan(0);
      // Wall should be negative (inside the shell wall)
      expect(evaluateSDF(shell, [9.5, 0, 0])).toBeLessThan(0);
    });

    it('offset: expands the shape', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 5 };
      const offset: SDFNode = { kind: 'offset', child: sphere, distance: 2 };
      // Point at radius 6 should now be inside (was outside without offset)
      expect(evaluateSDF(offset, [6, 0, 0])).toBeLessThan(0);
    });

    it('round: expands the shape', () => {
      const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
      const round: SDFNode = { kind: 'round', child: box, radius: 1 };
      // Point at 5.5 (between box edge 5 and box+round 6) should be inside
      expect(evaluateSDF(round, [5.5, 0, 0])).toBeLessThan(0);
    });
  });

  describe('transforms', () => {
    it('translate: shifts the shape', () => {
      const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
      const translated: SDFNode = { kind: 'transform', child: box, tx: 20, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
      expect(evaluateSDF(translated, [0, 0, 0])).toBeGreaterThan(0); // origin is now outside
      expect(evaluateSDF(translated, [20, 0, 0])).toBeLessThan(0); // new center is inside
    });

    it('scale: enlarges the shape', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 5 };
      const scaled: SDFNode = { kind: 'transform', child: sphere, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 2, sy: 2, sz: 2 };
      expect(evaluateSDF(scaled, [8, 0, 0])).toBeLessThan(0); // inside scaled sphere
    });

    it('rotate: rotates the shape', () => {
      const box: SDFNode = { kind: 'box', size: [20, 4, 4] }; // long in X
      const rotated: SDFNode = { kind: 'transform', child: box, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 90, sx: 1, sy: 1, sz: 1 };
      // After 90deg Z rotation, X axis becomes Y axis
      expect(evaluateSDF(rotated, [0, 8, 0])).toBeLessThan(0); // now extends in Y
      expect(evaluateSDF(rotated, [8, 0, 0])).toBeGreaterThan(0); // no longer extends in X
    });
  });

  describe('mirror', () => {
    it('mirrors across X axis', () => {
      const translated: SDFNode = {
        kind: 'transform', child: { kind: 'sphere', radius: 3 },
        tx: 10, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      };
      const mirrored: SDFNode = { kind: 'mirror', child: translated, axes: [1, 0, 0] };
      // Should be inside at both +10 and -10
      expect(evaluateSDF(mirrored, [10, 0, 0])).toBeLessThan(0);
      expect(evaluateSDF(mirrored, [-10, 0, 0])).toBeLessThan(0);
    });
  });

  describe('halfSpace', () => {
    it('below plane is inside', () => {
      const hs: SDFNode = { kind: 'halfSpace', axis: 'y', position: 5, flip: false };
      expect(evaluateSDF(hs, [0, 0, 0])).toBeLessThan(0);
    });

    it('above plane is outside', () => {
      const hs: SDFNode = { kind: 'halfSpace', axis: 'y', position: 5, flip: false };
      expect(evaluateSDF(hs, [0, 10, 0])).toBeGreaterThan(0);
    });

    it('flip inverts the side, and x/z axes work too', () => {
      expect(evaluateSDF({ kind: 'halfSpace', axis: 'y', position: 5, flip: true }, [0, 0, 0])).toBeGreaterThan(0);
      expect(evaluateSDF({ kind: 'halfSpace', axis: 'x', position: 0, flip: false }, [5, 0, 0])).toBeGreaterThan(0);
      expect(evaluateSDF({ kind: 'halfSpace', axis: 'z', position: 0, flip: false }, [0, 0, 5])).toBeGreaterThan(0);
    });
  });

  describe('patterns', () => {
    it('linearPattern repeats the child along its axis', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 2 };
      const pattern: SDFNode = { kind: 'linearPattern', child: sphere, axis: [1, 0, 0], count: 3, spacing: 10 };
      expect(evaluateSDF(pattern, [0, 0, 0])).toBeCloseTo(-2);
      expect(evaluateSDF(pattern, [10, 0, 0])).toBeCloseTo(-2);
      expect(evaluateSDF(pattern, [20, 0, 0])).toBeCloseTo(-2);
    });

    it('linearPattern with a zero-length axis falls back to the plain child', () => {
      const sphere: SDFNode = { kind: 'sphere', radius: 2 };
      const pattern: SDFNode = { kind: 'linearPattern', child: sphere, axis: [0, 0, 0], count: 3, spacing: 10 };
      expect(evaluateSDF(pattern, [0, 0, 0])).toBeCloseTo(-2);
    });

    it('circularPattern repeats around the Y, X, and Z axes', () => {
      const sphereAtX: SDFNode = { kind: 'transform', child: { kind: 'sphere', radius: 1 }, tx: 5, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
      const patternY: SDFNode = { kind: 'circularPattern', child: sphereAtX, axis: [0, 1, 0], count: 4 };
      expect(evaluateSDF(patternY, [5, 0, 0])).toBeCloseTo(-1);
      expect(evaluateSDF(patternY, [0, 0, 5])).toBeCloseTo(-1);

      const sphereAtY: SDFNode = { kind: 'transform', child: { kind: 'sphere', radius: 1 }, tx: 0, ty: 5, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
      const patternX: SDFNode = { kind: 'circularPattern', child: sphereAtY, axis: [1, 0, 0], count: 4 };
      expect(evaluateSDF(patternX, [0, 5, 0])).toBeCloseTo(-1);

      const patternZ: SDFNode = { kind: 'circularPattern', child: sphereAtX, axis: [0, 0, 1], count: 4 };
      expect(evaluateSDF(patternZ, [5, 0, 0])).toBeCloseTo(-1);
    });
  });

  describe('text', () => {
    it('falls back to a box shape without glyph data', () => {
      const text: SDFNode = { kind: 'text', text: 'Hi', size: 10, depth: 4, font: 'sans' };
      expect(evaluateSDF(text, [0, 0, 0])).toBeLessThan(0);
      expect(evaluateSDF(text, [1000, 0, 0])).toBeGreaterThan(0);
    });

    it('evaluates a glyph contour built from line segments, extruded in Z', () => {
      const text: SDFNode = {
        kind: 'text', text: 'I', size: 10, depth: 4, font: 'sans',
        glyphWidth: 4, glyphAscent: 10, glyphDescent: 0,
        glyphSegments: [
          { type: 'L', x0: 0, y0: 0, x1: 4, y1: 0 },
          { type: 'L', x0: 4, y0: 0, x1: 4, y1: 10 },
          { type: 'L', x0: 4, y0: 10, x1: 0, y1: 10 },
          { type: 'L', x0: 0, y0: 10, x1: 0, y1: 0 },
        ],
      };
      expect(evaluateSDF(text, [0, 0, 0])).toBeLessThan(0);
      expect(evaluateSDF(text, [1000, 0, 0])).toBeGreaterThan(0);
    });

    it('evaluates a glyph contour built from quadratic beziers', () => {
      const text: SDFNode = {
        kind: 'text', text: 'O', size: 10, depth: 4, font: 'sans',
        glyphWidth: 6, glyphAscent: 10, glyphDescent: 0,
        glyphBeziers: [
          { type: 'Q', x0: 0, y0: 5, x1: 0, y1: 10, x2: 6, y2: 10 },
          { type: 'Q', x0: 6, y0: 10, x1: 6, y1: 5, x2: 0, y2: 5 },
        ],
      };
      expect(typeof evaluateSDF(text, [3, 5, 0])).toBe('number');
    });
  });

  it('_far is always effectively infinite', () => {
    expect(evaluateSDF({ kind: '_far' }, [0, 0, 0])).toBe(1e10);
  });
});

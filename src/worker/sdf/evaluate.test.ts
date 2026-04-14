import { describe, it, expect } from 'vitest';
import { evaluateSDF } from './evaluate';
import type { SDFNode, Vec3 } from './types';

describe('evaluateSDF', () => {
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
  });
});

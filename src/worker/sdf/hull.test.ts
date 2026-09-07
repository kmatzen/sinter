import { describe, expect, it } from 'vitest';
import { computeBounds } from './bounds';
import { evaluateSDF } from './evaluate';
import { buildHullPlanes, hullDirections, supportBound } from './hull';
import type { SDFNode, Vec3 } from './types';

const movedSphere = (x: number, radius = 2): SDFNode => ({ kind: 'transform', child: { kind: 'sphere', radius }, tx: x, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
function hull(a: SDFNode, b: SDFNode, detail: number): SDFNode {
  return { kind: 'hull', a, b, detail, planes: buildHullPlanes(a, b, computeBounds(a), computeBounds(b), detail) };
}

describe('faceted hull support envelope', () => {
  it('uses nested normalized directions and retains the six axial planes', () => {
    const coarse = hullDirections(12), fine = hullDirections(48);
    expect(fine.slice(0, coarse.length)).toEqual(coarse);
    expect(coarse.slice(0, 6)).toEqual([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
    expect(fine.every((d) => Math.abs(Math.hypot(...d) - 1) < 1e-12)).toBe(true);
  });

  it('bridges separated solids while containing both at every detail', () => {
    const a = movedSphere(-8), b = movedSphere(8);
    for (const detail of [6, 24, 98]) {
      const envelope = hull(a, b, detail);
      expect(evaluateSDF(envelope, [0, 0, 0])).toBeLessThan(0);
      for (const center of [-8, 8]) for (const point of [[center + 2, 0, 0], [center, 2, 0], [center, 0, -2]] as Vec3[]) {
        expect(evaluateSDF(envelope, point), `${detail}: ${point}`).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('derives exact transformed primitive support', () => {
    const child: SDFNode = { kind: 'transform', child: { kind: 'box', size: [4, 2, 6] }, tx: 5, ty: -2, tz: 3, rx: 20, ry: 35, rz: -15, sx: 2, sy: 0.5, sz: 1.5 };
    expect(supportBound(child, [1, 0, 0], computeBounds(child))).toBeCloseTo(computeBounds(child).max[0], 10);
  });

  it('keeps the envelope inside the merged axial bounds', () => {
    expect(computeBounds(hull(movedSphere(-8), movedSphere(8), 98))).toEqual({ min: [-10, -2, -2], max: [10, 2, 2] });
  });
});

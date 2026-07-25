import { describe, it, expect } from 'vitest';
import { solveQEF } from './qef';
import type { Vec3 } from './types';

describe('solveQEF', () => {
  it('reconstructs a corner exactly from three orthogonal planes', () => {
    // Planes x=2, y=3, z=-1 meeting at corner (2, 3, -1).
    // Sample points sit far from the corner along each plane, and the mass
    // point is deliberately off the corner — the solve must still land on it.
    const points: Vec3[] = [
      [2, 10, 4],
      [-5, 3, 8],
      [7, -2, -1],
    ];
    const normals: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const massPoint: Vec3 = [1.4, 3.6, -0.5];
    const v = solveQEF(points, normals, massPoint);
    expect(v[0]).toBeCloseTo(2, 6);
    expect(v[1]).toBeCloseTo(3, 6);
    expect(v[2]).toBeCloseTo(-1, 6);
  });

  it('reconstructs a corner from non-axis-aligned planes', () => {
    // Three planes with random-ish orientations all passing through (1, -2, 0.5)
    const corner: Vec3 = [1, -2, 0.5];
    const normals: Vec3[] = [
      [0.6, 0.8, 0],
      [-0.36, 0.48, 0.8],
      [0.48, -0.64, 0.6],
    ];
    // Points displaced from the corner within each plane
    const points: Vec3[] = normals.map(([nx, ny, nz], i) => {
      // Build any vector orthogonal to n
      const t: Vec3 = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const ox = ny * t[2] - nz * t[1];
      const oy = nz * t[0] - nx * t[2];
      const oz = nx * t[1] - ny * t[0];
      const s = (i + 1) * 2;
      return [corner[0] + ox * s, corner[1] + oy * s, corner[2] + oz * s];
    });
    const v = solveQEF(points, normals, [0, 0, 0]);
    expect(v[0]).toBeCloseTo(corner[0], 5);
    expect(v[1]).toBeCloseTo(corner[1], 5);
    expect(v[2]).toBeCloseTo(corner[2], 5);
  });

  it('lands on the crease line for two planes, staying near the mass point', () => {
    // Planes x=1 and y=2 intersect along the line (1, 2, t).
    const points: Vec3[] = [
      [1, 5, 0],
      [4, 2, 0],
    ];
    const normals: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    const massPoint: Vec3 = [0.8, 2.3, 7];
    const v = solveQEF(points, normals, massPoint);
    // Exactly on the crease in x/y...
    expect(v[0]).toBeCloseTo(1, 6);
    expect(v[1]).toBeCloseTo(2, 6);
    // ...and unconstrained along z, so it keeps the mass point's z
    expect(v[2]).toBeCloseTo(7, 6);
  });

  it('projects the mass point onto a single plane', () => {
    // One plane z=4: the null space is the whole plane, so the result is
    // the mass point projected along the normal.
    const points: Vec3[] = [[10, -3, 4], [0, 6, 4]];
    const normals: Vec3[] = [[0, 0, 1], [0, 0, 1]];
    const massPoint: Vec3 = [2.5, 1.5, 9];
    const v = solveQEF(points, normals, massPoint);
    expect(v[0]).toBeCloseTo(2.5, 6);
    expect(v[1]).toBeCloseTo(1.5, 6);
    expect(v[2]).toBeCloseTo(4, 6);
  });

  it('returns the mass point when there is no data', () => {
    const v = solveQEF([], [], [1, 2, 3]);
    expect(v).toEqual([1, 2, 3]);
  });
});

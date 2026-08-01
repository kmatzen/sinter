import { describe, it, expect } from 'vitest';
import { fitPrimitive } from './fitPrimitive';
import { bakeMeshField } from './meshField';
import { evaluateSDF } from './evaluate';
import { marchingCubes } from './marchingCubes';
import type { SDFNode, BBox } from './types';

/**
 * A triangle soup for an analytic shape, so a fit can be checked against a
 * known answer rather than against itself.
 */
function soupFor(node: SDFNode, res = 40): Float32Array {
  const bbox: BBox = { min: [-25, -25, -25], max: [25, 25, 25] };
  const grid = new Float32Array(res * res * res);
  const d = 50 / res;
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    grid[z * res * res + y * res + x] = evaluateSDF(node, [
      -25 + (x + 0.5) * d, -25 + (y + 0.5) * d, -25 + (z + 0.5) * d,
    ]);
  }
  const mesh = marchingCubes(grid, res, bbox, node);
  const out = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i] * 3;
    out[i * 3] = mesh.positions[v];
    out[i * 3 + 1] = mesh.positions[v + 1];
    out[i * 3 + 2] = mesh.positions[v + 2];
  }
  return out;
}

describe('fitPrimitive', () => {
  /**
   * The whole point: a mesh that *is* a primitive should come back as that
   * primitive, with a residual small enough to offer. The tolerance is stated
   * against the baked field's own resolution — the fit cannot be better than
   * the field it is fitting, and at 40^3 over 50mm a voxel is 1.25mm.
   */
  it('recovers a sphere, and says so', () => {
    const field = bakeMeshField(soupFor({ kind: 'sphere', radius: 12 }), 40);
    const fit = fitPrimitive(field)!;
    expect(fit.kind).toBe('Sphere');
    expect(fit.acceptable).toBe(true);
    expect(fit.surfaceMax).toBeLessThan(2);
  });

  it('recovers a box', () => {
    const field = bakeMeshField(soupFor({ kind: 'box', size: [20, 14, 24] }), 40);
    const fit = fitPrimitive(field)!;
    expect(fit.kind).toBe('Box');
    expect(fit.acceptable).toBe(true);
  });

  it('recovers a cylinder and picks its axis', () => {
    const field = bakeMeshField(soupFor({ kind: 'cylinder', radius: 9, height: 30 }), 40);
    const fit = fitPrimitive(field)!;
    expect(fit.kind).toMatch(/^(Cylinder|Capsule) \(Y\)$/);
    expect(fit.acceptable).toBe(true);
  });

  /**
   * The fallback the issue asks about. A shape that is not one primitive must
   * come back *not acceptable*, with a residual saying how far off it is —
   * never a confident wrong answer, because accepting one costs the user their
   * original geometry.
   */
  it('refuses a shape that is not one primitive, and reports the error', () => {
    const twoBalls: SDFNode = {
      kind: 'union', k: 0,
      a: { kind: 'transform', child: { kind: 'sphere', radius: 7 }, tx: -10, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      b: { kind: 'transform', child: { kind: 'sphere', radius: 7 }, tx: 10, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
    };
    const fit = fitPrimitive(bakeMeshField(soupFor(twoBalls), 40))!;
    expect(fit.acceptable).toBe(false);
    expect(fit.relativeError).toBeGreaterThan(0.01);
    expect(Number.isFinite(fit.surfaceMax)).toBe(true);
  });

  it('refuses a box with a bite taken out of it', () => {
    const bitten: SDFNode = {
      kind: 'subtract', k: 0,
      a: { kind: 'box', size: [24, 24, 24] },
      b: { kind: 'transform', child: { kind: 'sphere', radius: 11 }, tx: 12, ty: 12, tz: 12, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
    };
    const fit = fitPrimitive(bakeMeshField(soupFor(bitten), 40))!;
    expect(fit.acceptable).toBe(false);
  });

  it('returns null for a field with no solid in it', () => {
    expect(fitPrimitive(bakeMeshField(new Float32Array(0), 12))).toBeNull();
  });

  /** Import twice, get the same tree — the refinement must not be stochastic. */
  it('is deterministic', () => {
    const field = bakeMeshField(soupFor({ kind: 'sphere', radius: 10 }), 32);
    const a = fitPrimitive(field)!;
    const b = fitPrimitive(field)!;
    expect(b.kind).toBe(a.kind);
    expect(b.surfaceMax).toBe(a.surfaceMax);
    expect(JSON.stringify(b.node)).toBe(JSON.stringify(a.node));
  });
});

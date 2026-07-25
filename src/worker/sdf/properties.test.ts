import { describe, it, expect } from 'vitest';
import { evaluateSDF } from './evaluate';
import type { SDFNode, Vec3 } from './types';

/**
 * Property-based tests over randomly generated trees (part of #52).
 *
 * The existing evaluate.test.ts checks hand-picked points on hand-built
 * shapes. These check invariants that must hold for *any* tree, which is
 * where the cases nobody thought to write live.
 *
 * Deterministic by construction: a seeded PRNG rather than a fuzzing library,
 * so a failure reproduces exactly and CI never flakes. No new dependency.
 */

/** mulberry32 — small, fast, good enough for test input generation. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Primitives and combinators restricted to those that should preserve the
 * Lipschitz bound — i.e. exact distance fields, not bounds or approximations.
 *
 * Deliberately excluded, with reasons:
 *   ellipsoid  — the standard sdEllipsoid is a lower bound, not exact
 *   cone       — likewise approximate in the usual formulation
 *   scale      — non-uniform scaling does not preserve distance
 *   patterns   — domain repetition breaks the bound near cell boundaries
 *   text       — glyph geometry is piecewise and not claimed exact
 *
 * Narrowing here is not hiding failures: an approximate field is a legitimate
 * design choice, and asserting exactness of it would produce noise rather
 * than findings. What matters is that the shapes claiming to be exact are.
 */
function randomExactTree(r: () => number, depth: number): SDFNode {
  const leaf = (): SDFNode => {
    const pick = Math.floor(r() * 5);
    const dim = () => 0.5 + r() * 3;
    if (pick === 0) return { kind: 'sphere', radius: dim() };
    if (pick === 1) return { kind: 'box', size: [dim(), dim(), dim()] as Vec3 };
    if (pick === 2) return { kind: 'cylinder', radius: dim(), height: dim() };
    if (pick === 3) return { kind: 'torus', major: 1 + r() * 2, minor: 0.2 + r() };
    return { kind: 'capsule', radius: dim(), height: dim() };
  };

  if (depth <= 0) return leaf();

  const pick = Math.floor(r() * 7);
  const child = () => randomExactTree(r, depth - 1);

  switch (pick) {
    case 0: return { kind: 'union', a: child(), b: child(), k: 0 };
    case 1: return { kind: 'intersect', a: child(), b: child(), k: 0 };
    case 2: return { kind: 'subtract', a: child(), b: child(), k: 0 };
    case 3: return { kind: 'offset', child: child(), distance: (r() - 0.5) * 2 };
    case 4: return { kind: 'round', child: child(), radius: r() * 0.5 };
    case 5: return { kind: 'shell', child: child(), thickness: 0.1 + r() * 0.5 };
    default: return {
      kind: 'transform', child: child(),
      tx: (r() - 0.5) * 4, ty: (r() - 0.5) * 4, tz: (r() - 0.5) * 4,
      rx: r() * Math.PI, ry: r() * Math.PI, rz: r() * Math.PI,
      sx: 1, sy: 1, sz: 1,
    };
  }
}

const point = (r: () => number, spread = 8): Vec3 =>
  [(r() - 0.5) * spread, (r() - 0.5) * spread, (r() - 0.5) * spread];

/**
 * Bisect to a point on the surface. Random points in an 8-unit cube land far
 * from any surface, where the field is smooth and well-behaved — so a
 * Lipschitz check on them is a much weaker probe than it looks. Violations
 * cluster at the zero level set and at the seams where booleans switch
 * branches, so that is where the samples need to be.
 */
function findSurfacePoint(tree: SDFNode, r: () => number): Vec3 | null {
  let inside: Vec3 | null = null;
  let outside: Vec3 | null = null;
  for (let i = 0; i < 400 && (!inside || !outside); i++) {
    const p = point(r, 10);
    const v = evaluateSDF(tree, p);
    if (!Number.isFinite(v)) continue;
    if (v < 0 && !inside) inside = p;
    if (v > 0 && !outside) outside = p;
  }
  if (!inside || !outside) return null;

  let lo = inside;
  let hi = outside;
  for (let i = 0; i < 50; i++) {
    const mid: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    if (evaluateSDF(tree, mid) < 0) lo = mid; else hi = mid;
  }
  return lo;
}

const dist = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('SDF invariants over random trees', () => {
  it('is 1-Lipschitz: |f(a) - f(b)| <= |a - b|', () => {
    // Sphere tracing steps by the returned distance. If the field reports a
    // distance larger than the true one, the march overshoots the surface and
    // the render shows holes — thin walls being the usual casualty. This is
    // the single most load-bearing property of an SDF.
    const r = rng(0x5eed);
    const violations: string[] = [];

    for (let i = 0; i < 300; i++) {
      const tree = randomExactTree(r, 2 + Math.floor(r() * 2));
      for (let j = 0; j < 20; j++) {
        const a = point(r);
        const b = point(r);
        const fa = evaluateSDF(tree, a);
        const fb = evaluateSDF(tree, b);
        if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
        const ratio = Math.abs(fa - fb) / Math.max(dist(a, b), 1e-9);
        // 1e-6 slack for float accumulation through deep trees.
        if (ratio > 1 + 1e-6) {
          violations.push(`ratio ${ratio.toFixed(4)} on ${JSON.stringify(tree).slice(0, 120)}`);
        }
      }
    }

    expect(violations.slice(0, 3)).toEqual([]);
  });

  it('produces finite values everywhere', () => {
    const r = rng(0xf17e);
    for (let i = 0; i < 300; i++) {
      const tree = randomExactTree(r, 2 + Math.floor(r() * 2));
      for (let j = 0; j < 20; j++) {
        expect(Number.isFinite(evaluateSDF(tree, point(r)))).toBe(true);
      }
    }
  });

  it('union is commutative', () => {
    const r = rng(0xc0);
    for (let i = 0; i < 200; i++) {
      const a = randomExactTree(r, 2);
      const b = randomExactTree(r, 2);
      const p = point(r);
      const ab = evaluateSDF({ kind: 'union', a, b, k: 0 }, p);
      const ba = evaluateSDF({ kind: 'union', a: b, b: a, k: 0 }, p);
      expect(ab).toBeCloseTo(ba, 10);
    }
  });

  it('union and intersect are idempotent', () => {
    const r = rng(0x1de);
    for (let i = 0; i < 200; i++) {
      const a = randomExactTree(r, 2);
      const p = point(r);
      const self = evaluateSDF(a, p);
      expect(evaluateSDF({ kind: 'union', a, b: a, k: 0 }, p)).toBeCloseTo(self, 10);
      expect(evaluateSDF({ kind: 'intersect', a, b: a, k: 0 }, p)).toBeCloseTo(self, 10);
    }
  });

  it('union is exactly the pointwise minimum at k = 0', () => {
    const r = rng(0x11);
    for (let i = 0; i < 200; i++) {
      const a = randomExactTree(r, 2);
      const b = randomExactTree(r, 2);
      const p = point(r);
      const expected = Math.min(evaluateSDF(a, p), evaluateSDF(b, p));
      expect(evaluateSDF({ kind: 'union', a, b, k: 0 }, p)).toBeCloseTo(expected, 10);
    }
  });

  it('translation commutes with evaluation', () => {
    // Evaluating a translated shape at p must equal evaluating the original
    // at p - t. This catches sign errors in the inverse transform, which are
    // easy to write and produce a shape that moves the wrong way.
    const r = rng(0x71a);
    for (let i = 0; i < 200; i++) {
      const child = randomExactTree(r, 2);
      const t = point(r, 6);
      const moved: SDFNode = {
        kind: 'transform', child,
        tx: t[0], ty: t[1], tz: t[2],
        rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      };
      const p = point(r);
      const shifted: Vec3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
      expect(evaluateSDF(moved, p)).toBeCloseTo(evaluateSDF(child, shifted), 8);
    }
  });

  it('smooth union never exceeds the sharp union', () => {
    // Smoothing may only pull the surface outward (more negative), never
    // inward — otherwise a blend would carve material away rather than add
    // a fillet.
    const r = rng(0x53000);
    for (let i = 0; i < 200; i++) {
      const a = randomExactTree(r, 2);
      const b = randomExactTree(r, 2);
      const p = point(r);
      const k = 0.1 + r() * 0.8;
      const sharp = evaluateSDF({ kind: 'union', a, b, k: 0 }, p);
      const smooth = evaluateSDF({ kind: 'union', a, b, k }, p);
      expect(smooth).toBeLessThanOrEqual(sharp + 1e-9);
    }
  });
  it('is 1-Lipschitz near the surface', () => {
    // The sharp version of the test above. Samples are taken within a small
    // radius of a bisected surface point, so they straddle the zero level set
    // and the boolean seams where the bound is actually at risk.
    const r = rng(0x5017ace);
    const violations: { ratio: number; tree: string }[] = [];
    let probed = 0;

    for (let i = 0; i < 250; i++) {
      const tree = randomExactTree(r, 2 + Math.floor(r() * 2));
      const surf = findSurfacePoint(tree, r);
      if (!surf) continue;
      probed++;

      for (let j = 0; j < 40; j++) {
        const jitter = (scale: number): Vec3 => [
          surf[0] + (r() - 0.5) * scale,
          surf[1] + (r() - 0.5) * scale,
          surf[2] + (r() - 0.5) * scale,
        ];
        const scale = 0.001 + r() * 0.5;
        const a = jitter(scale);
        const b = jitter(scale);
        const fa = evaluateSDF(tree, a);
        const fb = evaluateSDF(tree, b);
        if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
        const d = dist(a, b);
        if (d < 1e-9) continue;
        const ratio = Math.abs(fa - fb) / d;
        if (ratio > 1 + 1e-6) {
          violations.push({ ratio, tree: JSON.stringify(tree) });
        }
      }
    }

    // Guard against the test passing because it never probed anything.
    expect(probed).toBeGreaterThan(50);

    const worst = violations.sort((x, y) => y.ratio - x.ratio).slice(0, 3);
    expect(worst.map((v) => `${v.ratio.toFixed(3)}x ${v.tree.slice(0, 200)}`)).toEqual([]);
  });
});

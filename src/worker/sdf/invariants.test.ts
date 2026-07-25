import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateSDF } from './evaluate';
import { computeBounds } from './bounds';
import { sdfTree, expandPatterns, gridSamples, usableBounds, nodeCount } from './testTrees';
import type { SDFNode, Vec3 } from './types';

/**
 * Invariants the rest of the system depends on but nothing used to check.
 *
 * The mesher sizes its grid from `computeBounds` and prunes octree blocks by
 * the magnitude of the field; the viewport sphere-traces that same field.  Each
 * is sound only under a property stated here.  Every defect these caught
 * (#69-#72) was invisible to tests that checked one node's zero level set.
 *
 * Note what is *not* asserted: that the field is 1-Lipschitz.  That is
 * sufficient for soundness but not necessary, and Quilez's ellipsoid
 * approximation genuinely violates it outside the solid (|grad| reaches ~7 for
 * a 6:1 ellipsoid) while never overreporting distance.  The property that
 * actually has to hold is the ball property below.
 */

const RUNS = 120;

/** Reject trees big enough to make an O(samples x nodes) property crawl. */
const smallTree = (depth: number) => sdfTree(depth).filter((t) => nodeCount(t) <= 24);

function seeded(seed: number) {
  let s = seed || 1;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

describe('invariant: computeBounds contains all solid', () => {
  it('holds for random trees', () => {
    fc.assert(
      fc.property(smallTree(3), fc.integer({ min: 1, max: 2 ** 30 }), (tree, seed) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        const ext: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
        const tol = Math.max(ext[0], ext[1], ext[2]) * 1e-3;
        const rnd = seeded(seed);
        for (let n = 0; n < 300; n++) {
          const p: Vec3 = [
            bb.min[0] - ext[0] * 0.6 + rnd() * ext[0] * 2.2,
            bb.min[1] - ext[1] * 0.6 + rnd() * ext[1] * 2.2,
            bb.min[2] - ext[2] * 0.6 + rnd() * ext[2] * 2.2,
          ];
          const outside = p[0] < bb.min[0] || p[0] > bb.max[0] || p[1] < bb.min[1] ||
                          p[1] > bb.max[1] || p[2] < bb.min[2] || p[2] > bb.max[2];
          if (!outside) continue;
          if (evaluateSDF(tree, p) < -tol) return false;
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('invariant: the reported distance is a valid clearance (ball property)', () => {
  it('nothing of the opposite sign lies within |f(p)| of p', () => {
    fc.assert(
      fc.property(smallTree(3), fc.integer({ min: 1, max: 2 ** 30 }), (tree, seed) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        const ext: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
        const rnd = seeded(seed);
        for (let n = 0; n < 60; n++) {
          const p: Vec3 = [
            bb.min[0] - ext[0] * 0.3 + rnd() * ext[0] * 1.6,
            bb.min[1] - ext[1] * 0.3 + rnd() * ext[1] * 1.6,
            bb.min[2] - ext[2] * 0.3 + rnd() * ext[2] * 1.6,
          ];
          const f = evaluateSDF(tree, p);
          if (!isFinite(f) || Math.abs(f) < 1e-9) continue;
          for (let k = 0; k < 4; k++) {
            let d: Vec3 = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
            const L = Math.hypot(d[0], d[1], d[2]);
            if (L < 1e-9) continue;
            d = [d[0] / L, d[1] / L, d[2] / L];
            // 0.98 keeps the probe strictly inside the claimed clear ball, so
            // a point sitting exactly on the surface is not counted a failure.
            for (let t = 0.1; t < 0.98; t += 0.08) {
              const r = Math.abs(f) * t;
              const fq = evaluateSDF(tree, [p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r]);
              if (isFinite(fq) && (fq < 0) !== (f < 0)) return false;
            }
          }
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('metamorphic: a pattern equals the union of its instances', () => {
  const patternTree = fc.oneof(
    fc.record({
      kind: fc.constant('linearPattern' as const), child: smallTree(2),
      axis: fc.tuple(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
      ).filter((a) => Math.hypot(a[0], a[1], a[2]) > 0.2),
      count: fc.integer({ min: 2, max: 5 }),
      spacing: fc.double({ min: 2, max: 30, noNaN: true }),
    }),
    fc.record({
      kind: fc.constant('circularPattern' as const), child: smallTree(2),
      axis: fc.constantFrom<Vec3>([1, 0, 0], [0, 1, 0], [0, 0, 1]),
      count: fc.integer({ min: 2, max: 8 }),
    }),
  ) as fc.Arbitrary<SDFNode>;

  it('agrees on occupancy', () => {
    fc.assert(
      fc.property(patternTree, (tree) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        const ref = expandPatterns(tree);
        for (const p of gridSamples(bb, 9)) {
          const a = evaluateSDF(tree, p), b = evaluateSDF(ref, p);
          if (!isFinite(a) || !isFinite(b)) continue;
          // Only sign disagreement matters, and not where both are within
          // rounding of the surface.
          if (a < 0 !== b < 0 && Math.abs(a - b) > 1e-9) return false;
        }
        return true;
      }),
      { numRuns: 80 },
    );
  });
});

describe('metamorphic: shell equals the difference of two offsets', () => {
  it('agrees on occupancy', () => {
    fc.assert(
      fc.property(smallTree(2), fc.double({ min: 0.5, max: 8, noNaN: true }), (child, thickness) => {
        const shell: SDFNode = { kind: 'shell', child, thickness };
        // |d| <= t/2  ==  (d <= t/2) and not (d < -t/2)
        const ref: SDFNode = {
          kind: 'subtract', k: 0,
          a: { kind: 'offset', child, distance: thickness / 2 },
          b: { kind: 'offset', child, distance: -thickness / 2 },
        };
        const bb = usableBounds(shell);
        if (!bb) return true;
        for (const p of gridSamples(bb, 7)) {
          const a = evaluateSDF(shell, p), b = evaluateSDF(ref, p);
          if (!isFinite(a) || !isFinite(b)) continue;
          if (a < 0 !== b < 0 && Math.abs(a - b) > 1e-9) return false;
        }
        return true;
      }),
      { numRuns: 80 },
    );
  });
});

describe('metamorphic: translation equivariance', () => {
  it('moving the shape equals moving the query point', () => {
    fc.assert(
      fc.property(
        smallTree(2),
        fc.tuple(
          fc.double({ min: -30, max: 30, noNaN: true }),
          fc.double({ min: -30, max: 30, noNaN: true }),
          fc.double({ min: -30, max: 30, noNaN: true }),
        ),
        (child, t) => {
          const moved: SDFNode = {
            kind: 'transform', child, tx: t[0], ty: t[1], tz: t[2],
            rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
          };
          const bb = usableBounds(moved);
          if (!bb) return true;
          for (const p of gridSamples(bb, 7)) {
            const a = evaluateSDF(moved, p);
            const b = evaluateSDF(child, [p[0] - t[0], p[1] - t[1], p[2] - t[2]]);
            if (!isFinite(a) || !isFinite(b)) continue;
            if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) return false;
          }
          return true;
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe('regressions for the defects these properties found', () => {
  it('#69 linearPattern keeps every copy when the child is offset along the axis', () => {
    const pat: SDFNode = {
      kind: 'linearPattern', axis: [1, 0, 0], count: 3, spacing: 20,
      child: {
        kind: 'transform', child: { kind: 'box', size: [10, 10, 10] },
        tx: 37.5, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      },
    };
    for (const x of [37.5, 57.5, 77.5]) {
      expect(evaluateSDF(pat, [x, 0, 0])).toBeCloseTo(-5, 6);
    }
  });

  it('#69 circularPattern covers a child spanning more than one sector', () => {
    const pat: SDFNode = {
      kind: 'circularPattern', axis: [0, 1, 0], count: 6,
      child: {
        kind: 'transform', child: { kind: 'box', size: [60, 10, 10] },
        tx: 20, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      },
    };
    const ref = expandPatterns(pat);
    let disagree = 0;
    for (const p of gridSamples(computeBounds(pat), 15)) {
      if (evaluateSDF(pat, p) < 0 !== evaluateSDF(ref, p) < 0) disagree++;
    }
    expect(disagree).toBe(0);
  });

  it('#71 ellipsoid never reports more than the true distance', () => {
    const ell: SDFNode = { kind: 'ellipsoid', size: [60, 10, 20] };
    // True distances along the axes: 60-30, 30-5, 40-10.  The field is allowed
    // to under-report — that only costs ray-march steps — but never to exceed.
    expect(evaluateSDF(ell, [60, 0, 0])).toBeLessThanOrEqual(30);
    expect(evaluateSDF(ell, [0, 30, 0])).toBeLessThanOrEqual(25);
    expect(evaluateSDF(ell, [0, 0, 40])).toBeLessThanOrEqual(30);
    // Positive outside, and exact along the shortest axis, which is where the
    // scaled-sphere bound is tight.
    expect(evaluateSDF(ell, [60, 0, 0])).toBeGreaterThan(0);
    expect(evaluateSDF(ell, [0, 30, 0])).toBeCloseTo(25, 6);
    // The surface itself still has to land in the right place.
    expect(evaluateSDF(ell, [30, 0, 0])).toBeCloseTo(0, 6);
    expect(evaluateSDF(ell, [0, 5, 0])).toBeCloseTo(0, 6);
    expect(evaluateSDF(ell, [0, 0, 10])).toBeCloseTo(0, 6);
  });

  it('#71 the ellipsoid interior is continuous and never overstates clearance', () => {
    const ell: SDFNode = { kind: 'ellipsoid', size: [60, 10, 20] };
    // Nearest surface from the centre is the short axis, 5mm away.  Quilez's
    // form tends to -30 along x and -10 along z instead, so the value at the
    // centre depended on the direction of approach.
    for (const p of [[1e-4, 0, 0], [0, 1e-4, 0], [0, 0, 1e-4]] as Vec3[]) {
      expect(evaluateSDF(ell, p)).toBeCloseTo(-5, 3);
    }
  });

  it('#71 an ellipsoid agrees with the same shape built by scaling a sphere', () => {
    const ell: SDFNode = { kind: 'ellipsoid', size: [60, 10, 20] };
    const scaled: SDFNode = {
      kind: 'transform', child: { kind: 'sphere', radius: 1 },
      tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 30, sy: 5, sz: 10,
    };
    for (const p of gridSamples(computeBounds(ell), 11)) {
      expect(evaluateSDF(ell, p)).toBeCloseTo(evaluateSDF(scaled, p), 6);
    }
  });

  it('#72 a capsule shorter than its diameter is a sphere at the origin', () => {
    const cap: SDFNode = { kind: 'capsule', radius: 10, height: 5 };
    expect(evaluateSDF(cap, [0, 0, 0])).toBeCloseTo(-10, 6);
    expect(evaluateSDF(cap, [0, 10, 0])).toBeCloseTo(0, 6);
    expect(evaluateSDF(cap, [0, -10, 0])).toBeCloseTo(0, 6);
    const bb = computeBounds(cap);
    expect(bb.min[1]).toBeLessThanOrEqual(-10);
    expect(bb.max[1]).toBeGreaterThanOrEqual(10);
  });

  it('#73 bounds compose rotation and non-uniform scale the way the evaluator does', () => {
    // Scale-then-rotate and rotate-then-scale differ once the scale is
    // non-uniform; bounds.ts used the opposite order to evaluate.ts, so the
    // solid stuck out of its own bounding box.
    const tree: SDFNode = {
      kind: 'transform', child: { kind: 'box', size: [2, 2, 3.16] },
      tx: 0, ty: 0, tz: 0, rx: -3.86, ry: 0, rz: 0,
      sx: 0.4138, sy: 3.0, sz: 1.6068,
    };
    const bb = computeBounds(tree);
    for (const p of gridSamples(bb, 21, 0.4)) {
      if (evaluateSDF(tree, p) < 0) {
        for (let k = 0; k < 3; k++) {
          expect(p[k]).toBeGreaterThanOrEqual(bb.min[k] - 1e-9);
          expect(p[k]).toBeLessThanOrEqual(bb.max[k] + 1e-9);
        }
      }
    }
  });

  it('#70 round() over a non-uniform scale stays inside its bounds', () => {
    const tree: SDFNode = {
      kind: 'round', radius: 10,
      child: {
        kind: 'transform', child: { kind: 'box', size: [20, 20, 20] },
        tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 0.1, sz: 1,
      },
    };
    const bb = computeBounds(tree);
    let maxX = 0;
    for (let x = 0; x < 400; x += 0.5) if (evaluateSDF(tree, [x, 0, 0]) < 0) maxX = x;
    expect(maxX).toBeLessThanOrEqual(bb.max[0]);
  });
});

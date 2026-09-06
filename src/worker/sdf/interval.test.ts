import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateSDF } from './evaluate';
import { computeBounds } from './bounds';
import { evaluateInterval, classifyCell, soundBounds, verifiedBounds } from './interval';
import { sdfTree, usableBounds, nodeCount } from './testTrees';
import type { SDFNode, Vec3, BBox } from './types';

/**
 * The interval evaluator's whole value is one claim: the returned range
 * contains every value the field takes in the box.  If that ever fails, the
 * octree pruning built on it becomes unsound, so it is worth hammering.
 */

const smallTree = (depth: number) => sdfTree(depth).filter((t) => nodeCount(t) <= 20);

function samplesIn(box: BBox, n: number, seed: number): Vec3[] {
  let s = seed || 1;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    out.push([
      box.min[0] + rnd() * (box.max[0] - box.min[0]),
      box.min[1] + rnd() * (box.max[1] - box.min[1]),
      box.min[2] + rnd() * (box.max[2] - box.min[2]),
    ]);
  }
  // Corners too — extremes usually live there.
  for (let i = 0; i < 8; i++) {
    out.push([
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    ]);
  }
  return out;
}

/** A sub-box of the tree's bounds, chosen from three unit-cube fractions. */
function subBox(bb: BBox, f: [number, number, number], g: [number, number, number]): BBox {
  const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = bb.min[k] + f[k] * (bb.max[k] - bb.min[k]);
    const b = bb.min[k] + g[k] * (bb.max[k] - bb.min[k]);
    lo[k] = Math.min(a, b); hi[k] = Math.max(a, b);
  }
  return { min: lo, max: hi };
}

const frac = fc.tuple(
  fc.double({ min: -0.2, max: 1.2, noNaN: true }),
  fc.double({ min: -0.2, max: 1.2, noNaN: true }),
  fc.double({ min: -0.2, max: 1.2, noNaN: true }),
);

describe('the interval enclosure contains the pointwise field', () => {
  it('holds for random trees and random boxes', () => {
    fc.assert(
      fc.property(smallTree(3), frac, frac, fc.integer({ min: 1, max: 2 ** 30 }), (tree, f, g, seed) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        const box = subBox(bb, f as [number, number, number], g as [number, number, number]);
        const iv = evaluateInterval(tree, box);
        if (!isFinite(iv.lo) && !isFinite(iv.hi)) return true;
        const scale = Math.max(...[0, 1, 2].map((k) => bb.max[k] - bb.min[k]));
        // Nested transforms and repetition can accumulate a few ulps beyond
        // the scale-relative allowance (the CI counterexample missed by
        // 9.8e-10 after six patterned, non-uniformly scaled copies).
        const tol = scale * 1e-6 + 1e-8;
        for (const p of samplesIn(box, 120, seed)) {
          const v = evaluateSDF(tree, p);
          if (!isFinite(v)) continue;
          if (v < iv.lo - tol || v > iv.hi + tol) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });
});

describe('classifyCell never lies about a cell', () => {
  it('an "outside" verdict means no solid, an "inside" verdict means no void', () => {
    fc.assert(
      fc.property(smallTree(3), frac, frac, fc.integer({ min: 1, max: 2 ** 30 }), (tree, f, g, seed) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        const box = subBox(bb, f as [number, number, number], g as [number, number, number]);
        const verdict = classifyCell(tree, box);
        if (verdict === 'straddles') return true;
        for (const p of samplesIn(box, 120, seed)) {
          const v = evaluateSDF(tree, p);
          if (!isFinite(v)) continue;
          if (verdict === 'outside' && v < 0) return false;
          if (verdict === 'inside' && v > 0) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });
});

describe('soundBounds encloses the solid', () => {
  it('every solid sample lies inside the returned box', () => {
    fc.assert(
      fc.property(smallTree(3), fc.integer({ min: 1, max: 2 ** 30 }), (tree, seed) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        // Seed generously so the search cannot miss solid outside computeBounds.
        const ext: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
        const seedBox: BBox = {
          min: [bb.min[0] - ext[0], bb.min[1] - ext[1], bb.min[2] - ext[2]],
          max: [bb.max[0] + ext[0], bb.max[1] + ext[1], bb.max[2] + ext[2]],
        };
        const sb = soundBounds(tree, seedBox, 5);
        if (!sb) return true;
        const tol = Math.max(ext[0], ext[1], ext[2]) * 1e-6;
        for (const p of samplesIn(seedBox, 400, seed)) {
          if (evaluateSDF(tree, p) >= 0) continue;
          for (let k = 0; k < 3; k++) {
            if (p[k] < sb.min[k] - tol || p[k] > sb.max[k] + tol) return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('verifiedBounds contains the solid, as the mesher calls it', () => {
    fc.assert(
      fc.property(smallTree(3), fc.integer({ min: 1, max: 2 ** 30 }), (tree, seed) => {
        const bb = usableBounds(tree);
        if (!bb) return true;
        // Exactly how prepareBBox calls it.  Coverage comes from computeBounds
        // being structural; the interval search only ever widens the result.
        const vb = verifiedBounds(tree, computeBounds(tree), 4, 4);
        if (!vb) return true;
        const ext: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
        const tol = Math.max(ext[0], ext[1], ext[2]) * 1e-6;
        const wide: BBox = {
          min: [bb.min[0] - ext[0], bb.min[1] - ext[1], bb.min[2] - ext[2]],
          max: [bb.max[0] + ext[0], bb.max[1] + ext[1], bb.max[2] + ext[2]],
        };
        for (const p of samplesIn(wide, 300, seed)) {
          if (evaluateSDF(tree, p) >= 0) continue;
          for (let k = 0; k < 3; k++) {
            if (p[k] < vb.min[k] - tol || p[k] > vb.max[k] + tol) return false;
          }
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('verifiedBounds widens a hint that omits real material', () => {
    // The #70 shape fed the pre-fix margin as its hint: solid reaches x = 110
    // but the hint stops at 20.  The interval search has to notice and widen,
    // which is the half of the contract computeBounds cannot provide.
    const tree: SDFNode = {
      kind: 'round', radius: 10,
      child: {
        kind: 'transform', child: { kind: 'box', size: [20, 20, 20] },
        tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 0.1, sz: 1,
      },
    };
    const badHint: BBox = { min: [-20, -11, -20], max: [20, 11, 20] };
    const vb = verifiedBounds(tree, badHint, 6, 6)!;
    expect(evaluateSDF(tree, [100, 0, 0])).toBeLessThan(0);
    expect(vb.max[0]).toBeGreaterThanOrEqual(100);
  });

  it('halfSpace no longer clips models larger than the old 1000mm stand-in', () => {
    // intersect(box 4000 wide, x <= 0) — the solid runs from x = -2000 to 0.
    const tree: SDFNode = {
      kind: 'intersect', k: 0,
      a: { kind: 'box', size: [4000, 100, 100] },
      b: { kind: 'halfSpace', axis: 'x', position: 0, flip: false },
    };
    expect(evaluateSDF(tree, [-1500, 0, 0])).toBeLessThan(0);
    const bb = computeBounds(tree);
    expect(bb.min[0]).toBeLessThanOrEqual(-2000);
    // The half-space side is unbounded on its own, but the intersect defers to
    // the box, so the result stays finite.
    expect(isFinite(bb.min[0])).toBe(true);
    expect(isFinite(bb.max[0])).toBe(true);
  });

  it('catches solid that the composed per-node bounds would have missed', () => {
    // The #70 shape: round() over a non-uniform scale.  Deliberately fed the
    // pre-fix margin (radius, not radius * fieldScale) as the seed, to show the
    // interval search finds the material regardless of the per-node rule.
    const tree: SDFNode = {
      kind: 'round', radius: 10,
      child: {
        kind: 'transform', child: { kind: 'box', size: [20, 20, 20] },
        tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 0.1, sz: 1,
      },
    };
    const naive: BBox = { min: [-20, -11, -20], max: [20, 11, 20] };
    const seed: BBox = { min: [-300, -300, -300], max: [300, 300, 300] };
    const sb = soundBounds(tree, seed, 7);
    expect(sb).not.toBeNull();
    // Solid really does reach x = 110, far outside the naive box.
    expect(evaluateSDF(tree, [100, 0, 0])).toBeLessThan(0);
    expect(sb!.max[0]).toBeGreaterThan(naive.max[0]);
    expect(sb!.max[0]).toBeGreaterThanOrEqual(100);
    // And the fixed per-node bounds now cover it too.
    expect(computeBounds(tree).max[0]).toBeGreaterThanOrEqual(110);
  });
});

import fc from 'fast-check';
import type { SDFNode, Vec3, BBox } from './types';
import { computeBounds } from './bounds';

/**
 * Shared fixtures for the invariant suites: random tree generation, and
 * reference rewrites that a correct evaluator must agree with.
 */

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const leaf: fc.Arbitrary<SDFNode> = fc.oneof(
  fc.record({ kind: fc.constant('box' as const), size: fc.tuple(num(2, 40), num(2, 40), num(2, 40)) }),
  fc.record({ kind: fc.constant('sphere' as const), radius: num(1, 20) }),
  fc.record({ kind: fc.constant('cylinder' as const), radius: num(1, 20), height: num(2, 40) }),
  fc.record({ kind: fc.constant('torus' as const), major: num(4, 20), minor: num(1, 6) }),
  fc.record({ kind: fc.constant('cone' as const), radius: num(1, 20), height: num(2, 40) }),
  // height deliberately allowed below 2*radius — that is the degenerate case
  fc.record({ kind: fc.constant('capsule' as const), radius: num(1, 15), height: num(1, 40) }),
  fc.record({ kind: fc.constant('ellipsoid' as const), size: fc.tuple(num(2, 40), num(2, 40), num(2, 40)) }),
);

/** Random tree over every node kind the evaluator supports. */
export function sdfTree(maxDepth = 3): fc.Arbitrary<SDFNode> {
  return fc.letrec<{ node: SDFNode }>((tie) => ({
    node: fc.oneof(
      { maxDepth, depthSize: 'small' },
      leaf,
      fc.record({ kind: fc.constant('union' as const), a: tie('node'), b: tie('node'), k: num(0, 6) }),
      fc.record({ kind: fc.constant('subtract' as const), a: tie('node'), b: tie('node'), k: num(0, 6) }),
      fc.record({ kind: fc.constant('intersect' as const), a: tie('node'), b: tie('node'), k: num(0, 6) }),
      fc.record({ kind: fc.constant('shell' as const), child: tie('node'), thickness: num(0.5, 8) }),
      fc.record({ kind: fc.constant('offset' as const), child: tie('node'), distance: num(-6, 6) }),
      fc.record({ kind: fc.constant('round' as const), child: tie('node'), radius: num(0, 10) }),
      fc.record({
        kind: fc.constant('transform' as const), child: tie('node'),
        tx: num(-25, 25), ty: num(-25, 25), tz: num(-25, 25),
        rx: num(-180, 180), ry: num(-180, 180), rz: num(-180, 180),
        sx: num(0.1, 3), sy: num(0.1, 3), sz: num(0.1, 3),
      }),
      fc.record({
        kind: fc.constant('mirror' as const), child: tie('node'),
        axes: fc.tuple(fc.constantFrom(0, 1), fc.constantFrom(0, 1), fc.constantFrom(0, 1)),
      }),
      fc.record({
        kind: fc.constant('linearPattern' as const), child: tie('node'),
        axis: fc.tuple(num(-1, 1), num(-1, 1), num(-1, 1)).filter((a) => Math.hypot(...a) > 0.2),
        count: fc.integer({ min: 2, max: 6 }), spacing: num(2, 30),
      }),
      fc.record({
        kind: fc.constant('circularPattern' as const), child: tie('node'),
        axis: fc.constantFrom<Vec3>([1, 0, 0], [0, 1, 0], [0, 0, 1]),
        count: fc.integer({ min: 2, max: 8 }),
      }),
    ) as fc.Arbitrary<SDFNode>,
  })).node;
}

/** Rigid transform node, spelled out so the reference rewrites stay readable. */
function rigid(child: SDFNode, t: Vec3, r: Vec3): SDFNode {
  return {
    kind: 'transform', child,
    tx: t[0], ty: t[1], tz: t[2], rx: r[0], ry: r[1], rz: r[2], sx: 1, sy: 1, sz: 1,
  };
}

/**
 * Reference semantics for the pattern nodes: a pattern is exactly the union of
 * its instances, each placed by a rigid transform.  The real nodes fold the
 * query point into one cell instead, for speed; that fold is what broke in #69,
 * so the two must be checked against each other.
 */
export function expandPatterns(node: SDFNode): SDFNode {
  switch (node.kind) {
    case 'linearPattern': {
      const len = Math.hypot(node.axis[0], node.axis[1], node.axis[2]);
      if (len < 1e-8) return expandPatterns(node.child);
      const a: Vec3 = [node.axis[0] / len, node.axis[1] / len, node.axis[2] / len];
      const copies: SDFNode[] = [];
      for (let i = 0; i < node.count; i++) {
        const o = i * node.spacing;
        copies.push(rigid(expandPatterns(node.child), [a[0] * o, a[1] * o, a[2] * o], [0, 0, 0]));
      }
      return copies.reduce((p, c) => ({ kind: 'union', a: p, b: c, k: 0 }));
    }
    case 'circularPattern': {
      const ax = node.axis;
      const isX = Math.abs(ax[0]) > Math.abs(ax[1]) && Math.abs(ax[0]) > Math.abs(ax[2]);
      const isZ = !isX && Math.abs(ax[2]) > Math.abs(ax[1]);
      const copies: SDFNode[] = [];
      for (let i = 0; i < node.count; i++) {
        const deg = (360 / node.count) * i;
        const rot: Vec3 = isX ? [deg, 0, 0] : isZ ? [0, 0, deg] : [0, deg, 0];
        copies.push(rigid(expandPatterns(node.child), [0, 0, 0], rot));
      }
      return copies.reduce((p, c) => ({ kind: 'union', a: p, b: c, k: 0 }));
    }
    case 'union':
    case 'subtract':
    case 'intersect':
      return { ...node, a: expandPatterns(node.a), b: expandPatterns(node.b) };
    case 'shell':
    case 'offset':
    case 'round':
    case 'transform':
    case 'mirror':
      return { ...node, child: expandPatterns(node.child) } as SDFNode;
    default:
      return node;
  }
}

/** Node count, so properties can skip trees too big to sample cheaply. */
export function nodeCount(node: SDFNode): number {
  if ('a' in node && 'b' in node) return 1 + nodeCount(node.a) + nodeCount(node.b);
  if ('child' in node) return 1 + nodeCount(node.child);
  return 1;
}

/** Deterministic sample points filling a box, for occupancy comparisons. */
export function gridSamples(bb: BBox, n: number, pad = 0.25): Vec3[] {
  const ext: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    out.push([
      bb.min[0] - ext[0] * pad + (ext[0] * (1 + 2 * pad) * i) / (n - 1),
      bb.min[1] - ext[1] * pad + (ext[1] * (1 + 2 * pad) * j) / (n - 1),
      bb.min[2] - ext[2] * pad + (ext[2] * (1 + 2 * pad) * k) / (n - 1),
    ]);
  }
  return out;
}

/** True when a tree's bounds are finite and big enough to sample meaningfully. */
export function usableBounds(node: SDFNode): BBox | null {
  const bb = computeBounds(node);
  for (let i = 0; i < 3; i++) {
    if (!isFinite(bb.min[i]) || !isFinite(bb.max[i])) return null;
    if (bb.max[i] - bb.min[i] < 1e-3) return null;
    if (bb.max[i] - bb.min[i] > 1e5) return null;
  }
  return bb;
}

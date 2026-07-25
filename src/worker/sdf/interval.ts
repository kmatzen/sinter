import type { SDFNode, BBox, Vec3 } from './types';

/**
 * Interval-arithmetic evaluation of the SDF tree.
 *
 * `evaluateInterval(node, box)` returns an enclosure of every value the field
 * takes anywhere in `box` — the result is guaranteed to contain
 * { evaluateSDF(node, p) : p in box }, though it may be wider.
 *
 * That guarantee is what the pointwise field cannot give.  The mesher's octree
 * currently prunes a block when |f(centre)| exceeds the block's half-diagonal,
 * which is only valid if the field never overestimates distance — an
 * assumption several nodes break (see #70, #71).  An interval that excludes
 * zero *proves* the block holds no surface, with no Lipschitz assumption at
 * all, so the pruning becomes sound by construction.
 *
 * The usual caveat applies: intervals do not track correlation between
 * occurrences of a variable, so enclosures widen on large boxes.  That costs
 * extra subdivision, never correctness.
 */

export interface Interval { lo: number; hi: number }

const I = (lo: number, hi: number): Interval => ({ lo, hi });
export const WHOLE: Interval = I(-Infinity, Infinity);

const add = (a: Interval, b: Interval) => I(a.lo + b.lo, a.hi + b.hi);
const sub = (a: Interval, b: Interval) => I(a.lo - b.hi, a.hi - b.lo);
const neg = (a: Interval) => I(-a.hi, -a.lo);
const addK = (a: Interval, k: number) => I(a.lo + k, a.hi + k);

function mulK(a: Interval, k: number): Interval {
  return k >= 0 ? I(a.lo * k, a.hi * k) : I(a.hi * k, a.lo * k);
}

const minI = (a: Interval, b: Interval) => I(Math.min(a.lo, b.lo), Math.min(a.hi, b.hi));
const maxI = (a: Interval, b: Interval) => I(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi));
const minK = (a: Interval, k: number) => I(Math.min(a.lo, k), Math.min(a.hi, k));
const maxK = (a: Interval, k: number) => I(Math.max(a.lo, k), Math.max(a.hi, k));

function absI(a: Interval): Interval {
  if (a.lo >= 0) return a;
  if (a.hi <= 0) return neg(a);
  return I(0, Math.max(-a.lo, a.hi));
}

function sqr(a: Interval): Interval {
  if (a.lo >= 0) return I(a.lo * a.lo, a.hi * a.hi);
  if (a.hi <= 0) return I(a.hi * a.hi, a.lo * a.lo);
  return I(0, Math.max(a.lo * a.lo, a.hi * a.hi));
}

const sqrtI = (a: Interval) => I(Math.sqrt(Math.max(a.lo, 0)), Math.sqrt(Math.max(a.hi, 0)));

/** Euclidean length of a vector of intervals. */
function lengthI(cs: Interval[]): Interval {
  return sqrtI(cs.map(sqr).reduce(add, I(0, 0)));
}

const clampI = (a: Interval, lo: number, hi: number) =>
  I(Math.min(Math.max(a.lo, lo), hi), Math.min(Math.max(a.hi, lo), hi));

const boxToIntervals = (b: BBox): [Interval, Interval, Interval] =>
  [I(b.min[0], b.max[0]), I(b.min[1], b.max[1]), I(b.min[2], b.max[2])];

/** AABB of an affine image of a box — sound because affine maps send the box
 *  into the hull of its mapped corners. */
function mapBox(b: BBox, f: (p: Vec3) => Vec3): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const q = f([
      i & 1 ? b.max[0] : b.min[0],
      i & 2 ? b.max[1] : b.min[1],
      i & 4 ? b.max[2] : b.min[2],
    ]);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
  }
  return { min, max };
}

/** Inverse of a transform node, matching evaluate.ts exactly. */
function inverseTransform(node: Extract<SDFNode, { kind: 'transform' }>): (p: Vec3) => Vec3 {
  return (p: Vec3) => {
    let px = (p[0] - node.tx) / node.sx;
    let py = (p[1] - node.ty) / node.sy;
    let pz = (p[2] - node.tz) / node.sz;
    {
      const a = -node.rz * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      [px, py] = [px * c - py * s, px * s + py * c];
    }
    {
      const a = -node.ry * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      [px, pz] = [px * c + pz * s, -px * s + pz * c];
    }
    {
      const a = -node.rx * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      [py, pz] = [py * c - pz * s, py * s + pz * c];
    }
    return [px, py, pz];
  };
}

function rotateAbout(axis: 'x' | 'y' | 'z', ang: number): (p: Vec3) => Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  if (axis === 'x') return (p) => [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  if (axis === 'z') return (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  return (p) => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

export function evaluateInterval(node: SDFNode, box: BBox): Interval {
  const [x, y, z] = boxToIntervals(box);

  switch (node.kind) {
    case 'box': {
      const q = [
        addK(absI(x), -node.size[0] / 2),
        addK(absI(y), -node.size[1] / 2),
        addK(absI(z), -node.size[2] / 2),
      ];
      const outside = lengthI(q.map((c) => maxK(c, 0)));
      const inside = minK(maxI(maxI(q[0], q[1]), q[2]), 0);
      return add(outside, inside);
    }
    case 'sphere':
      return addK(lengthI([x, y, z]), -node.radius);
    case 'cylinder': {
      const dxz = addK(lengthI([x, z]), -node.radius);
      const dy = addK(absI(y), -node.height / 2);
      return add(minK(maxI(dxz, dy), 0), lengthI([maxK(dxz, 0), maxK(dy, 0)]));
    }
    case 'torus': {
      const q = addK(lengthI([x, z]), -node.major);
      return addK(lengthI([q, y]), -node.minor);
    }
    case 'capsule': {
      const halfH = Math.max(0, node.height / 2 - node.radius);
      const py = clampI(y, -halfH, halfH);
      return addK(lengthI([x, sub(y, py), z]), -node.radius);
    }
    case 'ellipsoid': {
      // Mirrors evaluate.ts exactly: (length(p/r) - 1) * min(r).
      const sx = node.size[0] / 2, sy = node.size[1] / 2, sz = node.size[2] / 2;
      const k0 = lengthI([mulK(x, 1 / sx), mulK(y, 1 / sy), mulK(z, 1 / sz)]);
      return mulK(addK(k0, -1), Math.min(sx, sy, sz));
    }
    case 'cone': {
      // Enclosing the full capped-cone formula is not worth it: the cone sits
      // inside its bounding cylinder, and the cylinder's distance is a sound
      // lower bound, with no useful upper bound.
      const dxz = addK(lengthI([x, z]), -node.radius);
      const dy = addK(absI(y), -node.height / 2);
      const outer = add(minK(maxI(dxz, dy), 0), lengthI([maxK(dxz, 0), maxK(dy, 0)]));
      return I(outer.lo, Infinity);
    }
    // The blend term is k*h*(1-h) with h in [0,1], so it never exceeds k/4 —
    // the slack the smooth forms need over their sharp min/max, and no more.
    // Using k instead costs real pruning: a smooth union widens four times
    // further than it has to and the octree descends where it need not.
    case 'union': {
      const a = evaluateInterval(node.a, box), b = evaluateInterval(node.b, box);
      // smin <= min(a, b), and never more than k/4 below it.
      if (node.k > 0) return I(Math.min(a.lo, b.lo) - node.k / 4, Math.min(a.hi, b.hi));
      return minI(a, b);
    }
    case 'subtract': {
      const a = evaluateInterval(node.a, box), b = neg(evaluateInterval(node.b, box));
      // smax >= max(a, -b), and never more than k/4 above it.
      if (node.k > 0) return I(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi) + node.k / 4);
      return maxI(a, b);
    }
    case 'intersect': {
      const a = evaluateInterval(node.a, box), b = evaluateInterval(node.b, box);
      if (node.k > 0) return I(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi) + node.k / 4);
      return maxI(a, b);
    }
    case 'shell':
      return addK(absI(evaluateInterval(node.child, box)), -node.thickness / 2);
    case 'offset':
      return addK(evaluateInterval(node.child, box), -node.distance);
    case 'round':
      return addK(evaluateInterval(node.child, box), -node.radius);
    case 'transform': {
      if (!isFinite(node.sx) || !isFinite(node.sy) || !isFinite(node.sz) ||
          Math.abs(node.sx) < 1e-9 || Math.abs(node.sy) < 1e-9 || Math.abs(node.sz) < 1e-9) return WHOLE;
      const inner = evaluateInterval(node.child, mapBox(box, inverseTransform(node)));
      return mulK(inner, Math.min(node.sx, node.sy, node.sz));
    }
    case 'mirror': {
      // abs() folds the box onto the positive side; the fold of an interval
      // straddling zero is [0, max(|lo|,|hi|)], which is what absI gives.
      const fold = (c: Interval, on: number) => (on ? absI(c) : c);
      const fx = fold(x, node.axes[0]), fy = fold(y, node.axes[1]), fz = fold(z, node.axes[2]);
      return evaluateInterval(node.child, { min: [fx.lo, fy.lo, fz.lo], max: [fx.hi, fy.hi, fz.hi] });
    }
    case 'linearPattern': {
      // Every instance, not a window: over a box the relevant instances vary,
      // and enumerating is sound and cheap for the counts the UI allows.
      const len = Math.hypot(node.axis[0], node.axis[1], node.axis[2]);
      if (len < 1e-8) return evaluateInterval(node.child, box);
      const a: Vec3 = [node.axis[0] / len, node.axis[1] / len, node.axis[2] / len];
      let acc: Interval | null = null;
      for (let i = 0; i < node.count; i++) {
        const o = i * node.spacing;
        const shifted: BBox = {
          min: [box.min[0] - a[0] * o, box.min[1] - a[1] * o, box.min[2] - a[2] * o],
          max: [box.max[0] - a[0] * o, box.max[1] - a[1] * o, box.max[2] - a[2] * o],
        };
        const v = evaluateInterval(node.child, shifted);
        acc = acc ? minI(acc, v) : v;
      }
      return acc ?? WHOLE;
    }
    case 'circularPattern': {
      const ax = node.axis;
      const isX = Math.abs(ax[0]) > Math.abs(ax[1]) && Math.abs(ax[0]) > Math.abs(ax[2]);
      const isZ = !isX && Math.abs(ax[2]) > Math.abs(ax[1]);
      const which: 'x' | 'y' | 'z' = isX ? 'x' : isZ ? 'z' : 'y';
      const sector = (2 * Math.PI) / node.count;
      let acc: Interval | null = null;
      for (let i = 0; i < node.count; i++) {
        const v = evaluateInterval(node.child, mapBox(box, rotateAbout(which, -i * sector)));
        acc = acc ? minI(acc, v) : v;
      }
      return acc ?? WHOLE;
    }
    case 'halfSpace': {
      const c = node.axis === 'x' ? x : node.axis === 'y' ? y : z;
      const d = addK(c, -node.position);
      return node.flip ? neg(d) : d;
    }
    case 'text': {
      // The glyphs sit inside the text's bounding box, so the box's distance
      // is a sound lower bound.  No useful upper bound, which only costs the
      // "entirely inside" shortcut.
      const hw = (node.glyphWidth ?? node.text.length * node.size * 0.6) / 2;
      const ga = node.glyphAscent ?? node.size, gd = node.glyphDescent ?? 0;
      const hh = node.glyphWidth ? (ga - gd) / 2 : node.size / 2;
      const q = [addK(absI(x), -hw), addK(absI(y), -hh), addK(absI(z), -node.depth / 2)];
      const outside = lengthI(q.map((c) => maxK(c, 0)));
      const inside = minK(maxI(maxI(q[0], q[1]), q[2]), 0);
      return I(add(outside, inside).lo, Infinity);
    }
    case '_far':
      return I(1e10, 1e10);
  }
}

/** Cheap sound verdict for a region, used by the mesher's octree. */
export type CellVerdict = 'outside' | 'inside' | 'straddles';

export function classifyCell(node: SDFNode, box: BBox): CellVerdict {
  const v = evaluateInterval(node, box);
  if (v.lo > 0) return 'outside';
  if (v.hi < 0) return 'inside';
  return 'straddles';
}

/**
 * Sound axis-aligned bounds for the solid, by branch and bound over the field's
 * interval enclosure.  `seed` must contain the solid to begin with; the search
 * shrinks onto the occupied region, discarding sub-boxes proved empty.
 *
 * Unlike `computeBounds`, which composes per-node rules that assume Euclidean
 * child fields, this asks the actual field where it is negative, so it cannot
 * disagree with the evaluator.
 */
export function soundBounds(node: SDFNode, seed: BBox, depth = 6): BBox | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = false;

  const visit = (b: BBox, level: number) => {
    // Already inside the running hull on every axis: cannot widen it.
    if (found && level > 0 &&
        b.min[0] >= min[0] && b.max[0] <= max[0] &&
        b.min[1] >= min[1] && b.max[1] <= max[1] &&
        b.min[2] >= min[2] && b.max[2] <= max[2]) return;

    const v = evaluateInterval(node, b);
    if (v.lo > 0) return;                       // proved empty
    if (level === 0 || v.hi < 0) {              // occupied, or out of budget
      found = true;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], b.min[k]);
        max[k] = Math.max(max[k], b.max[k]);
      }
      return;
    }
    const mid: Vec3 = [
      (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2,
    ];
    for (let i = 0; i < 8; i++) {
      visit({
        min: [i & 1 ? mid[0] : b.min[0], i & 2 ? mid[1] : b.min[1], i & 4 ? mid[2] : b.min[2]],
        max: [i & 1 ? b.max[0] : mid[0], i & 2 ? b.max[1] : mid[1], i & 4 ? b.max[2] : mid[2]],
      }, level - 1);
    }
  };

  visit(seed, depth);
  return found ? { min, max } : null;
}

/**
 * Bounds for the mesher: `computeBounds` widened by whatever the field itself
 * says lies outside it.
 *
 * `computeBounds` composes a rule per node kind, and every rule is a chance to
 * disagree with the evaluator — two defects found so far (#70, #73) were
 * exactly that.  So it is not trusted as the answer.  But it is not discarded
 * either, and the reason is worth stating, because the obvious construction is
 * wrong:
 *
 * A search over a finite region can prove where the solid is *inside* that
 * region, and it is tempting to stop growing the region once the solid no
 * longer touches its edge.  That is unsound.  "Nothing reaches the edge" does
 * not imply "nothing lies beyond it" — a second, disconnected component
 * further out is missed entirely.  A property test caught precisely that: two
 * spheres at x = 0 and x = -3, searched from a small box at the origin, stop
 * at the first sphere.  No purely local search can rule out distant material.
 *
 * `computeBounds` is where a global claim actually comes from: it is
 * structural, so a union covers every component.  Taking the union of the two
 * is therefore strictly safer than either alone — it inherits that global
 * coverage, and adds any region the interval search *proves* occupied beyond
 * it, which is what catches a mistaken bounds rule.  Erring large only costs
 * grid resolution; erring small silently cuts the model.
 *
 * `start` is a hint for the search region only.
 */
export function verifiedBounds(
  node: SDFNode,
  start: BBox,
  maxGrowths = 6,
  depth = 6,
): BBox | null {
  const finite = (v: number, f: number) => (isFinite(v) ? v : f);
  const base: BBox = {
    min: [finite(start.min[0], -100), finite(start.min[1], -100), finite(start.min[2], -100)],
    max: [finite(start.max[0], 100), finite(start.max[1], 100), finite(start.max[2], 100)],
  };
  for (let k = 0; k < 3; k++) {
    if (!(base.max[k] - base.min[k] > 1e-6)) {
      const c = (base.min[k] + base.max[k]) / 2;
      base.min[k] = c - 1; base.max[k] = c + 1;
    }
  }

  // Search a region around the hint, growing while the solid runs into its
  // edge — that still finds material a wrong bounds rule omitted, it just
  // cannot be the sole source of coverage.
  let probe: BBox = {
    min: [0, 0, 0].map((_, k) => base.min[k] - (base.max[k] - base.min[k]) / 2) as Vec3,
    max: [0, 0, 0].map((_, k) => base.max[k] + (base.max[k] - base.min[k]) / 2) as Vec3,
  };
  const result: BBox = { min: [...base.min] as Vec3, max: [...base.max] as Vec3 };

  for (let attempt = 0; attempt <= maxGrowths; attempt++) {
    const found = soundBounds(node, probe, depth);
    if (found) {
      for (let k = 0; k < 3; k++) {
        result.min[k] = Math.min(result.min[k], found.min[k]);
        result.max[k] = Math.max(result.max[k], found.max[k]);
      }
      const slack = [0, 1, 2].map((k) => (probe.max[k] - probe.min[k]) * 1e-6);
      const touches = [0, 1, 2].some(
        (k) => found.min[k] <= probe.min[k] + slack[k] || found.max[k] >= probe.max[k] - slack[k],
      );
      if (!touches) break;
    } else {
      break;   // region proved empty; nothing here to add
    }
    const grown: BBox = { min: [0, 0, 0], max: [0, 0, 0] };
    for (let k = 0; k < 3; k++) {
      const c = (probe.min[k] + probe.max[k]) / 2;
      const h = probe.max[k] - probe.min[k];
      grown.min[k] = c - h; grown.max[k] = c + h;
    }
    probe = grown;
  }

  return result;
}

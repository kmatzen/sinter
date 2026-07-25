import { computeBounds } from './bounds';
import type { SDFNode, Vec3 } from './types';

/**
 * Instance-window computation shared by the CPU evaluator and the GLSL codegen.
 *
 * Both pattern nodes work by folding a query point back into one repetition
 * cell and evaluating the child there.  That is only sound if the search
 * covers every instance that could be nearest to the point.  A fixed +/-1
 * neighbourhood does not: it silently assumes each copy is centred on the
 * pattern origin and stays inside its own cell.  When the child is offset
 * along the axis, or is wider than the spacing, the window lands on the wrong
 * instances and copies are dropped or eroded.
 *
 * So the window is derived from the child's actual extent instead.  Project
 * the child's AABB onto the repetition axis to get the span [lo, hi] a single
 * copy occupies; a copy can then reach into ceil(span / spacing) cells, and a
 * window of that many instances plus one on either side provably contains the
 * nearest copy for any query point.
 *
 * Everything here is a pure function of the tree, so the results are cached
 * per node — `evaluateSDF` runs millions of times per mesh and must not
 * recompute bounds on every call.
 */

export interface LinearWindow {
  /** Normalised repetition axis. */
  axis: Vec3;
  /** Extent of a single copy projected onto the axis. */
  lo: number;
  hi: number;
  /** Number of instances to evaluate. Never exceeds `count`. */
  width: number;
}

export interface CircularWindow {
  isX: boolean;
  isZ: boolean;
  /** Angular extent of a single copy in the rotation plane, radians. */
  loAng: number;
  hiAng: number;
  /** Angle between successive instances, radians. */
  sector: number;
  /** Number of instances to evaluate. Never exceeds `count`. */
  width: number;
}

const linearCache = new WeakMap<object, LinearWindow>();
const circularCache = new WeakMap<object, CircularWindow>();

/** Support interval of an AABB along a direction. */
function projectBox(min: Vec3, max: Vec3, dir: Vec3): [number, number] {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 3; i++) {
    const a = dir[i] * min[i];
    const b = dir[i] * max[i];
    lo += Math.min(a, b);
    hi += Math.max(a, b);
  }
  return [lo, hi];
}

export function normalizeAxis(ax: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(ax[0], ax[1], ax[2]);
  if (len < 1e-8) return fallback;
  return [ax[0] / len, ax[1] / len, ax[2] / len];
}

export function linearWindow(node: Extract<SDFNode, { kind: 'linearPattern' }>): LinearWindow {
  const cached = linearCache.get(node);
  if (cached) return cached;

  const axis = normalizeAxis(node.axis, [0, 1, 0]);
  const cb = computeBounds(node.child);
  const [lo, hi] = projectBox(cb.min, cb.max, axis);

  // A copy spanning `span` reaches into ceil(span / spacing) cells; +3 covers
  // the partially-overlapped cells at each end of that run.
  const spacing = Math.abs(node.spacing);
  const cells = spacing > 1e-9 ? Math.ceil((hi - lo) / spacing) : node.count;
  const width = Math.max(1, Math.min(node.count, cells + 3));

  const w: LinearWindow = { axis, lo, hi, width };
  linearCache.set(node, w);
  return w;
}

/**
 * Smallest angular interval containing every corner of an axis-aligned
 * rectangle, as seen from the origin of the rotation plane.  Returns a full
 * turn when the rectangle contains the origin, since then the child covers
 * every angle and no windowing is possible.
 */
function angularSpan(aMin: number, aMax: number, bMin: number, bMax: number): [number, number] {
  if (aMin <= 0 && 0 <= aMax && bMin <= 0 && 0 <= bMax) return [0, 2 * Math.PI];

  const angles = [
    Math.atan2(bMin, aMin), Math.atan2(bMin, aMax),
    Math.atan2(bMax, aMin), Math.atan2(bMax, aMax),
  ].sort((x, y) => x - y);

  // The rectangle misses the origin, so the corners fit in an arc under half a
  // turn: the covering arc is the complement of the widest gap between them.
  let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  let start = angles[0];
  for (let i = 1; i < angles.length; i++) {
    const g = angles[i] - angles[i - 1];
    if (g > gap) { gap = g; start = angles[i]; }
  }
  return [start, start + (2 * Math.PI - gap)];
}

export function circularWindow(node: Extract<SDFNode, { kind: 'circularPattern' }>): CircularWindow {
  const cached = circularCache.get(node);
  if (cached) return cached;

  const ax = node.axis;
  const isX = Math.abs(ax[0]) > Math.abs(ax[1]) && Math.abs(ax[0]) > Math.abs(ax[2]);
  const isZ = !isX && Math.abs(ax[2]) > Math.abs(ax[1]);

  const cb = computeBounds(node.child);
  // Rotation-plane coordinates: (y,z) about X, (x,y) about Z, (x,z) about Y.
  const [aMin, aMax, bMin, bMax] = isX
    ? [cb.min[1], cb.max[1], cb.min[2], cb.max[2]]
    : isZ
      ? [cb.min[0], cb.max[0], cb.min[1], cb.max[1]]
      : [cb.min[0], cb.max[0], cb.min[2], cb.max[2]];

  const [loAng, hiAng] = angularSpan(aMin, aMax, bMin, bMax);
  const sector = (2 * Math.PI) / node.count;
  const cells = Math.ceil((hiAng - loAng) / sector);
  const width = Math.max(1, Math.min(node.count, cells + 3));

  const w: CircularWindow = { isX, isZ, loAng, hiAng, sector, width };
  circularCache.set(node, w);
  return w;
}

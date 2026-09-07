import type { BBox, Vec3 } from './types';

export const axisIndex = (axis: 'x' | 'y' | 'z'): number => axis === 'x' ? 0 : axis === 'z' ? 2 : 1;

export function bendRate(angle: number, extent: number): number {
  return angle * Math.PI / 180 / extent;
}

export function bendMinimumMetric(directionMin: number, directionMax: number, rate: number): number {
  const a = 1 - rate * directionMin;
  const b = 1 - rate * directionMax;
  if (a === 0 || b === 0 || a * b < 0) return 0;
  return Math.min(Math.abs(a), Math.abs(b));
}

/** Conservative Lipschitz correction for the circular bend's inverse map. */
export function bendScale(bounds: BBox, direction: number, rate: number): number {
  return 1 / Math.max(1e-6, Math.min(1, bendMinimumMetric(bounds.min[direction], bounds.max[direction], rate)));
}

/** Map a bent world-space point back into the undeformed child domain. */
export function inverseBendPoint(p: Vec3, axis: number, direction: number, angle: number, origin: number, extent: number): Vec3 {
  const q: Vec3 = [...p];
  const u = p[axis] - origin;
  const v = p[direction];
  const rate = bendRate(angle, extent);
  const radius = 1 / rate;
  const half = extent / 2;
  const endpoint = (sign: -1 | 1) => {
    const sourceU = sign * half;
    const theta = rate * sourceU;
    const c = Math.cos(theta), s = Math.sin(theta);
    const centerU = radius * s;
    const centerV = radius * (1 - c);
    const du = (u - centerU) * c + (v - centerV) * s;
    return { sourceU, c, s, centerU, centerV, du };
  };
  const hi = endpoint(1);
  const lo = endpoint(-1);
  let sourceU: number, sourceV: number;
  if (hi.du > 0) {
    sourceU = hi.sourceU + hi.du;
    sourceV = -(u - hi.centerU) * hi.s + (v - hi.centerV) * hi.c;
  } else if (lo.du < 0) {
    sourceU = lo.sourceU + lo.du;
    sourceV = -(u - lo.centerU) * lo.s + (v - lo.centerV) * lo.c;
  } else {
    const sign = Math.sign(radius) || 1;
    const theta = Math.atan2(sign * u, sign * (radius - v));
    sourceU = theta / rate;
    sourceV = radius - sign * Math.hypot(u, radius - v);
  }
  q[axis] = sourceU + origin;
  q[direction] = sourceV;
  return q;
}

/**
 * Every bent point moves by no more than twice its longitudinal distance plus
 * twice its distance from the bend axis. Expanding those two coordinates by
 * that amount is intentionally loose, but remains finite as angle approaches
 * zero and encloses the rigid end continuations too.
 */
export function conservativeBendBounds(bounds: BBox, axis: number, direction: number, origin: number): BBox {
  const maxU = Math.max(Math.abs(bounds.min[axis] - origin), Math.abs(bounds.max[axis] - origin));
  const maxV = Math.max(Math.abs(bounds.min[direction]), Math.abs(bounds.max[direction]));
  const margin = 2 * (maxU + maxV);
  const result: BBox = { min: [...bounds.min], max: [...bounds.max] };
  for (const index of [axis, direction]) {
    result.min[index] -= margin;
    result.max[index] += margin;
  }
  return result;
}

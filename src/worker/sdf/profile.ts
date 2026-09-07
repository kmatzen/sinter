import type { Vec3 } from './types';
import { MODEL_SPATIAL_LIMIT_MM } from '../../types/modelingEnvelope';

export type Vec2 = [number, number];
export interface PolygonProfile { outer: Vec2[]; holes: Vec2[][] }
export const MAX_PROFILE_VERTICES = 256;

export const DEFAULT_PROFILE: PolygonProfile = {
  outer: [[-20, -15], [20, -15], [20, 15], [-20, 15]],
  holes: [],
};
export const DEFAULT_REVOLVE_PROFILE: PolygonProfile = {
  outer: [[0, -15], [12, -15], [18, -8], [18, 8], [12, 15], [0, 15]],
  holes: [],
};

export class ProfileValidationError extends Error {
  constructor(message: string) { super(`Invalid profile: ${message}`); this.name = 'ProfileValidationError'; }
}

const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function signedArea(loop: Vec2[]): number {
  return loop.reduce((sum, p, i) => sum + p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1], 0) / 2;
}
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b);
  if (ab1 * ab2 < 0 && cd1 * cd2 < 0) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2, orientation: number) => Math.abs(orientation) < 1e-10 &&
    q[0] >= Math.min(p[0], r[0]) && q[0] <= Math.max(p[0], r[0]) && q[1] >= Math.min(p[1], r[1]) && q[1] <= Math.max(p[1], r[1]);
  return on(a, c, b, ab1) || on(a, d, b, ab2) || on(c, a, d, cd1) || on(c, b, d, cd2);
}
function loopsIntersect(a: Vec2[], b: Vec2[]): boolean {
  return a.some((p, i) => b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}
export function pointInLoop(p: Vec2, loop: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function validateLoop(loop: unknown, label: string, ccw: boolean): asserts loop is Vec2[] {
  if (!Array.isArray(loop) || loop.length < 3) throw new ProfileValidationError(`${label} must contain at least three vertices`);
  for (const p of loop) if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => Number.isFinite(v) && Math.abs(v) <= MODEL_SPATIAL_LIMIT_MM)) throw new ProfileValidationError(`${label} vertices must be finite [x,y] pairs within ±${MODEL_SPATIAL_LIMIT_MM} mm`);
  const area = signedArea(loop as Vec2[]);
  if (Math.abs(area) < 1e-9) throw new ProfileValidationError(`${label} is degenerate`);
  if ((area > 0) !== ccw) throw new ProfileValidationError(`${label} must wind ${ccw ? 'counter-clockwise' : 'clockwise'}`);
  const points = loop as Vec2[];
  for (let i = 0; i < points.length; i++) if (points[i][0] === points[(i + 1) % points.length][0] && points[i][1] === points[(i + 1) % points.length][1]) {
    throw new ProfileValidationError(`${label} contains a zero-length edge`);
  }
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) {
      throw new ProfileValidationError(`${label} self-intersects`);
    }
  }
}

export function parseProfile(source?: string): PolygonProfile {
  let value: unknown = DEFAULT_PROFILE;
  if (source) try { value = JSON.parse(source); } catch { throw new ProfileValidationError('profile data is not valid JSON'); }
  if (!value || typeof value !== 'object') throw new ProfileValidationError('expected an outer loop and holes');
  const profile = value as PolygonProfile;
  if (Array.isArray(profile.outer) && profile.outer.length > MAX_PROFILE_VERTICES) throw new ProfileValidationError(`profile has ${profile.outer.length} vertices; the limit is ${MAX_PROFILE_VERTICES}`);
  validateLoop(profile.outer, 'outer loop', true);
  if (!Array.isArray(profile.holes)) throw new ProfileValidationError('holes must be an array');
  let vertices = profile.outer.length;
  for (const hole of profile.holes) {
    if (!Array.isArray(hole)) throw new ProfileValidationError('each hole must be a vertex array');
    vertices += hole.length;
    if (vertices > MAX_PROFILE_VERTICES) throw new ProfileValidationError(`profile has ${vertices} vertices; the limit is ${MAX_PROFILE_VERTICES}`);
  }
  profile.holes.forEach((hole, i) => {
    validateLoop(hole, `hole ${i + 1}`, false);
    if (!hole.every((point) => pointInLoop(point, profile.outer)) || loopsIntersect(hole, profile.outer)) throw new ProfileValidationError(`hole ${i + 1} lies outside or crosses the outer loop`);
    for (let j = 0; j < i; j++) if (loopsIntersect(hole, profile.holes[j]) || pointInLoop(hole[0], profile.holes[j]) || pointInLoop(profile.holes[j][0], hole)) {
      throw new ProfileValidationError(`hole ${i + 1} overlaps hole ${j + 1}`);
    }
  });
  return profile;
}

export function parseRevolveProfile(source?: string): PolygonProfile {
  const profile = parseProfile(source || JSON.stringify(DEFAULT_REVOLVE_PROFILE));
  if ([profile.outer, ...profile.holes].some((loop) => loop.some((point) => point[0] < 0))) {
    throw new ProfileValidationError('revolve radius coordinates must be non-negative');
  }
  return profile;
}

function loopDistance(loop: Vec2[], x: number, y: number, ignoreAxisEdge = false): number {
  let distance2 = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dx = b[0] - a[0], dy = b[1] - a[1];
    if (ignoreAxisEdge && a[0] === 0 && b[0] === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    distance2 = Math.min(distance2, (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2);
  }
  return Math.sqrt(distance2) * (pointInLoop([x, y], loop) ? -1 : 1);
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Smallest explicit edge or wall separation that export must preserve. */
export function profileFeatureSize(profile: PolygonProfile): number {
  const loops = [profile.outer, ...profile.holes];
  let feature = Infinity;
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    feature = Math.min(feature, Math.hypot(loop[i][0] - loop[(i + 1) % loop.length][0], loop[i][1] - loop[(i + 1) % loop.length][1]));
    for (let edge = 0; edge < loop.length; edge++) {
      if (edge === i || (edge + 1) % loop.length === i) continue;
      feature = Math.min(feature, pointSegmentDistance(loop[i], loop[edge], loop[(edge + 1) % loop.length]));
    }
    for (let j = i + 1; j < loop.length; j++) {
      if (j === i + 1 || (i === 0 && j === loop.length - 1)) continue;
      feature = Math.min(feature, segmentDistance(loop[i], loop[(i + 1) % loop.length], loop[j], loop[(j + 1) % loop.length]));
    }
  }
  for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) {
    for (let a = 0; a < loops[i].length; a++) for (let b = 0; b < loops[j].length; b++) {
      feature = Math.min(feature, segmentDistance(loops[i][a], loops[i][(a + 1) % loops[i].length], loops[j][b], loops[j][(b + 1) % loops[j].length]));
    }
  }
  return feature;
}

export function profileDistance(profile: PolygonProfile, x: number, y: number): number {
  let distance = loopDistance(profile.outer, x, y);
  for (const hole of profile.holes) distance = Math.max(distance, -loopDistance(hole, x, y));
  return distance;
}

function revolvedProfileDistance(profile: PolygonProfile, radius: number, axial: number): number {
  let distance = loopDistance(profile.outer, radius, axial, true);
  for (const hole of profile.holes) distance = Math.max(distance, -loopDistance(hole, radius, axial, true));
  return distance;
}

export function extrudeDistance(profile: PolygonProfile, depth: number, p: Vec3): number {
  const d2 = profileDistance(profile, p[0], p[1]), dz = Math.abs(p[2]) - depth / 2;
  return Math.min(Math.max(d2, dz), 0) + Math.hypot(Math.max(d2, 0), Math.max(dz, 0));
}

function distanceToRay(u: number, v: number, angle: number): number {
  const dx = Math.cos(angle), dy = Math.sin(angle), t = Math.max(0, u * dx + v * dy);
  return Math.hypot(u - t * dx, v - t * dy);
}

/** Signed distance to the angular sector centred on the positive radial direction. */
export function sectorDistance(u: number, v: number, angleDegrees: number): number {
  if (angleDegrees >= 360) return -Infinity;
  const half = angleDegrees * Math.PI / 360;
  const theta = Math.atan2(v, u);
  const distance = Math.min(distanceToRay(u, v, half), distanceToRay(u, v, -half));
  return Math.abs(theta) <= half ? -distance : distance;
}

export function revolveDistance(profile: PolygonProfile, axis: 'x' | 'y' | 'z', angle: number, p: Vec3): number {
  let axial: number, u: number, v: number;
  if (axis === 'x') { axial = p[0]; u = p[1]; v = p[2]; }
  else if (axis === 'z') { axial = p[2]; u = p[0]; v = p[1]; }
  else { axial = p[1]; u = p[0]; v = p[2]; }
  const radial = Math.hypot(u, v);
  const section = revolvedProfileDistance(profile, radial, axial);
  return Math.max(section, sectorDistance(u, v, angle));
}

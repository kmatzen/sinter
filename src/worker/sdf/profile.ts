import type { Vec3 } from './types';
import { MODEL_SPATIAL_LIMIT_MM } from '../../types/modelingEnvelope';

export type Vec2 = [number, number];
/**
 * Bulge is tan(sweep/4) for the edge beginning at the matching vertex.
 * Missing arrays/entries are straight lines, which keeps every legacy polygon
 * document valid while preserving imported circular arcs parametrically.
 */
export interface PolygonProfile { outer: Vec2[]; holes: Vec2[][]; bulges?: number[]; holeBulges?: number[][] }
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
export function profileLoopSignedArea(loop: Vec2[], bulges: number[] = []): number {
  return signedArea(flattenLoop(loop, bulges));
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
export function arcGeometry(a: Vec2, b: Vec2, bulge: number) {
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const sweep = 4 * Math.atan(bulge), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const nx = -(b[1] - a[1]) / chord, ny = (b[0] - a[0]) / chord;
  const offset = chord / (2 * Math.tan(sweep / 2));
  const center: Vec2 = [mx + nx * offset, my + ny * offset];
  return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]), start: Math.atan2(a[1] - center[1], a[0] - center[0]), sweep };
}

function flattenLoop(loop: Vec2[], bulges: number[] = []): Vec2[] {
  const out: Vec2[] = [];
  loop.forEach((a, i) => {
    out.push(a);
    const bulge = bulges[i] || 0;
    if (!bulge) return;
    const b = loop[(i + 1) % loop.length], arc = arcGeometry(a, b, bulge);
    const steps = Math.max(2, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 36)));
    for (let step = 1; step < steps; step++) {
      const angle = arc.start + arc.sweep * step / steps;
      out.push([arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)]);
    }
  });
  return out;
}

export function profileLoopBoundsPoints(loop: Vec2[], bulges: number[] = []): Vec2[] {
  const points = loop.map((point) => [...point] as Vec2);
  loop.forEach((a, i) => {
    const bulge = bulges[i] || 0;
    if (!bulge) return;
    const arc = arcGeometry(a, loop[(i + 1) % loop.length], bulge);
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) if (angleAlongSweep(angle, arc.start, arc.sweep)) {
      points.push([arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)]);
    }
  });
  return points;
}

function validateLoop(loop: unknown, bulges: unknown, label: string, ccw: boolean): asserts loop is Vec2[] {
  const hasArc = Array.isArray(bulges) && bulges.some((value) => Number(value) !== 0);
  if (!Array.isArray(loop) || loop.length < (hasArc ? 2 : 3)) throw new ProfileValidationError(`${label} must contain at least three line vertices or two vertices with an arc`);
  for (const p of loop) if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => Number.isFinite(v) && Math.abs(v) <= MODEL_SPATIAL_LIMIT_MM)) throw new ProfileValidationError(`${label} vertices must be finite [x,y] pairs within ±${MODEL_SPATIAL_LIMIT_MM} mm`);
  if (bulges !== undefined && (!Array.isArray(bulges) || bulges.length !== loop.length || bulges.some((value) => !Number.isFinite(value) || Math.abs(value) > 10))) {
    throw new ProfileValidationError(`${label} bulges must provide one finite value per edge between -10 and 10`);
  }
  const points = loop as Vec2[], expanded = flattenLoop(points, bulges as number[] | undefined);
  const area = signedArea(expanded);
  if (Math.abs(area) < 1e-9) throw new ProfileValidationError(`${label} is degenerate`);
  if ((area > 0) !== ccw) throw new ProfileValidationError(`${label} must wind ${ccw ? 'counter-clockwise' : 'clockwise'}`);
  for (let i = 0; i < points.length; i++) if (points[i][0] === points[(i + 1) % points.length][0] && points[i][1] === points[(i + 1) % points.length][1]) {
    throw new ProfileValidationError(`${label} contains a zero-length edge`);
  }
  for (let i = 0; i < expanded.length; i++) for (let j = i + 1; j < expanded.length; j++) {
    if (j === i + 1 || (i === 0 && j === expanded.length - 1)) continue;
    if (segmentsIntersect(expanded[i], expanded[(i + 1) % expanded.length], expanded[j], expanded[(j + 1) % expanded.length])) {
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
  validateLoop(profile.outer, profile.bulges, 'outer loop', true);
  if (!Array.isArray(profile.holes)) throw new ProfileValidationError('holes must be an array');
  let vertices = profile.outer.length;
  for (const hole of profile.holes) {
    if (!Array.isArray(hole)) throw new ProfileValidationError('each hole must be a vertex array');
    vertices += hole.length;
    if (vertices > MAX_PROFILE_VERTICES) throw new ProfileValidationError(`profile has ${vertices} vertices; the limit is ${MAX_PROFILE_VERTICES}`);
  }
  profile.holes.forEach((hole, i) => {
    const holeBulges = profile.holeBulges?.[i];
    validateLoop(hole, holeBulges, `hole ${i + 1}`, false);
    const outerExpanded = flattenLoop(profile.outer, profile.bulges), holeExpanded = flattenLoop(hole, holeBulges);
    if (!holeExpanded.every((point) => pointInLoop(point, outerExpanded)) || loopsIntersect(holeExpanded, outerExpanded)) throw new ProfileValidationError(`hole ${i + 1} lies outside or crosses the outer loop`);
    for (let j = 0; j < i; j++) {
      const previous = flattenLoop(profile.holes[j], profile.holeBulges?.[j]);
      if (loopsIntersect(holeExpanded, previous) || pointInLoop(holeExpanded[0], previous) || pointInLoop(previous[0], holeExpanded)) {
      throw new ProfileValidationError(`hole ${i + 1} overlaps hole ${j + 1}`);
      }
    }
  });
  if (profile.holeBulges !== undefined && (!Array.isArray(profile.holeBulges) || profile.holeBulges.length !== profile.holes.length)) throw new ProfileValidationError('holeBulges must provide one array per hole');
  return profile;
}

export function parseRevolveProfile(source?: string): PolygonProfile {
  const profile = parseProfile(source || JSON.stringify(DEFAULT_REVOLVE_PROFILE));
  if ([profile.outer, ...profile.holes].some((loop) => loop.some((point) => point[0] < 0))) {
    throw new ProfileValidationError('revolve radius coordinates must be non-negative');
  }
  return profile;
}

function angleAlongSweep(angle: number, start: number, sweep: number): boolean {
  const tau = 2 * Math.PI;
  const directed = sweep > 0 ? (angle - start + tau) % tau : (start - angle + tau) % tau;
  return directed <= Math.abs(sweep) + 1e-12;
}

function arcDistance(p: Vec2, a: Vec2, b: Vec2, bulge: number): number {
  const arc = arcGeometry(a, b, bulge), angle = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
  if (angleAlongSweep(angle, arc.start, arc.sweep)) return Math.abs(Math.hypot(p[0] - arc.center[0], p[1] - arc.center[1]) - arc.radius);
  return Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(p[0] - b[0], p[1] - b[1]));
}

function pointInBulgedLoop(p: Vec2, loop: Vec2[], bulges: number[] = []): boolean {
  let crossings = 0;
  const scale = Math.max(1, ...loop.flatMap((point) => point.map(Math.abs)));
  const vertexEpsilon = scale * 1e-12;
  const rayY = loop.some((point) => Math.abs(point[1] - p[1]) <= vertexEpsilon) ? p[1] + vertexEpsilon : p[1];
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length], bulge = bulges[i] || 0;
    if (!bulge) {
      if ((a[1] > rayY) !== (b[1] > rayY) && p[0] < (b[0] - a[0]) * (rayY - a[1]) / (b[1] - a[1]) + a[0]) crossings++;
      return;
    }
    const arc = arcGeometry(a, b, bulge), dy = rayY - arc.center[1];
    const ys = [a[1], b[1]];
    for (const angle of [Math.PI / 2, -Math.PI / 2]) if (angleAlongSweep(angle, arc.start, arc.sweep)) ys.push(arc.center[1] + arc.radius * Math.sin(angle));
    if (rayY < Math.min(...ys) || rayY >= Math.max(...ys)) return;
    if (Math.abs(dy) >= arc.radius) return; // tangent contact does not cross
    const dx = Math.sqrt(Math.max(0, arc.radius * arc.radius - dy * dy));
    for (const x of [arc.center[0] - dx, arc.center[0] + dx]) {
      if (x <= p[0]) continue;
      const endpointTolerance = 1e-10 * Math.max(1, arc.radius);
      if (Math.hypot(x - b[0], rayY - b[1]) <= endpointTolerance) continue;
      if (Math.hypot(x - a[0], rayY - a[1]) <= endpointTolerance) { crossings++; continue; }
      const angle = Math.atan2(dy, x - arc.center[0]), tau = 2 * Math.PI;
      let directed = arc.sweep > 0 ? (angle - arc.start + tau) % tau : (arc.start - angle + tau) % tau;
      if (directed > tau - 1e-14) directed = 0;
      // Start-inclusive/end-exclusive matches the straight-edge ray rule and
      // counts a shared profile vertex exactly once.
      if (directed < Math.abs(arc.sweep) - 1e-12) crossings++;
    }
  });
  return crossings % 2 === 1;
}

function loopDistance(loop: Vec2[], x: number, y: number, ignoreAxisEdge = false, bulges: number[] = []): number {
  let distance2 = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dx = b[0] - a[0], dy = b[1] - a[1];
    if (ignoreAxisEdge && a[0] === 0 && b[0] === 0) continue;
    if (bulges[i]) { const distance = arcDistance([x, y], a, b, bulges[i]); distance2 = Math.min(distance2, distance * distance); continue; }
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    distance2 = Math.min(distance2, (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2);
  }
  return Math.sqrt(distance2) * (pointInBulgedLoop([x, y], loop, bulges) ? -1 : 1);
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
  const loops = [flattenLoop(profile.outer, profile.bulges), ...profile.holes.map((loop, i) => flattenLoop(loop, profile.holeBulges?.[i]))];
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
  let distance = loopDistance(profile.outer, x, y, false, profile.bulges);
  profile.holes.forEach((hole, i) => { distance = Math.max(distance, -loopDistance(hole, x, y, false, profile.holeBulges?.[i])); });
  return distance;
}

function revolvedProfileDistance(profile: PolygonProfile, radius: number, axial: number): number {
  let distance = loopDistance(profile.outer, radius, axial, true, profile.bulges);
  profile.holes.forEach((hole, i) => { distance = Math.max(distance, -loopDistance(hole, radius, axial, true, profile.holeBulges?.[i])); });
  return distance;
}

export interface ExtrudeOptions { zMin?: number; zMax?: number; taper?: number; wallThickness?: number }
export function extrudeDistance(profile: PolygonProfile, depth: number, p: Vec3, options: ExtrudeOptions = {}): number {
  const zMin = options.zMin ?? -depth / 2, zMax = options.zMax ?? depth / 2;
  const sampleZ = Math.max(zMin, Math.min(zMax, p[2]));
  const slope = Math.tan((options.taper ?? 0) * Math.PI / 180);
  let d2 = (profileDistance(profile, p[0], p[1]) + (sampleZ - zMin) * slope) / Math.hypot(1, slope);
  if ((options.wallThickness ?? 0) > 0) d2 = Math.abs(d2) - options.wallThickness! / 2;
  const dz = Math.max(zMin - p[2], p[2] - zMax);
  return Math.min(Math.max(d2, dz), 0) + Math.hypot(Math.max(d2, 0), Math.max(dz, 0));
}

export type ProfilePlane = 'xy' | 'xz' | 'yz';

/** Map a world-local point into profile U/V and plane-normal coordinates. */
export function profilePlaneCoordinates(p: Vec3, plane: ProfilePlane = 'xy'): Vec3 {
  if (plane === 'xz') return [p[0], p[2], p[1]];
  if (plane === 'yz') return [p[1], p[2], p[0]];
  return p;
}

/** Axial and oriented radial-plane coordinates for a revolved sketch. */
export function revolveCoordinates(p: Vec3, axis: 'x' | 'y' | 'z', plane: ProfilePlane = 'xy'): Vec3 {
  const index = { x: 0, y: 1, z: 2 } as const;
  const planeAxes: Array<'x' | 'y' | 'z'> = plane === 'xy' ? ['x', 'y'] : plane === 'xz' ? ['x', 'z'] : ['y', 'z'];
  const other = planeAxes.find((candidate) => candidate !== axis);
  if (planeAxes.includes(axis) && other) {
    const normal = (['x', 'y', 'z'] as const).find((candidate) => !planeAxes.includes(candidate))!;
    return [p[index[axis]], p[index[other]], p[index[normal]]];
  }
  if (axis === 'x') return [p[0], p[1], p[2]];
  if (axis === 'z') return [p[2], p[0], p[1]];
  return [p[1], p[0], p[2]];
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

export function revolveDistance(profile: PolygonProfile, axis: 'x' | 'y' | 'z', angle: number, p: Vec3, plane: ProfilePlane = 'xy'): number {
  const [axial, u, v] = revolveCoordinates(p, axis, plane);
  const radial = Math.hypot(u, v);
  const section = revolvedProfileDistance(profile, radial, axial);
  return Math.max(section, sectorDistance(u, v, angle));
}

import type { Vec3 } from './types';
import type { MeshRegionSurfaceFit as RegionSurfaceFit } from '../../types/geometry';
import type { MeshSurfaceRegion } from './meshSegmentation';
import { regionTriangleSoup } from './meshSegmentation';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, value: number): Vec3 => [a[0] * value, a[1] * value, a[2] * value];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 | null => { const length = Math.hypot(...a); return length > 1e-12 ? scale(a, 1 / length) : null; };

function solve(matrix: number[][], values: number[]): number[] | null {
  const n = values.length, augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column]; for (let j = column; j <= n; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = augmented[row][column]; for (let j = column; j <= n; j++) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row[n]);
}

function leastSquares(rows: number[][], values: number[]): number[] | null {
  const columns = rows[0]?.length ?? 0;
  const normal = Array.from({ length: columns }, () => Array(columns).fill(0)), rhs = Array(columns).fill(0);
  rows.forEach((row, index) => { for (let i = 0; i < columns; i++) { rhs[i] += row[i] * values[index]; for (let j = 0; j < columns; j++) normal[i][j] += row[i] * row[j]; } });
  return solve(normal, rhs);
}

function smallestEigenvector(matrix: number[][]): Vec3 | null {
  const a = matrix.map((row) => [...row]);
  let vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
    if (Math.abs(a[p][q]) < 1e-15) continue;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(1 + t * t), s = t * c;
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = vectors[k][p], y = vectors[k][q]; vectors[k][p] = c * x - s * y; vectors[k][q] = s * x + c * y; }
  }
  let index = 0; if (a[1][1] < a[index][index]) index = 1; if (a[2][2] < a[index][index]) index = 2;
  const result = unit([vectors[0][index], vectors[1][index], vectors[2][index]]);
  if (!result) return null;
  let pivot = 0; for (let i = 1; i < 3; i++) if (Math.abs(result[i]) > Math.abs(result[pivot])) pivot = i;
  return result[pivot] < 0 ? scale(result, -1) : result;
}

function largestPrincipalAxis(points: Vec3[], center: Vec3): Vec3 | null {
  const covariance = [[0,0,0],[0,0,0],[0,0,0]];
  for (const point of points) {
    const delta = sub(point, center);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) covariance[i][j] += delta[i] * delta[j];
  }
  let vector: Vec3 = [1, Math.SQRT2, Math.sqrt(3)];
  for (let iteration = 0; iteration < 32; iteration++) {
    const next: Vec3 = covariance.map((row) => dot(row as Vec3, vector)) as Vec3;
    const normalized = unit(next); if (!normalized) return null;
    vector = normalized;
  }
  let pivot = 0; for (let i = 1; i < 3; i++) if (Math.abs(vector[i]) > Math.abs(vector[pivot])) pivot = i;
  return vector[pivot] < 0 ? scale(vector, -1) : vector;
}

function pointsOf(positions: Float32Array, region: MeshSurfaceRegion): Vec3[] {
  const soup = regionTriangleSoup(positions, region), seen = new Map<string, Vec3>();
  for (let index = 0; index < soup.length; index += 3) {
    const point: Vec3 = [soup[index], soup[index + 1], soup[index + 2]];
    seen.set(point.join(','), point);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => point);
}

function residual(distances: number[], diagonal: number) {
  const surfaceMax = Math.max(...distances), surfaceRms = Math.sqrt(distances.reduce((sum, value) => sum + value * value, 0) / distances.length);
  return { surfaceMax, surfaceRms, relativeError: surfaceMax / diagonal };
}

function orientedNormalScore(positions: Float32Array, region: MeshSurfaceRegion, radialAt: (point: Vec3) => Vec3): number {
  const soup = regionTriangleSoup(positions, region);
  let score = 0;
  for (let index = 0; index < soup.length; index += 9) {
    const a: Vec3 = [soup[index], soup[index + 1], soup[index + 2]], b: Vec3 = [soup[index + 3], soup[index + 4], soup[index + 5]], c: Vec3 = [soup[index + 6], soup[index + 7], soup[index + 8]];
    const raw = cross(sub(b, a), sub(c, a));
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    score += dot(raw, radialAt(centroid));
  }
  return score;
}

function normalAgreement(positions: Float32Array, region: MeshSurfaceRegion, expectedAt: (point: Vec3) => Vec3): number {
  const soup = regionTriangleSoup(positions, region);
  let weighted = 0, total = 0;
  for (let index = 0; index < soup.length; index += 9) {
    const a: Vec3 = [soup[index], soup[index + 1], soup[index + 2]], b: Vec3 = [soup[index + 3], soup[index + 4], soup[index + 5]], c: Vec3 = [soup[index + 6], soup[index + 7], soup[index + 8]];
    const raw = cross(sub(b, a), sub(c, a)), area2 = Math.hypot(...raw), actual = unit(raw);
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], expected = unit(expectedAt(centroid));
    if (!actual || !expected) continue;
    weighted += Math.abs(dot(actual, expected)) * area2; total += area2;
  }
  return total ? weighted / total : 0;
}

function planeCandidate(points: Vec3[], region: MeshSurfaceRegion, diagonal: number): Omit<RegionSurfaceFit, 'regionKey' | 'triangleIds' | 'bounds'> | null {
  const normal = unit(region.normal); if (!normal) return null;
  const distances = points.map((point) => Math.abs(dot(sub(point, region.centroid), normal)));
  return { parameters: { kind: 'plane', origin: region.centroid, normal }, ...residual(distances, diagonal) };
}

function sphereCandidate(positions: Float32Array, points: Vec3[], region: MeshSurfaceRegion, diagonal: number): Omit<RegionSurfaceFit, 'regionKey' | 'triangleIds' | 'bounds'> | null {
  if (points.length < 4) return null;
  const reference = points.reduce((sum, point) => add(sum, scale(point, 1 / points.length)), [0, 0, 0] as Vec3);
  const local = points.map((point) => sub(point, reference));
  const solution = leastSquares(local.map((point) => [2 * point[0], 2 * point[1], 2 * point[2], 1]), local.map((point) => dot(point, point)));
  if (!solution) return null;
  const localCenter: Vec3 = [solution[0], solution[1], solution[2]], center = add(reference, localCenter), radius2 = solution[3] + dot(localCenter, localCenter);
  if (!(radius2 > 0)) return null;
  const radius = Math.sqrt(radius2), distances = points.map((point) => Math.abs(Math.hypot(...sub(point, center)) - radius));
  // Point positions alone cannot distinguish a two-ring cylinder from the
  // sphere through both rings. Facet normals provide the missing evidence.
  if (normalAgreement(positions, region, (point) => sub(point, center)) < 0.98) return null;
  const outward = orientedNormalScore(positions, region, (point) => sub(point, center)) >= 0;
  return { parameters: { kind: 'sphere', center, radius, outward }, ...residual(distances, diagonal) };
}

function cylinderCandidate(positions: Float32Array, points: Vec3[], region: MeshSurfaceRegion, diagonal: number): Omit<RegionSurfaceFit, 'regionKey' | 'triangleIds' | 'bounds'> | null {
  const soup = regionTriangleSoup(positions, region), covariance = [[0,0,0],[0,0,0],[0,0,0]];
  for (let index = 0; index < soup.length; index += 9) {
    const ab: Vec3 = [soup[index + 3] - soup[index], soup[index + 4] - soup[index + 1], soup[index + 5] - soup[index + 2]];
    const ac: Vec3 = [soup[index + 6] - soup[index], soup[index + 7] - soup[index + 1], soup[index + 8] - soup[index + 2]];
    const raw = cross(ab, ac), area2 = Math.hypot(...raw), normal = unit(raw); if (!normal) continue;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) covariance[i][j] += normal[i] * normal[j] * area2;
  }
  const axis = smallestEigenvector(covariance); if (!axis) return null;
  const seed = Math.abs(axis[0]) < 0.8 ? [1,0,0] as Vec3 : [0,1,0] as Vec3;
  const basisU = unit(cross(axis, seed))!, basisV = cross(axis, basisU);
  const local = points.map((point) => sub(point, region.centroid));
  const projected = local.map((point) => [dot(point, basisU), dot(point, basisV)]);
  const circle = leastSquares(projected.map(([u, v]) => [2 * u, 2 * v, 1]), projected.map(([u, v]) => u * u + v * v));
  if (!circle) return null;
  const radius2 = circle[2] + circle[0] ** 2 + circle[1] ** 2; if (!(radius2 > 0)) return null;
  const radius = Math.sqrt(radius2), meanAxial = local.reduce((sum, point) => sum + dot(point, axis), 0) / points.length;
  const origin = add(region.centroid, add(add(scale(basisU, circle[0]), scale(basisV, circle[1])), scale(axis, meanAxial)));
  const axial = points.map((point) => dot(sub(point, origin), axis));
  const distances = points.map((point) => { const delta = sub(point, origin), t = dot(delta, axis); return Math.abs(Math.hypot(...sub(delta, scale(axis, t))) - radius); });
  const outward = orientedNormalScore(positions, region, (point) => { const delta = sub(point, origin); return sub(delta, scale(axis, dot(delta, axis))); }) >= 0;
  return { parameters: { kind: 'cylinder', origin, axis, radius, axialMin: Math.min(...axial), axialMax: Math.max(...axial), outward }, ...residual(distances, diagonal) };
}

function capsuleCandidate(positions: Float32Array, points: Vec3[], region: MeshSurfaceRegion, diagonal: number): Omit<RegionSurfaceFit, 'regionKey' | 'triangleIds' | 'bounds'> | null {
  if (points.length < 8) return null;
  const center = points.reduce((sum, point) => add(sum, scale(point, 1 / points.length)), [0,0,0] as Vec3);
  const axis = largestPrincipalAxis(points, center); if (!axis) return null;
  const axial = points.map((point) => dot(sub(point, center), axis));
  const radial = points.map((point, index) => Math.hypot(...sub(sub(point, center), scale(axis, axial[index]))));
  const radius = Math.max(...radial);
  const bandAxial = axial.filter((_, index) => radial[index] >= radius * 0.995);
  const curvedCount = radial.filter((value) => value < radius * 0.98).length;
  if (bandAxial.length < 4 || curvedCount < 3) return null;
  const bandMin = Math.min(...bandAxial), bandMax = Math.max(...bandAxial), axialCenter = (bandMin + bandMax) / 2;
  const segmentHalf = (bandMax - bandMin) / 2;
  if (!(radius > 1e-9) || segmentHalf <= radius * 0.05) return null;
  const origin = add(center, scale(axis, axialCenter));
  const distances = points.map((point) => {
    const delta = sub(point, origin), t = dot(delta, axis), clamped = Math.max(-segmentHalf, Math.min(segmentHalf, t));
    return Math.abs(Math.hypot(...sub(delta, scale(axis, clamped))) - radius);
  });
  if (normalAgreement(positions, region, (point) => {
    const delta = sub(point, origin), t = Math.max(-segmentHalf, Math.min(segmentHalf, dot(delta, axis)));
    return sub(delta, scale(axis, t));
  }) < 0.98) return null;
  const outward = orientedNormalScore(positions, region, (point) => {
    const delta = sub(point, origin), t = Math.max(-segmentHalf, Math.min(segmentHalf, dot(delta, axis)));
    return sub(delta, scale(axis, t));
  }) >= 0;
  return { parameters: { kind: 'capsule', origin, axis, radius, axialMin: -segmentHalf - radius, axialMax: segmentHalf + radius, outward }, ...residual(distances, diagonal) };
}

/** Fit the simplest sufficiently accurate analytic surface to one region. */
export function rankRegionSurfaceCandidates(positions: Float32Array, region: MeshSurfaceRegion): Array<Omit<RegionSurfaceFit, 'regionKey' | 'triangleIds' | 'bounds'>> {
  if (!region.eligible) return [];
  const points = pointsOf(positions, region); if (points.length < 3) return [];
  const diagonal = Math.hypot(region.bounds.max[0] - region.bounds.min[0], region.bounds.max[1] - region.bounds.min[1], region.bounds.max[2] - region.bounds.min[2]);
  if (!(diagonal > 0)) return [];
  const candidates = [planeCandidate(points, region, diagonal), cylinderCandidate(positions, points, region, diagonal), sphereCandidate(positions, points, region, diagonal), capsuleCandidate(positions, points, region, diagonal)].filter((value): value is NonNullable<typeof value> => value !== null);
  candidates.sort((a, b) => a.surfaceRms - b.surfaceRms || ['plane','cylinder','sphere','capsule'].indexOf(a.parameters.kind) - ['plane','cylinder','sphere','capsule'].indexOf(b.parameters.kind));
  return candidates;
}

/** Fit the simplest sufficiently accurate analytic surface to one region. */
export function fitRegionSurface(positions: Float32Array, region: MeshSurfaceRegion, maximumRelativeError = 0.01): RegionSurfaceFit | null {
  const candidates = rankRegionSurfaceCandidates(positions, region);
  const diagonal = Math.hypot(region.bounds.max[0] - region.bounds.min[0], region.bounds.max[1] - region.bounds.min[1], region.bounds.max[2] - region.bounds.min[2]);
  let best = candidates[0];
  if (!best || best.relativeError > maximumRelativeError) return null;
  // Do not force a label when two different analytic families explain the
  // samples equally well within numerical noise.
  const second = candidates[1];
  if (second && second.parameters.kind !== best.parameters.kind && second.surfaceRms <= best.surfaceRms * 1.001 + diagonal * 1e-9) {
    // Two axial rings admit an interpolating sphere as well as a cylinder.
    // When the normal-derived cylindrical hypothesis is equally accurate,
    // prefer it; a genuine spherical patch with more than two latitudes does
    // not produce an equal cylinder residual.
    if (best.parameters.kind === 'sphere' && second.parameters.kind === 'cylinder') best = second;
    else return null;
  }
  return { regionKey: region.key, triangleIds: [...region.triangleIds], bounds: region.bounds, ...best };
}

export function fitSegmentedSurfaces(positions: Float32Array, regions: MeshSurfaceRegion[]): Array<RegionSurfaceFit | null> {
  return regions.map((region) => fitRegionSurface(positions, region));
}

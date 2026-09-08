import type { BBox, Vec3 } from './types';

export interface MeshSurfaceRegion {
  /** Stable region identity derived from geometry, independent of triangle order. */
  key: string;
  /** Indices into the source triangle soup. */
  triangleIds: number[];
  area: number;
  centroid: Vec3;
  normal: Vec3;
  bounds: BBox;
  /** False regions remain visible but are not candidates for primitive fitting. */
  eligible: boolean;
}

export interface MeshSegmentationResult {
  regions: MeshSurfaceRegion[];
  diagnostics: string[];
  triangleCount: number;
}

export interface MeshSegmentationOptions {
  /** Maximum dihedral angle joined into one smooth region. */
  smoothAngleDegrees?: number;
  /** Regions below this fraction of total surface area are retained but rejected for fitting. */
  minimumAreaFraction?: number;
}

interface Triangle {
  id: number;
  points: [Vec3, Vec3, Vec3];
  vertices: [string, string, string];
  key: string;
  normal: Vec3;
  area: number;
  centroid: Vec3;
}

const clean = (value: number) => Object.is(value, -0) ? 0 : value;
const vertexKey = (point: Vec3) => point.map((value) => clean(value).toString()).join(',');
const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function triangleAt(positions: Float32Array, id: number, scale: number): Triangle {
  const at = (vertex: number): Vec3 => [positions[id * 9 + vertex * 3], positions[id * 9 + vertex * 3 + 1], positions[id * 9 + vertex * 3 + 2]];
  const points = [at(0), at(1), at(2)] as [Vec3, Vec3, Vec3];
  const ab: Vec3 = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
  const ac: Vec3 = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
  const cross: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const twiceArea = Math.hypot(...cross), area = twiceArea / 2;
  const normal: Vec3 = twiceArea > scale * scale * 1e-12 ? cross.map((value) => value / twiceArea) as Vec3 : [0, 0, 0];
  const vertices = points.map(vertexKey) as [string, string, string];
  return {
    id, points, vertices, key: [...vertices].sort().join(';'), normal, area,
    centroid: [(points[0][0] + points[1][0] + points[2][0]) / 3, (points[0][1] + points[1][1] + points[2][1]) / 3, (points[0][2] + points[1][2] + points[2][2]) / 3],
  };
}

class DisjointSet {
  private readonly parent: number[];
  constructor(size: number) { this.parent = Array.from({ length: size }, (_, index) => index); }
  find(value: number): number { let root = value; while (this.parent[root] !== root) root = this.parent[root]; while (this.parent[value] !== value) { const next = this.parent[value]; this.parent[value] = root; value = next; } return root; }
  join(a: number, b: number): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb); }
}

/** Partition triangle soup into deterministic, normal-continuous surface regions. */
export function segmentMeshSurfaces(positions: Float32Array, options: MeshSegmentationOptions = {}): MeshSegmentationResult {
  if (positions.length % 9 !== 0) throw new Error('Mesh segmentation requires whole Float32 triangles');
  for (let index = 0; index < positions.length; index++) if (!Number.isFinite(positions[index])) throw new Error(`Mesh segmentation coordinate ${index} is not finite`);
  const triangleCount = positions.length / 9;
  if (!triangleCount) return { regions: [], diagnostics: ['Mesh contains no triangles'], triangleCount: 0 };
  let min = Infinity, max = -Infinity;
  for (const value of positions) { min = Math.min(min, value); max = Math.max(max, value); }
  const scale = Math.max(1, max - min);
  const triangles = Array.from({ length: triangleCount }, (_, id) => triangleAt(positions, id, scale));
  const edges = new Map<string, number[]>();
  for (const triangle of triangles) for (let edge = 0; edge < 3; edge++) {
    const key = edgeKey(triangle.vertices[edge], triangle.vertices[(edge + 1) % 3]);
    const owners = edges.get(key) ?? []; owners.push(triangle.id); edges.set(key, owners);
  }
  const diagnostics: string[] = [];
  const boundary = [...edges.values()].filter((owners) => owners.length === 1).length;
  const nonManifold = [...edges.values()].filter((owners) => owners.length > 2).length;
  if (boundary) diagnostics.push(`${boundary} boundary edges leave the mesh open`);
  if (nonManifold) diagnostics.push(`${nonManifold} edges are non-manifold`);
  const degenerate = triangles.filter((triangle) => triangle.area <= scale * scale * 1e-12).length;
  if (degenerate) diagnostics.push(`${degenerate} degenerate triangles were retained but rejected for fitting`);

  const sets = new DisjointSet(triangleCount);
  const cosine = Math.cos((options.smoothAngleDegrees ?? 35) * Math.PI / 180);
  for (const owners of edges.values()) if (owners.length === 2) {
    const [a, b] = owners.map((id) => triangles[id]);
    if (a.area > 0 && b.area > 0 && dot(a.normal, b.normal) >= cosine) sets.join(a.id, b.id);
  }
  const grouped = new Map<number, Triangle[]>();
  for (const triangle of triangles) { const root = sets.find(triangle.id); const group = grouped.get(root) ?? []; group.push(triangle); grouped.set(root, group); }
  const totalArea = triangles.reduce((sum, triangle) => sum + triangle.area, 0);
  const minimumArea = totalArea * (options.minimumAreaFraction ?? 1e-6);
  const regions = [...grouped.values()].map((group): MeshSurfaceRegion => {
    group.sort((a, b) => a.key.localeCompare(b.key));
    const area = group.reduce((sum, triangle) => sum + triangle.area, 0);
    const bounds: BBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const centroid: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0];
    for (const triangle of group) {
      for (let axis = 0; axis < 3; axis++) {
        centroid[axis] += triangle.centroid[axis] * triangle.area;
        normal[axis] += triangle.normal[axis] * triangle.area;
        for (const point of triangle.points) { bounds.min[axis] = Math.min(bounds.min[axis], point[axis]); bounds.max[axis] = Math.max(bounds.max[axis], point[axis]); }
      }
    }
    if (area > 0) for (let axis = 0; axis < 3; axis++) centroid[axis] /= area;
    const normalLength = Math.hypot(...normal); if (normalLength > 0) for (let axis = 0; axis < 3; axis++) normal[axis] /= normalLength;
    return { key: group.map((triangle) => triangle.key).join('/'), triangleIds: group.map((triangle) => triangle.id).sort((a, b) => a - b), area, centroid, normal, bounds, eligible: area > minimumArea && group.every((triangle) => triangle.area > 0) };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const undersized = regions.filter((region) => !region.eligible && region.area > 0).length;
  if (undersized) diagnostics.push(`${undersized} undersized surface regions were retained but rejected for fitting`);
  return { regions, diagnostics, triangleCount };
}

/** Copy one region's original triangles in stable geometric order. The fit
 * pipeline can derive samples from this without losing the source-id mapping
 * retained on the region itself. */
export function regionTriangleSoup(positions: Float32Array, region: MeshSurfaceRegion): Float32Array {
  if (positions.length % 9 !== 0) throw new Error('Region extraction requires whole Float32 triangles');
  const count = positions.length / 9;
  const ids = [...region.triangleIds];
  if (new Set(ids).size !== ids.length || ids.some((id) => !Number.isInteger(id) || id < 0 || id >= count)) throw new Error('Region contains invalid or duplicate source triangle ids');
  ids.sort((a, b) => {
    const key = (id: number) => [0, 1, 2].map((vertex) => vertexKey([positions[id * 9 + vertex * 3], positions[id * 9 + vertex * 3 + 1], positions[id * 9 + vertex * 3 + 2]])).sort().join(';');
    return key(a).localeCompare(key(b));
  });
  const output = new Float32Array(ids.length * 9);
  ids.forEach((id, index) => output.set(positions.subarray(id * 9, id * 9 + 9), index * 9));
  return output;
}

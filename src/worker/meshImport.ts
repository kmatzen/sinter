import { parseSTL, STLParseError, validateSTLTopology, type RawMesh } from './sdf/stl';
import { simplifyMesh } from './sdf/simplify';
import { unzipSync } from 'fflate';

export const MAX_IMPORT_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_TRIANGLES = 300_000;
export const MAX_IMPORT_PROJECT_BYTES = 3 * 1024 * 1024;

export function estimatedStoredMeshBytes(triangleCount: number): number {
  return Math.ceil(triangleCount * 9 * 4 * 4 / 3) + 1024;
}

export type MeshImportFormat = 'stl' | 'obj' | '3mf';
export interface MeshImportInfo {
  format: MeshImportFormat;
  triangleCount: number;
  componentCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  unitScaleToMillimeters: number;
  declaredUnit?: string;
  estimatedProjectBytes: number;
}

export interface ParsedImport { info: MeshImportInfo; positions: Float32Array }

function bounds(positions: Float32Array): Pick<MeshImportInfo, 'boundsMin' | 'boundsMax'> {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], positions[i + axis]); max[axis] = Math.max(max[axis], positions[i + axis]);
  }
  return { boundsMin: min, boundsMax: max };
}

function formatFor(name: string): MeshImportFormat {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'stl' || extension === 'obj' || extension === '3mf') return extension;
  throw new STLParseError('Choose an STL, OBJ, or 3MF mesh file');
}

const THREE_MF_UNITS: Record<string, number> = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1].split(':').pop()!] = match[3];
  return result;
}

function transformPoint(point: [number, number, number], chain: string[]): [number, number, number] {
  let result = point;
  for (const raw of chain) {
  const m = raw.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((value) => !Number.isFinite(value))) throw new STLParseError('3MF component has an invalid transform');
    const [x, y, z] = result;
    result = [x*m[0] + y*m[3] + z*m[6] + m[9], x*m[1] + y*m[4] + z*m[7] + m[10], x*m[2] + y*m[5] + z*m[8] + m[11]];
  }
  return result;
}

function transformSign(chain: string[]): number {
  let sign = 1;
  for (const raw of chain) {
    const m = raw.trim().split(/\s+/).map(Number);
    if (m.length !== 12 || m.some((value) => !Number.isFinite(value))) throw new STLParseError('3MF component has an invalid transform');
    const determinant = m[0]*(m[4]*m[8]-m[7]*m[5]) - m[3]*(m[1]*m[8]-m[7]*m[2]) + m[6]*(m[1]*m[5]-m[4]*m[2]);
    if (Math.abs(determinant) < 1e-12) throw new STLParseError('3MF component has a singular transform');
    sign *= Math.sign(determinant);
  }
  return sign;
}

function parse3MF(buffer: ArrayBuffer): { mesh: RawMesh; unit: string; unitScale: number } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), { filter: (file) => {
      if (!file.name.toLowerCase().endsWith('.model')) return false;
      if (file.originalSize > 64 * 1024 * 1024) throw new STLParseError('The expanded 3MF model exceeds the 64 MB safety limit');
      return true;
    } });
  } catch (error) {
    if (error instanceof STLParseError) throw error;
    throw new STLParseError('The 3MF ZIP container is malformed');
  }
  let expanded = 0;
  for (const value of Object.values(files)) {
    expanded += value.byteLength;
    if (expanded > 64 * 1024 * 1024) throw new STLParseError('The expanded 3MF exceeds the 64 MB safety limit');
  }
  const entry = Object.entries(files).find(([name]) => /(^|\/)3d\/[^/]+\.model$/i.test(name)) ?? Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.model'));
  if (!entry) throw new STLParseError('The 3MF contains no model part');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(entry[1]);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new STLParseError('3MF document types and entities are not supported');
  const model = xml.match(/<(?:\w+:)?model\b([^>]*)>/i);
  const unit = model ? (attributes(model[1]).unit || 'millimeter').toLowerCase() : 'millimeter';
  const unitScale = THREE_MF_UNITS[unit];
  if (!unitScale) throw new STLParseError(`The 3MF declares unsupported unit “${unit}”`);

  type ObjectData = { vertices?: Array<[number, number, number]>; triangles?: Array<[number, number, number]>; components?: Array<{ id: string; transform?: string }> };
  const objects = new Map<string, ObjectData>();
  for (const match of xml.matchAll(/<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/gi)) {
    const id = attributes(match[1]).id;
    if (!id || objects.has(id)) throw new STLParseError('The 3MF contains a missing or duplicate object id');
    const body = match[2];
    const vertices = [...body.matchAll(/<(?:\w+:)?vertex\b([^>]*)\/?\s*>/gi)].map((vertex) => {
      const a = attributes(vertex[1]); const p = [Number(a.x), Number(a.y), Number(a.z)] as [number, number, number];
      if (p.some((value) => !Number.isFinite(value))) throw new STLParseError('3MF vertex coordinate is not finite');
      return p;
    });
    const triangles = [...body.matchAll(/<(?:\w+:)?triangle\b([^>]*)\/?\s*>/gi)].map((triangle) => {
      const a = attributes(triangle[1]); const t = [Number(a.v1), Number(a.v2), Number(a.v3)] as [number, number, number];
      if (t.some((value) => !Number.isInteger(value) || value < 0 || value >= vertices.length)) throw new STLParseError('3MF triangle references a missing vertex');
      return t;
    });
    const components = [...body.matchAll(/<(?:\w+:)?component\b([^>]*)\/?\s*>/gi)].map((component) => {
      const a = attributes(component[1]);
      if (!a.objectid) throw new STLParseError('3MF component is missing its object id');
      if (a.path) throw new STLParseError('External 3MF component paths are not supported');
      return { id: a.objectid, transform: a.transform };
    });
    if (!triangles.length && !components.length) throw new STLParseError(`3MF object ${id} has no mesh or components`);
    objects.set(id, { ...(triangles.length ? { vertices, triangles } : {}), ...(components.length ? { components } : {}) });
  }
  const positions: number[] = [];
  const emit = (id: string, transforms: string[] = [], stack: string[] = []) => {
    if (stack.includes(id) || stack.length > 32) throw new STLParseError('The 3MF component graph is cyclic or too deep');
    const object = objects.get(id); if (!object) throw new STLParseError(`3MF build references missing object ${id}`);
    if (object.triangles && object.vertices) for (const triangle of object.triangles) {
      const points = triangle.map((index) => transformPoint(object.vertices![index], transforms));
      if (transformSign(transforms) < 0) [points[1], points[2]] = [points[2], points[1]];
      for (const point of points) positions.push(...point);
    }
    for (const component of object.components ?? []) {
      emit(component.id, [...(component.transform ? [component.transform] : []), ...transforms], [...stack, id]);
    }
  };
  const build = xml.match(/<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/i)?.[1];
  const items = build ? [...build.matchAll(/<(?:\w+:)?item\b([^>]*)\/?\s*>/gi)] : [];
  if (!items.length) throw new STLParseError('The 3MF build contains no items');
  for (const item of items) { const a = attributes(item[1]); if (!a.objectid) throw new STLParseError('3MF build item is missing its object id'); emit(a.objectid, a.transform ? [a.transform] : []); }
  const output = new Float32Array(positions);
  const triangles = output.length / 9;
  if (!triangles) throw new STLParseError('The 3MF contains no triangles');
  if (triangles > MAX_IMPORT_TRIANGLES) throw new STLParseError(`The 3MF exceeds the supported source limit of ${MAX_IMPORT_TRIANGLES.toLocaleString()} triangles`);
  const topology = validateSTLTopology(output);
  return { mesh: { positions: output, normals: new Float32Array(triangles * 3), triangleCount: triangles, topology }, unit, unitScale };
}

function parseOBJ(buffer: ArrayBuffer): RawMesh {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  const vertices: Array<[number, number, number]> = [];
  const positions: number[] = [];
  let triangles = 0;
  for (const original of source.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields[0] === 'v') {
      if (fields.length < 4) throw new STLParseError('OBJ vertex is missing coordinates');
      const vertex = fields.slice(1, 4).map(Number) as [number, number, number];
      if (vertex.some((value) => !Number.isFinite(value))) throw new STLParseError('OBJ vertex coordinate is not finite');
      vertices.push(vertex);
    } else if (fields[0] === 'f') {
      if (fields.length < 4) throw new STLParseError('OBJ face has fewer than three vertices');
      const face = fields.slice(1).map((field) => {
        const raw = Number(field.split('/')[0]);
        if (!Number.isInteger(raw) || raw === 0) throw new STLParseError('OBJ face contains an invalid vertex index');
        const index = raw < 0 ? vertices.length + raw : raw - 1;
        if (index < 0 || index >= vertices.length) throw new STLParseError('OBJ face references a missing vertex');
        return index;
      });
      for (let i = 1; i < face.length - 1; i++) {
        for (const index of [face[0], face[i], face[i + 1]]) positions.push(...vertices[index]);
        if (++triangles > MAX_IMPORT_TRIANGLES) throw new STLParseError(`The OBJ exceeds the supported source limit of ${MAX_IMPORT_TRIANGLES.toLocaleString()} triangles`);
      }
    }
  }
  if (!triangles) throw new STLParseError('The OBJ has no faces');
  const output = new Float32Array(positions);
  const topology = validateSTLTopology(output);
  return { positions: output, normals: new Float32Array(triangles * 3), triangleCount: triangles, topology };
}

export function parseMeshImport(buffer: ArrayBuffer, name: string): ParsedImport {
  if (buffer.byteLength > MAX_IMPORT_SOURCE_BYTES) throw new STLParseError(`Mesh file exceeds the ${MAX_IMPORT_SOURCE_BYTES / 1024 / 1024} MB source limit`);
  const format = formatFor(name);
  const parsed = format === '3mf' ? parse3MF(buffer) : { mesh: format === 'stl' ? parseSTL(buffer, MAX_IMPORT_TRIANGLES) : parseOBJ(buffer), unit: '', unitScale: 1 };
  const mesh = parsed.mesh;
  return { positions: mesh.positions, info: { format, triangleCount: mesh.triangleCount, componentCount: mesh.topology.componentCount, ...bounds(mesh.positions), unitScaleToMillimeters: parsed.unitScale, ...(parsed.unit ? { declaredUnit: parsed.unit } : {}), estimatedProjectBytes: estimatedStoredMeshBytes(mesh.triangleCount) } };
}

function indexedSoup(positions: Float32Array) {
  const unique: number[] = []; const indices = new Uint32Array(positions.length / 3); const ids = new Map<string, number>();
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = unique.length / 3; ids.set(key, id); unique.push(positions[i], positions[i + 1], positions[i + 2]); }
    indices[i / 3] = id;
  }
  return { positions: new Float32Array(unique), normals: new Float32Array(unique.length), indices };
}

export function reduceImportedMesh(positions: Float32Array, targetTriangles: number, onProgress?: (percent: number) => void): Float32Array {
  const current = positions.length / 9;
  if (!Number.isInteger(targetTriangles) || targetTriangles < 4 || targetTriangles > current) throw new Error('Simplification target is outside the mesh triangle range');
  if (estimatedStoredMeshBytes(targetTriangles) > MAX_IMPORT_PROJECT_BYTES) throw new Error('Simplification target exceeds the 3 MB stored mesh limit');
  if (targetTriangles === current) return positions.slice();
  const simplified = simplifyMesh(indexedSoup(positions), targetTriangles / current, onProgress);
  const soup = new Float32Array(simplified.indices.length * 3);
  for (let i = 0; i < simplified.indices.length; i++) {
    const source = simplified.indices[i] * 3;
    soup[i * 3] = simplified.positions[source]; soup[i * 3 + 1] = simplified.positions[source + 1]; soup[i * 3 + 2] = simplified.positions[source + 2];
  }
  validateSTLTopology(soup);
  return soup;
}

function pointTriangleDistanceSq(px: number, py: number, pz: number, a: number, b: number, c: number, positions: Float32Array): number {
  const ax=positions[a], ay=positions[a+1], az=positions[a+2], bx=positions[b], by=positions[b+1], bz=positions[b+2], cx=positions[c], cy=positions[c+1], cz=positions[c+2];
  const abx=bx-ax, aby=by-ay, abz=bz-az, acx=cx-ax, acy=cy-ay, acz=cz-az, apx=px-ax, apy=py-ay, apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz, d2=acx*apx+acy*apy+acz*apz;
  if (d1<=0 && d2<=0) return apx*apx+apy*apy+apz*apz;
  const bpx=px-bx, bpy=py-by, bpz=pz-bz, d3=abx*bpx+aby*bpy+abz*bpz, d4=acx*bpx+acy*bpy+acz*bpz;
  if (d3>=0 && d4<=d3) return bpx*bpx+bpy*bpy+bpz*bpz;
  const vc=d1*d4-d3*d2;
  if (vc<=0 && d1>=0 && d3<=0) { const v=d1/(d1-d3), dx=apx-v*abx, dy=apy-v*aby, dz=apz-v*abz; return dx*dx+dy*dy+dz*dz; }
  const cpx=px-cx, cpy=py-cy, cpz=pz-cz, d5=abx*cpx+aby*cpy+abz*cpz, d6=acx*cpx+acy*cpy+acz*cpz;
  if (d6>=0 && d5<=d6) return cpx*cpx+cpy*cpy+cpz*cpz;
  const vb=d5*d2-d1*d6;
  if (vb<=0 && d2>=0 && d6<=0) { const w=d2/(d2-d6), dx=apx-w*acx, dy=apy-w*acy, dz=apz-w*acz; return dx*dx+dy*dy+dz*dz; }
  const va=d3*d6-d5*d4;
  if (va<=0 && d4-d3>=0 && d5-d6>=0) { const w=(d4-d3)/((d4-d3)+(d5-d6)), dx=bpx+w*(cx-bx), dy=bpy+w*(cy-by), dz=bpz+w*(cz-bz); return dx*dx+dy*dy+dz*dz; }
  const denom=1/(va+vb+vc), v=vb*denom, w=vc*denom;
  const dx=apx-v*abx-w*acx, dy=apy-v*aby-w*acy, dz=apz-v*abz-w*acz;
  return dx*dx+dy*dy+dz*dz;
}

/** Deterministic sampled one-sided Hausdorff estimate, in source coordinate units. */
export function estimateImportedMeshDeviation(original: Float32Array, simplified: Float32Array, maxSamples = 256): number {
  const sourceVertices = original.length / 3;
  if (!sourceVertices || simplified.length < 9) return 0;
  const step = Math.max(1, Math.floor(sourceVertices / maxSamples));
  let worst = 0;
  for (let vertex = 0, sampled = 0; vertex < sourceVertices && sampled < maxSamples; vertex += step, sampled++) {
    const i = vertex * 3; let nearest = Infinity;
    for (let triangle = 0; triangle < simplified.length; triangle += 9) nearest = Math.min(nearest, pointTriangleDistanceSq(original[i], original[i+1], original[i+2], triangle, triangle+3, triangle+6, simplified));
    worst = Math.max(worst, nearest);
  }
  return Math.sqrt(worst);
}

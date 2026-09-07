import { parseSTL, STLParseError, validateSTLTopology, type RawMesh } from './sdf/stl';
import { simplifyMesh } from './sdf/simplify';

export const MAX_IMPORT_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_TRIANGLES = 300_000;

export type MeshImportFormat = 'stl' | 'obj';
export interface MeshImportInfo {
  format: MeshImportFormat;
  triangleCount: number;
  componentCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
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
  if (extension === 'stl' || extension === 'obj') return extension;
  throw new STLParseError('Choose an STL or OBJ mesh file');
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
  const mesh = format === 'stl' ? parseSTL(buffer, MAX_IMPORT_TRIANGLES) : parseOBJ(buffer);
  return { positions: mesh.positions, info: { format, triangleCount: mesh.triangleCount, componentCount: mesh.topology.componentCount, ...bounds(mesh.positions) } };
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

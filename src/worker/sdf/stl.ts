import { MODEL_SPATIAL_LIMIT_MM } from '../../types/modelingEnvelope';

/**
 * STL reader (#87).
 *
 * Both encodings, because both are in the wild and the file gives you no
 * reliable way to ask which it is: an ASCII file starts with "solid", but so do
 * plenty of binary ones, since exporters write their name into the 80-byte
 * header and some of them start it with that word. The only sound test is
 * arithmetic — a binary STL's length is exactly 84 + 50n for the triangle count
 * in its header — so that is what this checks, and the "solid" prefix is used
 * only as a tie-break when the arithmetic is inconclusive.
 */

export interface RawMesh {
  /** Triangle vertices, flat xyz, 9 numbers per triangle. */
  positions: Float32Array;
  /** Per-triangle facet normals as written in the file, 3 per triangle. */
  normals: Float32Array;
  triangleCount: number;
  topology: STLTopology;
}

export class STLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'STLParseError';
  }
}

/** Header is 80 bytes of comment, then a uint32 triangle count. */
const BINARY_HEADER = 84;
const BINARY_TRIANGLE = 50;
export const MAX_STL_TRIANGLES = 60_000;
export const STL_TOPOLOGY_STATUS = 'closed-manifold; self-intersections not checked';

export interface STLTopology {
  vertexCount: number;
  componentCount: number;
  weldTolerance: number;
  selfIntersections: 'unchecked';
}

/**
 * Prove that a triangle soup is a closed, consistently oriented 2-manifold.
 *
 * STL repeats coordinates for every facet, and exporters commonly introduce
 * tiny round-off differences between copies of the same vertex. We therefore
 * weld within one millionth of the model's longest extent (with a small
 * absolute floor) before counting edges. Every edge of an orientable closed
 * surface must then occur exactly twice, once in each direction.
 */
export function validateSTLTopology(positions: ArrayLike<number>): STLTopology {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const tolerance = Math.max(extent * 1e-6, 1e-7);
  const tolerance2 = tolerance * tolerance;
  const buckets = new Map<string, number[]>();
  const vertices: [number, number, number][] = [];
  const ids = new Uint32Array(positions.length / 3);
  const cell = (value: number) => Math.floor(value / tolerance);

  for (let i = 0; i < positions.length; i += 3) {
    const p: [number, number, number] = [positions[i], positions[i + 1], positions[i + 2]];
    const c = [cell(p[0]), cell(p[1]), cell(p[2])];
    let found = -1;
    for (let dz = -1; dz <= 1 && found < 0; dz++) {
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        for (let dx = -1; dx <= 1 && found < 0; dx++) {
          for (const candidate of buckets.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
            const q = vertices[candidate];
            const qx = p[0] - q[0], qy = p[1] - q[1], qz = p[2] - q[2];
            if (qx * qx + qy * qy + qz * qz <= tolerance2) { found = candidate; break; }
          }
        }
      }
    }
    if (found < 0) {
      found = vertices.length;
      vertices.push(p);
      const key = `${c[0]},${c[1]},${c[2]}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(found); else buckets.set(key, [found]);
    }
    ids[i / 3] = found;
  }

  type Edge = { count: number; direction: number; triangles: number[] };
  const edges = new Map<string, Edge>();
  const facets = new Set<string>();
  const triangleCount = ids.length / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = ids[triangle * 3], b = ids[triangle * 3 + 1], c = ids[triangle * 3 + 2];
    if (a === b || b === c || c === a) {
      throw new STLParseError(`Facet ${triangle + 1} collapses after welding; the mesh is not a valid solid`);
    }
    const pa = vertices[a], pb = vertices[b], pc = vertices[c];
    const ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const nx = ab[1] * ac[2] - ab[2] * ac[1];
    const ny = ab[2] * ac[0] - ab[0] * ac[2];
    const nz = ab[0] * ac[1] - ab[1] * ac[0];
    if (nx * nx + ny * ny + nz * nz <= tolerance2 * tolerance2) {
      throw new STLParseError(`Facet ${triangle + 1} is degenerate; the mesh is not a valid solid`);
    }
    const facetKey = [a, b, c].sort((x, y) => x - y).join(',');
    if (facets.has(facetKey)) throw new STLParseError(`Facet ${triangle + 1} duplicates another facet`);
    facets.add(facetKey);
    for (const [from, to] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const key = `${lo},${hi}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0, triangles: [] };
      edge.count++;
      edge.direction += from === lo ? 1 : -1;
      edge.triangles.push(triangle);
      edges.set(key, edge);
    }
  }

  let boundary = 0, nonManifold = 0, inconsistent = 0;
  for (const edge of edges.values()) {
    if (edge.count === 1) boundary++;
    else if (edge.count !== 2) nonManifold++;
    else if (edge.direction !== 0) inconsistent++;
  }
  if (boundary || nonManifold || inconsistent) {
    const problems = [
      boundary && `${boundary} boundary edge${boundary === 1 ? '' : 's'}`,
      nonManifold && `${nonManifold} non-manifold edge${nonManifold === 1 ? '' : 's'}`,
      inconsistent && `${inconsistent} inconsistently oriented edge${inconsistent === 1 ? '' : 's'}`,
    ].filter(Boolean).join(', ');
    throw new STLParseError(`The STL is not a closed, consistently oriented solid (${problems})`);
  }

  // Connected components by shared edges. Disconnected closed shells are valid
  // and ray parity handles nesting independently of winding direction.
  const parent = new Uint32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) parent[i] = i;
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const join = (a: number, b: number) => { a = root(a); b = root(b); if (a !== b) parent[b] = a; };
  for (const edge of edges.values()) join(edge.triangles[0], edge.triangles[1]);
  const componentCount = new Set(Array.from(parent, (_, i) => root(i))).size;
  return { vertexCount: vertices.length, componentCount, weldTolerance: tolerance, selfIntersections: 'unchecked' };
}

function validatePositions(positions: ArrayLike<number>): STLTopology {
  if (positions.length === 0) throw new STLParseError('No triangles found — is this an STL file?');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i];
    if (!Number.isFinite(value)) throw new STLParseError(`Vertex coordinate ${i + 1} is not finite`);
    if (Math.abs(value) > MODEL_SPATIAL_LIMIT_MM) {
      throw new STLParseError(`Vertex coordinate ${i + 1} exceeds the ±${MODEL_SPATIAL_LIMIT_MM} mm modeling envelope`);
    }
    const axis = i % 3;
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  }
  if (min.every((value, axis) => value === max[axis])) {
    throw new STLParseError('All vertices coincide; the STL has no usable geometry');
  }
  let hasArea = false;
  for (let i = 0; i < positions.length; i += 9) {
    const abx = positions[i + 3] - positions[i], aby = positions[i + 4] - positions[i + 1], abz = positions[i + 5] - positions[i + 2];
    const acx = positions[i + 6] - positions[i], acy = positions[i + 7] - positions[i + 1], acz = positions[i + 8] - positions[i + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz > 0) { hasArea = true; break; }
  }
  if (!hasArea) throw new STLParseError('Every triangle is degenerate; the STL has no usable surface');
  return validateSTLTopology(positions);
}

export function isBinarySTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_HEADER) return false;
  const count = new DataView(buffer).getUint32(80, true);
  // Exact length match is decisive in either direction: an ASCII file whose
  // bytes 80-84 happen to encode its own triangle count to the byte is not a
  // case worth defending against.
  if (BINARY_HEADER + count * BINARY_TRIANGLE === buffer.byteLength) return true;
  // Otherwise fall back to the prefix, which is right for well-formed ASCII and
  // is all that is left for a binary file with a wrong count.
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)));
  return head.trim().toLowerCase() !== 'solid';
}

export function parseSTL(buffer: ArrayBuffer, maxTriangles = MAX_STL_TRIANGLES): RawMesh {
  if (!Number.isInteger(maxTriangles) || maxTriangles < 1) throw new STLParseError('Triangle limit must be a positive integer');
  return isBinarySTL(buffer) ? parseBinary(buffer, maxTriangles) : parseAscii(buffer, maxTriangles);
}

function parseBinary(buffer: ArrayBuffer, maxTriangles: number): RawMesh {
  if (buffer.byteLength < BINARY_HEADER) throw new STLParseError('File is too short to be an STL');
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (count > maxTriangles) {
    throw new STLParseError(`The STL contains ${count.toLocaleString()} triangles; the supported limit is ${maxTriangles.toLocaleString()}`);
  }
  const needed = BINARY_HEADER + count * BINARY_TRIANGLE;
  if (needed > buffer.byteLength) {
    throw new STLParseError(
      `Header claims ${count} triangles (${needed} bytes) but the file is ${buffer.byteLength} bytes`,
    );
  }

  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 3);
  let off = BINARY_HEADER;
  for (let t = 0; t < count; t++) {
    normals[t * 3] = view.getFloat32(off, true);
    normals[t * 3 + 1] = view.getFloat32(off + 4, true);
    normals[t * 3 + 2] = view.getFloat32(off + 8, true);
    off += 12;
    for (let v = 0; v < 3; v++) {
      positions[t * 9 + v * 3] = view.getFloat32(off, true);
      positions[t * 9 + v * 3 + 1] = view.getFloat32(off + 4, true);
      positions[t * 9 + v * 3 + 2] = view.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // attribute byte count, unused
  }
  const topology = validatePositions(positions);
  return { positions, normals, triangleCount: count, topology };
}

function parseAscii(buffer: ArrayBuffer, maxTriangles: number): RawMesh {
  const text = new TextDecoder().decode(buffer);
  const positions: number[] = [];
  const normals: number[] = [];

  // Token-driven rather than line-driven because ASCII STL has no required
  // line layout. Facet boundaries still matter: collecting any three stray
  // `vertex` tokens silently invents geometry that the document did not
  // declare, and extra vertices in a facet must not spill into the next one.
  const tokens = text.split(/\s+/);
  let i = 0;
  let inFacet = false;
  let facetVertices: number[] = [];
  let facetNormal: number[] = [0, 0, 0];
  const numberAt = (index: number, context: string) => {
    const value = Number(tokens[index]);
    if (!Number.isFinite(value)) throw new STLParseError(`${context} is missing or not finite`);
    return value;
  };
  while (i < tokens.length) {
    const tok = tokens[i].toLowerCase();
    if (tok === 'facet') {
      if (inFacet) throw new STLParseError('A facet begins before the previous facet ends');
      inFacet = true;
      facetVertices = [];
      if (tokens[i + 1]?.toLowerCase() === 'normal') {
        facetNormal = [numberAt(i + 2, 'Facet normal X'), numberAt(i + 3, 'Facet normal Y'), numberAt(i + 4, 'Facet normal Z')];
        i += 5;
      } else { facetNormal = [0, 0, 0]; i++; }
      continue;
    }
    if (tok === 'vertex') {
      if (!inFacet) throw new STLParseError('A vertex appears outside a facet');
      facetVertices.push(numberAt(i + 1, 'Vertex X'), numberAt(i + 2, 'Vertex Y'), numberAt(i + 3, 'Vertex Z'));
      if (facetVertices.length > 9) throw new STLParseError('A facet contains more than three vertices');
      i += 4;
      continue;
    }
    if (tok === 'endfacet') {
      if (!inFacet) throw new STLParseError('An endfacet appears without a matching facet');
      if (facetVertices.length !== 9) throw new STLParseError(`A facet contains ${facetVertices.length / 3} vertices instead of 3`);
      positions.push(...facetVertices);
      normals.push(...facetNormal);
      if (positions.length / 9 > maxTriangles) {
        throw new STLParseError(`The STL exceeds the supported limit of ${maxTriangles.toLocaleString()} triangles`);
      }
      inFacet = false;
      i++;
      continue;
    }
    i++;
  }
  if (inFacet) throw new STLParseError('The final facet is missing endfacet');
  const triangleCount = positions.length / 9;

  const topology = validatePositions(positions);

  return { positions: new Float32Array(positions), normals: new Float32Array(normals), triangleCount, topology };
}

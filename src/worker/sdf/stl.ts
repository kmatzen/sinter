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
const MAX_ABS_COORDINATE = 1e9;
export const MAX_STL_TRIANGLES = 60_000;

function validatePositions(positions: ArrayLike<number>): void {
  if (positions.length === 0) throw new STLParseError('No triangles found — is this an STL file?');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i];
    if (!Number.isFinite(value)) throw new STLParseError(`Vertex coordinate ${i + 1} is not finite`);
    if (Math.abs(value) > MAX_ABS_COORDINATE) {
      throw new STLParseError(`Vertex coordinate ${i + 1} exceeds the supported range`);
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

export function parseSTL(buffer: ArrayBuffer): RawMesh {
  return isBinarySTL(buffer) ? parseBinary(buffer) : parseAscii(buffer);
}

function parseBinary(buffer: ArrayBuffer): RawMesh {
  if (buffer.byteLength < BINARY_HEADER) throw new STLParseError('File is too short to be an STL');
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (count > MAX_STL_TRIANGLES) {
    throw new STLParseError(`The STL contains ${count.toLocaleString()} triangles; the supported limit is ${MAX_STL_TRIANGLES.toLocaleString()}`);
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
  validatePositions(positions);
  return { positions, normals, triangleCount: count };
}

function parseAscii(buffer: ArrayBuffer): RawMesh {
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
      if (positions.length / 9 > MAX_STL_TRIANGLES) {
        throw new STLParseError(`The STL exceeds the supported limit of ${MAX_STL_TRIANGLES.toLocaleString()} triangles`);
      }
      inFacet = false;
      i++;
      continue;
    }
    i++;
  }
  if (inFacet) throw new STLParseError('The final facet is missing endfacet');
  const triangleCount = positions.length / 9;

  validatePositions(positions);

  return { positions: new Float32Array(positions), normals: new Float32Array(normals), triangleCount };
}

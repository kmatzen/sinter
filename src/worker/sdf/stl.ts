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

  // Deliberately token-driven rather than line-driven: ASCII STL has no
  // required line structure, and exporters differ on indentation, on whether
  // "outer loop" is present, and on line endings.
  const tokens = text.split(/\s+/);
  let i = 0;
  let pending = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === 'facet') {
      if (tokens[i + 1] === 'normal') {
        normals.push(Number(tokens[i + 2]), Number(tokens[i + 3]), Number(tokens[i + 4]));
        i += 5;
      } else {
        normals.push(0, 0, 0);
        i += 1;
      }
      pending = 0;
      continue;
    }
    if (tok === 'vertex') {
      positions.push(Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3]));
      pending++;
      i += 4;
      continue;
    }
    i++;
  }

  if (positions.length % 9 !== 0) {
    throw new STLParseError(`Truncated final facet: ${positions.length / 3} vertices is not a whole number of triangles`);
  }
  // A file can declare more facets than it gives normals for, or vice versa.
  const triangleCount = positions.length / 9;
  const outNormals = new Float32Array(triangleCount * 3);
  outNormals.set(normals.slice(0, triangleCount * 3));

  validatePositions(positions);

  return { positions: new Float32Array(positions), normals: outNormals, triangleCount };
}

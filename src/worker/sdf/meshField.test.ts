import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { bakeMeshField, sampleMeshField, meshBounds } from './meshField';
import { parseSTL, isBinarySTL, STLParseError } from './stl';

/** Axis-aligned box as a closed triangle soup, outward-facing. */
function boxMesh(hx: number, hy: number, hz: number): Float32Array {
  const v: [number, number, number][] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], // -z
    [4, 5, 6], [4, 6, 7], // +z
    [0, 1, 5], [0, 5, 4], // -y
    [3, 7, 6], [3, 6, 2], // +y
    [0, 4, 7], [0, 7, 3], // -x
    [1, 2, 6], [1, 6, 5], // +x
  ];
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    f.forEach((idx, k) => out.set(v[idx], i * 9 + k * 3));
  });
  return out;
}

/** Icosphere-ish: an octahedron subdivided `n` times and pushed onto a sphere. */
function sphereMesh(radius: number, subdiv: number): Float32Array {
  let tris: [number, number, number][][] = [];
  const o: [number, number, number][] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  tris = faces.map((f) => f.map((i) => o[i]) as [number, number, number][]);

  const norm = (p: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  const mid = (a: [number, number, number], b: [number, number, number]) =>
    norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);

  for (let s = 0; s < subdiv; s++) {
    const next: [number, number, number][][] = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }

  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    t.forEach((p, k) => out.set([p[0] * radius, p[1] * radius, p[2] * radius], i * 9 + k * 3));
  });
  return out;
}

describe('meshBounds', () => {
  it('pads so the field has room to be positive outside the surface', () => {
    const b = meshBounds(boxMesh(10, 10, 10));
    // Padded, and symmetric about the mesh.
    expect(b.min[0]).toBeLessThan(-10);
    expect(b.max[0]).toBeGreaterThan(10);
    expect(b.min[0]).toBeCloseTo(-b.max[0], 5);
  });

  it('returns a usable box for an empty mesh rather than infinities', () => {
    const b = meshBounds(new Float32Array(0));
    for (const v of [...b.min, ...b.max]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('bakeMeshField', () => {
  const RES = 48;

  it('signs a closed box correctly inside and out', () => {
    const field = bakeMeshField(boxMesh(10, 10, 10), RES);
    expect(sampleMeshField(field, 0, 0, 0)).toBeLessThan(0);
    expect(sampleMeshField(field, 0, 0, 9)).toBeLessThan(0);
    expect(sampleMeshField(field, 0, 0, 11)).toBeGreaterThan(0);
    expect(sampleMeshField(field, 12, 12, 12)).toBeGreaterThan(0);
  });

  /**
   * The field is only as accurate as the grid, so the tolerance is stated in
   * voxels rather than millimetres. One voxel is the honest claim: trilinear
   * interpolation of a sampled distance cannot do better near a sharp edge.
   */
  it('approximates a box distance to within a voxel', () => {
    const field = bakeMeshField(boxMesh(10, 10, 10), RES);
    const voxel = (field.bbox.max[0] - field.bbox.min[0]) / (RES - 1);
    const exact = (x: number, y: number, z: number) => {
      const qx = Math.abs(x) - 10, qy = Math.abs(y) - 10, qz = Math.abs(z) - 10;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
    };
    // All inside the padded grid box. Outside it the field is deliberately a
    // loose under-estimate rather than an accurate value — see the soundness
    // test below, which is the property that matters out there.
    for (const p of [[0, 0, 0], [5, 0, 0], [0, 7, 3], [11.5, 0, 0], [0, 0, 11.8], [11, 11, 0]] as const) {
      expect(Math.abs(sampleMeshField(field, p[0], p[1], p[2]) - exact(p[0], p[1], p[2])))
        .toBeLessThan(voxel);
    }
  });

  /**
   * Beyond the baked box there is no data, so the field falls back to bounds
   * that under-estimate. Under-estimating is the direction sphere tracing
   * needs; the value must still be positive, and must still grow with
   * distance, or a ray outside the grid either stalls or steps through the
   * box entirely.
   */
  it('stays a positive, growing under-estimate outside the baked box', () => {
    const field = bakeMeshField(boxMesh(10, 10, 10), RES);
    const far = field.bbox.max[0];
    let prev = 0;
    for (const d of [1, 4, 12, 40]) {
      const got = sampleMeshField(field, far + d, 0, 0);
      const exact = far + d - 10;
      expect(got).toBeGreaterThan(prev);
      expect(got).toBeLessThanOrEqual(exact + 1e-6);
      prev = got;
    }
  });

  it('approximates a sphere distance to within a voxel', () => {
    const field = bakeMeshField(sphereMesh(12, 3), RES);
    const voxel = (field.bbox.max[0] - field.bbox.min[0]) / (RES - 1);
    for (const p of [[0, 0, 0], [6, 0, 0], [0, 0, 12.6], [9, 9, 0]] as const) {
      const exact = Math.hypot(p[0], p[1], p[2]) - 12;
      // A subdivided octahedron is inscribed in its sphere, so the tessellated
      // surface sits slightly inside the ideal one; two voxels covers both the
      // grid error and that chord deficit.
      expect(Math.abs(sampleMeshField(field, p[0], p[1], p[2]) - exact)).toBeLessThan(2 * voxel);
    }
  });

  /**
   * The property that makes the field usable at all: sphere tracing needs a
   * value that never overstates the distance to the surface, or it steps
   * through geometry.
   */
  it('never reports more clearance than there is', () => {
    const field = bakeMeshField(sphereMesh(12, 3), RES);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      // Deterministic lattice rather than random, so a failure reproduces.
      const x = ((i * 7) % 41) - 20, y = ((i * 13) % 41) - 20, z = ((i * 29) % 41) - 20;
      const reported = sampleMeshField(field, x, y, z);
      const trueDist = Math.abs(Math.hypot(x, y, z) - 12);
      const overstatement = Math.abs(reported) - trueDist;
      if (overstatement > worst) worst = overstatement;
    }
    const voxel = (field.bbox.max[0] - field.bbox.min[0]) / (RES - 1);
    expect(worst).toBeLessThan(voxel);
  });

  it('reports empty space everywhere for a mesh with no triangles', () => {
    const field = bakeMeshField(new Float32Array(0), 8);
    expect(sampleMeshField(field, 0, 0, 0)).toBeGreaterThan(0);
  });

  /**
   * A bake must be reproducible: the sign test votes over three fixed
   * directions precisely so that importing the same file twice cannot produce
   * two different solids.
   */
  it('bakes the same field twice', () => {
    const mesh = sphereMesh(12, 2);
    const a = bakeMeshField(mesh, 24);
    const b = bakeMeshField(mesh, 24);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  /**
   * Ray parity was chosen over a surface pseudonormal because it degrades
   * gracefully. Dropping a facet leaves a hole; the sign must stay right
   * almost everywhere rather than inverting the model.
   */
  it('keeps the sign right on a mesh with a hole in it', () => {
    const full = boxMesh(10, 10, 10);
    const holed = full.slice(0, full.length - 9); // drop one facet
    const field = bakeMeshField(holed, RES);
    expect(sampleMeshField(field, 0, 0, 0)).toBeLessThan(0);
    expect(sampleMeshField(field, 14, 14, 14)).toBeGreaterThan(0);
  });
});

describe('STL parsing', () => {
  function binarySTL(tris: number[][]): ArrayBuffer {
    const buf = new ArrayBuffer(84 + tris.length * 50);
    const view = new DataView(buf);
    view.setUint32(80, tris.length, true);
    let off = 84;
    for (const t of tris) {
      for (let i = 0; i < 3; i++) view.setFloat32(off + i * 4, 0, true);
      off += 12;
      for (let i = 0; i < 9; i++) view.setFloat32(off + i * 4, t[i], true);
      off += 36;
      view.setUint16(off, 0, true);
      off += 2;
    }
    return buf;
  }

  const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

  it('reads a binary file', () => {
    const mesh = parseSTL(binarySTL([TRI, TRI]));
    expect(mesh.triangleCount).toBe(2);
    expect(Array.from(mesh.positions.slice(0, 9))).toEqual(TRI);
  });

  it('reads an ascii file', () => {
    const text = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test`;
    const mesh = parseSTL(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(mesh.triangleCount).toBe(1);
    expect(Array.from(mesh.positions)).toEqual(TRI);
    expect(Array.from(mesh.normals)).toEqual([0, 0, 1]);
  });

  /**
   * The case that makes a prefix sniff wrong: exporters put their own name in
   * the 80-byte header, and some of those names begin with "solid". Length
   * arithmetic is the only sound test, so it has to win.
   */
  it('reads a binary file whose header starts with the word solid', () => {
    const buf = binarySTL([TRI]);
    new Uint8Array(buf).set(new TextEncoder().encode('solid produced by something'), 0);
    expect(isBinarySTL(buf)).toBe(true);
    expect(parseSTL(buf).triangleCount).toBe(1);
  });

  it('rejects a binary file whose triangle count overruns the data', () => {
    const buf = binarySTL([TRI]);
    new DataView(buf).setUint32(80, 5000, true);
    expect(() => parseSTL(buf)).toThrow(STLParseError);
  });

  it('rejects non-finite coordinates in binary files', () => {
    const triangle = [...TRI];
    triangle[4] = Number.NaN;
    expect(() => parseSTL(binarySTL([triangle]))).toThrow(/not finite/);
  });

  it('rejects unsafe coordinate magnitudes', () => {
    const triangle = [...TRI];
    triangle[3] = 2e9;
    expect(() => parseSTL(binarySTL([triangle]))).toThrow(/supported range/);
  });

  it('rejects meshes whose vertices all coincide', () => {
    expect(() => parseSTL(binarySTL([[1, 2, 3, 1, 2, 3, 1, 2, 3]]))).toThrow(/coincide/);
  });

  it('rejects a zero-triangle binary file', () => {
    expect(() => parseSTL(binarySTL([]))).toThrow(/No triangles/);
  });

  it('rejects a file with no triangles in it', () => {
    const buf = new TextEncoder().encode('this is not an STL at all').buffer as ArrayBuffer;
    expect(() => parseSTL(buf)).toThrow(STLParseError);
  });

  it('rejects a truncated final facet rather than emitting a partial triangle', () => {
    const text = 'solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendfacet\n';
    expect(() => parseSTL(new TextEncoder().encode(text).buffer as ArrayBuffer)).toThrow(STLParseError);
  });

  it('tolerates an ascii file with no normals and unusual whitespace', () => {
    const text = 'solid\nfacet\nvertex 0 0 0\n\t vertex 1 0 0\n   vertex 0 1 0\nendfacet\nendsolid';
    const mesh = parseSTL(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(mesh.triangleCount).toBe(1);
  });

  it('rejects vertices outside facets instead of inventing triangles', () => {
    const text = 'solid bad vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 endsolid bad';
    expect(() => parseSTL(new TextEncoder().encode(text).buffer as ArrayBuffer)).toThrow(/outside a facet/);
  });

  it('rejects facets with the wrong number of vertices', () => {
    const text = `solid bad facet normal 0 0 1 outer loop
      vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 vertex 1 1 0
      endloop endfacet endsolid bad`;
    expect(() => parseSTL(new TextEncoder().encode(text).buffer as ArrayBuffer)).toThrow(/more than three vertices/);
  });

  it('rejects an unterminated ASCII facet', () => {
    const text = 'solid bad facet normal 0 0 1 vertex 0 0 0 vertex 1 0 0 vertex 0 1 0';
    expect(() => parseSTL(new TextEncoder().encode(text).buffer as ArrayBuffer)).toThrow(/missing endfacet/);
  });

  it('rejects an all-degenerate triangle set', () => {
    expect(() => parseSTL(binarySTL([[0, 0, 0, 1, 0, 0, 2, 0, 0]]))).toThrow(/Every triangle is degenerate/);
  });

  it('rejects oversized binary declarations before allocating vertex arrays', () => {
    const buf = new ArrayBuffer(84);
    new DataView(buf).setUint32(80, 60_001, true);
    expect(() => parseSTL(buf)).toThrow(/supported limit/);
  });

  it('fails arbitrary bounded input only with a parser error', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 2_048 }), (bytes) => {
      try {
        const copy = Uint8Array.from(bytes);
        parseSTL(copy.buffer);
      } catch (error) {
        expect(error).toBeInstanceOf(STLParseError);
      }
    }), { numRuns: 500 });
  });
});

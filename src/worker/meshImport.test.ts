import { describe, expect, it } from 'vitest';
import { parseMeshImport, reduceImportedMesh } from './meshImport';

const tetraOBJ = `
v 0 0 0
v 0 1 0
v 1 0 0
v 0 0 1
f 1 2 3
f 1 3 4
f 3 2 4
f 2 1 4
`;
const octaOBJ = `
v 1 0 0
v -1 0 0
v 0 1 0
v 0 -1 0
v 0 0 1
v 0 0 -1
f 5 1 3
f 5 3 2
f 5 2 4
f 5 4 1
f 6 3 1
f 6 2 3
f 6 4 2
f 6 1 4
`;

describe('mesh import preprocessing', () => {
  it('parses a closed OBJ with explicit bounded metadata', () => {
    const bytes = new TextEncoder().encode(tetraOBJ);
    const parsed = parseMeshImport(bytes.buffer, 'fixture.obj');
    expect(parsed.info).toEqual({ format: 'obj', triangleCount: 4, componentCount: 1, boundsMin: [0, 0, 0], boundsMax: [1, 1, 1] });
    expect(parsed.positions).toHaveLength(36);
  });

  it('rejects unsupported, malformed, and out-of-range preprocessing requests', () => {
    const bytes = new TextEncoder().encode(tetraOBJ);
    expect(() => parseMeshImport(bytes.buffer, 'fixture.ply')).toThrow(/STL or OBJ/);
    expect(() => parseMeshImport(new TextEncoder().encode('v 0 0 0\nf 1 2 3').buffer, 'bad.obj')).toThrow(/missing vertex/);
    const positions = parseMeshImport(bytes.buffer, 'fixture.obj').positions;
    expect(() => reduceImportedMesh(positions, 3)).toThrow(/outside/);
    expect(reduceImportedMesh(positions, 4)).not.toBe(positions);
  });

  it('performs an explicit topology-checked triangle reduction', () => {
    const parsed = parseMeshImport(new TextEncoder().encode(octaOBJ).buffer, 'octa.obj');
    const reduced = reduceImportedMesh(parsed.positions, 4);
    expect(reduced.length / 9).toBeLessThan(parsed.info.triangleCount);
    expect(reduced.length / 9).toBeGreaterThanOrEqual(4);
  });
});

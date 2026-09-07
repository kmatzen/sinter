import { describe, expect, it } from 'vitest';
import { estimateImportedMeshDeviation, parseMeshImport, reduceImportedMesh } from './meshImport';
import { strToU8, zipSync } from 'fflate';

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
    expect(parsed.info).toEqual({ format: 'obj', triangleCount: 4, componentCount: 1, boundsMin: [0, 0, 0], boundsMax: [1, 1, 1], unitScaleToMillimeters: 1, estimatedProjectBytes: 1216 });
    expect(parsed.positions).toHaveLength(36);
  });

  it('rejects unsupported, malformed, and out-of-range preprocessing requests', () => {
    const bytes = new TextEncoder().encode(tetraOBJ);
    expect(() => parseMeshImport(bytes.buffer, 'fixture.ply')).toThrow(/STL, OBJ, or 3MF/);
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
    expect(estimateImportedMeshDeviation(parsed.positions, reduced)).toBeGreaterThanOrEqual(0);
    expect(estimateImportedMeshDeviation(parsed.positions, parsed.positions)).toBe(0);
  });

  it('parses declared 3MF units, build transforms, and component objects', () => {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
      <model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
        <resources>
          <object id="1"><mesh><vertices>
            <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/>
          </vertices><triangles>
            <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/>
          </triangles></mesh></object>
          <object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></components></object>
        </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 3 0"/></build>
      </model>`;
    const archive = zipSync({ '3D/3dmodel.model': strToU8(model) });
    const parsed = parseMeshImport(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength), 'fixture.3mf');
    expect(parsed.info.format).toBe('3mf');
    expect(parsed.info.declaredUnit).toBe('inch');
    expect(parsed.info.unitScaleToMillimeters).toBe(25.4);
    expect(parsed.info.triangleCount).toBe(4);
    expect(parsed.info.boundsMin).toEqual([2, 3, 0]);
    expect(parsed.info.boundsMax).toEqual([3, 4, 1]);
  });

  it('bounds malformed and adversarial 3MF inputs', () => {
    expect(() => parseMeshImport(new Uint8Array([1, 2, 3]).buffer, 'bad.3mf')).toThrow(/ZIP container/);
    const entity = zipSync({ '3D/model.model': strToU8('<!DOCTYPE model [<!ENTITY x "boom">]><model><resources/></model>') });
    expect(() => parseMeshImport(entity.buffer.slice(entity.byteOffset, entity.byteOffset + entity.byteLength), 'entity.3mf')).toThrow(/entities/);
    expect(() => reduceImportedMesh(new Float32Array(70_000 * 9), 70_000)).toThrow(/3 MB stored mesh limit/);
  });
});

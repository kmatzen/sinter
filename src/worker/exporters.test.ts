import { describe, expect, it } from 'vitest';
import { export3MF, type MeshData } from './exporters';

const triangle = (offset = 0): MeshData => ({
  positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
});

const archiveText = (value: ArrayBuffer): string => new TextDecoder().decode(value);

describe('export3MF', () => {
  it('retains the legacy single-mesh form as one build object', () => {
    const xml = archiveText(export3MF(triangle()));
    expect(xml.match(/<object id="1" type="model">/g)).toHaveLength(1);
    expect(xml.match(/<item objectid="1" \/>/g)).toHaveLength(1);
  });

  it('encodes each component as a separately named build object', () => {
    const xml = archiveText(export3MF([
      { mesh: triangle(-10), name: 'Left & lower' },
      { mesh: triangle(10), name: 'Right' },
    ]));
    expect(xml).toContain('<object id="1" type="model" name="Left &amp; lower">');
    expect(xml).toContain('<object id="2" type="model" name="Right">');
    expect(xml).toContain('<item objectid="1" />');
    expect(xml).toContain('<item objectid="2" />');
    expect(xml).toContain('<vertex x="-10" y="0" z="0" />');
    expect(xml).toContain('<vertex x="10" y="0" z="0" />');
  });

  it('rejects an empty object collection', () => {
    expect(() => export3MF([])).toThrow(/at least one mesh object/i);
  });
});

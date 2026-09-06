import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DocumentDecodeError, MAX_DOCUMENT_DEPTH, decodeProjectDocument, decodeTree,
} from './documentDecoder';

const box = (id = 'box') => ({
  id, kind: 'box', label: 'Box',
  params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true,
});

describe('document decoder', () => {
  it('loads current and legacy project envelopes', () => {
    expect(decodeProjectDocument({ version: 1, thumbnail: null, tree: box() }).tree?.id).toBe('box');
    const legacy = decodeProjectDocument({ projectName: 'Old', tree: { kind: 'sphere', params: { radius: 4 }, children: [] } });
    expect(legacy).toMatchObject({ version: 1, projectName: 'Old', tree: { kind: 'sphere', label: 'Sphere', enabled: true } });
    expect(legacy.tree?.id).toBe('migrated-root');
  });

  it('rejects unknown future document versions deliberately', () => {
    expect(() => decodeProjectDocument({ version: 2, tree: box() })).toThrow(/version 2/);
  });

  it('rejects duplicate IDs, unknown kinds, and invalid arity', () => {
    const duplicate = {
      id: 'u', kind: 'union', label: 'Union', params: { smooth: 0 }, enabled: true,
      children: [box('same'), box('same')],
    };
    expect(() => decodeTree(duplicate)).toThrow(/duplicate node id/);
    expect(() => decodeTree({ ...box(), kind: 'futureSolid' })).toThrow(/kind is unknown/);
    expect(() => decodeTree({ ...box(), children: [box('child')] })).toThrow(/at most 0/);
    expect(decodeTree({
      id: 'shell', kind: 'shell', label: 'Shell', params: { thickness: 2 }, children: [], enabled: true,
    })?.children).toEqual([]);
  });

  it('rejects missing and non-finite current parameters while normalizing legacy values', () => {
    expect(() => decodeTree({ ...box(), params: { width: 1, height: 2 } })).toThrow(/depth is required/);
    expect(() => decodeTree({ ...box(), params: { width: Infinity, height: 2, depth: 3 } })).toThrow(/must be finite/);
    const legacy = decodeProjectDocument({ tree: { kind: 'sphere', params: { radius: -4 }, children: [] } });
    expect(legacy.tree?.params.radius).toBe(0.1);
  });

  it('rejects excessive depth before recursive consumers see it', () => {
    let tree: any = box('leaf');
    for (let i = 0; i <= MAX_DOCUMENT_DEPTH; i++) {
      tree = { id: `n-${i}`, kind: 'translate', label: 'Move', params: { x: 0, y: 0, z: 0 }, children: [tree], enabled: true };
    }
    expect(() => decodeTree(tree)).toThrow(/maximum depth/);
  });

  it('rejects malformed and non-finite imported mesh payloads', () => {
    const mesh = (meshPositions: string) => ({
      id: 'mesh', kind: 'mesh', label: 'Mesh', params: { resolution: 48 },
      data: { meshPositions, meshName: 'part.stl' }, children: [], enabled: true,
    });
    expect(() => decodeTree(mesh('not base64!'))).toThrow(/valid base64/);

    const values = new Float32Array(9);
    values[3] = NaN;
    let binary = '';
    for (const byte of new Uint8Array(values.buffer)) binary += String.fromCharCode(byte);
    expect(() => decodeTree(mesh(btoa(binary)))).toThrow(/non-finite/);
  });

  it('fails safely for arbitrary JSON-like input', () => {
    fc.assert(fc.property(fc.jsonValue({ maxDepth: 8 }), (value) => {
      try {
        const decoded = decodeTree(value, { repairMissingIds: true });
        return decoded === null || typeof decoded.id === 'string';
      } catch (error) {
        return error instanceof DocumentDecodeError;
      }
    }), { numRuns: 300 });
  });
});

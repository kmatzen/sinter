import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DocumentDecodeError, MAX_DOCUMENT_DEPTH, decodeProjectDocument, decodeTree,
} from './documentDecoder';
import { toSDFNode } from '../worker/sdf/convert';
import { evaluateSDF } from '../worker/sdf/evaluate';
import { computeBounds } from '../worker/sdf/bounds';
import { generateSDFFunction } from '../worker/sdf/codegen';

const box = (id = 'box') => ({
  id, kind: 'box', label: 'Box',
  params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true,
});

describe('document decoder', () => {
  it('loads current and legacy project envelopes', () => {
    expect(decodeProjectDocument({ version: 1, thumbnail: null, tree: box() }).tree?.id).toBe('box');
    const legacy = decodeProjectDocument({ projectName: 'Old', tree: { kind: 'sphere', params: { radius: 4 }, children: [] } });
    expect(legacy).toMatchObject({ version: 2, projectName: 'Old', checkpoints: [], tree: { kind: 'sphere', label: 'Sphere', enabled: true } });
    expect(legacy.tree?.id).toBe('migrated-root');
  });

  it('rejects unknown future document versions deliberately', () => {
    expect(() => decodeProjectDocument({ version: 3, tree: box() })).toThrow(/version 3/);
  });

  it('validates and loads bounded version checkpoints', () => {
    const decoded = decodeProjectDocument({
      version: 2, tree: box(), thumbnail: null,
      checkpoints: [{ id: 'v1', name: 'Before holes', createdAt: '2026-09-06T12:00:00.000Z', tree: box('old') }],
    });
    expect(decoded.checkpoints[0]).toMatchObject({ id: 'v1', name: 'Before holes', tree: { id: 'old' } });
    expect(() => decodeProjectDocument({ version: 2, tree: box(), checkpoints: [
      { id: 'same', name: 'A', createdAt: '2026-09-06T12:00:00Z', tree: box('a') },
      { id: 'same', name: 'B', createdAt: '2026-09-06T12:00:00Z', tree: box('b') },
    ] })).toThrow(/duplicated/);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), checkpoints: Array.from({ length: 11 }, (_, i) => ({
      id: String(i), name: 'Version', createdAt: '2026-09-06T12:00:00Z', tree: box(`b${i}`),
    })) })).toThrow(/at most 10/);
  });

  it('validates persistent formulas and resolves them at the document boundary', () => {
    const driven = { ...box(), expressions: { width: 'opening + 2 * wall' } };
    const decoded = decodeProjectDocument({
      version: 2, tree: driven, parameters: [
        { name: 'opening', expression: '20', unit: 'mm' },
        { name: 'wall', expression: '2', unit: 'mm' },
      ],
    });
    expect(decoded.tree?.params.width).toBe(24);
    expect(decoded.tree?.expressions?.width).toBe('opening + 2 * wall');
    expect(() => decodeProjectDocument({
      version: 2, tree: driven, parameters: [{ name: 'wall', expression: '2', unit: 'mm' }],
    })).toThrow(/Unknown parameter.*opening/);
  });

  it('round-trips bounded named project views and rejects unsafe camera state', () => {
    const view = {
      id: 'front-detail', name: 'Front detail', createdAt: '2026-09-06T12:00:00Z',
      position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0],
      projection: 'orthographic', verticalSpan: 42,
      clipping: { enabled: true, axis: 'z', position: 3, flip: false },
    };
    expect(decodeProjectDocument({ version: 2, tree: box(), views: [view] }).views[0]).toEqual(view);
    expect(decodeProjectDocument({ version: 1, tree: box(), views: [view] }).views).toEqual([]);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), views: [{ ...view, target: view.position }] })).toThrow(/position must differ/);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), views: [{ ...view, up: [0, 0, 1] }] })).toThrow(/parallel/);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), views: [{ ...view, up: [0, 0, -1] }] })).toThrow(/parallel/);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), views: [{ ...view, up: [0, 1e-8, 1] }] })).toThrow(/parallel/);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), views: [{ ...view, verticalSpan: Infinity }] })).toThrow(/verticalSpan/);
    expect(() => decodeProjectDocument({ version: 2, tree: box(), views: Array.from({ length: 21 }, (_, i) => ({ ...view, id: `v${i}` })) })).toThrow(/at most 20/);
  });

  it('round-trips checkpoint views while preserving the legacy absence marker', () => {
    const view = {
      id: 'detail', name: 'Detail', createdAt: '2026-09-06T12:00:00Z',
      position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0],
      projection: 'perspective', verticalSpan: 42,
      clipping: { enabled: false, axis: 'z', position: 0, flip: false },
    };
    const current = decodeProjectDocument({ version: 2, tree: box(), checkpoints: [
      { id: 'with-view', name: 'With view', createdAt: '2026-09-06T12:00:00Z', tree: box('old'), views: [view] },
    ] });
    expect(current.checkpoints[0].views).toEqual([view]);

    const legacy = decodeProjectDocument({ version: 2, tree: box(), checkpoints: [
      { id: 'legacy', name: 'Legacy', createdAt: '2026-09-06T12:00:00Z', tree: box('old') },
    ] });
    expect(legacy.checkpoints[0]).not.toHaveProperty('views');
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
    expect(() => decodeTree({ ...box(), params: { width: 1e20, height: 2, depth: 3 } })).toThrow(/does not require clamping/);
    expect(() => decodeTree({ ...box(), kind: 'torus', params: { majorRadius: 2, minorRadius: 3 } })).toThrow(/does not require clamping/);
    const legacy = decodeProjectDocument({ tree: { kind: 'sphere', params: { radius: -4 }, children: [] } });
    expect(legacy.tree?.params.radius).toBe(0.1);
  });

  it('canonicalizes equivalent current-document rotations without rejecting them', () => {
    const rotation = decodeTree({
      id: 'r', kind: 'rotate', label: 'Rotate', params: { x: 360, y: -720, z: 1_000_080 },
      children: [box()], enabled: true,
    });
    expect(rotation?.params).toEqual({ x: 0, y: 0, z: 0 });
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

    const openTriangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    binary = '';
    for (const byte of new Uint8Array(openTriangle.buffer)) binary += String.fromCharCode(byte);
    expect(() => decodeTree(mesh(btoa(binary)))).toThrow(/not a valid solid.*boundary edge/);
  });

  it('validates text outline containers, metrics, tags, coordinates, and count', () => {
    const text = (glyph: unknown) => ({
      id: 'text', kind: 'text', label: 'Text', params: { size: 10, depth: 2 },
      data: { text: 'A', glyphPaths: JSON.stringify(glyph) }, children: [], enabled: true,
    });
    const line = { type: 'L', x0: 0, y0: 0, x1: 5, y1: 10 };
    expect(() => decodeTree(text({ segs: 'bad', bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/outlines must be arrays/);
    expect(() => decodeTree(text({ segs: [{ ...line, type: 'C' }], bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/type must be L/);
    expect(() => decodeTree(text({ segs: [{ ...line, x1: '5' }], bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/x1 must be a bounded finite number/);
    expect(() => decodeTree(text({ segs: [{ ...line, x1: Infinity }], bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/x1 must be a bounded finite number/);
    expect(() => decodeTree(text({ segs: [{ ...line, z0: 1 }], bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/unsupported fields/);
    expect(() => decodeTree(text({ segs: [line], bezs: [], w: -5, a: 10, d: 0 }))).toThrow(/positive glyph box/);
    expect(() => decodeTree(text({ segs: [], bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/outline count/);
    expect(() => decodeTree(text({ segs: Array(20_001).fill(line), bezs: [], w: 5, a: 10, d: 0 }))).toThrow(/outline count/);
  });

  it('accepts generated glyph geometry that stays finite through every evaluator boundary', () => {
    const glyphPaths = JSON.stringify({
      segs: [
        { type: 'L', x0: 0, y0: 0, x1: 5, y1: 0 },
        { type: 'L', x0: 5, y0: 0, x1: 5, y1: 10 },
        { type: 'L', x0: 5, y0: 10, x1: 0, y1: 10 },
        { type: 'L', x0: 0, y0: 10, x1: 0, y1: 0 },
      ],
      bezs: [{ type: 'Q', x0: 0, y0: 0, x1: 2.5, y1: -1, x2: 5, y2: 0 }],
      w: 5, a: 10, d: 0,
    });
    const decoded = decodeTree({
      id: 'text', kind: 'text', label: 'Text', params: { size: 10, depth: 2 },
      data: { text: 'A', glyphPaths }, children: [], enabled: true,
    })!;
    expect(decoded.data?.glyphPaths).toBe(glyphPaths);
    const internal = toSDFNode(decoded)!;
    expect(Number.isFinite(evaluateSDF(internal, [0, 0, 0]))).toBe(true);
    expect([...computeBounds(internal).min, ...computeBounds(internal).max].every(Number.isFinite)).toBe(true);
    const compiled = generateSDFFunction(internal);
    expect(compiled.glsl).not.toMatch(/NaN|Infinity|undefined/);
    expect(compiled.paramValues.every(Number.isFinite)).toBe(true);
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

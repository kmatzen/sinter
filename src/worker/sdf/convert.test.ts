import { describe, expect, it } from 'vitest';
import { isTreeExportable, type SDFNodeUI } from '../../types/operations';
import { toSDFNode } from './convert';

function node(kind: string, children: SDFNodeUI[] = []): SDFNodeUI {
  return { id: kind, kind, label: kind, params: kind === 'sphere' ? { radius: 5 } : { smooth: 0 }, children, enabled: true };
}

const empty = (): SDFNodeUI => ({ id: 'empty', kind: '_empty', label: '', params: {}, children: [], enabled: false });

describe('boolean operand conversion', () => {
  it('never turns a lone subtract cutter into positive geometry', () => {
    const tree = node('subtract', [empty(), node('sphere')]);
    expect(toSDFNode(tree)).toBeNull();
    expect(isTreeExportable(tree)).toBe(false);
  });

  it('keeps a lone subtract stock as a warned diagnostic preview', () => {
    const tree = node('subtract', [node('sphere'), empty()]);
    expect(toSDFNode(tree)).toMatchObject({ kind: 'sphere', warn: true });
    expect(isTreeExportable(tree)).toBe(false);
  });
});

describe('chamfer conversion', () => {
  it('preserves its physical distance and child', () => {
    const child = node('sphere');
    const ui: SDFNodeUI = { id: 'c', kind: 'chamfer', label: 'Chamfer', params: { distance: 3 }, children: [child], enabled: true };
    expect(toSDFNode(ui)).toEqual({ kind: 'chamfer', distance: 3, child: { kind: 'sphere', radius: 5 } });
  });
});

describe('draft conversion', () => {
  it('preserves axis, signed angle, reference, and child', () => {
    const ui: SDFNodeUI = { id: 'd', kind: 'draft', label: 'Draft', params: { axis: 2, angle: -7, reference: 4 }, children: [node('sphere')], enabled: true };
    expect(toSDFNode(ui)).toEqual({ kind: 'draft', axis: 'z', angle: -7, reference: 4, child: { kind: 'sphere', radius: 5 } });
  });
});

describe('twist conversion', () => {
  it('preserves axis, signed angle, origin, extent, and child', () => {
    const ui: SDFNodeUI = { id: 't', kind: 'twist', label: 'Twist', params: { axis: 0, angle: -90, origin: 3, extent: 20 }, children: [node('sphere')], enabled: true };
    expect(toSDFNode(ui)).toEqual({ kind: 'twist', axis: 'x', angle: -90, origin: 3, extent: 20, child: { kind: 'sphere', radius: 5 } });
  });
});

describe('bend conversion', () => {
  it('preserves axes, signed angle, origin, extent, and child', () => {
    const ui: SDFNodeUI = { id: 'b', kind: 'bend', label: 'Bend', params: { axis: 2, direction: 0, angle: -60, origin: 3, extent: 20 }, children: [node('sphere')], enabled: true };
    expect(toSDFNode(ui)).toEqual({ kind: 'bend', axis: 'z', direction: 'x', angle: -60, origin: 3, extent: 20, child: { kind: 'sphere', radius: 5 } });
  });
});

describe('hull conversion', () => {
  it('builds bounded support planes for both children', () => {
    const ui: SDFNodeUI = { id: 'h', kind: 'hull', label: 'Hull', params: { detail: 12 }, children: [node('sphere'), node('sphere')], enabled: true };
    const converted = toSDFNode(ui);
    expect(converted).toMatchObject({ kind: 'hull', detail: 12 });
    expect(converted?.kind === 'hull' && converted.planes).toHaveLength(12);
  });
});

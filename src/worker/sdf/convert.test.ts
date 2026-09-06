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

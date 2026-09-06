import { describe, expect, it } from 'vitest';
import type { SDFNodeUI } from '../../types/operations';
import { filterNodeTree } from './NodeTreePanel';

const leaf = (id: string, kind: string, label: string): SDFNodeUI => ({
  id, kind, label, params: {}, children: [], enabled: true,
});

describe('filterNodeTree', () => {
  const tree: SDFNodeUI = {
    id: 'root', kind: 'union', label: 'Assembly', params: { smooth: 0 }, enabled: true,
    children: [
      leaf('body', 'box', 'Main body'),
      { id: 'moved', kind: 'translate', label: 'Fasteners', params: {}, enabled: true, children: [leaf('hole', 'cylinder', 'Mounting hole')] },
    ],
  };

  it('retains ancestors but prunes unrelated siblings for a deep name match', () => {
    const result = filterNodeTree(tree, 'mounting hole')!;
    expect(result.children.map((node) => node.id)).toEqual(['moved']);
    expect(result.children[0].children.map((node) => node.id)).toEqual(['hole']);
  });

  it('matches kind display names and all query terms case-insensitively', () => {
    expect(filterNodeTree(tree, 'MAIN box')?.children.map((node) => node.id)).toEqual(['body']);
    expect(filterNodeTree(tree, 'sphere')).toBeNull();
  });
});

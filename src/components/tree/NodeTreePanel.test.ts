import { describe, expect, it } from 'vitest';
import type { SDFNodeUI } from '../../types/operations';
import { filterNodeTree, groupedNodes } from './NodeTreePanel';

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

  it('matches group names and returns stable alphabetical group folders', () => {
    const grouped = {
      ...tree,
      children: [
        { ...tree.children[0], group: 'Shell' },
        { ...tree.children[1], group: 'Hardware', children: [{ ...tree.children[1].children[0], group: 'Hardware' }] },
      ],
    };
    expect(filterNodeTree(grouped, 'hardware')?.children.map((node) => node.id)).toEqual(['moved']);
    expect([...groupedNodes(grouped)].map(([name, nodes]) => [name, nodes.map((node) => node.id)])).toEqual([
      ['Hardware', ['moved', 'hole']],
      ['Shell', ['body']],
    ]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { useModelerStore } from './modelerStore';
import type { SDFNodeUI } from '../types/operations';
import { toSDFNode } from '../worker/sdf/convert';
import { evaluateSDF } from '../worker/sdf/evaluate';
import type { Vec3 } from '../worker/sdf/types';

type Wrapper = { kind: 'translate' | 'rotate' | 'scale'; x: number; y: number; z: number };

const finite = fc.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true });
const scale = fc.double({ min: 0.2, max: 4, noNaN: true, noDefaultInfinity: true });
const wrapper = fc.oneof(
  fc.record({ kind: fc.constant('translate' as const), x: finite, y: finite, z: finite }),
  fc.record({ kind: fc.constant('rotate' as const), x: finite, y: finite, z: finite }),
  fc.record({ kind: fc.constant('scale' as const), x: scale, y: scale, z: scale }),
);
const point = fc.tuple(finite, finite, finite) as fc.Arbitrary<Vec3>;

type RawNode = { kind: string; params: Record<string, number>; children: RawNode[] };
const rawTree = (depth: number): fc.Arbitrary<RawNode> => {
  const leaf = fc.oneof(
    fc.record({ kind: fc.constant('box'), width: scale, height: scale, depth: scale })
      .map((p) => ({ kind: 'box', params: { width: p.width, height: p.height, depth: p.depth }, children: [] })),
    scale.map((radius) => ({ kind: 'sphere', params: { radius }, children: [] })),
  );
  if (depth === 0) return leaf;
  const child = rawTree(depth - 1);
  const transform = fc.tuple(wrapper, child).map(([w, c]) => ({ kind: w.kind, params: { x: w.x, y: w.y, z: w.z }, children: [c] }));
  const boolean = fc.tuple(fc.constantFrom('union', 'subtract', 'intersect'), child, child)
    .map(([kind, a, b]) => ({ kind, params: { smooth: 0 }, children: [a, b] }));
  const modifier = fc.tuple(fc.constantFrom('round', 'offset', 'shell'), scale, child).map(([kind, value, c]): RawNode => {
    const params: Record<string, number> = kind === 'round' ? { radius: value }
      : kind === 'offset' ? { distance: value } : { thickness: value };
    return { kind, params, children: [c] };
  });
  return fc.oneof({ depthIdentifier: 'simplify-tree', maxDepth: depth }, leaf, transform, boolean, modifier);
};

function hydrate(raw: RawNode): SDFNodeUI {
  let next = 0;
  const visit = (node: RawNode): SDFNodeUI => ({
    id: `generated-${next++}`, kind: node.kind, label: node.kind, params: node.params,
    children: node.children.map(visit), enabled: true,
  });
  return visit(raw);
}

function treeOf(wrappers: Wrapper[]): SDFNodeUI {
  let tree: SDFNodeUI = {
    id: 'box', kind: 'box', label: 'Box', params: { width: 7, height: 9, depth: 11 }, children: [], enabled: true,
  };
  wrappers.forEach((item, index) => {
    tree = { id: `w-${index}`, kind: item.kind, label: item.kind, params: { x: item.x, y: item.y, z: item.z }, children: [tree], enabled: true };
  });
  return tree;
}

describe('simplifyTree field equivalence', () => {
  beforeEach(() => useModelerStore.setState({ tree: null, history: [null], parameterHistory: [[]], historyIndex: 0, namedParameters: [], historyTransaction: null }));

  it('preserves the evaluated field over generated valid transform trees', () => {
    fc.assert(fc.property(fc.array(wrapper, { maxLength: 14 }), fc.array(point, { minLength: 6, maxLength: 12 }), (wrappers, points) => {
      useModelerStore.getState().resetDocument(treeOf(wrappers));
      const before = toSDFNode(useModelerStore.getState().tree!);
      expect(before).not.toBeNull();
      useModelerStore.getState().simplifyTree();
      const after = toSDFNode(useModelerStore.getState().tree!);
      expect(after).not.toBeNull();
      for (const p of points) expect(evaluateSDF(after!, p)).toBeCloseTo(evaluateSDF(before!, p), 9);
    }), { numRuns: 150 });
  });

  it('preserves fields when simplifiable transforms sit inside booleans and modifiers', () => {
    fc.assert(fc.property(rawTree(3), fc.array(point, { minLength: 8, maxLength: 16 }), (raw, points) => {
      useModelerStore.getState().resetDocument(hydrate(raw));
      const before = toSDFNode(useModelerStore.getState().tree!);
      expect(before).not.toBeNull();
      useModelerStore.getState().simplifyTree();
      const simplified = useModelerStore.getState().tree;
      expect(simplified).not.toBeNull();
      const after = toSDFNode(simplified!);
      expect(after).not.toBeNull();
      for (const p of points) expect(evaluateSDF(after!, p)).toBeCloseTo(evaluateSDF(before!, p), 8);
    }), { numRuns: 100 });
  });

  it('commits the whole normalization as one undo entry', () => {
    const tree = treeOf([
      { kind: 'translate', x: 1, y: 2, z: 3 },
      { kind: 'translate', x: 4, y: 5, z: 6 },
      { kind: 'translate', x: 7, y: 8, z: 1 },
    ]);
    useModelerStore.getState().resetDocument(tree);
    useModelerStore.getState().simplifyTree();
    expect(useModelerStore.getState().history).toHaveLength(2);
    expect(useModelerStore.getState().tree!.children[0].kind).toBe('box');
    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree!.children[0].children[0].kind).toBe('translate');
  });
});

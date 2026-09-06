import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SDFNodeUI } from '../types/operations';
import { applyWorldSelectionDelta } from './GizmoController';

describe('multi-selection gizmo transforms', () => {
  it('applies one world delta in each selected node local space', () => {
    const tree: SDFNodeUI = {
      id: 'root', kind: 'union', label: 'Union', params: {}, enabled: true,
      children: [
        { id: 'a', kind: 'box', label: 'A', params: { width: 1, height: 1, depth: 1 }, enabled: true, children: [] },
        {
          id: 'parent', kind: 'rotate', label: 'Rotated', params: { x: 0, y: 0, z: 90 }, enabled: true,
          children: [{ id: 'b', kind: 'sphere', label: 'B', params: { radius: 1 }, enabled: true, children: [] }],
        },
      ],
    };
    const ids = new Map<string, [string, string, string]>([
      ['a', ['at', 'ar', 'as']],
      ['b', ['bt', 'br', 'bs']],
    ]);
    const moved = applyWorldSelectionDelta(
      tree,
      ['a', 'b'],
      new THREE.Matrix4().makeTranslation(10, 0, 0),
      ids,
    );

    expect(moved.children[0]).toMatchObject({ id: 'at', kind: 'translate', params: { x: 10, y: 0, z: 0 } });
    const localMove = moved.children[1].children[0];
    expect(localMove).toMatchObject({ id: 'bt', kind: 'translate' });
    expect(localMove.params.x).toBeCloseTo(0);
    expect(localMove.params.y).toBeCloseTo(-10);
    expect(localMove.children[0].children[0].children[0].id).toBe('b');
  });

  it('rotates separate nodes around the same explicit pivot without losing their ids', () => {
    const tree: SDFNodeUI = {
      id: 'root', kind: 'union', label: 'Union', params: {}, enabled: true,
      children: [
        { id: 'a', kind: 'box', label: 'A', params: {}, enabled: true, children: [] },
        { id: 'b', kind: 'sphere', label: 'B', params: {}, enabled: true, children: [] },
      ],
    };
    const ids = new Map<string, [string, string, string]>([
      ['a', ['at', 'ar', 'as']],
      ['b', ['bt', 'br', 'bs']],
    ]);
    const delta = new THREE.Matrix4()
      .makeTranslation(5, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeTranslation(-5, 0, 0));
    const rotated = applyWorldSelectionDelta(tree, ['a', 'b'], delta, ids);

    expect(rotated.children[0].params).toMatchObject({ x: 5, y: -5 });
    expect(rotated.children[0].children[0].params.z).toBeCloseTo(90);
    expect(JSON.stringify(rotated)).toContain('"id":"a"');
    expect(JSON.stringify(rotated)).toContain('"id":"b"');
  });
});

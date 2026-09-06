import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SDFNodeUI } from '../types/operations';
import { applyWorldSelectionDelta, selectionPivot, snapTranslationToObjects } from './GizmoController';

describe('multi-selection gizmo transforms', () => {
  it('resolves object, primary bounds, selection, and custom pivots explicitly', () => {
    const tree: SDFNodeUI = {
      id: 'root', kind: 'union', label: 'Union', params: {}, enabled: true,
      children: [
        { id: 'ta', kind: 'translate', label: 'A position', params: { x: 0, y: 0, z: 0 }, enabled: true, children: [
          { id: 'a', kind: 'box', label: 'A', params: { width: 2, height: 2, depth: 2 }, enabled: true, children: [] },
        ] },
        { id: 'tb', kind: 'translate', label: 'B position', params: { x: 10, y: 0, z: 0 }, enabled: true, children: [
          { id: 'b', kind: 'box', label: 'B', params: { width: 4, height: 2, depth: 2 }, enabled: true, children: [] },
        ] },
      ],
    };
    expect(selectionPivot(tree, ['a', 'b'], 'a', 'object-origin', [9, 8, 7]).toArray()).toEqual([0, 0, 0]);
    expect(selectionPivot(tree, ['a', 'b'], 'a', 'bounds-center', [9, 8, 7]).toArray()).toEqual([0, 0, 0]);
    expect(selectionPivot(tree, ['a', 'b'], 'a', 'selection-center', [9, 8, 7]).toArray()).toEqual([5.5, 0, 0]);
    expect(selectionPivot(tree, ['a', 'b'], 'a', 'custom', [9, 8, 7]).toArray()).toEqual([9, 8, 7]);
  });

  it('snaps to unselected bounds by projected pixel distance', () => {
    const tree: SDFNodeUI = {
      id: 'root', kind: 'union', label: 'Union', params: {}, enabled: true,
      children: [
        { id: 'a', kind: 'box', label: 'A', params: { width: 2, height: 2, depth: 2 }, enabled: true, children: [] },
        { id: 'tb', kind: 'translate', label: 'B position', params: { x: 10, y: 0, z: 0 }, enabled: true, children: [
          { id: 'b', kind: 'box', label: 'B', params: { width: 2, height: 2, depth: 2 }, enabled: true, children: [] },
        ] },
      ],
    };
    const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const near = snapTranslationToObjects(tree, ['a'], new THREE.Vector3(8.9, 0, 0), camera, { width: 1000, height: 1000 });
    expect(near?.position.toArray()).toEqual([9, 0, 0]);
    expect(near?.label).toContain('min X');
    expect(snapTranslationToObjects(tree, ['a'], new THREE.Vector3(7, 0, 0), camera, { width: 1000, height: 1000 })).toBeNull();
  });

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
    expect(localMove.children[0].id).toBe('b');
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

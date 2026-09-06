import { describe, it, expect, beforeEach } from 'vitest';
import { useModelerStore } from './modelerStore';
import { expectedChildren } from '../types/operations';
import type { SDFNodeUI } from '../types/operations';

/**
 * Counterexamples from `specs/NodeTree.tla`, replayed against the store.
 *
 * Each of these fails against the pre-#120 design and passes against the
 * repair described in specs/README.md. They are grouped by the invariant TLC
 * violated, and each `it` is one gesture sequence TLC produced.
 */

function reset() {
  useModelerStore.setState({
    tree: null,
    selectedNodeId: null,
    mesh: null,
    sdfDisplay: null,
    evaluating: false,
    error: null,
    projectName: 'Untitled',
    expandedNodes: new Set(),
    history: [null],
    historyIndex: 0,
    clipboard: null,
  });
}

const getState = () => useModelerStore.getState();

/** Every id in the tree, in traversal order — duplicates included. */
function allIds(node: SDFNodeUI | null): string[] {
  if (!node) return [];
  return [node.id, ...node.children.flatMap(allIds)];
}

/** IsATree: no id occupies two slots. */
function expectNoDuplicateIds(node: SDFNodeUI | null) {
  const ids = allIds(node);
  expect(ids).toHaveLength(new Set(ids).size);
}

/** WithinCapacity: nothing carries more children than `toSDFNode` will read. */
function expectWithinCapacity(node: SDFNodeUI | null) {
  if (!node) return;
  expect({ kind: node.kind, children: node.children.length })
    .toEqual({ kind: node.kind, children: Math.min(node.children.length, expectedChildren(node.kind)) });
  node.children.forEach(expectWithinCapacity);
}

describe('NodeTree.tla — IsATree', () => {
  beforeEach(reset);

  // TLC depth 5: AddPrimitive, AddPrimitive, DropOnNode, DragMove.
  //
  // `moveNode` removes the source with `removeFromTree`, which promotes a
  // sole child into the vacated slot (modelerStore.ts:141) — and then
  // re-attaches the source, still holding that child, under the target. The
  // child ends up in the document twice, under the same id.
  it('does not duplicate the source\'s only child when the source is dragged away', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere'); // union(box, sphere)
    const boxId = getState().tree!.children[0].id;
    const sphereId = getState().tree!.children[1].id;

    // Drop a subtract onto the box: union(subtract(box), sphere)
    getState().addNodeFromData(boxId, { kind: 'subtract', params: {} });
    const subtractId = getState().tree!.children[0].id;
    expect(getState().tree!.children[0].kind).toBe('subtract');

    getState().moveNode(subtractId, sphereId);

    expectNoDuplicateIds(getState().tree);
    expect(allIds(getState().tree).filter((id) => id === boxId)).toHaveLength(1);
  });
});

describe('NodeTree.tla — WithinCapacity', () => {
  beforeEach(reset);

  // TLC depth 2, the shortest counterexample in the whole model:
  // DropOnCanvas("Leaf"), DropOnNode("Prim").
  //
  // `addNodeFromData` asks `NODE_KINDS.primitives.includes(...)` of the drop
  // target but `expectedChildren(...) === 0` of the dropped node
  // (modelerStore.ts:413 vs :441). `text` and `mesh` answer no to the first
  // and yes to the second, so they fall to the `targetExpected === 0` branch
  // (:467) and are given a child that `toSDFNode` never reads.
  it('unions rather than parents when a shape is dropped on an imported mesh', () => {
    const tetra = new Float32Array([
      0, 0, 0, 0, 1, 0, 1, 0, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 1,
      1, 0, 0, 0, 1, 0, 0, 0, 1,
      0, 1, 0, 0, 0, 0, 0, 0, 1,
    ]);
    let binary = '';
    for (const byte of new Uint8Array(tetra.buffer)) binary += String.fromCharCode(byte);
    getState().addNodeFromData(null, {
      kind: 'mesh',
      params: { resolution: 48 },
      data: { meshName: 'part.stl', meshPositions: btoa(binary) },
    });
    const meshId = getState().tree!.id;

    getState().addNodeFromData(meshId, { kind: 'box', params: {} });

    expectWithinCapacity(getState().tree);
    // The box has to be somewhere the mesher will actually look at it.
    expect(allIds(getState().tree).length).toBeGreaterThan(1);
  });

  it('unions rather than parents when a shape is dropped on a text node', () => {
    getState().addNodeFromData(null, { kind: 'text', params: { size: 10, depth: 2 }, data: { text: 'hi' } });
    const textId = getState().tree!.id;

    getState().addNodeFromData(textId, { kind: 'sphere', params: {} });

    expectWithinCapacity(getState().tree);
  });

  // `moveNode` ends in `addChildPreferSlot` (modelerStore.ts:507) with no
  // check of the target's kind at all, so a drag can park a subtree under a
  // sphere.
  it('does not park a dragged node under a primitive', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere'); // union(box, sphere)
    const boxId = getState().tree!.children[0].id;
    const sphereId = getState().tree!.children[1].id;

    getState().moveNode(boxId, sphereId);

    expectWithinCapacity(getState().tree);
  });

  // `duplicateSelected` appends to the parent unconditionally (:560-563).
  // A union already holding two operands gets a third, which `toSDFNode`
  // reads neither of (convert.ts:101) and `incompleteNodeIds` does not flag
  // (operations.ts:109) — the shape is in the outline and not in the mesh.
  it('keeps a full union renderable when one of its operands is duplicated', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere'); // union(box, sphere) — full
    const boxId = getState().tree!.children[0].id;

    getState().selectNode(boxId);
    getState().duplicateSelected();

    expectWithinCapacity(getState().tree);
  });

  // Same append, reached through Cmd-V (:534-537).
  it('keeps a full union renderable when a node is pasted into it', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere'); // union(box, sphere) — full
    const unionId = getState().tree!.id;
    const boxId = getState().tree!.children[0].id;

    getState().selectNode(boxId);
    getState().copySelected();
    getState().selectNode(unionId);
    getState().pasteToSelected();

    expectWithinCapacity(getState().tree);
  });

  // Same append, reached through the store's addChildToSelected (:381).
  it('keeps a full union renderable when a child is added to it', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere'); // union(box, sphere) — full
    getState().selectNode(getState().tree!.id);

    getState().addChildToSelected('cylinder');

    expectWithinCapacity(getState().tree);
  });
});

describe('NodeTree.tla — NoSilentLoss', () => {
  beforeEach(reset);

  // TLC depth 5, `lost = {box}`.
  //
  // `removeFromTree` promotes a sole child only when `children.length === 1`
  // (modelerStore.ts:141) — and a boolean that has lost one operand still has
  // length 2, because the vacated slot holds an `_empty` placeholder (:151).
  // So deleting the union destroys the operand that is still in it, where
  // deleting a union that never lost an operand would have promoted it.
  it('promotes the surviving operand when a half-empty union is deleted', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere'); // union(box, sphere)
    const unionId = getState().tree!.id;
    const sphereId = getState().tree!.children[1].id;

    getState().removeNode(sphereId); // union(box, _empty)
    expect(getState().tree!.children[1].kind).toBe('_empty');

    getState().removeNode(unionId);

    expect(getState().tree).not.toBeNull();
    expect(getState().tree!.kind).toBe('box');
  });

  it('still promotes a sole operand when no slot was ever vacated', () => {
    getState().addNodeFromData(null, {
      kind: 'shell',
      params: { thickness: 2 },
      children: [{ kind: 'box', params: {} }],
    });
    getState().removeNode(getState().tree!.id);
    expect(getState().tree!.kind).toBe('box');
  });

  it('destroys both operands when a full union is deleted, as before', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere');
    getState().removeNode(getState().tree!.id);
    expect(getState().tree).toBeNull();
  });
});

describe('NodeTree.tla — SelectionValid', () => {
  beforeEach(reset);

  // TLC depth 4: the selected node is removed as collateral, but `removeNode`
  // only clears the selection when the selected id *is* the target
  // (modelerStore.ts:268).
  //
  // A dangling id is not cosmetic. `addNodeFromData` bails at `if
  // (!targetNode) return;` (:440), so with the palette pointed at a node that
  // no longer exists, clicking a shape does nothing at all.
  it('clears the selection when an ancestor of the selected node is removed', () => {
    getState().addNodeFromData(null, {
      kind: 'union',
      params: {},
      children: [
        { kind: 'subtract', params: {}, children: [{ kind: 'box', params: {} }, { kind: 'sphere', params: {} }] },
        { kind: 'cylinder', params: {} },
      ],
    });
    const subtractId = getState().tree!.children[0].id;
    const boxId = getState().tree!.children[0].children[0].id;

    getState().selectNode(boxId);
    getState().removeNode(subtractId);

    expect(getState().selectedNodeId).toBeNull();

    // And the palette works again: with no selection, a shape unions with the
    // root instead of vanishing.
    const before = allIds(getState().tree).length;
    getState().addNodeFromData(getState().selectedNodeId, { kind: 'torus', params: {} });
    expect(allIds(getState().tree).length).toBeGreaterThan(before);
  });

  it('keeps the selection when an unrelated branch is removed', () => {
    getState().addPrimitive('box');
    getState().addPrimitive('sphere');
    const boxId = getState().tree!.children[0].id;
    const sphereId = getState().tree!.children[1].id;

    getState().selectNode(boxId);
    getState().removeNode(sphereId);

    expect(getState().selectedNodeId).toBe(boxId);
  });
});

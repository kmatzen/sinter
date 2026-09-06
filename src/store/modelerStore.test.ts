import { describe, it, expect, beforeEach } from 'vitest';
import { effectiveNodeTransform, MAX_HISTORY_ENTRIES, useModelerStore } from './modelerStore';
import { isTreeValid } from '../types/operations';
import type { SDFNodeUI } from '../types/operations';
import { useViewportStore } from './viewportStore';
import { toSDFNode } from '../worker/sdf/convert';

// Reset store between tests
function reset() {
  useViewportStore.setState({ namedViews: [] });
  useModelerStore.setState({
    tree: null,
    selectedNodeIds: [],
    selectedNodeId: null,
    mesh: null,
    sdfDisplay: null,
    evaluating: false,
    error: null,
    projectName: 'Untitled',
    expandedNodes: new Set(),
    namedParameters: [],
    history: [null],
    parameterHistory: [[]],
    historyIndex: 0,
    historyTransaction: null,
    clipboard: null,
  });
}

function getState() {
  return useModelerStore.getState();
}


describe('Modeler editing scenarios', () => {
  beforeEach(reset);

  // ─── Scenario 1: Build a simple box ─────────────────────────────────
  describe('Scenario: Add a single box', () => {
    it('creates a box as root', () => {
      getState().addPrimitive('box');
      const { tree } = getState();
      expect(tree).not.toBeNull();
      expect(tree!.kind).toBe('box');
      expect(tree!.params.width).toBe(50);
      expect(tree!.children).toHaveLength(0);
      expect(isTreeValid(tree)).toBe(true);
    });

    it('selects the new box', () => {
      getState().addPrimitive('box');
      expect(getState().selectedNodeId).toBe(getState().tree!.id);
    });

    it('renames nodes as an undoable document change that round-trips', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().renameNode(id, '  Main enclosure  ');
      expect(getState().tree!.label).toBe('Main enclosure');

      getState().undo();
      expect(getState().tree!.label).toBe('Box');
      getState().redo();
      const json = getState().toJSON();
      reset();
      getState().fromJSON(json);
      expect(getState().tree!.label).toBe('Main enclosure');
      expect(getState().tree!.kind).toBe('box');
    });

    it('restores the type label for an empty rename and avoids no-op history', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      const before = getState().historyIndex;
      getState().renameNode(id, '   ');
      expect(getState().tree!.label).toBe('Box');
      expect(getState().historyIndex).toBe(before);
    });

    it('round-trips project unit preferences without changing geometry or history', () => {
      getState().addPrimitive('box');
      const tree = getState().tree;
      const historyIndex = getState().historyIndex;
      useViewportStore.getState().setUnitPreferences({ displayUnit: 'in', decimalPrecision: 4, fractionalDenominator: 32 });
      expect(getState().tree).toBe(tree);
      expect(getState().historyIndex).toBe(historyIndex);
      const json = getState().toJSON();
      useViewportStore.getState().setUnitPreferences({ displayUnit: 'mm', decimalPrecision: 2, fractionalDenominator: 16 });
      getState().fromJSON(json);
      expect(useViewportStore.getState()).toMatchObject({
        measurementUnit: 'in', measurementPrecision: 4, measurementFractionalDenominator: 32,
      });
      expect(getState().tree?.params).toEqual(tree?.params);
    });

    it('persists non-geometric groups and makes assignment undoable', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      const geometry = toSDFNode(getState().tree!);
      getState().setNodeGroup(id, '  Enclosure  ');
      expect(getState().tree!.group).toBe('Enclosure');
      expect(toSDFNode(getState().tree!)).toEqual(geometry);

      getState().undo();
      expect(getState().tree).not.toHaveProperty('group');
      getState().redo();
      const json = getState().toJSON();
      reset();
      getState().fromJSON(json);
      expect(getState().tree!.group).toBe('Enclosure');
    });

    it('renames every group member in one history entry', () => {
      getState().resetDocument({
        id: 'root', kind: 'union', label: 'Assembly', params: { smooth: 0 }, enabled: true,
        children: [
          { id: 'a', kind: 'box', label: 'A', group: 'Shell', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true },
          { id: 'b', kind: 'sphere', label: 'B', group: 'Shell', params: { radius: 1 }, children: [], enabled: true },
        ],
      });
      const before = getState().historyIndex;
      getState().renameGroup('Shell', 'Exterior');
      expect(getState().tree!.children.map((node) => node.group)).toEqual(['Exterior', 'Exterior']);
      expect(getState().historyIndex).toBe(before + 1);
      getState().undo();
      expect(getState().tree!.children.map((node) => node.group)).toEqual(['Shell', 'Shell']);
    });
  });

  describe('Scenario: parameter invariants', () => {
    it('clamps every live mutation through the node schema', () => {
      getState().addPrimitive('box');
      getState().updateNodeParams(getState().tree!.id, { width: -10 });
      expect(getState().tree!.params.width).toBe(0.1);
    });

    it('rejects a mixed finite/non-finite patch atomically', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().updateNodeParams(id, { width: 99, height: Number.NaN });
      expect(getState().tree!.params).toMatchObject({ width: 50, height: 30 });
      expect(getState().error).toBe('height must be a finite number');
    });

    it('normalizes whole-tree replacement paths such as AI and cloud loads', () => {
      getState().setTree({
        id: 'pattern', kind: 'linearPattern', label: 'Pattern',
        params: { count: -4, spacing: 0, axisX: 0, axisY: 0, axisZ: 0 }, enabled: true,
        children: [{ id: 'box', kind: 'box', label: 'Box', params: { width: Infinity, height: -1, depth: 2 }, children: [], enabled: true }],
      });
      expect(getState().tree!.params).toMatchObject({ count: 2, spacing: 0.1, axisX: 1 });
      expect(getState().tree!.children[0].params).toMatchObject({ width: 50, height: 0.1, depth: 2 });
    });
  });

  describe('Scenario: named parameters and formulas', () => {
    it('updates dependent geometry atomically and restores definitions with undo/redo', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().promoteNodeParam(id, 'width', 'outerWidth');
      expect(getState().tree!.expressions?.width).toBe('outerWidth');
      expect(getState().namedParameters).toEqual([{ name: 'outerWidth', expression: '50', unit: 'mm' }]);

      getState().setNamedParameters([{ name: 'outerWidth', expression: '75', unit: 'mm' }]);
      expect(getState().tree!.params.width).toBe(75);
      getState().undo();
      expect(getState().tree!.params.width).toBe(50);
      expect(getState().namedParameters[0].expression).toBe('50');
      getState().redo();
      expect(getState().tree!.params.width).toBe(75);
      expect(getState().namedParameters[0].expression).toBe('75');
    });

    it('rejects an invalid definition set without changing definitions or geometry', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().promoteNodeParam(id, 'width', 'width');
      const beforeTree = getState().tree;
      const beforeParameters = getState().namedParameters;
      getState().setNamedParameters([{ name: 'width', expression: 'missing + 2', unit: 'mm' }]);
      expect(getState().tree).toBe(beforeTree);
      expect(getState().namedParameters).toBe(beforeParameters);
      expect(getState().error).toMatch(/Unknown parameter/);
    });

    it('turns a driven property back into a literal when directly edited', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().promoteNodeParam(id, 'width', 'width');
      getState().updateNodeParams(id, { width: 60 });
      expect(getState().tree!.params.width).toBe(60);
      expect(getState().tree!.expressions).toBeUndefined();
    });

    it('rejects a literal edit that would invalidate another driven field', () => {
      getState().resetDocument({
        id: 't', kind: 'torus', label: 'Torus', params: { majorRadius: 20, minorRadius: 10 },
        expressions: { minorRadius: 'minor' }, children: [], enabled: true,
      }, 'Torus', [{ name: 'minor', expression: '10', unit: 'mm' }]);
      const before = getState().tree;
      getState().updateNodeParams('t', { majorRadius: 5 });
      expect(getState().tree).toBe(before);
      expect(getState().error).toMatch(/minorRadius.*outside its valid domain/);
    });

    it('round-trips formula sources and resolved values', () => {
      getState().addPrimitive('box');
      getState().promoteNodeParam(getState().tree!.id, 'width', 'width');
      const json = getState().toJSON();
      reset();
      getState().fromJSON(json);
      expect(getState().namedParameters[0].name).toBe('width');
      expect(getState().tree!.expressions?.width).toBe('width');
      expect(getState().tree!.params.width).toBe(50);
    });
  });

  // ─── Scenario 2: Build a box with a hole ────────────────────────────
  describe('Scenario: Box with cylindrical hole (subtract)', () => {
    it('builds the complete tree', () => {
      const s = getState();
      // Add first box
      s.addPrimitive('box');
      // Add a cylinder — should auto-wrap in union
      getState().addPrimitive('cylinder');
      const { tree } = getState();
      expect(tree!.kind).toBe('union');
      expect(tree!.children).toHaveLength(2);
      expect(tree!.children[0].kind).toBe('box');
      expect(tree!.children[1].kind).toBe('cylinder');
      expect(isTreeValid(tree)).toBe(true);

      // Change the union to subtract
      getState().changeNodeKind(tree!.id, 'subtract');
      const updated = getState().tree!;
      expect(updated.kind).toBe('subtract');
      expect(updated.children).toHaveLength(2);
      expect(isTreeValid(updated)).toBe(true);
    });
  });

  // ─── Scenario 3: Rounded enclosure ─────────────────────────────────
  describe('Scenario: Rounded enclosure with shell', () => {
    it('builds box → round → shell', () => {
      // Add box
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;

      // Select box, wrap in round
      getState().selectNode(boxId);
      getState().wrapSelected('round');
      expect(getState().tree!.kind).toBe('round');
      expect(getState().tree!.children[0].kind).toBe('box');

      // Select round, wrap in shell
      const roundId = getState().tree!.id;
      getState().selectNode(roundId);
      getState().wrapSelected('shell');
      expect(getState().tree!.kind).toBe('shell');
      expect(getState().tree!.children[0].kind).toBe('round');
      expect(getState().tree!.children[0].children[0].kind).toBe('box');
      expect(isTreeValid(getState().tree)).toBe(true);
    });

    it('allows parameter editing', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().updateNodeParams(boxId, { width: 74, height: 25, depth: 59 });
      expect(getState().tree!.params.width).toBe(74);

      getState().selectNode(boxId);
      getState().wrapSelected('round');
      const roundId = getState().tree!.id;
      getState().updateNodeParams(roundId, { radius: 3 });
      expect(getState().tree!.params.radius).toBe(3);
    });
  });

  // ─── Scenario 4: Undo/redo through edits ───────────────────────────
  describe('Scenario: Undo and redo', () => {
    it('undoes adding a primitive', () => {
      getState().addPrimitive('box');
      expect(getState().tree).not.toBeNull();

      getState().undo();
      expect(getState().tree).toBeNull();

      getState().redo();
      expect(getState().tree).not.toBeNull();
      expect(getState().tree!.kind).toBe('box');
    });

    it('undoes parameter changes', () => {
      getState().addPrimitive('sphere');
      const id = getState().tree!.id;
      getState().updateNodeParams(id, { radius: 42 });
      expect(getState().tree!.params.radius).toBe(42);

      getState().undo();
      expect(getState().tree!.params.radius).toBe(20); // default
    });

    it('clears a selection that the undone tree no longer contains', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      expect(getState().selectedNodeId).toBe(boxId);

      // Undo back past the box's creation — the selected node is gone.
      getState().undo();
      expect(getState().tree).toBeNull();
      expect(getState().selectedNodeId).toBeNull();
    });

    it('keeps a selection that survives the undo', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().updateNodeParams(boxId, { radius: 3 });
      getState().selectNode(boxId);

      getState().undo();
      expect(getState().tree!.id).toBe(boxId);
      expect(getState().selectedNodeId).toBe(boxId);
    });

    it('undoes wrap operation', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('shell');
      expect(getState().tree!.kind).toBe('shell');

      getState().undo();
      expect(getState().tree!.kind).toBe('box');
    });
  });

  // ─── Scenario 5: Delete nodes ──────────────────────────────────────
  describe('Scenario: Deleting nodes', () => {
    it('deletes root clears tree', () => {
      getState().addPrimitive('box');
      getState().removeNode(getState().tree!.id);
      expect(getState().tree).toBeNull();
    });

    it('deleting a child of a boolean preserves slot order', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      // tree is union(box, sphere)
      const boxId = getState().tree!.children[0].id;
      getState().removeNode(boxId);
      // Slot order preserved: empty placeholder at index 0, sphere at index 1
      expect(getState().tree!.kind).toBe('union');
      expect(getState().tree!.children).toHaveLength(2);
      expect(getState().tree!.children[0].kind).toBe('_empty');
      expect(getState().tree!.children[1].kind).toBe('sphere');
    });

    it('deleting a modifier promotes its child', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('shell');
      getState().removeNode(getState().tree!.id);
      // Shell removed, box promoted to root
      expect(getState().tree!.kind).toBe('box');
      expect(getState().tree!.id).toBe(boxId);
    });
  });

  // ─── Scenario 6: Copy/paste ────────────────────────────────────────
  describe('Scenario: Copy and paste', () => {
    it('copies and pastes a node', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().updateNodeParams(boxId, { width: 77 });

      getState().copySelected();
      expect(getState().clipboard).not.toBeNull();
      expect(getState().clipboard!.params.width).toBe(77);
    });

    it('duplicates a node', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().duplicateSelected();
      // Should be union(box, box)
      expect(getState().tree!.kind).toBe('union');
      expect(getState().tree!.children).toHaveLength(2);
      expect(getState().tree!.children[0].kind).toBe('box');
      expect(getState().tree!.children[1].kind).toBe('box');
      // IDs should be different
      expect(getState().tree!.children[0].id).not.toBe(getState().tree!.children[1].id);
    });
  });

  // ─── Scenario 7: Move nodes between parents ───────────────────────
  describe('Scenario: Move nodes via drag and drop', () => {
    it('moves a child from one parent to another', () => {
      // Build: subtract(box, sphere), then add a cylinder
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      getState().addPrimitive('cylinder');
      // Tree: union(union(box, sphere), cylinder)
      const root = getState().tree!;
      expect(root.kind).toBe('union');
      const innerUnion = root.children[0];
      const cylinder = root.children[1];

      // Move cylinder into the inner union. That union is already full, so
      // the cylinder cannot simply be appended -- `toSDFNode` reads two
      // operands and no more, and a third would vanish at mesh time with no
      // warning anywhere. It unions in place instead (#120, NodeTree.tla).
      getState().moveNode(cylinder.id, innerUnion.id);
      const updated = getState().tree!;
      const landed = updated.children[0];
      expect(landed.kind).toBe('union');
      expect(landed.children.map((c) => c.kind)).toEqual(['union', 'cylinder']);
      expect(landed.children[0].children.map((c) => c.kind)).toEqual(['box', 'sphere']);
      // The slot the cylinder left keeps its position, as it does on delete.
      expect(updated.children[1].kind).toBe('_empty');
    });
  });

  // ─── Scenario 8: Toggle node enable/disable ───────────────────────
  describe('Scenario: Enable/disable nodes', () => {
    it('toggles a node off and on', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      expect(getState().tree!.enabled).toBe(true);

      getState().toggleNode(id);
      expect(getState().tree!.enabled).toBe(false);

      getState().toggleNode(id);
      expect(getState().tree!.enabled).toBe(true);
    });

    it('records the toggle in history so undo reverts only the toggle', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().updateNodeParams(id, { radius: 7 });

      getState().toggleNode(id);
      expect(getState().tree!.enabled).toBe(false);

      // Undo should restore the enabled box with radius 7 — not discard the
      // parameter edit along with the toggle.
      getState().undo();
      expect(getState().tree!.enabled).toBe(true);
      expect(getState().tree!.params.radius).toBe(7);
    });

    it('keeps tree in sync with history[historyIndex] after a toggle', () => {
      getState().addPrimitive('box');
      getState().toggleNode(getState().tree!.id);

      const { tree, history, historyIndex } = getState();
      expect(history[historyIndex]).toEqual(tree);
    });

    it('redoes a toggle', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().toggleNode(id);
      getState().undo();
      expect(getState().tree!.enabled).toBe(true);

      getState().redo();
      expect(getState().tree!.enabled).toBe(false);
    });

    it('disabled nodes pass tree validation', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('subtract');
      // subtract has only 1 child (box) — normally invalid
      expect(isTreeValid(getState().tree)).toBe(false);

      // Disable the subtract — disabled nodes pass validation
      getState().toggleNode(getState().tree!.id);
      expect(isTreeValid(getState().tree)).toBe(true);
    });
  });

  // ─── Scenario 9: Change node kind ─────────────────────────────────
  describe('Scenario: Switch node types', () => {
    it('switches boolean from union to subtract', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      const unionId = getState().tree!.id;
      expect(getState().tree!.kind).toBe('union');

      getState().changeNodeKind(unionId, 'subtract');
      expect(getState().tree!.kind).toBe('subtract');
      // Children preserved
      expect(getState().tree!.children).toHaveLength(2);
    });

    it('switches primitive from box to sphere', () => {
      getState().addPrimitive('box');
      const id = getState().tree!.id;
      getState().changeNodeKind(id, 'sphere');
      expect(getState().tree!.kind).toBe('sphere');
      expect(getState().tree!.params.radius).toBe(20); // sphere default
    });
  });

  // ─── Scenario 10: Complex multi-step workflow ──────────────────────
  describe('Scenario: Arduino enclosure workflow', () => {
    it('builds enclosure step by step', () => {
      // 1. Add base box
      getState().addPrimitive('box');
      getState().updateNodeParams(getState().tree!.id, { width: 74, height: 25, depth: 59 });

      // 2. Round the edges
      getState().selectNode(getState().tree!.id);
      getState().wrapSelected('round');
      getState().updateNodeParams(getState().tree!.id, { radius: 3 });

      // 3. Shell it
      getState().selectNode(getState().tree!.id);
      getState().wrapSelected('shell');
      getState().updateNodeParams(getState().tree!.id, { thickness: 2 });

      // 4. Add a screw hole (subtract a cylinder)
      getState().addPrimitive('cylinder');
      // Tree is now: union(shell(round(box)), cylinder)
      const root = getState().tree!;
      expect(root.kind).toBe('union');

      // 5. Change union to subtract
      getState().changeNodeKind(root.id, 'subtract');

      // 6. Adjust cylinder
      const cylId = getState().tree!.children[1].id;
      getState().updateNodeParams(cylId, { radius: 1.6, height: 30 });

      // Verify final tree
      const final = getState().tree!;
      expect(final.kind).toBe('subtract');
      expect(final.children[0].kind).toBe('shell');
      expect(final.children[0].children[0].kind).toBe('round');
      expect(final.children[0].children[0].children[0].kind).toBe('box');
      expect(final.children[1].kind).toBe('cylinder');
      expect(final.children[1].params.radius).toBe(1.6);
      expect(isTreeValid(final)).toBe(true);

      // 7. Undo all the way back
      for (let i = 0; i < 10; i++) getState().undo();
      expect(getState().tree).toBeNull();

      // 8. Redo everything
      for (let i = 0; i < 10; i++) getState().redo();
      const restored = getState().tree!;
      expect(restored.kind).toBe('subtract');
      expect(restored.children[1].params.radius).toBe(1.6);
    });
  });

  // ─── Scenario 11: Tree validation ─────────────────────────────────
  describe('Scenario: Tree validation catches incomplete trees', () => {
    it('subtract with one child is invalid', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().wrapSelected('subtract');
      expect(getState().tree!.kind).toBe('subtract');
      expect(getState().tree!.children).toHaveLength(1);
      expect(isTreeValid(getState().tree)).toBe(false);
    });

    it('shell with no children is invalid', () => {
      // Create shell(box), then delete box
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('shell');
      // Delete the box child — shell now has no children
      // Actually removeNode promotes child, so delete the shell
      // Let's test differently: create a node manually
      const emptyShell = {
        id: 'test-shell', kind: 'shell', label: 'Shell',
        params: { thickness: 2 }, children: [] as any[], enabled: true,
      };
      useModelerStore.setState({ tree: emptyShell as any });
      expect(isTreeValid(getState().tree)).toBe(false);
    });

    it('complete tree passes validation', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      // union(box, sphere) — all slots filled
      expect(isTreeValid(getState().tree)).toBe(true);
    });
  });

  // ─── Scenario 13: Expanded node tracking ──────────────────────────
  describe('Scenario: Expand/collapse tree nodes', () => {
    it('toggles a single node expanded state', () => {
      getState().toggleExpanded('a');
      expect(getState().expandedNodes.has('a')).toBe(true);
      getState().toggleExpanded('a');
      expect(getState().expandedNodes.has('a')).toBe(false);
    });

    it('expandAll expands every node with children or expected children', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().wrapSelected('shell');
      const shellId = getState().tree!.id;
      const boxId = getState().tree!.children[0].id;

      getState().expandAll();
      expect(getState().expandedNodes.has(shellId)).toBe(true);
      expect(getState().expandedNodes.has(boxId)).toBe(false);
    });

    it('expandAll is a no-op with no tree', () => {
      getState().expandAll();
      expect(getState().expandedNodes.size).toBe(0);
    });

    it('collapseAll clears expanded nodes', () => {
      getState().toggleExpanded('a');
      getState().toggleExpanded('b');
      getState().collapseAll();
      expect(getState().expandedNodes.size).toBe(0);
    });

    it('selectNode auto-expands ancestors of the selected node', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().wrapSelected('shell');
      const shellId = getState().tree!.id;
      const boxId = getState().tree!.children[0].id;

      getState().collapseAll();
      getState().selectNode(boxId);
      expect(getState().expandedNodes.has(shellId)).toBe(true);
      expect(getState().selectedNodeId).toBe(boxId);
    });

    it('selectNode(null) just clears selection', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().selectNode(null);
      expect(getState().selectedNodeId).toBeNull();
    });
  });

  // ─── Scenario 14: Add child to selected node directly ─────────────
  describe('Scenario: Add child to selected node', () => {
    it('adds a child under the selected node and selects it', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().wrapSelected('union'); // union(box) — invalid but fine for the test
      const unionId = getState().tree!.id;
      getState().selectNode(unionId);
      getState().addChildToSelected('sphere');

      const union = getState().tree!;
      expect(union.children).toHaveLength(2);
      expect(union.children[1].kind).toBe('sphere');
      expect(getState().selectedNodeId).toBe(union.children[1].id);
      expect(getState().expandedNodes.has(unionId)).toBe(true);
    });

    it('is a no-op with no tree or no selection', () => {
      getState().addChildToSelected('box');
      expect(getState().tree).toBeNull();

      getState().addPrimitive('box');
      getState().selectNode(null);
      getState().addChildToSelected('sphere');
      expect(getState().tree!.kind).toBe('box');
    });
  });

  // ─── Scenario 15: Node data updates (e.g. text content) ───────────
  describe('Scenario: updateNodeData', () => {
    it('merges data fields onto a node', () => {
      getState().addPrimitive('text');
      const id = getState().tree!.id;
      getState().updateNodeData(id, { text: 'Hello' });
      expect(getState().tree!.data?.text).toBe('Hello');
    });

    it('is a no-op with no tree', () => {
      getState().updateNodeData('missing', { text: 'x' });
      expect(getState().tree).toBeNull();
    });
  });

  // ─── Scenario 16: Misc setters ─────────────────────────────────────
  describe('Scenario: Mesh/display/evaluating/error setters', () => {
    it('sets mesh, sdfDisplay, evaluating and error', () => {
      const mesh = { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() } as any;
      getState().setMesh(mesh);
      expect(getState().mesh).toBe(mesh);

      const display = { glsl: 'x', paramCount: 0, paramValues: [], textures: [], bbMin: [0, 0, 0], bbMax: [1, 1, 1], hasWarn: false } as any;
      getState().setSDFDisplay(display);
      expect(getState().sdfDisplay).toBe(display);

      getState().setEvaluating(true);
      expect(getState().evaluating).toBe(true);

      getState().setError('boom');
      expect(getState().error).toBe('boom');

      getState().setMesh(null);
      expect(getState().mesh).toBeNull();
      getState().setSDFDisplay(null);
      expect(getState().sdfDisplay).toBeNull();
      getState().setError(null);
      expect(getState().error).toBeNull();
    });
  });

  // ─── Scenario 17: addNodeFromData drag-and-drop paths ─────────────
  describe('Scenario: addNodeFromData', () => {
    it('rejects malformed external node data without changing the tree', () => {
      getState().addPrimitive('box');
      const before = getState().tree;
      getState().addNodeFromData(null, { kind: 'future-shape', params: {} });
      expect(getState().tree).toBe(before);
      expect(getState().error).toMatch(/validation failed/i);
    });

    it('becomes root when there is no tree', () => {
      getState().addNodeFromData(null, { kind: 'box', params: { width: 5, height: 5, depth: 5 } });
      expect(getState().tree!.kind).toBe('box');
    });

    it('unions a dropped primitive with the root when no target is given', () => {
      getState().addPrimitive('box');
      getState().addNodeFromData(null, { kind: 'sphere', params: { radius: 3 } });
      expect(getState().tree!.kind).toBe('union');
      expect(getState().tree!.children).toHaveLength(2);
    });

    it('ignores a dropped operation with no target on an existing tree', () => {
      getState().addPrimitive('box');
      getState().addNodeFromData(null, { kind: 'shell', params: { thickness: 2 } });
      expect(getState().tree!.kind).toBe('box');
    });

    it('does nothing if the target node cannot be found', () => {
      getState().addPrimitive('box');
      getState().addNodeFromData('does-not-exist', { kind: 'sphere', params: { radius: 3 } });
      expect(getState().tree!.kind).toBe('box');
    });

    it('wraps a primitive target when an operation is dropped on it', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().addNodeFromData(boxId, { kind: 'shell', params: { thickness: 2 } });
      expect(getState().tree!.kind).toBe('shell');
      expect(getState().tree!.children[0].kind).toBe('box');
    });

    it('wraps two primitives in a union when dropped on each other', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().addNodeFromData(boxId, { kind: 'sphere', params: { radius: 3 } });
      expect(getState().tree!.kind).toBe('union');
      expect(getState().tree!.children[0].kind).toBe('box');
      expect(getState().tree!.children[1].kind).toBe('sphere');
    });

    it('adds as a child when the target operation has room', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('subtract'); // subtract(box) has room for one more child
      const subId = getState().tree!.id;
      getState().addNodeFromData(subId, { kind: 'sphere', params: { radius: 3 } });
      expect(getState().tree!.children).toHaveLength(2);
      expect(getState().tree!.children[1].kind).toBe('sphere');
    });

    it('wraps a full operation target when another operation is dropped on it', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere'); // union(box, sphere) — full
      const unionId = getState().tree!.id;
      getState().addNodeFromData(unionId, { kind: 'shell', params: { thickness: 2 } });
      expect(getState().tree!.kind).toBe('shell');
      expect(getState().tree!.children[0].kind).toBe('union');
    });

    it('fills an empty slot when a primitive is dropped on a full operation', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere'); // union(box, sphere)
      const unionId = getState().tree!.id;
      getState().removeNode(getState().tree!.children[0].id); // union(_empty, sphere)
      getState().addNodeFromData(unionId, { kind: 'cylinder', params: { radius: 2, height: 4 } });
      expect(getState().tree!.children[0].kind).toBe('cylinder');
      expect(getState().tree!.children[1].kind).toBe('sphere');
    });

    it('hydrates nested children data recursively', () => {
      getState().addNodeFromData(null, {
        kind: 'shell',
        params: { thickness: 2 },
        children: [{ kind: 'box', params: { width: 1, height: 1, depth: 1 } }],
      });
      expect(getState().tree!.kind).toBe('shell');
      expect(getState().tree!.children[0].kind).toBe('box');
    });
  });

  // ─── Scenario 18: pasteToSelected ──────────────────────────────────
  describe('Scenario: pasteToSelected', () => {
    it('is a no-op with an empty clipboard', () => {
      getState().pasteToSelected();
      expect(getState().tree).toBeNull();
    });

    it('pastes as root when there is no tree', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().copySelected();
      getState().removeNode(getState().tree!.id);
      expect(getState().tree).toBeNull();

      getState().pasteToSelected();
      expect(getState().tree!.kind).toBe('box');
      expect(getState().selectedNodeId).toBe(getState().tree!.id);
    });

    it('is a no-op when a tree exists but nothing is selected', () => {
      getState().addPrimitive('box');
      getState().selectNode(getState().tree!.id);
      getState().copySelected();
      getState().selectNode(null);
      getState().pasteToSelected();
      expect(getState().tree!.children).toHaveLength(0);
    });

    it('pastes as a child of the selected node with a fresh id', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('union');
      const unionId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().copySelected();

      getState().selectNode(unionId);
      getState().pasteToSelected();

      const union = getState().tree!;
      expect(union.children).toHaveLength(2);
      expect(union.children[1].kind).toBe('box');
      expect(union.children[1].id).not.toBe(boxId);
      expect(getState().selectedNodeId).toBe(union.children[1].id);
    });
  });

  // ─── Scenario 19: duplicateSelected with no parent found ──────────
  describe('Scenario: duplicateSelected edge cases', () => {
    it('is a no-op with no tree or no selection', () => {
      getState().duplicateSelected();
      expect(getState().tree).toBeNull();
    });
  });

  // ─── Scenario 20: moveNode edge cases ──────────────────────────────
  describe('Scenario: moveNode guards', () => {
    it('is a no-op with no tree', () => {
      getState().moveNode('a', 'b');
      expect(getState().tree).toBeNull();
    });

    it('refuses to move a node into its own descendant', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('shell');
      const shellId = getState().tree!.id;
      getState().moveNode(shellId, boxId);
      expect(getState().tree!.kind).toBe('shell');
      expect(getState().tree!.children[0].id).toBe(boxId);
    });

    it('is a no-op when the source node cannot be found', () => {
      getState().addPrimitive('box');
      getState().moveNode('missing', getState().tree!.id);
      expect(getState().tree!.kind).toBe('box');
    });
  });

  // ─── Scenario 21: simplifyTree ─────────────────────────────────────
  describe('Scenario: simplifyTree', () => {
    it('removes disabled nodes', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      getState().toggleNode(getState().tree!.children[1].id); // disable sphere
      getState().simplifyTree();
      expect(getState().tree!.kind).toBe('box');
    });

    it('collapses identity translate/rotate/scale wrappers', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('translate'); // default translate params are 0,0,0
      getState().simplifyTree();
      expect(getState().tree!.kind).toBe('box');
    });

    it('collapses single-child booleans', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('union');
      getState().simplifyTree();
      expect(getState().tree!.kind).toBe('box');
    });

    it('removes empty modifiers and booleans', () => {
      const emptyShell = {
        id: 'empty-shell', kind: 'shell', label: 'Shell',
        params: { thickness: 2 }, children: [] as any[], enabled: true,
      };
      useModelerStore.setState({ tree: emptyShell as any });
      getState().simplifyTree();
      expect(getState().tree).toBeNull();
    });

    it('merges nested transforms of the same kind', () => {
      getState().addPrimitive('box');
      const boxId = getState().tree!.id;
      getState().selectNode(boxId);
      getState().wrapSelected('translate');
      getState().updateNodeParams(getState().tree!.id, { x: 5, y: 0, z: 0 });
      const innerId = getState().tree!.id;
      getState().selectNode(innerId);
      getState().wrapSelected('translate');
      getState().updateNodeParams(getState().tree!.id, { x: 10, y: 0, z: 0 });

      getState().simplifyTree();
      const result = getState().tree!;
      expect(result.kind).toBe('translate');
      expect(result.params.x).toBe(15);
      expect(result.children[0].kind).toBe('box');
    });

    it('retains nested rotations because component-wise addition changes geometry', () => {
      const box: SDFNodeUI = { id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true };
      const inner: SDFNodeUI = { id: 'inner', kind: 'rotate', label: 'Rotate', params: { x: 0, y: 90, z: 0 }, children: [box], enabled: true };
      const outer: SDFNodeUI = { id: 'outer', kind: 'rotate', label: 'Rotate', params: { x: 90, y: 0, z: 0 }, children: [inner], enabled: true };
      useModelerStore.setState({ tree: outer });
      getState().simplifyTree();
      expect(getState().tree!.kind).toBe('rotate');
      expect(getState().tree!.children[0].kind).toBe('rotate');
    });

    it('retains nested non-uniform scales because collapsing changes conservative fields', () => {
      const box: SDFNodeUI = { id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true };
      const inner: SDFNodeUI = { id: 'inner', kind: 'scale', label: 'Scale', params: { x: 4, y: 3, z: 2 }, children: [box], enabled: true };
      const outer: SDFNodeUI = { id: 'outer', kind: 'scale', label: 'Scale', params: { x: 2, y: 3, z: 4 }, children: [inner], enabled: true };
      const rounded: SDFNodeUI = { id: 'round', kind: 'round', label: 'Round', params: { radius: 2 }, children: [outer], enabled: true };
      getState().resetDocument(rounded);
      getState().simplifyTree();
      expect(getState().tree!.children[0].kind).toBe('scale');
      expect(getState().tree!.children[0].children[0].kind).toBe('scale');
    });

    it('preserves formula-driven identity transforms', () => {
      const box: SDFNodeUI = { id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true };
      const move: SDFNodeUI = {
        id: 'move', kind: 'translate', label: 'Translate', params: { x: 0, y: 0, z: 0 }, expressions: { x: 'offset' }, children: [box], enabled: true,
      };
      getState().resetDocument(move, 'Formula', [{ name: 'offset', expression: '0', unit: 'mm' }]);
      getState().simplifyTree();
      expect(getState().tree!.kind).toBe('translate');
      getState().setNamedParameters([{ name: 'offset', expression: '5', unit: 'mm' }]);
      expect(getState().tree!.params.x).toBe(5);
    });

    it('does not promote a lone subtract cutter into positive geometry', () => {
      const cutter: SDFNodeUI = { id: 'cutter', kind: 'sphere', label: 'Sphere', params: { radius: 5 }, children: [], enabled: true };
      const root: SDFNodeUI = {
        id: 'subtract', kind: 'subtract', label: 'Subtract', params: { smooth: 0 },
        children: [{ id: 'empty', kind: '_empty', label: '', params: {}, children: [], enabled: false }, cutter], enabled: true,
      };
      useModelerStore.setState({ tree: root });
      getState().simplifyTree();
      expect(getState().tree!.kind).toBe('subtract');
      expect(getState().tree!.children[0].kind).toBe('_empty');
      expect(getState().tree!.children[1].id).toBe('cutter');
      expect(isTreeValid(getState().tree)).toBe(false);
    });

    it('is a no-op with no tree', () => {
      getState().simplifyTree();
      expect(getState().tree).toBeNull();
    });
  });

  // ─── Scenario 22: undo/redo boundaries ─────────────────────────────
  describe('Scenario: undo/redo at history boundaries', () => {
    it('undo at the start of history is a no-op', () => {
      getState().undo();
      expect(getState().tree).toBeNull();
    });

    it('redo at the end of history is a no-op', () => {
      getState().addPrimitive('box');
      getState().redo();
      expect(getState().tree!.kind).toBe('box');
    });
  });

  // ─── Scenario 12: Serialization round-trip ────────────────────────
  describe('Scenario: Save and load project', () => {
    it('round-trips through JSON', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      getState().changeNodeKind(getState().tree!.id, 'subtract');
      getState().updateNodeParams(getState().tree!.children[0].id, { width: 100 });
      getState().setProjectName('Test Project');
      const savedView = {
        id: 'v1', name: 'Detail', createdAt: '2026-09-06T12:00:00Z',
        position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number],
        projection: 'perspective' as const, verticalSpan: 10,
        clipping: { enabled: false, axis: 'y' as const, position: 0, flip: false },
      };
      useViewportStore.setState({ namedViews: [savedView] });

      const json = getState().toJSON();
      reset();
      getState().fromJSON(json);

      expect(getState().projectName).toBe('Test Project');
      expect(getState().tree!.kind).toBe('subtract');
      expect(getState().tree!.children[0].params.width).toBe(100);
      expect(isTreeValid(getState().tree)).toBe(true);
      expect(useViewportStore.getState().namedViews).toEqual([savedView]);
    });
  });
});

describe('ordered multi-selection', () => {
  beforeEach(reset);

  const document = (): SDFNodeUI => ({
    id: 'root', kind: 'union', label: 'Union', params: {}, enabled: true,
    children: [
      { id: 'a', kind: 'box', label: 'A', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true },
      { id: 'b', kind: 'sphere', label: 'B', params: { radius: 1 }, children: [], enabled: true },
    ],
  });

  it('toggles nodes while tracking an explicit primary selection', () => {
    getState().resetDocument(document());
    getState().selectNode('a');
    getState().selectNode('b', 'toggle');
    expect(getState()).toMatchObject({ selectedNodeIds: ['a', 'b'], selectedNodeId: 'b' });
    getState().selectNode('b', 'toggle');
    expect(getState()).toMatchObject({ selectedNodeIds: ['a'], selectedNodeId: 'a' });
  });

  it('selects a deterministic preorder range and removes deleted ids safely', () => {
    getState().resetDocument(document());
    getState().selectNode('root');
    getState().selectNode('b', 'range');
    expect(getState().selectedNodeIds).toEqual(['root', 'a', 'b']);
    getState().removeNode('a');
    expect(getState().selectedNodeIds).toEqual(['root', 'b']);
    expect(getState().selectedNodeId).toBe('b');
  });

  it('deletes and restores a multi-selection in one undo step', () => {
    getState().resetDocument(document());
    getState().selectNode('a');
    getState().selectNode('b', 'toggle');
    getState().removeSelected();
    expect(getState().tree?.children.map((node) => node.kind)).toEqual([
      '_empty',
      '_empty',
    ]);
    expect(JSON.stringify(getState().tree)).not.toContain('"id":"a"');
    expect(JSON.stringify(getState().tree)).not.toContain('"id":"b"');
    expect(getState().history).toHaveLength(2);
    getState().undo();
    expect(getState().tree?.children.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('toggles every selected root atomically', () => {
    getState().resetDocument(document());
    getState().selectNode('a');
    getState().selectNode('b', 'toggle');
    getState().toggleSelected();
    expect(getState().tree?.children.map((node) => node.enabled)).toEqual([false, false]);
    expect(getState().history).toHaveLength(2);
    getState().undo();
    expect(getState().tree?.children.map((node) => node.enabled)).toEqual([true, true]);
  });

  it('duplicates all selected roots as one history entry and selects the copies', () => {
    getState().resetDocument(document());
    getState().selectNode('a');
    getState().selectNode('b', 'toggle');
    getState().duplicateSelected();
    expect(getState().history).toHaveLength(2);
    expect(getState().selectedNodeIds).toHaveLength(2);
    expect(getState().selectedNodeIds).not.toContain('a');
    expect(getState().selectedNodeIds).not.toContain('b');
    getState().undo();
    expect(getState().tree?.children.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('replaces selected sibling operands with a union in one history entry', () => {
    const subtract = document();
    subtract.kind = 'subtract';
    subtract.label = 'Subtract';
    getState().resetDocument(subtract);
    getState().selectNode('a');
    getState().selectNode('b', 'toggle');
    getState().unionSelected();

    expect(getState().tree?.kind).toBe('union');
    expect(getState().tree?.children.map((node) => node.id)).toEqual(['a', 'b']);
    expect(getState().selectedNodeIds).toEqual([getState().tree?.id]);
    expect(getState().history).toHaveLength(2);
    getState().undo();
    expect(getState().tree?.kind).toBe('subtract');
  });

  const positionedDocument = (): SDFNodeUI => ({
    id: 'assembly', kind: 'union', label: 'Assembly', params: {}, enabled: true,
    children: [
      { id: 'ta', kind: 'translate', label: 'A position', params: { x: 0, y: 0, z: 0 }, enabled: true, children: [
        { id: 'pa', kind: 'box', label: 'A', params: { width: 2, height: 2, depth: 2 }, enabled: true, children: [] },
      ] },
      { id: 'tb', kind: 'translate', label: 'B position', params: { x: 10, y: 0, z: 0 }, enabled: true, children: [
        { id: 'pb', kind: 'box', label: 'B', params: { width: 4, height: 2, depth: 2 }, enabled: true, children: [] },
      ] },
      { id: 'tc', kind: 'translate', label: 'C position', params: { x: 30, y: 0, z: 0 }, enabled: true, children: [
        { id: 'pc', kind: 'box', label: 'C', params: { width: 2, height: 2, depth: 2 }, enabled: true, children: [] },
      ] },
    ],
  });

  it('aligns world-space centers deterministically as one undo entry', () => {
    getState().resetDocument(positionedDocument());
    getState().selectNode('ta');
    getState().selectNode('tb', 'toggle');
    getState().selectNode('tc', 'toggle');
    getState().alignSelected('x', 'center');

    expect(getState().tree?.children.map((node) => node.params.x)).toEqual([15, 5, -15]);
    expect(getState().history).toHaveLength(2);
    getState().undo();
    expect(getState().tree?.children.map((node) => node.id)).toEqual(['ta', 'tb', 'tc']);
  });

  it('distributes bounding boxes with equal gaps independent of selection order', () => {
    getState().resetDocument(positionedDocument());
    getState().selectNode('tc');
    getState().selectNode('ta', 'toggle');
    getState().selectNode('tb', 'toggle');
    getState().distributeSelected('x');

    expect(getState().tree?.children.map((node) => node.params.x)).toEqual([0, 5, 30]);
    expect(getState().tree?.children[1].children[0].id).toBe('tb');
    expect(getState().history).toHaveLength(2);
  });

  it('converts world alignment deltas through rotated ancestors', () => {
    const tree: SDFNodeUI = {
      id: 'root', kind: 'union', label: 'Assembly', params: {}, enabled: true,
      children: [
        { id: 'a', kind: 'sphere', label: 'A', params: { radius: 1 }, enabled: true, children: [] },
        { id: 'r', kind: 'rotate', label: 'Quarter turn', params: { x: 0, y: 0, z: 90 }, enabled: true, children: [
          { id: 't', kind: 'translate', label: 'Offset', params: { x: 10, y: 0, z: 0 }, enabled: true, children: [
            { id: 'b', kind: 'sphere', label: 'B', params: { radius: 1 }, enabled: true, children: [] },
          ] },
        ] },
      ],
    };
    getState().resetDocument(tree);
    getState().selectNode('a');
    getState().selectNode('b', 'toggle');
    getState().alignSelected('y', 'min');

    const wrapper = getState().tree!.children[1].children[0].children[0];
    expect(wrapper.kind).toBe('translate');
    expect(wrapper.params.x).toBeCloseTo(-10);
    expect(wrapper.params.y).toBeCloseTo(0);
    expect(wrapper.children[0].id).toBe('b');
  });
});

describe('bounded structurally-shared history', () => {
  beforeEach(() => {
    const mesh: SDFNodeUI = {
      id: 'mesh', kind: 'mesh', label: 'Mesh', params: { resolution: 32 },
      children: [], enabled: true, data: { meshData: 'large-base64-payload' },
    };
    const root: SDFNodeUI = {
      id: 'move', kind: 'translate', label: 'Move', params: { x: 0, y: 0, z: 0 },
      children: [mesh], enabled: true,
    };
    getState().resetDocument(root, 'History');
  });

  it('shares untouched imported-mesh subtrees between snapshots', () => {
    getState().updateNodeParams('move', { x: 1 });
    getState().updateNodeParams('move', { x: 2 });
    const history = getState().history;

    expect(history[1]!.children[0]).toBe(history[2]!.children[0]);
    expect(history[0]!.children[0]).toBe(history[1]!.children[0]);
  });

  it('evicts the oldest entries while preserving a coherent undo cursor', () => {
    for (let x = 1; x <= 120; x++) getState().updateNodeParams('move', { x });

    expect(getState().history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(getState().historyIndex).toBe(MAX_HISTORY_ENTRIES - 1);
    for (let i = 1; i < MAX_HISTORY_ENTRIES; i++) getState().undo();
    expect(getState().tree!.params.x).toBe(21);
    getState().undo();
    expect(getState().tree!.params.x).toBe(21);
  });
});

/**
 * Swapping an imported mesh for the primitive fitted to it (#87) has to be one
 * history entry. As an insert plus a remove it was two, so undoing a fit took
 * two presses and the state in between had the mesh gone and the primitive not
 * yet back — a visibly broken tree the user did not ask for.
 */
describe('replaceNode', () => {
  const leaf = (id: string, kind = 'box'): SDFNodeUI => ({
    id, kind, label: kind, params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true,
  });

  beforeEach(() => {
    useModelerStore.setState({ tree: null, history: [null], historyIndex: 0, selectedNodeId: null });
  });

  it('swaps a nested node and takes one undo to put back', () => {
    const tree: SDFNodeUI = {
      id: 'u', kind: 'union', label: 'Union', params: { smooth: 0 },
      children: [leaf('a'), leaf('b')], enabled: true,
    };
    useModelerStore.setState({ tree, history: [tree], historyIndex: 0 });

    useModelerStore.getState().replaceNode('b', leaf('c', 'sphere'));

    const after = useModelerStore.getState().tree!;
    expect(after.children.map((n) => n.id)).toEqual(['a', 'c']);
    expect(useModelerStore.getState().selectedNodeId).toBe('c');

    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree!.children.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('swaps the root', () => {
    const tree = leaf('root');
    useModelerStore.setState({ tree, history: [tree], historyIndex: 0 });
    useModelerStore.getState().replaceNode('root', leaf('new', 'sphere'));
    expect(useModelerStore.getState().tree!.id).toBe('new');
    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree!.id).toBe('root');
  });
});

describe('interactive history transactions', () => {
  beforeEach(() => {
    useModelerStore.setState({
      tree: null,
      selectedNodeId: null,
      history: [null],
      historyIndex: 0,
      historyTransaction: null,
      expandedNodes: new Set(),
    });
  });

  it('keeps live parameter updates out of history and commits one final undo step', () => {
    const store = useModelerStore.getState();
    store.addPrimitive('box');
    const id = useModelerStore.getState().tree!.id;
    const before = useModelerStore.getState().history.length;

    useModelerStore.getState().beginHistoryTransaction();
    useModelerStore.getState().updateNodeParams(id, { width: 20 });
    useModelerStore.getState().updateNodeParams(id, { width: 30 });
    useModelerStore.getState().updateNodeParams(id, { width: 40 });

    expect(useModelerStore.getState().tree!.params.width).toBe(40);
    expect(useModelerStore.getState().history).toHaveLength(before);

    useModelerStore.getState().commitHistoryTransaction();
    expect(useModelerStore.getState().history).toHaveLength(before + 1);

    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree!.params.width).not.toBe(40);
    useModelerStore.getState().redo();
    expect(useModelerStore.getState().tree!.params.width).toBe(40);
  });

  it('does not commit a no-op interaction', () => {
    useModelerStore.getState().addPrimitive('box');
    const before = useModelerStore.getState().history.length;
    useModelerStore.getState().beginHistoryTransaction();
    useModelerStore.getState().commitHistoryTransaction();
    expect(useModelerStore.getState().history).toHaveLength(before);
  });

  it('restores the pre-interaction tree when cancelled', () => {
    useModelerStore.getState().addPrimitive('box');
    const id = useModelerStore.getState().tree!.id;
    const originalWidth = useModelerStore.getState().tree!.params.width;
    const before = useModelerStore.getState().history.length;

    useModelerStore.getState().beginHistoryTransaction();
    useModelerStore.getState().updateNodeParams(id, { width: 99 });
    useModelerStore.getState().cancelHistoryTransaction();

    expect(useModelerStore.getState().tree!.params.width).toBe(originalWidth);
    expect(useModelerStore.getState().history).toHaveLength(before);
  });

  it('collapses wrapping and movement into the same undo step', () => {
    useModelerStore.getState().addPrimitive('box');
    const before = useModelerStore.getState().history.length;
    useModelerStore.getState().beginHistoryTransaction();
    useModelerStore.getState().wrapSelected('translate');
    const wrapper = useModelerStore.getState().selectedNodeId!;
    useModelerStore.getState().updateNodeParams(wrapper, { x: 12 });
    useModelerStore.getState().commitHistoryTransaction();

    expect(useModelerStore.getState().history).toHaveLength(before + 1);
    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree!.kind).toBe('box');
    useModelerStore.getState().redo();
    expect(useModelerStore.getState().tree!.kind).toBe('translate');
    expect(useModelerStore.getState().tree!.params.x).toBe(12);
  });
});

describe('document boundaries', () => {
  beforeEach(reset);

  it('establishes entry zero and clears every document-scoped transient', () => {
    getState().addPrimitive('box');
    const oldId = getState().tree!.id;
    getState().selectNode(oldId);
    getState().toggleExpanded(oldId);
    getState().copySelected();
    getState().beginHistoryTransaction();
    useModelerStore.setState({
      mesh: {} as never,
      sdfDisplay: {} as never,
      evaluating: true,
      error: 'old evaluation failed',
    });
    const incoming: SDFNodeUI = {
      id: 'incoming', kind: 'sphere', label: 'Sphere', params: { radius: 7 }, children: [], enabled: true,
    };

    getState().resetDocument(incoming, 'Incoming');

    const state = getState();
    expect(state.tree).toEqual(incoming);
    expect(state.projectName).toBe('Incoming');
    expect(state.selectedNodeId).toBeNull();
    expect(state.expandedNodes.size).toBe(0);
    expect(state.mesh).toBeNull();
    expect(state.sdfDisplay).toBeNull();
    expect(state.evaluating).toBe(false);
    expect(state.error).toBeNull();
    expect(state.history).toEqual([incoming]);
    expect(state.historyIndex).toBe(0);
    expect(state.historyTransaction).toBeNull();
    expect(state.clipboard).toBeNull();

    getState().undo();
    expect(getState().tree).toEqual(incoming);
  });
});

describe('effective world transforms', () => {
  beforeEach(reset);

  it('reads and edits a nested object in world space with one history entry', () => {
    const box: SDFNodeUI = { id: 'box', kind: 'box', label: 'Box', params: { width: 2, height: 2, depth: 2 }, children: [], enabled: true };
    const localMove: SDFNodeUI = { id: 'local', kind: 'translate', label: 'Local', params: { x: 2, y: 0, z: 0 }, children: [box], enabled: true };
    const rotate: SDFNodeUI = { id: 'rotate', kind: 'rotate', label: 'Rotate', params: { x: 0, y: 0, z: 90 }, children: [localMove], enabled: true };
    const root: SDFNodeUI = { id: 'root', kind: 'translate', label: 'Root', params: { x: 5, y: 0, z: 0 }, children: [rotate], enabled: true };
    getState().resetDocument(root);
    getState().selectNode('box');
    const before = getState().historyIndex;

    const initial = effectiveNodeTransform(getState().tree!, 'box')!;
    expect(initial.position[0]).toBeCloseTo(5);
    expect(initial.position[1]).toBeCloseTo(2);
    getState().setEffectiveNodeTransform('box', { ...initial, position: [5, 7, 0] });

    expect(getState().historyIndex).toBe(before + 1);
    expect(getState().selectedNodeId).toBe('box');
    const updated = effectiveNodeTransform(getState().tree!, 'box')!;
    expect(updated.position[0]).toBeCloseTo(5);
    expect(updated.position[1]).toBeCloseTo(7);
    getState().undo();
    expect(effectiveNodeTransform(getState().tree!, 'box')!.position[1]).toBeCloseTo(2);
  });
});

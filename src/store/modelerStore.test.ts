import { describe, it, expect, beforeEach } from 'vitest';
import { useModelerStore } from './modelerStore';
import { isTreeValid } from '../types/operations';

// Reset store between tests
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

    it('deleting a child of a boolean leaves remaining child', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      // tree is union(box, sphere)
      const sphereId = getState().tree!.children[1].id;
      getState().removeNode(sphereId);
      // Union with 1 child should have only the box left
      // removeFromTree filters out null children
      expect(getState().tree!.kind).toBe('union');
      expect(getState().tree!.children).toHaveLength(1);
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

      // Move cylinder into the inner union
      getState().moveNode(cylinder.id, innerUnion.id);
      const updated = getState().tree!;
      expect(updated.children[0].children).toHaveLength(3);
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

  // ─── Scenario 12: Serialization round-trip ────────────────────────
  describe('Scenario: Save and load project', () => {
    it('round-trips through JSON', () => {
      getState().addPrimitive('box');
      getState().addPrimitive('sphere');
      getState().changeNodeKind(getState().tree!.id, 'subtract');
      getState().updateNodeParams(getState().tree!.children[0].id, { width: 100 });
      getState().setProjectName('Test Project');

      const json = getState().toJSON();
      reset();
      getState().fromJSON(json);

      expect(getState().projectName).toBe('Test Project');
      expect(getState().tree!.kind).toBe('subtract');
      expect(getState().tree!.children[0].params.width).toBe(100);
      expect(isTreeValid(getState().tree)).toBe(true);
    });
  });
});

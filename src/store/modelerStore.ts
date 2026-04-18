import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { SDFNodeUI } from '../types/operations';
import { NODE_LABELS, NODE_DEFAULTS, NODE_KINDS, expectedChildren } from '../types/operations';
import type { TriangulatedMesh } from '../types/geometry';

export interface SDFDisplayData {
  glsl: string;
  paramCount: number;
  paramValues: number[];
  textures: { name: string; width: number; height: number; data: number[] }[];
  bbMin: [number, number, number];
  bbMax: [number, number, number];
  hasWarn: boolean;
}

interface ModelerState {
  tree: SDFNodeUI | null;
  selectedNodeId: string | null;
  mesh: TriangulatedMesh | null;
  sdfDisplay: SDFDisplayData | null;
  evaluating: boolean;
  error: string | null;
  projectName: string;
  expandedNodes: Set<string>;

  // History
  history: (SDFNodeUI | null)[];
  historyIndex: number;

  // Actions
  setTree: (tree: SDFNodeUI | null) => void;
  selectNode: (id: string | null) => void;
  updateNodeParams: (id: string, params: Record<string, number>) => void;
  updateNodeData: (id: string, data: Record<string, string>) => void;
  changeNodeKind: (id: string, kind: string) => void;
  removeNode: (id: string) => void;
  toggleNode: (id: string) => void;
  toggleExpanded: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  addPrimitive: (kind: string) => void;
  wrapSelected: (kind: string) => void;
  addChildToSelected: (kind: string) => void;
  addNodeFromData: (parentId: string | null, nodeData: any) => void;
  setMesh: (mesh: TriangulatedMesh | null) => void;
  setSDFDisplay: (data: SDFDisplayData | null) => void;
  setEvaluating: (v: boolean) => void;
  setError: (e: string | null) => void;
  setProjectName: (name: string) => void;
  moveNode: (sourceId: string, targetId: string) => void;
  clipboard: SDFNodeUI | null;
  copySelected: () => void;
  pasteToSelected: () => void;
  duplicateSelected: () => void;
  simplifyTree: () => void;
  undo: () => void;
  redo: () => void;
  toJSON: () => string;
  fromJSON: (json: string) => void;
}

function createNode(kind: string, children: SDFNodeUI[] = []): SDFNodeUI {
  const node: SDFNodeUI = {
    id: uuidv4(),
    kind,
    label: NODE_LABELS[kind] || kind,
    params: { ...NODE_DEFAULTS[kind] },
    children,
    enabled: true,
  };
  return node;
}

function cloneTree(node: SDFNodeUI): SDFNodeUI {
  return JSON.parse(JSON.stringify(node));
}

function findNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// Apply an update to a node by ID, returning a new tree (immutable)
function updateInTree(tree: SDFNodeUI, id: string, updater: (node: SDFNodeUI) => SDFNodeUI): SDFNodeUI {
  if (tree.id === id) return updater(tree);
  return {
    ...tree,
    children: tree.children.map((child) => updateInTree(child, id, updater)),
  };
}

// A placeholder that occupies a boolean slot without producing geometry.
// The tree UI renders it as an empty slot and the SDF converter skips it.
function emptySlot(): SDFNodeUI {
  return { id: uuidv4(), kind: '_empty', label: '', params: {}, children: [], enabled: false };
}

function removeFromTree(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) {
    // If this node has exactly one child, promote the child
    if (tree.children.length === 1) return tree.children[0];
    return null;
  }

  const mapped = tree.children.map((child) => removeFromTree(child, id));

  let newChildren: SDFNodeUI[];
  if (NODE_KINDS.booleans.includes(tree.kind as any)) {
    // For booleans, preserve slot positions: replace removed children with
    // disabled placeholder nodes so the remaining operand keeps its index.
    newChildren = mapped.map((c) => c ?? emptySlot());
  } else {
    newChildren = mapped.filter((c): c is SDFNodeUI => c !== null);
  }

  return { ...tree, children: newChildren };
}

/** Add a child to a node, replacing the first _empty placeholder if one exists. */
function addChildPreferSlot(node: SDFNodeUI, child: SDFNodeUI): SDFNodeUI {
  const emptyIdx = node.children.findIndex(c => c.kind === '_empty');
  if (emptyIdx >= 0) {
    const updated = [...node.children];
    updated[emptyIdx] = child;
    return { ...node, children: updated };
  }
  return { ...node, children: [...node.children, child] };
}

function reassignIds(node: SDFNodeUI): SDFNodeUI {
  return {
    ...node,
    id: uuidv4(),
    children: node.children.map(reassignIds),
  };
}

function findParentOf(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const found = findParentOf(child, id);
    if (found) return found;
  }
  return null;
}

export const useModelerStore = create<ModelerState>()((set, get) => ({
  tree: null,
  selectedNodeId: null,
  mesh: null,
  sdfDisplay: null,
  evaluating: false,
  error: null,
  projectName: 'Untitled',
  expandedNodes: new Set<string>(),
  history: [null],
  historyIndex: 0,

  setTree: (tree) => {
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(tree ? cloneTree(tree) : null);
    set({
      tree,
      selectedNodeId: null,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  selectNode: (id) => {
    if (id) {
      // Auto-expand ancestors so the selected node is visible in the tree
      const { tree, expandedNodes } = get();
      if (tree) {
        const next = new Set(expandedNodes);
        let changed = false;
        const expand = (node: SDFNodeUI): boolean => {
          if (node.id === id) return true;
          for (const child of node.children) {
            if (expand(child)) {
              if (!next.has(node.id)) { next.add(node.id); changed = true; }
              return true;
            }
          }
          return false;
        };
        expand(tree);
        if (changed) {
          set({ selectedNodeId: id, expandedNodes: next });
          return;
        }
      }
    }
    set({ selectedNodeId: id });
  },

  updateNodeParams: (id, params) => {
    const { tree } = get();
    if (!tree) return;
    const newTree = updateInTree(tree, id, (node) => ({
      ...node,
      params: { ...node.params, ...params },
    }));
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({ tree: newTree, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  updateNodeData: (id, data) => {
    const { tree } = get();
    if (!tree) return;
    const newTree = updateInTree(tree, id, (node) => ({
      ...node,
      data: { ...node.data, ...data },
    }));
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({ tree: newTree, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  changeNodeKind: (id, kind) => {
    const { tree } = get();
    if (!tree) return;
    const defaults = NODE_DEFAULTS[kind] || {};
    const newTree = updateInTree(tree, id, (node) => ({
      ...node,
      kind,
      label: NODE_LABELS[kind] || kind,
      params: { ...defaults },
    }));
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({ tree: newTree, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  removeNode: (id) => {
    const { tree } = get();
    if (!tree) return;
    const newTree = removeFromTree(tree, id);
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(newTree ? cloneTree(newTree) : null);
    set({
      tree: newTree,
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  toggleNode: (id) => {
    const { tree } = get();
    if (!tree) return;
    const newTree = updateInTree(tree, id, (node) => ({ ...node, enabled: !node.enabled }));
    set({ tree: newTree });
  },

  toggleExpanded: (id) => {
    const { expandedNodes } = get();
    const next = new Set(expandedNodes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expandedNodes: next });
  },

  expandAll: () => {
    const { tree } = get();
    if (!tree) return;
    const ids = new Set<string>();
    const walk = (node: SDFNodeUI) => {
      if (node.children.length > 0 || expectedChildren(node.kind) > 0) ids.add(node.id);
      node.children.forEach(walk);
    };
    walk(tree);
    set({ expandedNodes: ids });
  },

  collapseAll: () => {
    set({ expandedNodes: new Set<string>() });
  },

  addPrimitive: (kind) => {
    const { tree } = get();
    const newNode = createNode(kind);
    if (!tree) {
      // First node becomes the root
      const state = get();
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(cloneTree(newNode));
      set({
        tree: newNode,
        selectedNodeId: newNode.id,
        history: newHistory,
        historyIndex: newHistory.length - 1,
      });
    } else {
      // Auto-wrap current tree in a union with the new primitive
      const unionNode = createNode('union', [tree, newNode]);
      const expanded = new Set(get().expandedNodes);
      expanded.add(unionNode.id);
      const state = get();
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(cloneTree(unionNode));
      set({
        tree: unionNode,
        selectedNodeId: newNode.id,
        expandedNodes: expanded,
        history: newHistory,
        historyIndex: newHistory.length - 1,
      });
    }
  },

  wrapSelected: (kind) => {
    const { tree, selectedNodeId } = get();
    if (!tree || !selectedNodeId) return;
    const target = findNode(tree, selectedNodeId);
    if (!target) return;

    // Translate wraps outside (world-space positioning makes more sense outermost).
    // Rotate and scale insert inside (closer to primitives for local operations).
    const isTransform = ['translate', 'rotate', 'scale'].includes(target.kind);
    const insertInside = isTransform && target.children.length > 0 && kind !== 'translate';
    let wrapper: SDFNodeUI;
    let newTree: SDFNodeUI;

    if (insertInside) {
      // Insert inside: wrap the target's child, keep target as parent
      const innerWrapper = createNode(kind, target.children.map(cloneTree));
      newTree = updateInTree(tree, target.id, (node) => ({
        ...node,
        children: [innerWrapper],
      }));
      wrapper = innerWrapper;
    } else {
      // Wrap the target itself (translate always wraps outside)
      wrapper = createNode(kind, [cloneTree(target)]);
      if (tree.id === selectedNodeId) {
        newTree = wrapper;
      } else {
        newTree = updateInTree(tree, selectedNodeId, () => wrapper);
      }
    }

    const expanded = new Set(get().expandedNodes);
    expanded.add(wrapper.id);
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({
      tree: newTree,
      selectedNodeId: wrapper.id,
      expandedNodes: expanded,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  addChildToSelected: (kind) => {
    const { tree, selectedNodeId } = get();
    if (!tree || !selectedNodeId) return;
    const target = findNode(tree, selectedNodeId);
    if (!target) return;

    const child = createNode(kind);
    const newTree = updateInTree(tree, selectedNodeId, (node) => ({
      ...node,
      children: [...node.children, child],
    }));

    const expanded = new Set(get().expandedNodes);
    expanded.add(selectedNodeId);
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({
      tree: newTree,
      selectedNodeId: child.id,
      expandedNodes: expanded,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  addNodeFromData: (targetId, nodeData) => {
    // Reconstruct a full SDFNodeUI from the palette's JSON data
    function hydrate(data: any): SDFNodeUI {
      return {
        id: uuidv4(),
        kind: data.kind,
        label: data.label || NODE_LABELS[data.kind] || data.kind,
        params: data.params || NODE_DEFAULTS[data.kind] || {},
        children: (data.children || []).map(hydrate),
        enabled: data.enabled !== false,
      };
    }
    const newNode = hydrate(nodeData);
    const { tree } = get();
    const isPrim = NODE_KINDS.primitives.includes(newNode.kind as any);
    const isOp = !isPrim; // boolean, modifier, transform, pattern

    // Helper to commit a new tree
    const commit = (newTree: SDFNodeUI, selectedId: string, extraExpanded?: string[]) => {
      const expanded = new Set(get().expandedNodes);
      if (extraExpanded) extraExpanded.forEach(id => expanded.add(id));
      const state = get();
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(cloneTree(newTree));
      set({ tree: newTree, selectedNodeId: selectedId, expandedNodes: expanded, history: newHistory, historyIndex: newHistory.length - 1 });
    };

    // No tree: new node becomes root
    if (!tree) {
      commit(newNode, newNode.id);
      return;
    }

    // No specific target (dropped on empty area): union with root
    if (!targetId) {
      if (isPrim) {
        const unionNode = createNode('union', [tree, newNode]);
        commit(unionNode, newNode.id, [unionNode.id]);
      }
      return;
    }

    // Dropped on a specific node
    const targetNode = findNode(tree, targetId);
    if (!targetNode) return;
    const targetIsPrim = NODE_KINDS.primitives.includes(targetNode.kind as any);
    const targetExpected = expectedChildren(targetNode.kind);
    const targetEmptySlot = targetNode.children.findIndex(c => c.kind === '_empty');
    const targetHasRoom = targetNode.children.length < targetExpected || targetEmptySlot >= 0;

    if (isOp && targetIsPrim) {
      // Operation dropped on a primitive → WRAP the primitive
      // The new operation becomes parent, the primitive becomes its child
      newNode.children = [cloneTree(targetNode)];
      let newTree: SDFNodeUI;
      if (tree.id === targetId) {
        newTree = newNode;
      } else {
        newTree = updateInTree(tree, targetId, () => newNode);
      }
      commit(newTree, newNode.id, [newNode.id]);
    } else if (isPrim && targetIsPrim) {
      // Primitive dropped on another primitive → wrap both in a Union
      const unionNode = createNode('union', [cloneTree(targetNode), newNode]);
      let newTree: SDFNodeUI;
      if (tree.id === targetId) {
        newTree = unionNode;
      } else {
        newTree = updateInTree(tree, targetId, () => unionNode);
      }
      commit(newTree, newNode.id, [unionNode.id]);
    } else if (targetHasRoom || targetExpected === 0) {
      // Target has room for children, or is a primitive somehow → add as child
      const newTree = updateInTree(tree, targetId, (node) => addChildPreferSlot(node, newNode));
      commit(newTree, newNode.id, [targetId]);
    } else if (isOp) {
      // Operation dropped on an operation that's full → wrap the target
      newNode.children = [cloneTree(targetNode)];
      let newTree: SDFNodeUI;
      if (tree.id === targetId) {
        newTree = newNode;
      } else {
        newTree = updateInTree(tree, targetId, () => newNode);
      }
      commit(newTree, newNode.id, [newNode.id]);
    } else {
      // Primitive on a full operation → replace empty slot or add as child
      const newTree = updateInTree(tree, targetId, (node) => addChildPreferSlot(node, newNode));
      commit(newTree, newNode.id, [targetId]);
    }
  },

  setMesh: (mesh) => set({ mesh }),
  setSDFDisplay: (sdfDisplay) => set({ sdfDisplay }),
  setEvaluating: (evaluating) => set({ evaluating }),
  setError: (error) => set({ error }),
  setProjectName: (projectName) => set({ projectName }),

  moveNode: (sourceId, targetId) => {
    const { tree } = get();
    if (!tree) return;
    // Don't move a node into itself or its descendants
    const sourceNode = findNode(tree, sourceId);
    if (!sourceNode) return;
    if (findNode(sourceNode, targetId)) return; // target is a descendant of source

    // Remove source from tree
    const treeWithout = removeFromTree(cloneTree(tree), sourceId);
    if (!treeWithout) return;

    // Add source as child of target
    const newTree = updateInTree(treeWithout, targetId, (node) => addChildPreferSlot(node, cloneTree(sourceNode)));

    const expanded = new Set(get().expandedNodes);
    expanded.add(targetId);
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({ tree: newTree, expandedNodes: expanded, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  clipboard: null,

  copySelected: () => {
    const { tree, selectedNodeId } = get();
    if (!tree || !selectedNodeId) return;
    const node = findNode(tree, selectedNodeId);
    if (node) set({ clipboard: cloneTree(node) });
  },

  pasteToSelected: () => {
    const { tree, selectedNodeId, clipboard } = get();
    if (!clipboard) return;
    const fresh = reassignIds(cloneTree(clipboard));
    if (!tree) {
      // Paste as root
      const newHistory = get().history.slice(0, get().historyIndex + 1);
      newHistory.push(cloneTree(fresh));
      set({ tree: fresh, selectedNodeId: fresh.id, history: newHistory, historyIndex: newHistory.length - 1 });
      return;
    }
    if (!selectedNodeId) return;
    // Add as child to selected node
    const newTree = updateInTree(tree, selectedNodeId, (node) => ({
      ...node,
      children: [...node.children, fresh],
    }));
    const expanded = new Set(get().expandedNodes);
    expanded.add(selectedNodeId);
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({ tree: newTree, selectedNodeId: fresh.id, expandedNodes: expanded, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  duplicateSelected: () => {
    const { tree, selectedNodeId } = get();
    if (!tree || !selectedNodeId) return;
    const node = findNode(tree, selectedNodeId);
    if (!node) return;
    const dupe = reassignIds(cloneTree(node));
    // If root, wrap in union
    if (tree.id === selectedNodeId) {
      const unionNode = createNode('union', [tree, dupe]);
      const expanded = new Set(get().expandedNodes);
      expanded.add(unionNode.id);
      const newHistory = get().history.slice(0, get().historyIndex + 1);
      newHistory.push(cloneTree(unionNode));
      set({ tree: unionNode, selectedNodeId: dupe.id, expandedNodes: expanded, history: newHistory, historyIndex: newHistory.length - 1 });
      return;
    }
    // Find parent, add dupe as sibling
    const parent = findParentOf(tree, selectedNodeId);
    if (!parent) return;
    const newTree = updateInTree(tree, parent.id, (p) => ({
      ...p,
      children: [...p.children, dupe],
    }));
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push(cloneTree(newTree));
    set({ tree: newTree, selectedNodeId: dupe.id, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  simplifyTree: () => {
    const { tree } = get();
    if (!tree) return;

    function simplify(node: SDFNodeUI): SDFNodeUI | null {
      // Remove disabled nodes
      if (!node.enabled) return null;

      // Recursively simplify children first
      const children = node.children
        .map(simplify)
        .filter((c): c is SDFNodeUI => c !== null);

      const simplified = { ...node, children };

      // Remove identity transforms
      if (simplified.kind === 'translate') {
        const p = simplified.params;
        if ((p.x || 0) === 0 && (p.y || 0) === 0 && (p.z || 0) === 0) {
          return children[0] || null;
        }
      }
      if (simplified.kind === 'rotate') {
        const p = simplified.params;
        if ((p.x || 0) === 0 && (p.y || 0) === 0 && (p.z || 0) === 0) {
          return children[0] || null;
        }
      }
      if (simplified.kind === 'scale') {
        const p = simplified.params;
        if ((p.x || 1) === 1 && (p.y || 1) === 1 && (p.z || 1) === 1) {
          return children[0] || null;
        }
      }

      // Collapse single-child booleans
      if (['union', 'subtract', 'intersect'].includes(simplified.kind) && children.length === 1) {
        return children[0];
      }

      // Remove booleans with no children
      if (['union', 'subtract', 'intersect'].includes(simplified.kind) && children.length === 0) {
        return null;
      }

      // Remove modifiers/patterns with no children
      if (['shell', 'offset', 'round', 'mirror', 'halfSpace', 'linearPattern', 'circularPattern'].includes(simplified.kind) && children.length === 0) {
        return null;
      }

      // Collapse nested transforms of the same kind
      if (['translate', 'rotate', 'scale'].includes(simplified.kind) && children.length === 1 && children[0].kind === simplified.kind) {
        const inner = children[0];
        if (simplified.kind === 'translate') {
          return {
            ...simplified,
            params: {
              x: (simplified.params.x || 0) + (inner.params.x || 0),
              y: (simplified.params.y || 0) + (inner.params.y || 0),
              z: (simplified.params.z || 0) + (inner.params.z || 0),
            },
            children: inner.children,
          };
        }
        if (simplified.kind === 'rotate') {
          return {
            ...simplified,
            params: {
              x: (simplified.params.x || 0) + (inner.params.x || 0),
              y: (simplified.params.y || 0) + (inner.params.y || 0),
              z: (simplified.params.z || 0) + (inner.params.z || 0),
            },
            children: inner.children,
          };
        }
        if (simplified.kind === 'scale') {
          return {
            ...simplified,
            params: {
              x: (simplified.params.x || 1) * (inner.params.x || 1),
              y: (simplified.params.y || 1) * (inner.params.y || 1),
              z: (simplified.params.z || 1) * (inner.params.z || 1),
            },
            children: inner.children,
          };
        }
      }

      return simplified;
    }

    // Run iteratively until stable (removing identity transforms may
    // expose adjacent same-kind transforms for collapsing)
    let result: SDFNodeUI | null = tree;
    for (let i = 0; i < 10; i++) {
      if (!result) break;
      const next = simplify(result);
      if (JSON.stringify(next) === JSON.stringify(result)) break;
      result = next;
    }

    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(result ? cloneTree(result) : null);
    set({ tree: result, selectedNodeId: null, history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      set({ tree: history[newIndex] ? cloneTree(history[newIndex]!) : null, historyIndex: newIndex });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      set({ tree: history[newIndex] ? cloneTree(history[newIndex]!) : null, historyIndex: newIndex });
    }
  },

  toJSON: () => {
    const { tree, projectName } = get();
    return JSON.stringify({ projectName, tree }, null, 2);
  },

  fromJSON: (json: string) => {
    const data = JSON.parse(json);
    set({
      projectName: data.projectName || 'Untitled',
      tree: data.tree || null,
      selectedNodeId: null,
      history: [data.tree ? cloneTree(data.tree) : null],
      historyIndex: 0,
    });
  },
}));

// Expose store for e2e tests
if (typeof window !== 'undefined') {
  (window as any).__MODELER_STORE__ = useModelerStore.getState();
  useModelerStore.subscribe((state) => {
    (window as any).__MODELER_STORE__ = state;
  });
}

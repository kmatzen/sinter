import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { SDFNodeUI } from '../types/operations';
import { NODE_LABELS, NODE_DEFAULTS } from '../types/operations';
import type { TriangulatedMesh } from '../types/geometry';

interface ModelerState {
  tree: SDFNodeUI | null;
  selectedNodeId: string | null;
  mesh: TriangulatedMesh | null;
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
  removeNode: (id: string) => void;
  toggleNode: (id: string) => void;
  toggleExpanded: (id: string) => void;
  addPrimitive: (kind: string) => void;
  wrapSelected: (kind: string) => void;
  addChildToSelected: (kind: string) => void;
  setMesh: (mesh: TriangulatedMesh | null) => void;
  setEvaluating: (v: boolean) => void;
  setError: (e: string | null) => void;
  setProjectName: (name: string) => void;
  undo: () => void;
  redo: () => void;
  toJSON: () => string;
  fromJSON: (json: string) => void;
}

function createNode(kind: string, children: SDFNodeUI[] = []): SDFNodeUI {
  return {
    id: uuidv4(),
    kind,
    label: NODE_LABELS[kind] || kind,
    params: { ...NODE_DEFAULTS[kind] },
    children,
    enabled: true,
  };
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

function removeFromTree(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) {
    // If this node has exactly one child, promote the child
    if (tree.children.length === 1) return tree.children[0];
    return null;
  }
  return {
    ...tree,
    children: tree.children
      .map((child) => removeFromTree(child, id))
      .filter((c): c is SDFNodeUI => c !== null),
  };
}

export const useModelerStore = create<ModelerState>()((set, get) => ({
  tree: null,
  selectedNodeId: null,
  mesh: null,
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

  selectNode: (id) => set({ selectedNodeId: id }),

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

    const wrapper = createNode(kind, [cloneTree(target)]);

    let newTree: SDFNodeUI;
    if (tree.id === selectedNodeId) {
      newTree = wrapper;
    } else {
      // Replace the target with the wrapper in the tree
      newTree = updateInTree(tree, selectedNodeId, () => wrapper);
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

  setMesh: (mesh) => set({ mesh }),
  setEvaluating: (evaluating) => set({ evaluating }),
  setError: (error) => set({ error }),
  setProjectName: (projectName) => set({ projectName }),

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

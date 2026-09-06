import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { SDFNodeUI } from '../types/operations';
import { NODE_LABELS, NODE_DEFAULTS, NODE_KINDS, expectedChildren } from '../types/operations';
import type { TriangulatedMesh } from '../types/geometry';
import { applyNodeParamPatch, normalizeNodeParams, normalizeTreeParams } from '../types/parameterSchema';

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
  /** Exact immutable tree object that produced sdfDisplay. */
  evaluatedTree: SDFNodeUI | null;
  /** Most recent tree revision whose evaluation succeeded, for recovery. */
  lastValidTree: SDFNodeUI | null;
  evaluating: boolean;
  error: string | null;
  projectName: string;
  expandedNodes: Set<string>;

  // History
  history: (SDFNodeUI | null)[];
  historyIndex: number;
  historyTransaction: {
    tree: SDFNodeUI | null;
    selectedNodeId: string | null;
    expandedNodes: Set<string>;
  } | null;

  // Actions
  setTree: (tree: SDFNodeUI | null) => void;
  resetDocument: (tree: SDFNodeUI | null, projectName?: string) => void;
  selectNode: (id: string | null) => void;
  updateNodeParams: (id: string, params: Record<string, number>) => void;
  updateNodeData: (id: string, data: Record<string, string>) => void;
  changeNodeKind: (id: string, kind: string) => void;
  removeNode: (id: string) => void;
  replaceNode: (id: string, replacement: SDFNodeUI) => void;
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
  beginHistoryTransaction: () => void;
  commitHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
  toJSON: () => string;
  fromJSON: (json: string) => void;
}

/** Keep long editing sessions bounded while retaining useful undo depth. */
export const MAX_HISTORY_ENTRIES = 100;

function createNode(kind: string, children: SDFNodeUI[] = []): SDFNodeUI {
  const node: SDFNodeUI = {
    id: uuidv4(),
    kind,
    label: NODE_LABELS[kind] || kind,
    params: normalizeNodeParams(kind, NODE_DEFAULTS[kind]),
    children,
    enabled: true,
  };
  return node;
}

function cloneTree(node: SDFNodeUI): SDFNodeUI {
  return JSON.parse(JSON.stringify(node));
}

/**
 * The selection to keep after the tree is replaced wholesale. Undo/redo can
 * restore a tree in which the selected node no longer exists; leaving the id
 * dangling makes every `findNode` consumer silently no-op.
 */
function surviving(tree: SDFNodeUI | null, selectedNodeId: string | null): string | null {
  if (!tree || !selectedNodeId) return null;
  return findNode(tree, selectedNodeId) ? selectedNodeId : null;
}

/**
 * Build the state patch that commits `tree` as a new document version.
 *
 * Truncates any redo entries ahead of the cursor, pushes a snapshot, and
 * advances the index. `extra` carries whatever view state the action also
 * sets (selection, expansion), so no action has to touch the history fields
 * directly.
 *
 * Every mutating action goes through this. The ritual used to be open-coded
 * at seventeen sites, and toggleNode simply omitted it -- leaving `tree` and
 * `history[historyIndex]` divergent, so an undo discarded one more edit than
 * the user asked for (#54). Routing through one place removes the chance to
 * forget.
 */
function commit(
  state: ModelerState,
  tree: SDFNodeUI | null,
  extra: Partial<ModelerState> = {},
): Partial<ModelerState> {
  if (state.historyTransaction) {
    const wanted = 'selectedNodeId' in extra ? extra.selectedNodeId ?? null : state.selectedNodeId;
    return { ...extra, selectedNodeId: surviving(tree, wanted), tree };
  }
  let history = state.history.slice(0, state.historyIndex + 1);
  // Trees are immutable: updateInTree replaces only the edited path. Keeping
  // those references preserves structural sharing, most importantly the large
  // base64 payload on imported-mesh nodes.
  history.push(tree);
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(history.length - MAX_HISTORY_ENTRIES);
  }
  // Clamp the selection to a node that still exists. `surviving` was already
  // doing this for undo and redo, and nothing else did: removing a node took
  // its descendants with it but only cleared the selection when the removed
  // id *was* the selected one (#120). A selected id that points at nothing
  // makes addNodeFromData bail at `if (!targetNode) return` -- so the palette
  // stops responding, with no visible reason why.
  const wanted = 'selectedNodeId' in extra ? extra.selectedNodeId ?? null : state.selectedNodeId;
  return {
    ...extra,
    selectedNodeId: surviving(tree, wanted),
    tree,
    history,
    historyIndex: history.length - 1,
  };
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

/**
 * Detach `id` from the tree.
 *
 * With `promote` (a delete), a node holding a single *real* operand hands it
 * up into the vacated slot, so removing a wrapper does not take the shape
 * inside it. Counting `_empty` placeholders as operands here is what made a
 * boolean that had already lost one child destroy the other one: it still had
 * `children.length === 2`, so the survivor was never promoted (#120).
 *
 * Without `promote` (a move), the subtree leaves whole. `moveNode` re-attaches
 * it elsewhere, so promoting anything out of it would put that child in the
 * document twice, under one id.
 */
function removeFromTree(tree: SDFNodeUI, id: string, promote = true): SDFNodeUI | null {
  if (tree.id === id) {
    if (!promote) return null;
    const real = tree.children.filter((c) => c.kind !== '_empty');
    return real.length === 1 ? real[0] : null;
  }

  const mapped = tree.children.map((child) => removeFromTree(child, id, promote));

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

/** Does this node have somewhere to put another child? */
function hasRoom(node: SDFNodeUI): boolean {
  return node.children.some(c => c.kind === '_empty')
    || node.children.length < expectedChildren(node.kind);
}

/**
 * The one way a child gets attached to a parent.
 *
 * Fill a slot an earlier delete vacated; else append if the kind still has
 * room; else the parent is full, so it is replaced in place by a union of
 * itself and the newcomer.
 *
 * That last case is the whole point. Every call site used to append
 * regardless -- move, duplicate, paste, add-child and two branches of the
 * palette drop -- and `toSDFNode` reads `children[0]` and `children[1]` and
 * nothing after (convert.ts:97-165). A third operand under a union, or any
 * child of a `text` or `mesh`, was silently dropped at mesh time. Nor did the
 * outline warn: `incompleteNodeIds` only flags nodes with too *few* children
 * (operations.ts:109). The shape was in the tree and simply not in the model.
 *
 * Unioning in place is not a new idea in the UI -- it is what `addPrimitive`
 * does to the root, and what dropping a shape on a shape already did.
 *
 * Verified as `Attach` in specs/NodeTreeFixed.tla.
 */
function attachChild(tree: SDFNodeUI, parentId: string, child: SDFNodeUI): SDFNodeUI {
  const parent = findNode(tree, parentId);
  if (!parent) return tree;

  if (hasRoom(parent)) {
    return updateInTree(tree, parentId, (node) => {
      const emptyIdx = node.children.findIndex(c => c.kind === '_empty');
      if (emptyIdx >= 0) {
        const updated = [...node.children];
        updated[emptyIdx] = child;
        return { ...node, children: updated };
      }
      return { ...node, children: [...node.children, child] };
    });
  }

  const union = createNode('union', [cloneTree(parent), child]);
  return tree.id === parentId ? union : updateInTree(tree, parentId, () => union);
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
  evaluatedTree: null,
  lastValidTree: null,
  evaluating: false,
  error: null,
  projectName: 'Untitled',
  expandedNodes: new Set<string>(),
  history: [null],
  historyIndex: 0,
  historyTransaction: null,

  setTree: (tree) => {
    set(commit(get(), normalizeTreeParams(tree), { selectedNodeId: null }));
  },

  resetDocument: (tree, projectName = 'Untitled') => {
    const normalized = normalizeTreeParams(tree);
    const snapshot = normalized ? cloneTree(normalized) : null;
    set({
      tree: snapshot,
      projectName,
      selectedNodeId: null,
      expandedNodes: new Set<string>(),
      mesh: null,
      sdfDisplay: null,
      evaluatedTree: null,
      lastValidTree: null,
      evaluating: false,
      error: null,
      history: [snapshot],
      historyIndex: 0,
      historyTransaction: null,
      clipboard: null,
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
    let error: string | undefined;
    const newTree = updateInTree(tree, id, (node) => {
      const result = applyNodeParamPatch(node, params);
      error = result.error;
      return result.params ? { ...node, params: result.params } : node;
    });
    if (error) { set({ error }); return; }
    set(commit(get(), newTree));
  },

  updateNodeData: (id, data) => {
    const { tree } = get();
    if (!tree) return;
    const newTree = updateInTree(tree, id, (node) => ({
      ...node,
      data: { ...node.data, ...data },
    }));
    set(commit(get(), newTree));
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
    set(commit(get(), newTree));
  },

  removeNode: (id) => {
    const { tree } = get();
    if (!tree) return;
    // No selection bookkeeping here: `commit` clamps it to a node that still
    // exists, which also covers removing an *ancestor* of the selected node.
    set(commit(get(), removeFromTree(tree, id)));
  },

  /**
   * Swap one node for another in place, as a single history entry.
   *
   * Doing it as an insert followed by a remove would be two, so undoing a
   * primitive fit would take two presses and leave a visibly broken tree in
   * between — the mesh gone and the primitive not yet back.
   */
  replaceNode: (id, replacement) => {
    const { tree } = get();
    if (!tree) return;
    const normalized = normalizeTreeParams(replacement)!;
    if (tree.id === id) {
      set(commit(get(), normalized, { selectedNodeId: normalized.id }));
      return;
    }
    const newTree = updateInTree(tree, id, () => normalized);
    set(commit(get(), newTree, { selectedNodeId: normalized.id }));
  },

  toggleNode: (id) => {
    const { tree } = get();
    if (!tree) return;
    // Disabling a node changes the rendered geometry and the exported mesh, so
    // this is a document mutation and belongs in history like any other.
    const newTree = updateInTree(tree, id, (node) => ({ ...node, enabled: !node.enabled }));
    set(commit(get(), newTree));
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
      set(commit(get(), newNode, { selectedNodeId: newNode.id }));
    } else {
      // Auto-wrap current tree in a union with the new primitive
      const unionNode = createNode('union', [tree, newNode]);
      const expanded = new Set(get().expandedNodes);
      expanded.add(unionNode.id);
      set(commit(get(), unionNode, { selectedNodeId: newNode.id, expandedNodes: expanded }));
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
    set(commit(get(), newTree, { selectedNodeId: wrapper.id, expandedNodes: expanded }));
  },

  addChildToSelected: (kind) => {
    const { tree, selectedNodeId } = get();
    if (!tree || !selectedNodeId) return;
    const target = findNode(tree, selectedNodeId);
    if (!target) return;

    const child = createNode(kind);
    const newTree = attachChild(tree, selectedNodeId, child);

    const expanded = new Set(get().expandedNodes);
    expanded.add(selectedNodeId);
    set(commit(get(), newTree, { selectedNodeId: child.id, expandedNodes: expanded }));
  },

  addNodeFromData: (targetId, nodeData) => {
    // Reconstruct a full SDFNodeUI from the palette's JSON data
    function hydrate(data: any): SDFNodeUI {
      return {
        id: uuidv4(),
        kind: data.kind,
        label: data.label || NODE_LABELS[data.kind] || data.kind,
        params: normalizeNodeParams(data.kind, data.params),
        // `data` carries what params cannot: a text node's glyph outlines, an
        // imported mesh's geometry. Dropping it here turned an imported STL
        // into an empty node — and had been doing the same to text.
        ...(data.data ? { data: { ...data.data } } : {}),
        children: (data.children || []).map(hydrate),
        enabled: data.enabled !== false,
      };
    }
    const newNode = hydrate(nodeData);
    const { tree } = get();
    // "Takes no children", not "is in the primitives palette". `text` and
    // `mesh` are leaves that the palette does not offer — a mesh only exists
    // once a file has been imported — and treating them as operators made them
    // land as wrappers with nothing to wrap, or not land at all.
    const isPrim = expectedChildren(newNode.kind) === 0;
    const isOp = !isPrim; // boolean, modifier, transform, pattern

    // Commit plus the expansion bookkeeping this action shares across branches.
    const place = (newTree: SDFNodeUI, selectedId: string, extraExpanded?: string[]) => {
      const expanded = new Set(get().expandedNodes);
      if (extraExpanded) extraExpanded.forEach(id => expanded.add(id));
      set(commit(get(), newTree, { selectedNodeId: selectedId, expandedNodes: expanded }));
    };

    // No tree: new node becomes root
    if (!tree) {
      place(newNode, newNode.id);
      return;
    }

    // Replace `target` in place with `newNode`, which has taken it as a child.
    // Ids are preserved, so this wraps rather than duplicates.
    const wrap = (target: SDFNodeUI): SDFNodeUI => {
      newNode.children = [cloneTree(target)];
      return tree.id === target.id ? newNode : updateInTree(tree, target.id, () => newNode);
    };

    // No specific target (dropped on empty area): union with root. An
    // operation falls through and is ignored -- deliberate, and asserted by
    // "ignores a dropped operation with no target on an existing tree".
    // The model flags it as a silent no-op, which it is; it is a UX gap
    // rather than a defect, so it is left alone. See specs/README.md.
    if (!targetId) {
      if (isPrim) {
        const unionNode = createNode('union', [tree, newNode]);
        place(unionNode, newNode.id, [unionNode.id]);
      }
      return;
    }

    // Dropped on a specific node
    const targetNode = findNode(tree, targetId);
    if (!targetNode) return;
    // Classify the target by arity -- the same question already asked of the
    // dropped node above. Asking `NODE_KINDS.primitives.includes(...)` instead
    // answered "no" for `text` and `mesh`, which take no children either, so
    // they fell through to the `targetExpected === 0` branch and were handed a
    // child that the mesher never reads (#120).
    const targetIsLeaf = expectedChildren(targetNode.kind) === 0;

    if (isOp && targetIsLeaf) {
      // Operation dropped on a leaf → WRAP it
      place(wrap(targetNode), newNode.id, [newNode.id]);
    } else if (isPrim && targetIsLeaf) {
      // Shape dropped on a leaf → wrap both in a Union
      const unionNode = createNode('union', [cloneTree(targetNode), newNode]);
      const newTree = tree.id === targetId ? unionNode : updateInTree(tree, targetId, () => unionNode);
      place(newTree, newNode.id, [unionNode.id]);
    } else if (isOp && !hasRoom(targetNode)) {
      // Operation dropped on an operation that's full → wrap the target.
      // A deliberate gesture, not an overflow, so it stays ahead of attachChild.
      place(wrap(targetNode), newNode.id, [newNode.id]);
    } else {
      // Room, a vacated slot, or a full target that unions in place.
      place(attachChild(tree, targetId, newNode), newNode.id, [targetId]);
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
    // Without this the detach below still happens and the re-attach finds
    // nothing to attach to, so the source is simply deleted.
    if (!findNode(tree, targetId)) return;

    // Detach, don't delete. `removeFromTree`'s promote rule would hand the
    // source's only child up into the vacated slot *and* send a copy of that
    // child along inside the source -- one id in two places, which makes
    // `findNode` see only the first and `updateInTree` rewrite both (#120).
    const detached = removeFromTree(cloneTree(tree), sourceId, false);
    if (!detached) return;

    const newTree = attachChild(detached, targetId, cloneTree(sourceNode));

    const expanded = new Set(get().expandedNodes);
    expanded.add(targetId);
    set(commit(get(), newTree, { expandedNodes: expanded }));
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
      set(commit(get(), fresh, { selectedNodeId: fresh.id }));
      return;
    }
    if (!selectedNodeId) return;
    // Add as child to selected node
    const newTree = attachChild(tree, selectedNodeId, fresh);
    const expanded = new Set(get().expandedNodes);
    expanded.add(selectedNodeId);
    set(commit(get(), newTree, { selectedNodeId: fresh.id, expandedNodes: expanded }));
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
      set(commit(get(), unionNode, { selectedNodeId: dupe.id, expandedNodes: expanded }));
      return;
    }
    // Find parent, add dupe as sibling
    const parent = findParentOf(tree, selectedNodeId);
    if (!parent) return;
    const newTree = attachChild(tree, parent.id, dupe);
    set(commit(get(), newTree, { selectedNodeId: dupe.id }));
  },

  simplifyTree: () => {
    const { tree } = get();
    if (!tree) return;

    function simplify(node: SDFNodeUI): SDFNodeUI | null {
      if (node.kind === '_empty') return node;
      // Remove disabled nodes
      if (!node.enabled) return null;

      // Recursively simplify children first
      const isBoolean = ['union', 'subtract', 'intersect'].includes(node.kind);
      const children = isBoolean
        ? node.children.map((child) => simplify(child) ?? emptySlot())
        : node.children.map(simplify).filter((c): c is SDFNodeUI => c !== null);

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

      const realChildren = children.filter((child) => child.enabled && child.kind !== '_empty');
      // Union has a true one-child identity. Subtract and intersect do not:
      // retaining their slots preserves operand roles and keeps them visibly
      // incomplete instead of silently changing the model.
      if (simplified.kind === 'union' && realChildren.length < 2) {
        return realChildren[0] || null;
      }

      // Remove modifiers/patterns with no children
      if (['shell', 'offset', 'round', 'mirror', 'halfSpace', 'linearPattern', 'circularPattern'].includes(simplified.kind) && children.length === 0) {
        return null;
      }

      // Collapse nested transforms of the same kind
      if (['translate', 'scale'].includes(simplified.kind) && children.length === 1 && children[0].kind === simplified.kind) {
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
        if (simplified.kind === 'scale') {
          return {
            ...simplified,
            params: {
              x: (simplified.params.x ?? 1) * (inner.params.x ?? 1),
              y: (simplified.params.y ?? 1) * (inner.params.y ?? 1),
              z: (simplified.params.z ?? 1) * (inner.params.z ?? 1),
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

    set(commit(get(), result, { selectedNodeId: null }));
  },

  beginHistoryTransaction: () => {
    const state = get();
    if (state.historyTransaction) return;
    set({
      historyTransaction: {
        tree: state.tree,
        selectedNodeId: state.selectedNodeId,
        expandedNodes: new Set(state.expandedNodes),
      },
    });
  },

  commitHistoryTransaction: () => {
    const state = get();
    const transaction = state.historyTransaction;
    if (!transaction) return;
    if (transaction.tree === state.tree) {
      set({ historyTransaction: null });
      return;
    }
    const withoutTransaction = { ...state, historyTransaction: null };
    set({ ...commit(withoutTransaction, state.tree), historyTransaction: null });
  },

  cancelHistoryTransaction: () => {
    const transaction = get().historyTransaction;
    if (!transaction) return;
    set({
      tree: transaction.tree,
      selectedNodeId: transaction.selectedNodeId,
      expandedNodes: new Set(transaction.expandedNodes),
      historyTransaction: null,
    });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const restored = history[newIndex];
      set({ tree: restored, historyIndex: newIndex, selectedNodeId: surviving(restored, get().selectedNodeId) });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const restored = history[newIndex];
      set({ tree: restored, historyIndex: newIndex, selectedNodeId: surviving(restored, get().selectedNodeId) });
    }
  },

  toJSON: () => {
    const { tree, projectName } = get();
    return JSON.stringify({ projectName, tree }, null, 2);
  },

  fromJSON: (json: string) => {
    const data = JSON.parse(json);
    get().resetDocument(data.tree || null, data.projectName || 'Untitled');
  },
}));

// Expose store for e2e tests
if (typeof window !== 'undefined') {
  (window as any).__MODELER_STORE__ = useModelerStore.getState();
  useModelerStore.subscribe((state) => {
    (window as any).__MODELER_STORE__ = state;
  });
}

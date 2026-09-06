import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { NamedParameter, ParameterUnit, SDFNodeUI } from '../types/operations';
import { NODE_LABELS, NODE_DEFAULTS, NODE_KINDS, expectedChildren } from '../types/operations';
import type { TriangulatedMesh } from '../types/geometry';
import { applyNodeParamPatch, normalizeNodeParams, normalizeTreeParams } from '../types/parameterSchema';
import { decodeProjectDocument, decodeTree } from '../types/documentDecoder';
import { FormulaError, parameterUnitFor, resolveTreeFormulas } from '../types/formulas';
import { useViewportStore } from './viewportStore';
import { useTreeUiStore } from './treeUiStore';
import * as THREE from 'three';
import { nodeWorldBounds } from '../engine/nodeBounds';

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
  /** Ordered selection, with selectedNodeId as the explicit primary selection. */
  selectedNodeIds: string[];
  selectedNodeId: string | null;
  mesh: TriangulatedMesh | null;
  sdfDisplay: SDFDisplayData | null;
  /** Exact immutable tree object that produced sdfDisplay. */
  evaluatedTree: SDFNodeUI | null;
  /** Viewport projection that produced sdfDisplay (may omit editor-hidden nodes). */
  evaluatedViewTree: SDFNodeUI | null;
  /** Most recent tree revision whose evaluation succeeded, for recovery. */
  lastValidTree: SDFNodeUI | null;
  evaluating: boolean;
  error: string | null;
  projectName: string;
  expandedNodes: Set<string>;
  namedParameters: NamedParameter[];

  // History
  history: (SDFNodeUI | null)[];
  parameterHistory: NamedParameter[][];
  historyIndex: number;
  historyTransaction: {
    tree: SDFNodeUI | null;
    selectedNodeIds: string[];
    selectedNodeId: string | null;
    expandedNodes: Set<string>;
    namedParameters: NamedParameter[];
  } | null;

  // Actions
  setTree: (tree: SDFNodeUI | null) => void;
  resetDocument: (tree: SDFNodeUI | null, projectName?: string, namedParameters?: NamedParameter[]) => void;
  selectNode: (id: string | null, mode?: 'replace' | 'toggle' | 'range') => void;
  updateNodeParams: (id: string, params: Record<string, number>) => void;
  setEffectiveNodeTransform: (id: string, transform: EffectiveNodeTransform) => void;
  setNodeExpression: (id: string, key: string, expression: string | null) => void;
  setNamedParameters: (parameters: NamedParameter[]) => void;
  promoteNodeParam: (id: string, key: string, name: string, unit?: ParameterUnit) => void;
  updateNodeData: (id: string, data: Record<string, string>) => void;
  renameNode: (id: string, label: string) => void;
  setNodeGroup: (id: string, group: string | null) => void;
  renameGroup: (group: string, nextName: string) => void;
  changeNodeKind: (id: string, kind: string) => void;
  removeNode: (id: string) => void;
  removeSelected: () => void;
  replaceNode: (id: string, replacement: SDFNodeUI) => void;
  toggleNode: (id: string) => void;
  toggleSelected: () => void;
  unionSelected: () => void;
  alignSelected: (axis: 'x' | 'y' | 'z', anchor: 'min' | 'center' | 'max') => void;
  distributeSelected: (axis: 'x' | 'y' | 'z') => void;
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

function cloneParameters(parameters: NamedParameter[]): NamedParameter[] {
  return parameters.map((parameter) => ({ ...parameter }));
}

/**
 * The selection to keep after the tree is replaced wholesale. Undo/redo can
 * restore a tree in which the selected node no longer exists; leaving the id
 * dangling makes every `findNode` consumer silently no-op.
 */
function survivingSelection(tree: SDFNodeUI | null, ids: string[]): string[] {
  if (!tree) return [];
  const seen = new Set<string>();
  return ids.filter((id) => !seen.has(id) && !!findNode(tree, id) && !!seen.add(id));
}

function treeOrder(tree: SDFNodeUI | null): string[] {
  const ids: string[] = [];
  const visit = (node: SDFNodeUI) => { ids.push(node.id); node.children.forEach(visit); };
  if (tree) visit(tree);
  return ids;
}

function selectionPatch(state: ModelerState, tree: SDFNodeUI | null, extra: Partial<ModelerState>) {
  const primarySpecified = 'selectedNodeId' in extra;
  const idsSpecified = 'selectedNodeIds' in extra;
  const requestedPrimary = primarySpecified ? extra.selectedNodeId ?? null : state.selectedNodeId;
  const requestedIds = idsSpecified ? extra.selectedNodeIds ?? []
    : primarySpecified ? (requestedPrimary ? [requestedPrimary] : []) : state.selectedNodeIds;
  const selectedNodeIds = survivingSelection(tree, requestedIds);
  const selectedNodeId = requestedPrimary && selectedNodeIds.includes(requestedPrimary)
    ? requestedPrimary : selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  return { selectedNodeId, selectedNodeIds };
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
    return { ...extra, ...selectionPatch(state, tree, extra), tree };
  }
  let history = state.history.slice(0, state.historyIndex + 1);
  let parameterHistory = (state.parameterHistory ?? [state.namedParameters ?? []]).slice(0, state.historyIndex + 1);
  // Trees are immutable: updateInTree replaces only the edited path. Keeping
  // those references preserves structural sharing, most importantly the large
  // base64 payload on imported-mesh nodes.
  history.push(tree);
  parameterHistory.push(('namedParameters' in extra ? extra.namedParameters : state.namedParameters) ?? []);
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(history.length - MAX_HISTORY_ENTRIES);
    parameterHistory = parameterHistory.slice(parameterHistory.length - MAX_HISTORY_ENTRIES);
  }
  // Clamp the selection to a node that still exists. `surviving` was already
  // doing this for undo and redo, and nothing else did: removing a node took
  // its descendants with it but only cleared the selection when the removed
  // id *was* the selected one (#120). A selected id that points at nothing
  // makes addNodeFromData bail at `if (!targetNode) return` -- so the palette
  // stops responding, with no visible reason why.
  return {
    ...extra,
    ...selectionPatch(state, tree, extra),
    tree,
    history,
    parameterHistory,
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

/** Remove descendants when an ancestor is also selected, then use tree order. */
function selectedRoots(tree: SDFNodeUI, ids: string[]): string[] {
  const selected = new Set(ids.filter((id) => !!findNode(tree, id)));
  return treeOrder(tree).filter((id) => {
    if (!selected.has(id)) return false;
    return ![...selected].some((ancestor) => ancestor !== id && !!findNode(findNode(tree, ancestor)!, id));
  });
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

function ancestorTransform(tree: SDFNodeUI, id: string): THREE.Matrix4 {
  const path: SDFNodeUI[] = [];
  const visit = (node: SDFNodeUI): boolean => {
    if (node.id === id) return true;
    path.push(node);
    for (const child of node.children) if (visit(child)) return true;
    path.pop();
    return false;
  };
  visit(tree);
  const matrix = new THREE.Matrix4();
  for (const node of path) {
    if (node.kind === 'translate') matrix.multiply(new THREE.Matrix4().makeTranslation(node.params.x || 0, node.params.y || 0, node.params.z || 0));
    else if (node.kind === 'rotate') matrix.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
      (node.params.x || 0) * Math.PI / 180,
      (node.params.y || 0) * Math.PI / 180,
      (node.params.z || 0) * Math.PI / 180,
    )));
    else if (node.kind === 'scale') matrix.multiply(new THREE.Matrix4().makeScale(node.params.x || 1, node.params.y || 1, node.params.z || 1));
  }
  return matrix;
}

export interface EffectiveNodeTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

function nodeTransformMatrix(node: SDFNodeUI): THREE.Matrix4 {
  if (node.kind === 'translate') return new THREE.Matrix4().makeTranslation(node.params.x || 0, node.params.y || 0, node.params.z || 0);
  if (node.kind === 'rotate') return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    (node.params.x || 0) * Math.PI / 180,
    (node.params.y || 0) * Math.PI / 180,
    (node.params.z || 0) * Math.PI / 180,
  ));
  if (node.kind === 'scale') return new THREE.Matrix4().makeScale(node.params.x || 1, node.params.y || 1, node.params.z || 1);
  return new THREE.Matrix4();
}

function effectiveNodeMatrix(tree: SDFNodeUI, id: string): THREE.Matrix4 | null {
  const path: SDFNodeUI[] = [];
  const visit = (node: SDFNodeUI): boolean => {
    path.push(node);
    if (node.id === id) return true;
    for (const child of node.children) if (visit(child)) return true;
    path.pop();
    return false;
  };
  if (!visit(tree)) return null;
  return path.reduce((matrix, node) => matrix.multiply(nodeTransformMatrix(node)), new THREE.Matrix4());
}

export function effectiveNodeTransform(tree: SDFNodeUI, id: string): EffectiveNodeTransform | null {
  const matrix = effectiveNodeMatrix(tree, id);
  if (!matrix) return null;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x * 180 / Math.PI, rotation.y * 180 / Math.PI, rotation.z * 180 / Math.PI],
    scale: [scale.x, scale.y, scale.z],
  };
}

function matrixFromEffectiveTransform(transform: EffectiveNodeTransform): THREE.Matrix4 {
  const position = new THREE.Vector3(...transform.position);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    transform.rotation[0] * Math.PI / 180,
    transform.rotation[1] * Math.PI / 180,
    transform.rotation[2] * Math.PI / 180,
    'XYZ',
  ));
  return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(...transform.scale));
}

function wrapWithLocalDelta(node: SDFNodeUI, delta: THREE.Matrix4): SDFNodeUI {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  delta.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  let result = node;
  if (Math.abs(scale.x - 1) + Math.abs(scale.y - 1) + Math.abs(scale.z - 1) > 1e-10) result = {
    ...createNode('scale', [result]), label: 'Precision Scale', params: { x: scale.x, y: scale.y, z: scale.z },
  };
  if (Math.abs(rotation.x) + Math.abs(rotation.y) + Math.abs(rotation.z) > 1e-10) result = {
    ...createNode('rotate', [result]), label: 'Precision Rotate', params: { x: rotation.x * 180 / Math.PI, y: rotation.y * 180 / Math.PI, z: rotation.z * 180 / Math.PI },
  };
  if (position.lengthSq() > 1e-20) result = {
    ...createNode('translate', [result]), label: 'Precision Move', params: { x: position.x, y: position.y, z: position.z },
  };
  return result;
}

function translateRootsInWorld(tree: SDFNodeUI, deltas: Map<string, THREE.Vector3>): SDFNodeUI {
  const visit = (node: SDFNodeUI): SDFNodeUI => {
    const worldDelta = deltas.get(node.id);
    if (worldDelta) {
      const inverse = ancestorTransform(tree, node.id).invert();
      const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(inverse);
      const local = worldDelta.clone().applyMatrix4(inverse).sub(origin);
      const wrapper = createNode('translate', [node]);
      return {
        ...wrapper,
        label: 'Precision Move',
        params: { x: local.x, y: local.y, z: local.z },
      };
    }
    return { ...node, children: node.children.map(visit) };
  };
  return visit(tree);
}

export const useModelerStore = create<ModelerState>()((set, get) => ({
  tree: null,
  selectedNodeIds: [],
  selectedNodeId: null,
  mesh: null,
  sdfDisplay: null,
  evaluatedTree: null,
  evaluatedViewTree: null,
  lastValidTree: null,
  evaluating: false,
  error: null,
  projectName: 'Untitled',
  expandedNodes: new Set<string>(),
  namedParameters: [],
  history: [null],
  parameterHistory: [[]],
  historyIndex: 0,
  historyTransaction: null,

  setTree: (tree) => {
    const state = get();
    try { set(commit(state, resolveTreeFormulas(normalizeTreeParams(tree), state.namedParameters), { selectedNodeId: null, error: null })); }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Formula is invalid' }); }
  },

  resetDocument: (tree, projectName = 'Untitled', namedParameters = []) => {
    // Locks, hides, isolate, and move mode refer to node ids from the old
    // document. Carrying them into a replacement can blank or freeze a new
    // project if an imported id happens to match (or isolate points nowhere).
    useTreeUiStore.getState().resetViewState();
    namedParameters = cloneParameters(namedParameters);
    const normalized = resolveTreeFormulas(normalizeTreeParams(tree), namedParameters);
    const snapshot = normalized ? cloneTree(normalized) : null;
    set({
      tree: snapshot,
      projectName,
      selectedNodeIds: [],
      selectedNodeId: null,
      expandedNodes: new Set<string>(),
      namedParameters,
      mesh: null,
      sdfDisplay: null,
      evaluatedTree: null,
      evaluatedViewTree: null,
      lastValidTree: null,
      evaluating: false,
      error: null,
      history: [snapshot],
      parameterHistory: [namedParameters],
      historyIndex: 0,
      historyTransaction: null,
      clipboard: null,
    });
  },

  selectNode: (id, mode = 'replace') => {
    const state = get();
    let selectedNodeIds: string[];
    if (!id) selectedNodeIds = [];
    else if (mode === 'toggle') {
      selectedNodeIds = state.selectedNodeIds.includes(id)
        ? state.selectedNodeIds.filter((selected) => selected !== id)
        : [...state.selectedNodeIds, id];
    } else if (mode === 'range' && state.selectedNodeId) {
      const order = treeOrder(state.tree);
      const start = order.indexOf(state.selectedNodeId);
      const end = order.indexOf(id);
      selectedNodeIds = start >= 0 && end >= 0
        ? order.slice(Math.min(start, end), Math.max(start, end) + 1) : [id];
    } else selectedNodeIds = [id];
    const primary = id && selectedNodeIds.includes(id) ? id : selectedNodeIds[selectedNodeIds.length - 1] ?? null;
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
          set({ selectedNodeId: primary, selectedNodeIds, expandedNodes: next });
          return;
        }
      }
    }
    set({ selectedNodeId: primary, selectedNodeIds });
  },

  updateNodeParams: (id, params) => {
    const { tree, namedParameters } = get();
    if (!tree) return;
    let error: string | undefined;
    const newTree = updateInTree(tree, id, (node) => {
      const result = applyNodeParamPatch(node, params);
      error = result.error;
      if (!result.params) return node;
      const expressions = Object.fromEntries(Object.entries(node.expressions ?? {}).filter(([key]) => !(key in params)));
      return { ...node, params: result.params, ...(Object.keys(expressions).length ? { expressions } : { expressions: undefined }) };
    });
    if (error) { set({ error }); return; }
    try { set(commit(get(), resolveTreeFormulas(newTree, namedParameters), { error: null })); }
    catch (formulaError) { set({ error: formulaError instanceof Error ? formulaError.message : 'Formula is invalid' }); }
  },
  setEffectiveNodeTransform: (id, transform) => {
    const state = get();
    if (!state.tree) return;
    const node = findNode(state.tree, id);
    const current = effectiveNodeMatrix(state.tree, id);
    if (!node || !current || transform.scale.some((value) => !Number.isFinite(value) || Math.abs(value) < 1e-6)) return;
    const desired = matrixFromEffectiveTransform(transform);
    const worldDelta = desired.clone().multiply(current.clone().invert());
    if (worldDelta.equals(new THREE.Matrix4())) return;
    const ancestor = ancestorTransform(state.tree, id);
    const localDelta = ancestor.clone().invert().multiply(worldDelta).multiply(ancestor);
    const replacement = wrapWithLocalDelta(node, localDelta);
    const tree = updateInTree(state.tree, id, () => replacement);
    set(commit(state, tree, { selectedNodeId: id, selectedNodeIds: state.selectedNodeIds, expandedNodes: new Set([...state.expandedNodes, replacement.id]) }));
  },

  setNodeExpression: (id, key, expression) => {
    const state = get();
    if (!state.tree) return;
    const source = updateInTree(state.tree, id, (node) => {
      const expressions = { ...node.expressions };
      if (expression?.trim()) expressions[key] = expression.trim();
      else delete expressions[key];
      return { ...node, expressions: Object.keys(expressions).length ? expressions : undefined };
    });
    try { set(commit(state, resolveTreeFormulas(source, state.namedParameters), { error: null })); }
    catch (error) { set({ error: error instanceof FormulaError ? error.message : 'Formula is invalid' }); }
  },

  setNamedParameters: (namedParameters) => {
    const state = get();
    try {
      namedParameters = cloneParameters(namedParameters);
      const tree = resolveTreeFormulas(state.tree, namedParameters);
      set(commit(state, tree, { namedParameters, error: null }));
    } catch (error) {
      set({ error: error instanceof FormulaError ? error.message : 'Parameters are invalid' });
    }
  },

  promoteNodeParam: (id, key, name, unit) => {
    const state = get();
    if (!state.tree || state.namedParameters.some((item) => item.name === name)) { set({ error: `Parameter “${name}” already exists` }); return; }
    const node = findNode(state.tree, id);
    if (!node || !(key in node.params)) return;
    const namedParameters = [...state.namedParameters, { name, expression: String(node.params[key]), unit: unit ?? parameterUnitFor(node.kind, key) }];
    const source = updateInTree(state.tree, id, (current) => ({ ...current, expressions: { ...current.expressions, [key]: name } }));
    try { set(commit(state, resolveTreeFormulas(source, namedParameters), { namedParameters, error: null })); }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Parameter is invalid' }); }
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

  renameNode: (id, label) => {
    const state = get();
    if (!state.tree) return;
    const current = findNode(state.tree, id);
    if (!current) return;
    const nextLabel = label.trim().slice(0, 256) || NODE_LABELS[current.kind] || current.kind;
    if (nextLabel === current.label) return;
    set(commit(state, updateInTree(state.tree, id, (node) => ({ ...node, label: nextLabel }))));
  },

  setNodeGroup: (id, group) => {
    const { tree } = get();
    if (!tree) return;
    const normalized = group?.trim().slice(0, 256) || undefined;
    const current = findNode(tree, id);
    if (!current || current.group === normalized) return;
    set(commit(get(), updateInTree(tree, id, (node) => {
      if (normalized) return { ...node, group: normalized };
      const next = { ...node };
      delete next.group;
      return next;
    })));
  },

  renameGroup: (group, nextName) => {
    const { tree } = get();
    const normalized = nextName.trim().slice(0, 256);
    if (!tree || !group || !normalized || normalized === group) return;
    const visit = (node: SDFNodeUI): SDFNodeUI => {
      const children = node.children.map(visit);
      const changedChildren = children.some((child, index) => child !== node.children[index]);
      if (node.group === group) return { ...node, group: normalized, children };
      return changedChildren ? { ...node, children } : node;
    };
    const next = visit(tree);
    if (next !== tree) set(commit(get(), next));
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
      expressions: undefined,
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

  removeSelected: () => {
    const { tree, selectedNodeIds } = get();
    if (!tree || !selectedNodeIds.length) return;
    let next: SDFNodeUI | null = tree;
    for (const id of selectedRoots(tree, selectedNodeIds).reverse()) {
      if (next && findNode(next, id)) next = removeFromTree(next, id);
    }
    set(commit(get(), next, { selectedNodeId: null, selectedNodeIds: [] }));
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

  toggleSelected: () => {
    const { tree, selectedNodeIds } = get();
    if (!tree || !selectedNodeIds.length) return;
    const ids = new Set(selectedRoots(tree, selectedNodeIds));
    const enabled = ![...ids].some((id) => findNode(tree, id)?.enabled);
    const visit = (node: SDFNodeUI): SDFNodeUI => ids.has(node.id)
      ? { ...node, enabled }
      : { ...node, children: node.children.map(visit) };
    set(commit(get(), visit(tree)));
  },

  unionSelected: () => {
    const { tree, selectedNodeIds } = get();
    if (!tree) return;
    const roots = selectedRoots(tree, selectedNodeIds);
    if (roots.length < 2) return;
    const parent = findParentOf(tree, roots[0]);
    if (!parent || roots.some((id) => findParentOf(tree, id)?.id !== parent.id)) {
      set({ error: 'Select sibling nodes to combine them into a union.' });
      return;
    }
    const ids = new Set(roots);
    const operands = parent.children.filter((child) => ids.has(child.id));
    if (operands.length < 2) return;
    let union = createNode('union', [operands[0], operands[1]]);
    for (const operand of operands.slice(2)) union = createNode('union', [union, operand]);

    const allChildrenSelected = parent.children.every((child) => ids.has(child.id));
    const newTree = allChildrenSelected
      ? (tree.id === parent.id ? union : updateInTree(tree, parent.id, () => union))
      : updateInTree(tree, parent.id, (node) => {
          const first = node.children.findIndex((child) => ids.has(child.id));
          return {
            ...node,
            children: node.children.flatMap((child, index) =>
              index === first ? [union] : ids.has(child.id) ? [] : [child]),
          };
        });
    const expanded = new Set(get().expandedNodes);
    expanded.add(union.id);
    set(commit(get(), newTree, {
      selectedNodeIds: [union.id], selectedNodeId: union.id, expandedNodes: expanded, error: null,
    }));
  },

  alignSelected: (axis, anchor) => {
    const { tree, selectedNodeIds } = get();
    if (!tree) return;
    const roots = selectedRoots(tree, selectedNodeIds);
    const index = { x: 0, y: 1, z: 2 }[axis];
    const items = roots.map((id) => ({ id, bounds: nodeWorldBounds(tree, id) }))
      .filter((item): item is { id: string; bounds: NonNullable<typeof item.bounds> } => item.bounds !== null);
    if (items.length < 2) return;
    const globalMin = Math.min(...items.map(({ bounds }) => bounds.min[index]));
    const globalMax = Math.max(...items.map(({ bounds }) => bounds.max[index]));
    const target = anchor === 'min' ? globalMin : anchor === 'max' ? globalMax : (globalMin + globalMax) / 2;
    const deltas = new Map(items.map(({ id, bounds }) => {
      const current = anchor === 'min' ? bounds.min[index] : anchor === 'max' ? bounds.max[index] : (bounds.min[index] + bounds.max[index]) / 2;
      const delta = new THREE.Vector3();
      delta.setComponent(index, target - current);
      return [id, delta] as const;
    }).filter(([, delta]) => delta.lengthSq() > 1e-16));
    if (!deltas.size) return;
    set(commit(get(), translateRootsInWorld(tree, deltas), { error: null }));
  },

  distributeSelected: (axis) => {
    const { tree, selectedNodeIds } = get();
    if (!tree) return;
    const roots = selectedRoots(tree, selectedNodeIds);
    const index = { x: 0, y: 1, z: 2 }[axis];
    const items = roots.map((id) => ({ id, bounds: nodeWorldBounds(tree, id) }))
      .filter((item): item is { id: string; bounds: NonNullable<typeof item.bounds> } => item.bounds !== null)
      .sort((a, b) => a.bounds.min[index] - b.bounds.min[index] || a.id.localeCompare(b.id));
    if (items.length < 3) return;
    const occupied = items.reduce((sum, { bounds }) => sum + bounds.max[index] - bounds.min[index], 0);
    const gap = (items[items.length - 1].bounds.max[index] - items[0].bounds.min[index] - occupied) / (items.length - 1);
    let cursor = items[0].bounds.min[index];
    const deltas = new Map<string, THREE.Vector3>();
    for (const { id, bounds } of items) {
      const delta = new THREE.Vector3();
      delta.setComponent(index, cursor - bounds.min[index]);
      if (delta.lengthSq() > 1e-16) deltas.set(id, delta);
      cursor += bounds.max[index] - bounds.min[index] + gap;
    }
    if (!deltas.size) return;
    set(commit(get(), translateRootsInWorld(tree, deltas), { error: null }));
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
    let validated: SDFNodeUI;
    try {
      const decoded = decodeTree(nodeData, { legacy: true, repairMissingIds: true });
      if (!decoded) throw new Error('Node data is empty');
      validated = decoded;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Dropped node data is invalid' });
      return;
    }
    // Reconstruct a full SDFNodeUI from the palette's JSON data
    function hydrate(data: any): SDFNodeUI {
      return {
        id: uuidv4(),
        kind: data.kind,
        label: data.label || NODE_LABELS[data.kind] || data.kind,
        params: normalizeNodeParams(data.kind, data.params),
        ...(data.expressions ? { expressions: { ...data.expressions } } : {}),
        // `data` carries what params cannot: a text node's glyph outlines, an
        // imported mesh's geometry. Dropping it here turned an imported STL
        // into an empty node — and had been doing the same to text.
        ...(data.data ? { data: { ...data.data } } : {}),
        children: (data.children || []).map(hydrate),
        enabled: data.enabled !== false,
      };
    }
    const newNode = hydrate(validated);
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
    const { tree, selectedNodeId, selectedNodeIds } = get();
    if (!tree || !selectedNodeId) return;
    const roots = selectedRoots(tree, selectedNodeIds);
    const node = findNode(tree, roots[0]);
    if (!node || !roots.length) return;
    const dupe = reassignIds(cloneTree(node));
    // If root, wrap in union
    if (tree.id === roots[0]) {
      const unionNode = createNode('union', [tree, dupe]);
      const expanded = new Set(get().expandedNodes);
      expanded.add(unionNode.id);
      set(commit(get(), unionNode, { selectedNodeId: dupe.id, expandedNodes: expanded }));
      return;
    }
    if (roots.length > 1) {
      let next = tree;
      const duplicates: string[] = [];
      for (const id of roots) {
        const source = findNode(tree, id);
        const parent = findParentOf(next, id);
        if (!source || !parent) continue;
        const copy = reassignIds(cloneTree(source));
        next = attachChild(next, parent.id, copy);
        duplicates.push(copy.id);
      }
      if (duplicates.length) set(commit(get(), next, {
        selectedNodeIds: duplicates, selectedNodeId: duplicates[duplicates.length - 1],
      }));
      return;
    }
    // Find parent, add dupe as sibling
    const parent = findParentOf(tree, roots[0]);
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
      if (simplified.kind === 'translate' && !simplified.expressions) {
        const p = simplified.params;
        if ((p.x || 0) === 0 && (p.y || 0) === 0 && (p.z || 0) === 0) {
          return children[0] || null;
        }
      }
      if (simplified.kind === 'rotate' && !simplified.expressions) {
        const p = simplified.params;
        if ((p.x || 0) === 0 && (p.y || 0) === 0 && (p.z || 0) === 0) {
          return children[0] || null;
        }
      }
      if (simplified.kind === 'scale' && !simplified.expressions) {
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
      if (simplified.kind === 'translate' && !simplified.expressions && children.length === 1 && children[0].kind === 'translate' && !children[0].expressions) {
        const inner = children[0];
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

      return simplified;
    }

    // The bottom-up walk reaches a fixed point in one pass: simplifying a
    // child happens before its parent considers a merge. An arbitrary pass
    // limit can leave sufficiently deep trees half-normalized and makes
    // termination a guess rather than a property of the algorithm.
    const result = simplify(tree);

    set(commit(get(), result, { selectedNodeId: null }));
  },

  beginHistoryTransaction: () => {
    const state = get();
    if (state.historyTransaction) return;
    set({
      historyTransaction: {
        tree: state.tree,
        selectedNodeIds: state.selectedNodeIds,
        selectedNodeId: state.selectedNodeId,
        expandedNodes: new Set(state.expandedNodes),
        namedParameters: state.namedParameters,
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
      selectedNodeIds: transaction.selectedNodeIds,
      selectedNodeId: transaction.selectedNodeId,
      expandedNodes: new Set(transaction.expandedNodes),
      namedParameters: transaction.namedParameters,
      historyTransaction: null,
    });
  },

  undo: () => {
    const { historyIndex, history, parameterHistory } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const restored = history[newIndex];
      const selection = selectionPatch(get(), restored, {});
      set({ tree: restored, namedParameters: parameterHistory[newIndex] ?? [], historyIndex: newIndex, ...selection });
    }
  },

  redo: () => {
    const { historyIndex, history, parameterHistory } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const restored = history[newIndex];
      const selection = selectionPatch(get(), restored, {});
      set({ tree: restored, namedParameters: parameterHistory[newIndex] ?? [], historyIndex: newIndex, ...selection });
    }
  },

  toJSON: () => {
    const { tree, projectName, namedParameters: parameters } = get();
    const viewport = useViewportStore.getState();
    const units = { displayUnit: viewport.measurementUnit, decimalPrecision: viewport.measurementPrecision,
      fractionalDenominator: viewport.measurementFractionalDenominator };
    return JSON.stringify({ version: 2, projectName, tree, parameters, views: viewport.namedViews,
      measurements: viewport.pinnedMeasurements, units }, null, 2);
  },

  fromJSON: (json: string) => {
    const data = decodeProjectDocument(JSON.parse(json));
    get().resetDocument(data.tree, data.projectName, data.parameters);
    const viewport = useViewportStore.getState();
    viewport.setNamedViews(data.views);
    viewport.setPinnedMeasurements(data.measurements);
    viewport.setUnitPreferences(data.units);
    viewport.resetMeasurementSession();
  },
}));

// Expose store for e2e tests
if (typeof window !== 'undefined') {
  (window as any).__MODELER_STORE__ = useModelerStore.getState();
  useModelerStore.subscribe((state) => {
    (window as any).__MODELER_STORE__ = state;
  });
}

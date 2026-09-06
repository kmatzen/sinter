import * as THREE from 'three';
// @ts-ignore
import { TransformControls } from '../lib/TransformControls.js';
import type { ThreeEngine } from './ThreeEngine';
import { useModelerStore } from '../store/modelerStore';
import { useTreeUiStore } from '../store/treeUiStore';
import { useViewportStore } from '../store/viewportStore';
import type { SDFNodeUI } from '../types/operations';
import { v4 as uuidv4 } from 'uuid';
import { nodeWorldBounds } from './nodeBounds';
import type { GizmoPivotMode } from '../store/viewportStore';

function findNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const f = findNode(child, id);
    if (f) return f;
  }
  return null;
}

function findParent(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const f = findParent(child, id);
    if (f) return f;
  }
  return null;
}

function findTransformNode(tree: SDFNodeUI, id: string, kind: string): SDFNodeUI | null {
  const node = findNode(tree, id);
  if (!node) return null;
  if (node.kind === kind) return node;
  const parent = findParent(tree, id);
  if (parent && parent.kind === kind) return parent;
  for (const child of node.children) {
    if (child.kind === kind) return child;
  }
  return null;
}

function getAncestorPath(tree: SDFNodeUI, id: string): SDFNodeUI[] {
  const path: SDFNodeUI[] = [];
  function walk(node: SDFNodeUI): boolean {
    path.push(node);
    if (node.id === id) return true;
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    path.pop();
    return false;
  }
  walk(tree);
  return path;
}

const DEG = Math.PI / 180;

function getAncestorMatrix(tree: SDFNodeUI, id: string): THREE.Matrix4 {
  const path = getAncestorPath(tree, id);
  const mat = new THREE.Matrix4();
  for (let i = 0; i < path.length - 1; i++) {
    const node = path[i];
    if (node.kind === 'translate') {
      mat.multiply(new THREE.Matrix4().makeTranslation(node.params.x || 0, node.params.y || 0, node.params.z || 0));
    } else if (node.kind === 'rotate') {
      mat.multiply(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler((node.params.x || 0) * DEG, (node.params.y || 0) * DEG, (node.params.z || 0) * DEG)
      ));
    } else if (node.kind === 'scale') {
      mat.multiply(new THREE.Matrix4().makeScale(node.params.x || 1, node.params.y || 1, node.params.z || 1));
    }
  }
  return mat;
}

function getFullMatrix(tree: SDFNodeUI, id: string): THREE.Matrix4 {
  const path = getAncestorPath(tree, id);
  const mat = new THREE.Matrix4();
  for (const node of path) {
    if (node.kind === 'translate') {
      mat.multiply(new THREE.Matrix4().makeTranslation(node.params.x || 0, node.params.y || 0, node.params.z || 0));
    } else if (node.kind === 'rotate') {
      mat.multiply(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler((node.params.x || 0) * DEG, (node.params.y || 0) * DEG, (node.params.z || 0) * DEG)
      ));
    } else if (node.kind === 'scale') {
      mat.multiply(new THREE.Matrix4().makeScale(node.params.x || 1, node.params.y || 1, node.params.z || 1));
    }
  }
  return mat;
}

function selectedRoots(tree: SDFNodeUI, ids: string[]): string[] {
  const selected = new Set(ids.filter((id) => !!findNode(tree, id)));
  return ids.filter((id, index) => selected.has(id)
    && ids.indexOf(id) === index
    && !ids.some((ancestor) => ancestor !== id && selected.has(ancestor) && !!findNode(findNode(tree, ancestor)!, id)));
}

function replaceNodes(tree: SDFNodeUI, replacements: Map<string, SDFNodeUI>): SDFNodeUI {
  const replacement = replacements.get(tree.id);
  if (replacement) return replacement;
  return { ...tree, children: tree.children.map((child) => replaceNodes(child, replacements)) };
}

function transformNode(
  node: SDFNodeUI,
  localDelta: THREE.Matrix4,
  ids: [string, string, string],
): SDFNodeUI {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  localDelta.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
  let result = node;
  if (Math.abs(scale.x - 1) + Math.abs(scale.y - 1) + Math.abs(scale.z - 1) > 1e-10) result = {
    id: ids[2], kind: 'scale', label: 'Group Scale', enabled: true,
    params: { x: scale.x, y: scale.y, z: scale.z }, children: [result],
  };
  if (Math.abs(euler.x) + Math.abs(euler.y) + Math.abs(euler.z) > 1e-10) result = {
    id: ids[1], kind: 'rotate', label: 'Group Rotate', enabled: true,
    params: { x: euler.x / DEG, y: euler.y / DEG, z: euler.z / DEG }, children: [result],
  };
  if (position.lengthSq() > 1e-20) result = {
    id: ids[0], kind: 'translate', label: 'Group Move', enabled: true,
    params: { x: position.x, y: position.y, z: position.z }, children: [result],
  };
  return result;
}

/** Apply one world-space affine delta to independent selected subtrees. */
export function applyWorldSelectionDelta(
  tree: SDFNodeUI,
  rootIds: string[],
  worldDelta: THREE.Matrix4,
  wrapperIds: Map<string, [string, string, string]>,
): SDFNodeUI {
  const replacements = new Map<string, SDFNodeUI>();
  for (const id of rootIds) {
    const node = findNode(tree, id);
    if (!node) continue;
    const ancestor = getAncestorMatrix(tree, id);
    const localDelta = ancestor.clone().invert().multiply(worldDelta).multiply(ancestor);
    replacements.set(id, transformNode(node, localDelta, wrapperIds.get(id)!));
  }
  return replaceNodes(tree, replacements);
}

export function selectionPivot(
  tree: SDFNodeUI,
  selectedIds: string[],
  primaryId: string,
  mode: GizmoPivotMode,
  custom: [number, number, number],
): THREE.Vector3 {
  if (mode === 'custom') return new THREE.Vector3(...custom);
  if (mode === 'object-origin') {
    return new THREE.Vector3().setFromMatrixPosition(getFullMatrix(tree, primaryId));
  }
  const ids = mode === 'bounds-center' ? [primaryId] : selectedRoots(tree, selectedIds);
  const bounds = ids.map((id) => nodeWorldBounds(tree, id)).filter((box): box is Exclude<typeof box, null> => box !== null);
  if (!bounds.length) return new THREE.Vector3().setFromMatrixPosition(getFullMatrix(tree, primaryId));
  return new THREE.Vector3(
    (Math.min(...bounds.map((box) => box.min[0])) + Math.max(...bounds.map((box) => box.max[0]))) / 2,
    (Math.min(...bounds.map((box) => box.min[1])) + Math.max(...bounds.map((box) => box.max[1]))) / 2,
    (Math.min(...bounds.map((box) => box.min[2])) + Math.max(...bounds.map((box) => box.max[2]))) / 2,
  );
}

interface ObjectSnapResult {
  position: THREE.Vector3;
  label: string;
}

/** Find per-axis object/bounds targets within a screen-space tolerance. */
export function snapTranslationToObjects(
  tree: SDFNodeUI,
  selectedIds: string[],
  input: THREE.Vector3,
  camera: THREE.Camera,
  viewport: { width: number; height: number },
  tolerance = 12,
): ObjectSnapResult | null {
  const roots = selectedRoots(tree, selectedIds);
  const related = (node: SDFNodeUI) => roots.some((id) => {
    const root = findNode(tree, id)!;
    return node.id === id || !!findNode(root, node.id) || !!findNode(node, id);
  });
  const targets: { axis: 0 | 1 | 2; value: number; label: string }[] = [];
  for (const axis of [0, 1, 2] as const) targets.push({ axis, value: 0, label: `world origin ${'XYZ'[axis]}` });
  const visit = (node: SDFNodeUI) => {
    if (!related(node) && node.enabled && node.kind !== '_empty') {
      const origin = new THREE.Vector3().setFromMatrixPosition(getFullMatrix(tree, node.id));
      const bounds = nodeWorldBounds(tree, node.id);
      for (const axis of [0, 1, 2] as const) {
        targets.push({ axis, value: origin.getComponent(axis), label: `${node.label || node.kind} origin ${'XYZ'[axis]}` });
        if (bounds) {
          targets.push({ axis, value: bounds.min[axis], label: `${node.label || node.kind} min ${'XYZ'[axis]}` });
          targets.push({ axis, value: (bounds.min[axis] + bounds.max[axis]) / 2, label: `${node.label || node.kind} center ${'XYZ'[axis]}` });
          targets.push({ axis, value: bounds.max[axis], label: `${node.label || node.kind} max ${'XYZ'[axis]}` });
        }
      }
    }
    node.children.forEach(visit);
  };
  visit(tree);
  const screen = (point: THREE.Vector3) => {
    const projected = point.clone().project(camera);
    return new THREE.Vector2((projected.x + 1) * viewport.width / 2, (1 - projected.y) * viewport.height / 2);
  };
  const result = input.clone();
  const labels: string[] = [];
  for (const axis of [0, 1, 2] as const) {
    if (targets.some((target) => target.axis === axis && Math.abs(target.value - result.getComponent(axis)) < 1e-10)) continue;
    const currentScreen = screen(result);
    let best: { target: typeof targets[number]; distance: number } | null = null;
    for (const target of targets) {
      if (target.axis !== axis) continue;
      const candidate = result.clone().setComponent(axis, target.value);
      const distance = currentScreen.distanceTo(screen(candidate));
      if (distance >= 0.25 && distance <= tolerance && (!best || distance < best.distance - 1e-6)) best = { target, distance };
    }
    if (best && Math.abs(result.getComponent(axis) - best.target.value) > 1e-10) {
      result.setComponent(axis, best.target.value);
      labels.push(best.target.label);
    }
  }
  return labels.length ? { position: result, label: labels.join(', ') } : null;
}

export class GizmoController {
  private engine: ThreeEngine;
  private controls: any;
  private ancestorGroup: THREE.Group;
  private transformObj: THREE.Object3D;
  private suppressSync = false;
  private wrapping = false;
  private unsubs: (() => void)[] = [];
  private shiftHeld = false;
  private lastGizmoMode = 'none';
  private lastGizmoSpace: 'world' | 'local';
  private groupDrag: {
    tree: SDFNodeUI;
    roots: string[];
    startMatrix: THREE.Matrix4;
    wrapperIds: Map<string, [string, string, string]>;
  } | null = null;

  constructor(engine: ThreeEngine) {
    this.engine = engine;

    this.ancestorGroup = new THREE.Group();
    this.transformObj = new THREE.Object3D();
    this.ancestorGroup.add(this.transformObj);
    engine.gizmoScene.add(this.ancestorGroup);

    this.controls = new (TransformControls as any)(engine.camera, engine.renderer.domElement);
    this.controls.attach(this.transformObj);
    /*
     * The gizmo is picked by ray, so its on-screen size *is* its hit area. At
     * 1.2 the axis arrows are a few pixels wide — fine under a cursor whose
     * hotspot is a single pixel, a guessing game under a fingertip that covers
     * roughly 44px. Coarse pointers get a proportionally larger gizmo rather
     * than a separate picker mesh, so what you aim at is what you hit.
     */
    const coarsePointer = typeof window !== 'undefined'
      && window.matchMedia?.('(pointer: coarse)').matches;
    this.controls.setSize(coarsePointer ? 1.9 : 1.2);
    this.lastGizmoSpace = useViewportStore.getState().gizmoSpace;
    this.controls.setSpace(this.lastGizmoSpace);
    this.controls.visible = false;
    this.controls.enabled = false;
    engine.gizmoScene.add(this.controls);

    this.controls.addEventListener('dragging-changed', (e: any) => {
      engine.controls.enabled = !e.value;
      if (e.value) {
        useModelerStore.getState().beginHistoryTransaction();
        const { tree, selectedNodeIds } = useModelerStore.getState();
        const { gizmoPivot, objectSnapEnabled } = useViewportStore.getState();
        const roots = tree ? selectedRoots(tree, selectedNodeIds) : [];
        if (tree && roots.length && (roots.length > 1 || gizmoPivot !== 'object-origin' || objectSnapEnabled)) {
          this.transformObj.updateMatrixWorld(true);
          this.groupDrag = {
            tree,
            roots,
            startMatrix: this.transformObj.matrixWorld.clone(),
            wrapperIds: new Map(roots.map((id) => [id, [uuidv4(), uuidv4(), uuidv4()]])),
          };
        }
        useViewportStore.getState().setDragging(true);
      } else {
        useModelerStore.getState().commitHistoryTransaction();
        this.groupDrag = null;
        useViewportStore.getState().setSnapIndicator(null);
        useViewportStore.getState().setDragging(false);
      }
    });

    this.controls.addEventListener('objectChange', () => this.handleObjectChange());

    // Keyboard
    const onDown = (e: KeyboardEvent) => { if (e.key === 'Shift') this.shiftHeld = true; };
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Shift') this.shiftHeld = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    this.unsubs.push(() => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    });

    // Store subscriptions
    this.unsubs.push(useModelerStore.subscribe(() => this.syncFromStore()));
    this.unsubs.push(useViewportStore.subscribe(() => this.syncFromStore()));
    this.unsubs.push(useTreeUiStore.subscribe(() => this.syncFromStore()));
  }

  private syncFromStore() {
    if (this.suppressSync || useViewportStore.getState().dragging) return;

    const tree = useModelerStore.getState().tree;
    const selectedId = useModelerStore.getState().selectedNodeId;
    const selectedIds = useModelerStore.getState().selectedNodeIds;
    const gizmoMode = useViewportStore.getState().gizmoMode;
    const { gizmoPivot, customPivot, objectSnapEnabled } = useViewportStore.getState();

    const selectedNode = tree && selectedId ? findNode(tree, selectedId) : null;
    const isLocked = selectedIds.some((id) => useTreeUiStore.getState().lockedNodeIds.has(id));
    const isVisible = !!selectedNode && !isLocked && gizmoMode !== 'none';

    this.controls.visible = isVisible;
    this.controls.enabled = isVisible;

    if (!isVisible || !tree || !selectedId) return;

    // Update mode
    if (gizmoMode !== this.lastGizmoMode) {
      this.controls.setMode(gizmoMode);
      this.lastGizmoMode = gizmoMode;
    }

    // Update snap
    const vs = useViewportStore.getState();
    if (vs.gizmoSpace !== this.lastGizmoSpace) {
      this.controls.setSpace(vs.gizmoSpace);
      this.lastGizmoSpace = vs.gizmoSpace;
    }
    const snap = vs.snapEnabled && !this.shiftHeld;
    this.controls.setTranslationSnap(snap ? vs.snapSize : null);
    this.controls.setRotationSnap(snap ? (vs.snapSize * Math.PI / 180) : null);
    this.controls.setScaleSnap(snap ? vs.snapSize / 10 : null);

    const transformKind = gizmoMode as string;
    const transformNode = findTransformNode(tree, selectedId, transformKind);

    // Reset
    this.ancestorGroup.position.set(0, 0, 0);
    this.ancestorGroup.quaternion.identity();
    this.ancestorGroup.scale.set(1, 1, 1);
    this.transformObj.position.set(0, 0, 0);
    this.transformObj.quaternion.identity();
    this.transformObj.scale.set(1, 1, 1);

    if (selectedIds.length > 1 || gizmoPivot !== 'object-origin' || objectSnapEnabled) {
      this.transformObj.position.copy(selectionPivot(tree, selectedIds, selectedId, gizmoPivot, customPivot));
      if (vs.gizmoSpace === 'local') {
        const world = getFullMatrix(tree, selectedId);
        world.decompose(new THREE.Vector3(), this.transformObj.quaternion, new THREE.Vector3());
      }
      this.ancestorGroup.updateMatrixWorld(true);
      return;
    }

    if (transformNode) {
      const ancestorMat = getAncestorMatrix(tree, transformNode.id);
      this.ancestorGroup.applyMatrix4(ancestorMat);

      const p = transformNode.params;
      if (gizmoMode === 'translate') {
        this.transformObj.position.set(p.x || 0, p.y || 0, p.z || 0);
      } else if (gizmoMode === 'rotate') {
        this.transformObj.rotation.set((p.x || 0) * DEG, (p.y || 0) * DEG, (p.z || 0) * DEG);
      } else if (gizmoMode === 'scale') {
        this.transformObj.scale.set(p.x || 1, p.y || 1, p.z || 1);
      }
    } else {
      const fullMat = getFullMatrix(tree, selectedId);
      this.ancestorGroup.applyMatrix4(fullMat);
    }

    this.ancestorGroup.updateMatrixWorld(true);
  }

  private handleObjectChange() {
    if (this.groupDrag) {
      this.transformObj.updateMatrixWorld(true);
      const viewport = useViewportStore.getState();
      if (viewport.objectSnapEnabled && !this.shiftHeld && viewport.gizmoMode === 'translate') {
        const rect = this.engine.renderer.domElement.getBoundingClientRect();
        const snapped = snapTranslationToObjects(
          this.groupDrag.tree,
          this.groupDrag.roots,
          new THREE.Vector3().setFromMatrixPosition(this.transformObj.matrixWorld),
          this.engine.camera,
          { width: rect.width, height: rect.height },
        );
        if (snapped) {
          this.transformObj.position.copy(snapped.position);
          this.transformObj.updateMatrixWorld(true);
          viewport.setSnapIndicator({ position: snapped.position.toArray(), label: snapped.label });
        } else viewport.setSnapIndicator(null);
      } else viewport.setSnapIndicator(null);
      const delta = this.transformObj.matrixWorld.clone().multiply(this.groupDrag.startMatrix.clone().invert());
      if (delta.elements.every((value, index) => Math.abs(value - new THREE.Matrix4().elements[index]) < 1e-10)) return;
      this.suppressSync = true;
      useModelerStore.getState().setTree(applyWorldSelectionDelta(
        this.groupDrag.tree,
        this.groupDrag.roots,
        delta,
        this.groupDrag.wrapperIds,
      ));
      requestAnimationFrame(() => { this.suppressSync = false; });
      return;
    }
    const tree = useModelerStore.getState().tree;
    const selectedId = useModelerStore.getState().selectedNodeId;
    const gizmoMode = useViewportStore.getState().gizmoMode;
    if (!tree || !selectedId) return;

    const transformKind = gizmoMode as string;
    let transformNode = findTransformNode(tree, selectedId, transformKind);

    if (!transformNode) {
      if (this.wrapping) return;
      const isIdentity = gizmoMode === 'translate'
        ? (this.transformObj.position.lengthSq() < 1e-10)
        : gizmoMode === 'rotate'
        ? (Math.abs(this.transformObj.rotation.x) + Math.abs(this.transformObj.rotation.y) + Math.abs(this.transformObj.rotation.z) < 1e-6)
        : (Math.abs(this.transformObj.scale.x - 1) + Math.abs(this.transformObj.scale.y - 1) + Math.abs(this.transformObj.scale.z - 1) < 1e-6);
      if (isIdentity) return;

      this.wrapping = true;
      useModelerStore.getState().wrapSelected(transformKind);
      requestAnimationFrame(() => { this.wrapping = false; });
      return;
    }

    let params: Record<string, number>;
    if (gizmoMode === 'translate') {
      params = { x: this.transformObj.position.x, y: this.transformObj.position.y, z: this.transformObj.position.z };
    } else if (gizmoMode === 'rotate') {
      const r = 180 / Math.PI;
      params = { x: this.transformObj.rotation.x * r, y: this.transformObj.rotation.y * r, z: this.transformObj.rotation.z * r };
    } else {
      params = { x: this.transformObj.scale.x, y: this.transformObj.scale.y, z: this.transformObj.scale.z };
    }

    for (const key of Object.keys(params)) {
      if (!isFinite(params[key])) params[key] = (gizmoMode === 'scale' ? 1 : 0);
    }

    this.suppressSync = true;
    useModelerStore.getState().updateNodeParams(transformNode.id, params);
    requestAnimationFrame(() => { this.suppressSync = false; });
  }

  update() {
    // Controls update themselves via Three.js updateMatrixWorld
  }

  setVisible(visible: boolean) {
    this.controls.visible = visible;
    this.ancestorGroup.visible = visible;
  }

  setCamera(camera: THREE.Camera) {
    this.controls.camera = camera;
  }

  dispose() {
    useModelerStore.getState().cancelHistoryTransaction();
    for (const u of this.unsubs) u();
    this.engine.scene.remove(this.controls);
    this.engine.scene.remove(this.ancestorGroup);
    this.controls.dispose();
  }
}

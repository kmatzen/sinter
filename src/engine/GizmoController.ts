import * as THREE from 'three';
// @ts-ignore
import { TransformControls } from '../lib/TransformControls.js';
import type { ThreeEngine } from './ThreeEngine';
import { useModelerStore } from '../store/modelerStore';
import { useViewportStore } from '../store/viewportStore';
import type { SDFNodeUI } from '../types/operations';

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

  constructor(engine: ThreeEngine) {
    this.engine = engine;

    this.ancestorGroup = new THREE.Group();
    this.transformObj = new THREE.Object3D();
    this.ancestorGroup.add(this.transformObj);
    engine.scene.add(this.ancestorGroup);

    this.controls = new (TransformControls as any)(engine.camera, engine.renderer.domElement);
    this.controls.attach(this.transformObj);
    this.controls.setSize(1.2);
    this.controls.setSpace('local');
    this.controls.visible = false;
    this.controls.enabled = false;
    engine.scene.add(this.controls);

    this.controls.addEventListener('dragging-changed', (e: any) => {
      engine.controls.enabled = !e.value;
      if (e.value) {
        useViewportStore.getState().setDragging(true);
      } else {
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
  }

  private syncFromStore() {
    if (this.suppressSync || useViewportStore.getState().dragging) return;

    const tree = useModelerStore.getState().tree;
    const selectedId = useModelerStore.getState().selectedNodeId;
    const gizmoMode = useViewportStore.getState().gizmoMode;

    const selectedNode = tree && selectedId ? findNode(tree, selectedId) : null;
    const isVisible = !!selectedNode && gizmoMode !== 'none';

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

  dispose() {
    for (const u of this.unsubs) u();
    this.engine.scene.remove(this.controls);
    this.engine.scene.remove(this.ancestorGroup);
    this.controls.dispose();
  }
}

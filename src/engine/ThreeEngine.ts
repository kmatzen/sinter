import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useModelerStore } from '../store/modelerStore';
import { SdfMesh } from './SdfMesh';
import { OutlinePass } from './OutlinePass';
import { GizmoController } from './GizmoController';

export class ThreeEngine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  container: HTMLDivElement;

  private sdfMesh: SdfMesh;
  private outlinePass: OutlinePass;
  private gizmo: GizmoController;
  private animId: number = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLDivElement) {
    this.container = container;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      stencil: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(50, 100, 50);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-30, 40, -50);
    this.scene.add(fill);

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 5000);
    this.camera.position.set(100, 80, 100);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Subsystems
    this.sdfMesh = new SdfMesh(this);
    this.outlinePass = new OutlinePass(this);
    this.gizmo = new GizmoController(this);

    // Click on empty space deselects
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    // Start
    this.animate();
  }

  private pointerMoved = false;
  private onPointerDown = () => { this.pointerMoved = false; };
  private onPointerUp = (e: PointerEvent) => {
    if (this.pointerMoved) return;
    // Simple miss detection: if no gizmo was hit, deselect
    // (TransformControls handles its own events)
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hits = raycaster.intersectObjects(this.scene.children, true);
    if (hits.length === 0) {
      useModelerStore.getState().selectNode(null);
    }
  };

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.outlinePass.resize(w, h);
  }

  private animate = () => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.animate);

    this.controls.update();
    this.sdfMesh.update();
    this.gizmo.update();
    this.outlinePass.render();
  };

  /**
   * Capture 4 views: current viewport + front/right/top.
   * Returns base64 PNG data URLs at the given resolution.
   */
  captureMultiView(size = 256): string[] {
    const sdfDisplay = useModelerStore.getState().sdfDisplay;
    if (!sdfDisplay) return [];

    // Compute scene center and radius from bounding box
    const bbMin = new THREE.Vector3(...sdfDisplay.bbMin);
    const bbMax = new THREE.Vector3(...sdfDisplay.bbMax);
    const center = new THREE.Vector3().addVectors(bbMin, bbMax).multiplyScalar(0.5);
    const radius = bbMin.distanceTo(bbMax) * 0.5;
    const dist = radius * 2.5;

    this.gizmo.setVisible(false);

    // Save current state
    const savedPos = this.camera.position.clone();
    const savedAspect = this.camera.aspect;
    const savedSize = new THREE.Vector2();
    this.renderer.getSize(savedSize);

    // Set up small render target
    this.renderer.setSize(size, size);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();

    const views: Array<{ name: string; pos: THREE.Vector3 }> = [
      { name: 'current', pos: savedPos },
      { name: 'front', pos: new THREE.Vector3(center.x, center.y, center.z + dist) },
      { name: 'right', pos: new THREE.Vector3(center.x + dist, center.y, center.z) },
      { name: 'top', pos: new THREE.Vector3(center.x, center.y + dist, center.z) },
    ];

    const results: string[] = [];
    for (const view of views) {
      this.camera.position.copy(view.pos);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld();
      this.sdfMesh.update();  // push new camera uniforms to shader
      this.outlinePass.render();
      results.push(this.renderer.domElement.toDataURL('image/webp', 0.6));
    }

    // Restore
    this.camera.position.copy(savedPos);
    this.camera.aspect = savedAspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(savedSize.x, savedSize.y);
    this.outlinePass.resize(savedSize.x, savedSize.y);
    this.gizmo.setVisible(true);

    return results;
  }

  takeScreenshot(callback: (blob: Blob | null) => void) {
    // Hide gizmo, re-render clean frame, capture, restore
    this.gizmo.setVisible(false);
    this.outlinePass.render();
    this.renderer.domElement.toBlob(callback);
    this.gizmo.setVisible(true);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.sdfMesh.dispose();
    this.outlinePass.dispose();
    this.gizmo.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

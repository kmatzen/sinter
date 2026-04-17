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

  /** Frame the camera to fit the current model's bounding box */
  zoomToFit() {
    const sdfDisplay = useModelerStore.getState().sdfDisplay;
    if (!sdfDisplay) return;

    const bbMin = new THREE.Vector3(...sdfDisplay.bbMin);
    const bbMax = new THREE.Vector3(...sdfDisplay.bbMax);
    const center = new THREE.Vector3().addVectors(bbMin, bbMax).multiplyScalar(0.5);
    const radius = bbMin.distanceTo(bbMax) * 0.5;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const dist = radius / Math.sin(fovRad / 2);

    // Position camera at a 3/4 view angle
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /**
   * Capture 4 views: current viewport + front/right/top.
   * Returns base64 PNG data URLs at the given resolution.
   */
  captureMultiView(size = 256): { images: string[]; description: string } | null {
    const sdfDisplay = useModelerStore.getState().sdfDisplay;
    if (!sdfDisplay) return null;

    // Compute scene center and radius from bounding box
    const bbMin = new THREE.Vector3(...sdfDisplay.bbMin);
    const bbMax = new THREE.Vector3(...sdfDisplay.bbMax);
    const center = new THREE.Vector3().addVectors(bbMin, bbMax).multiplyScalar(0.5);
    const radius = bbMin.distanceTo(bbMax) * 0.5;
    const dist = radius * 2.5;

    const dimX = (bbMax.x - bbMin.x).toFixed(1);
    const dimY = (bbMax.y - bbMin.y).toFixed(1);
    const dimZ = (bbMax.z - bbMin.z).toFixed(1);

    this.gizmo.setVisible(false);

    // Save current state
    const savedPos = this.camera.position.clone();
    const savedQuat = this.camera.quaternion.clone();
    const savedTarget = this.controls.target.clone();
    const savedAspect = this.camera.aspect;
    const savedSize = new THREE.Vector2();
    this.renderer.getSize(savedSize);

    // Compute a zoom-to-fit position for the "current" view so edits are always framed
    const fitDir = new THREE.Vector3().subVectors(savedPos, savedTarget);
    if (fitDir.lengthSq() < 1e-6) fitDir.set(1, 0.8, 1);
    fitDir.normalize();
    const fitPos = new THREE.Vector3().copy(center).addScaledVector(fitDir, dist);

    // Set up small render target — resize OutlinePass to match
    this.renderer.setSize(size, size);
    this.outlinePass.resize(size, size);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();

    const views: Array<{ name: string; pos: THREE.Vector3; axes: string }> = [
      { name: 'current', pos: fitPos, axes: '' },
      { name: 'front', pos: new THREE.Vector3(center.x, center.y, center.z + dist), axes: `X=${dimX}mm wide, Y=${dimY}mm tall` },
      { name: 'right', pos: new THREE.Vector3(center.x + dist, center.y, center.z), axes: `Z=${dimZ}mm deep, Y=${dimY}mm tall` },
      { name: 'top', pos: new THREE.Vector3(center.x, center.y + dist, center.z), axes: `X=${dimX}mm wide, Z=${dimZ}mm deep` },
    ];

    // Offscreen canvas for ruler overlay
    const overlay = document.createElement('canvas');
    overlay.width = size;
    overlay.height = size;
    const ctx = overlay.getContext('2d')!;

    const images: string[] = [];
    for (const view of views) {
      this.camera.position.copy(view.pos);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld();
      this.sdfMesh.update();
      this.outlinePass.render();

      // Composite: render + ruler overlay
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(this.renderer.domElement, 0, 0, size, size);

      // Draw ruler along the left edge for orthographic views
      if (view.name !== 'current') {
        this.drawRuler(ctx, size, view.name, bbMin, bbMax, dist);
      }

      images.push(overlay.toDataURL('image/webp', 0.6));
    }

    // Restore
    this.camera.position.copy(savedPos);
    this.camera.quaternion.copy(savedQuat);
    this.controls.target.copy(savedTarget);
    this.camera.aspect = savedAspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(savedSize.x, savedSize.y);
    this.outlinePass.resize(savedSize.x, savedSize.y);
    this.controls.update();
    this.gizmo.setVisible(true);

    const description = [
      `Model bounding box: ${dimX} x ${dimY} x ${dimZ} mm (W x H x D).`,
      `4 views attached: current viewport, front (${views[1].axes}), right (${views[2].axes}), top (${views[3].axes}).`,
      `Each orthographic view has a graduated ruler (mm) along the left and bottom edges for scale reference.`,
    ].join(' ');

    return { images, description };
  }

  /** Draw graduated rulers on the left and bottom edges of a captured view */
  private drawRuler(
    ctx: CanvasRenderingContext2D, size: number,
    viewName: string,
    bbMin: THREE.Vector3, bbMax: THREE.Vector3,
    cameraDist: number,
  ) {
    // Determine which world axes map to screen horizontal/vertical
    // For perspective camera at distance, compute visible extent
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(fovRad / 2) * cameraDist; // world units visible vertically
    const visibleWidth = visibleHeight; // aspect = 1

    const center = new THREE.Vector3().addVectors(bbMin, bbMax).multiplyScalar(0.5);
    let worldMinV: number, worldMaxV: number;
    let hLabel: string, vLabel: string;

    if (viewName === 'front') {
      // Looking from +Z: horizontal = X, vertical = Y
      worldMinV = center.y - visibleHeight / 2;
      worldMaxV = center.y + visibleHeight / 2;
      hLabel = 'X'; vLabel = 'Y';
    } else if (viewName === 'right') {
      // Looking from +X: horizontal = Z (inverted), vertical = Y
      worldMinV = center.y - visibleHeight / 2;
      worldMaxV = center.y + visibleHeight / 2;
      hLabel = 'Z'; vLabel = 'Y';
    } else {
      // top: looking from +Y: horizontal = X, vertical = Z (inverted)
      worldMinV = center.z - visibleHeight / 2;
      worldMaxV = center.z + visibleHeight / 2;
      hLabel = 'X'; vLabel = 'Z';
    }

    const margin = 18; // px from edge for ruler
    const tickLen = 4;

    // Choose a nice tick interval in mm
    const worldRange = visibleHeight;
    const targetTicks = 8;
    const rawInterval = worldRange / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
    const candidates = [1, 2, 5, 10];
    let interval = candidates[candidates.length - 1] * magnitude;
    for (const c of candidates) {
      if (c * magnitude >= rawInterval) { interval = c * magnitude; break; }
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(200, 200, 220, 0.7)';
    ctx.fillStyle = 'rgba(200, 200, 220, 0.85)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Vertical ruler (left edge)
    const vStart = Math.ceil(worldMinV / interval) * interval;
    ctx.beginPath();
    ctx.moveTo(margin, 0);
    ctx.lineTo(margin, size);
    ctx.stroke();

    for (let w = vStart; w <= worldMaxV; w += interval) {
      const screenY = size - ((w - worldMinV) / (worldMaxV - worldMinV)) * size;
      if (screenY < 5 || screenY > size - 5) continue;
      ctx.beginPath();
      ctx.moveTo(margin - tickLen, screenY);
      ctx.lineTo(margin + tickLen, screenY);
      ctx.stroke();
      ctx.save();
      ctx.translate(margin - tickLen - 2, screenY);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(w)}`, 0, 0);
      ctx.restore();
    }

    // Horizontal ruler (bottom edge)
    const hWorldMin = viewName === 'right' ? center.z - visibleWidth / 2 : center.x - visibleWidth / 2;
    const hWorldMax = viewName === 'right' ? center.z + visibleWidth / 2 : center.x + visibleWidth / 2;
    const hStart = Math.ceil(hWorldMin / interval) * interval;

    ctx.beginPath();
    ctx.moveTo(0, size - margin);
    ctx.lineTo(size, size - margin);
    ctx.stroke();

    for (let w = hStart; w <= hWorldMax; w += interval) {
      let screenX = ((w - hWorldMin) / (hWorldMax - hWorldMin)) * size;
      // Right view and top view Z-axis are inverted
      if (viewName === 'right') screenX = size - screenX;
      if (screenX < 5 || screenX > size - 5) continue;
      ctx.beginPath();
      ctx.moveTo(screenX, size - margin - tickLen);
      ctx.lineTo(screenX, size - margin + tickLen);
      ctx.stroke();
      ctx.fillText(`${Math.round(w)}`, screenX, size - margin + tickLen + 6);
    }

    // Axis labels
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`${hLabel} (mm)`, size / 2, size - 3);
    ctx.save();
    ctx.translate(5, size / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${vLabel} (mm)`, 0, 0);
    ctx.restore();

    ctx.restore();
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

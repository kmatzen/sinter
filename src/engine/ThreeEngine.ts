import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useModelerStore } from '../store/modelerStore';
import { useTreeUiStore } from '../store/treeUiStore';
import { useViewportStore } from '../store/viewportStore';
import { SdfMesh } from './SdfMesh';
import { OutlinePass } from './OutlinePass';
import { GizmoController } from './GizmoController';
import { attributePointDetails, type PointAttribution } from './sdfPicking';
import type { Vec3 } from '../worker/sdf/types';
import { makeTargetMeasurementAnchor } from '../types/measurement';
import { nodeWorldBounds } from './nodeBounds';
import { standardViewPose, type StandardView } from './cameraViews';
import { hasValidCameraBasis, type NamedProjectView } from '../types/view';

interface PickResult { path: string[]; point?: Vec3; attribution?: PointAttribution }

export class ThreeEngine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /**
   * The transform gizmo, kept out of the main scene.
   *
   * `OutlinePass` needs to render the gizmo alone to detect its edges, and it
   * used to achieve that by moving the TransformControls object out of `scene`
   * into a scratch scene and back again — every frame it was visible. That is
   * scene-graph mutation, and therefore matrix and render-list invalidation,
   * on the render path. Owning a second scene costs nothing and the pass just
   * draws whichever one it wants.
   */
  gizmoScene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  container: HTMLDivElement;

  private sdfMesh: SdfMesh;
  private outlinePass: OutlinePass;
  private gizmo: GizmoController;
  private animId: number = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  /**
   * Device-pixel-ratio ceiling.
   *
   * A sphere tracer's cost is per fragment, so a Retina display's ratio of 2
   * quadruples it for a difference the eye barely resolves on a shaded solid
   * with no text or hairlines in it. 1.5 is the usual ceiling for ray marchers.
   */
  private static readonly MAX_DPR = 1.5;

  /**
   * Ratio used while the camera is moving. Dropping to ~0.44x the fragments
   * for the duration of a drag is the largest perceived-latency win available
   * here, and the full-resolution frame lands on idle — which is just another
   * invalidation, so it needs no machinery of its own.
   */
  private static readonly INTERACTIVE_DPR = 1.0;

  /** How long after the last camera change to re-render at full resolution. */
  private static readonly SETTLE_MS = 180;

  /**
   * Frames are produced on demand.
   *
   * The loop used to call `outlinePass.render()` unconditionally forever, so a
   * static model with an idle camera marched the SDF at 60fps indefinitely.
   * The risk in the other direction is worse than the cost it removes — a
   * missed invalidation is a stale viewport — so every source that can change
   * a pixel calls `invalidate()`, and they are enumerated in `subscribe()`.
   */
  private dirty = true;
  private interacting = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribes: (() => void)[] = [];
  private frameListeners = new Set<() => void>();
  private projection: 'perspective' | 'orthographic' = 'perspective';
  private cameraTransition: {
    startedAt: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromUp: THREE.Vector3;
    toUp: THREE.Vector3;
    fromHalfHeight: number | null;
    toHalfHeight: number | null;
  } | null = null;

  constructor(container: HTMLDivElement) {
    this.container = container;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // No stencil attachment: nothing writes stencil now that the outline
      // masks itself from the depth texture.
      stencil: false,
      // `preserveDrawingBuffer` forces the driver to keep the back buffer
      // around across frames rather than letting it swap, and every capture
      // path here (takeScreenshot, captureMultiView, the e2e probes) renders
      // immediately before reading, in the same task, so the buffer is still
      // valid without it.
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, ThreeEngine.MAX_DPR));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.gizmoScene = new THREE.Scene();
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

    // Click handling for selection, and hover preview of what a click would hit
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.subscribe();
    const initialProjection = useViewportStore.getState().projection;
    if (initialProjection !== this.projection) this.setProjection(initialProjection);

    // Start
    this.animate();
  }

  /**
   * Every source that can change what the viewport shows.
   *
   * This list is the correctness argument for on-demand rendering: anything
   * missing here is a stale frame. The damping tail is handled in `animate()`
   * rather than here, because `controls.update()` is the only thing that knows
   * whether inertia is still moving the camera.
   */
  private subscribe() {
    const onControlsChange = () => {
      this.beginInteraction();
      this.invalidate();
    };
    this.controls.addEventListener('change', onControlsChange);
    this.unsubscribes.push(() => this.controls.removeEventListener('change', onControlsChange));
    const interruptTransition = () => { this.cameraTransition = null; };
    this.controls.addEventListener('start', interruptTransition);
    this.unsubscribes.push(() => this.controls.removeEventListener('start', interruptTransition));

    // New evaluated field, selection, warn state — SdfMesh.update() reads all
    // of them, and any of them can change a pixel.
    this.unsubscribes.push(useModelerStore.subscribe(() => this.invalidate()));
    // Clip plane, gizmo mode and space, dragging.
    this.unsubscribes.push(useViewportStore.subscribe((state) => {
      if (state.projection !== this.projection) this.setProjection(state.projection);
      this.invalidate();
    }));
  }

  /** Mark the frame stale. Cheap enough to call from anywhere. */
  invalidate = () => {
    this.dirty = true;
  };

  /**
   * Run `fn` after every frame this engine draws.
   *
   * Screen-space overlays (the dimension labels) used to keep their own
   * `requestAnimationFrame` loop, recomputing and writing SVG attributes every
   * frame whether or not the camera had moved — main-thread layout work
   * competing with GL submission, and it would have kept running after the
   * renderer went quiet. Driving them from here means they update exactly when
   * there is something new to look at.
   */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    this.invalidate();
    return () => this.frameListeners.delete(fn);
  }

  /**
   * Drop to the interactive pixel ratio, and arm the return to full.
   *
   * The settle timer restarts on every change, so a continuous drag stays at
   * the lower ratio and only the pause at the end pays for the sharp frame.
   */
  private beginInteraction() {
    if (!this.interacting) {
      this.interacting = true;
      this.applyPixelRatio();
    }
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.interacting = false;
      this.applyPixelRatio();
      this.invalidate();
    }, ThreeEngine.SETTLE_MS);
  }

  private applyPixelRatio() {
    const full = Math.min(window.devicePixelRatio, ThreeEngine.MAX_DPR);
    const ratio = this.interacting ? Math.min(full, ThreeEngine.INTERACTIVE_DPR) : full;
    if (Math.abs(this.renderer.getPixelRatio() - ratio) < 1e-6) return;
    this.renderer.setPixelRatio(ratio);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.outlinePass.resize(w, h);
  }

  private pointerStart: { x: number; y: number } = { x: 0, y: 0 };
  private pointerIsDown = false;
  /**
   * Picking is asynchronous now, so two quick clicks are two in-flight reads
   * that can resolve in either order. Without this, the second click's
   * selection could be overwritten by the first click's late answer.
   */
  private pickSeq = 0;
  /**
   * How far a pointer may travel between down and up and still count as a tap
   * rather than an orbit.
   *
   * A mouse does not move while clicking, so 4px was plenty. A fingertip is a
   * soft contact patch whose centroid wanders 5-10px over the course of a
   * deliberate tap, so the same threshold silently discarded a large share of
   * real selection taps — and the failure is invisible, indistinguishable from
   * having missed the model. 10px for touch still separates a tap from any
   * orbit gesture, which covers far more ground than that.
   */
  /** Hover's own sequence, so a slow hover read cannot clobber a click. */
  private hoverSeq = 0;
  private lastHoverAt = 0;
  private hoverPending = false;
  /**
   * A click's depth read is outstanding.
   *
   * Both paths go through one 1x1 pick target and one shared sample-UV
   * uniform, so a hover pick starting between a click's render and its readback
   * would redraw that target from under it — and the click is the one that must
   * not be wrong. Hover yields; it gets another sample 50ms later.
   */
  private clickPending = false;
  private static readonly TAP_SLOP_MOUSE = 4;
  private static readonly TAP_SLOP_TOUCH = 10;

  /**
   * How often a pointer move is allowed to trigger a pick.
   *
   * Each one costs a 1x1 render plus an async buffer read, and the CPU-side
   * attribution walks the tree — cheap individually, but a pointer move fires
   * per frame. 50ms is under the ~100ms at which a highlight stops feeling
   * attached to the cursor, and an order of magnitude fewer reads.
   */
  private static readonly HOVER_INTERVAL_MS = 50;

  /**
   * Which node owns the surface under a screen point, root-first, or [] for a
   * miss. Shared by click and hover so the thing the highlight promises and the
   * thing the click delivers cannot drift apart.
   *
   * `allowRender` is the difference between them: a click may force a frame to
   * get an up-to-date depth buffer, because a wrong selection is worse than a
   * hitch. Hover will not — forcing a full sphere-march per pointer move to
   * refresh a *preview* is the wrong trade, so it declines to guess instead.
   */
  private async pickPathAt(clientX: number, clientY: number, allowRender: boolean): Promise<PickResult | null> {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    const model = useModelerStore.getState();
    const tree = model.evaluatedTree === model.tree ? (model.evaluatedViewTree ?? model.tree) : null;
    const u = (ndcX + 1) / 2;
    const v = (ndcY + 1) / 2;

    // The depth texture holds the last frame drawn. With on-demand rendering
    // that can be one invalidation behind if the click lands before rAF fires,
    // and picking against a stale depth buffer selects the wrong node.
    if (this.dirty) {
      if (!allowRender) return null;
      this.dirty = false;
      this.renderNow();
    }
    const depth = await this.outlinePass.readDepthAt(u, v);
    if (this.disposed) return null;

    // depth ≈ 1 means far plane = no hit
    if (depth >= 1.0 - 1e-6 || !tree) return { path: [] };

    // Unproject depth to world position
    const zNdc = depth * 2 - 1;
    const invProjView = new THREE.Matrix4()
      .multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      .invert();
    const worldPos = new THREE.Vector4(ndcX, ndcY, zNdc, 1).applyMatrix4(invProjView);
    worldPos.divideScalar(worldPos.w);

    const hitPoint: Vec3 = [worldPos.x, worldPos.y, worldPos.z];
    const attribution = attributePointDetails(tree, hitPoint);
    return { path: attribution?.path ?? [], point: hitPoint, attribution: attribution ?? undefined };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerStart = { x: e.clientX, y: e.clientY };
    this.pointerIsDown = true;
  };

  private onPointerUp = async (e: PointerEvent) => {
    this.pointerIsDown = false;
    // A fingertip's contact centroid wanders farther than a mouse while tapping.
    const dx = e.clientX - this.pointerStart.x;
    const dy = e.clientY - this.pointerStart.y;
    const slop = e.pointerType === 'mouse'
      ? ThreeEngine.TAP_SLOP_MOUSE
      : ThreeEngine.TAP_SLOP_TOUCH;
    if (dx * dx + dy * dy > slop * slop) return;

    const seq = ++this.pickSeq;
    this.clickPending = true;
    let picked: PickResult | null;
    try {
      picked = await this.pickPathAt(e.clientX, e.clientY, true);
    } finally {
      this.clickPending = false;
    }
    if (picked === null || seq !== this.pickSeq || this.disposed) return;

    const store = useModelerStore.getState();
    const path = picked.path;
    if (path.length === 0) {
      store.selectNode(null);
      useViewportStore.getState().setHoveredNode(null);
      return;
    }

    const viewport = useViewportStore.getState();
    if (viewport.measurementMode && picked.point && picked.attribution && store.tree) {
      const anchor = makeTargetMeasurementAnchor(store.tree, picked.attribution, picked.point);
      if (anchor) viewport.addMeasurementPoint(anchor);
      return;
    }

    // Alt-click steps one level up the chain that owns the surface, so the
    // boolean or transform *containing* the clicked primitive can be selected
    // without hunting for it in the tree. Picking always lands on a leaf —
    // that is what "which shape is this pixel" means — but the node a user
    // wants to edit is often the operation just above it.
    const index = e.altKey ? Math.max(0, path.length - 2) : path.length - 1;
    const locked = useTreeUiStore.getState().lockedNodeIds;
    const selectable = path.slice(0, index + 1).reverse().find((id) => !locked.has(id));
    if (selectable) store.selectNode(selectable, e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : 'replace');

    // A finger has no hover state to leave behind, and `pointerleave` is not
    // guaranteed after a touch ends — so without this the last tapped node
    // stays highlighted as "what a click would select" indefinitely.
    if (e.pointerType !== 'mouse') useViewportStore.getState().setHoveredNode(null);
  };

  /**
   * Preview which node a click would select.
   *
   * Selection used to be entirely blind: the model gives no clue where one
   * node's surface ends and the next begins, so clicking was a guess followed
   * by reading a side panel to find out what you got. Hovering resolves that
   * before the click instead of after it.
   */
  private onPointerMove = (e: PointerEvent) => {
    // Mid-drag the pointer is orbiting the camera or pulling a gizmo handle;
    // neither is aiming at anything, and the depth buffer is stale anyway.
    if (this.pointerIsDown || useViewportStore.getState().dragging) return;
    if (this.hoverPending || this.clickPending) return;

    const now = performance.now();
    if (now - this.lastHoverAt < ThreeEngine.HOVER_INTERVAL_MS) return;
    this.lastHoverAt = now;

    const seq = ++this.hoverSeq;
    this.hoverPending = true;
    const { clientX, clientY } = e;
    this.pickPathAt(clientX, clientY, false)
      .then((picked) => {
        if (seq !== this.hoverSeq || this.disposed) return;
        // null means "could not answer this time" (no fresh frame). Leaving the
        // previous highlight alone beats flickering it off and back on while
        // the model re-renders.
        if (picked === null) return;
        const id = picked.path.length > 0 ? picked.path[picked.path.length - 1] : null;
        useViewportStore.getState().setHoveredNode(id, 'viewport');
        this.renderer.domElement.style.cursor = id ? (useViewportStore.getState().measurementMode ? 'crosshair' : 'pointer') : '';
      })
      .finally(() => {
        this.hoverPending = false;
      });
  };

  private onPointerLeave = () => {
    this.pointerIsDown = false;
    this.hoverSeq++;
    useViewportStore.getState().setHoveredNode(null);
    this.renderer.domElement.style.cursor = '';
  };

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h;
    } else {
      const halfHeight = (this.camera.top - this.camera.bottom) / 2;
      const halfWidth = halfHeight * w / h;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.outlinePass.resize(w, h);
    this.invalidate();
  }

  /**
   * Poll for work, draw only when there is some.
   *
   * The rAF loop still runs — it is the only place `controls.update()` can be
   * called, and OrbitControls' damping tail moves the camera without emitting
   * anything. `update()` returns whether it actually moved, so the tail keeps
   * the frame dirty by itself and stops the moment it settles. Everything else
   * arrives through `invalidate()`.
   */
  private animate = () => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.animate);

    if (this.stepCameraTransition(performance.now())) this.dirty = true;
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;

    this.sdfMesh.update();
    this.gizmo.update();
    this.outlinePass.render();
    for (const fn of this.frameListeners) fn();
  };

  /** Draw one frame now, whatever the dirty flag says. */
  renderNow() {
    this.sdfMesh.update();
    this.gizmo.update();
    this.outlinePass.render();
    for (const fn of this.frameListeners) fn();
  }

  /** Frame the camera to fit the current model's bounding box */
  zoomToFit() {
    const sdfDisplay = useModelerStore.getState().sdfDisplay;
    if (!sdfDisplay) return;

    this.applyStandardView('isometric', { min: sdfDisplay.bbMin, max: sdfDisplay.bbMax });
  }

  /** Frame the selected operation without changing its exact current view axis. */
  frameSelection() {
    const model = useModelerStore.getState();
    if (!model.tree || !model.selectedNodeId) return;
    const bounds = nodeWorldBounds(model.tree, model.selectedNodeId);
    if (!bounds) return;
    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-12) direction.set(1, 0.8, 1);
    const pose = standardViewPose(bounds, 'isometric', 50);
    const target = new THREE.Vector3(...pose.target);
    this.camera.position.copy(target).addScaledVector(direction.normalize(), pose.distance);
    this.controls.target.copy(target);
    this.fitOrthographicFrustum(bounds);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    this.controls.update();
    this.invalidate();
  }

  setStandardView(view: StandardView) {
    const sdfDisplay = useModelerStore.getState().sdfDisplay;
    if (!sdfDisplay) return;
    const bounds = { min: sdfDisplay.bbMin, max: sdfDisplay.bbMax };
    const pose = standardViewPose(bounds, view, 50);
    const diagonal = new THREE.Vector3(...bounds.min).distanceTo(new THREE.Vector3(...bounds.max));
    this.transitionCamera(
      new THREE.Vector3(...pose.position), new THREE.Vector3(...pose.target), new THREE.Vector3(...pose.up),
      this.camera instanceof THREE.OrthographicCamera ? Math.max(diagonal * 0.55, 0.05) : null,
    );
  }

  private transitionCamera(position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, halfHeight: number | null) {
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      this.camera.position.copy(position); this.controls.target.copy(target); this.camera.up.copy(up);
      if (halfHeight !== null && this.camera instanceof THREE.OrthographicCamera) this.setOrthographicHalfHeight(halfHeight);
      this.camera.lookAt(target); this.camera.updateMatrixWorld(); this.controls.update(); this.invalidate();
      return;
    }
    this.cameraTransition = {
      startedAt: performance.now(), duration: 240,
      fromPosition: this.camera.position.clone(), toPosition: position,
      fromTarget: this.controls.target.clone(), toTarget: target,
      fromUp: this.camera.up.clone(), toUp: up,
      fromHalfHeight: this.camera instanceof THREE.OrthographicCamera ? (this.camera.top - this.camera.bottom) / 2 / this.camera.zoom : null,
      toHalfHeight: halfHeight,
    };
    this.invalidate();
  }

  private stepCameraTransition(now: number): boolean {
    const transition = this.cameraTransition;
    if (!transition) return false;
    const raw = Math.min(1, Math.max(0, (now - transition.startedAt) / transition.duration));
    const t = 1 - (1 - raw) ** 3;
    this.camera.position.lerpVectors(transition.fromPosition, transition.toPosition, t);
    this.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, t);
    this.camera.up.lerpVectors(transition.fromUp, transition.toUp, t).normalize();
    if (transition.fromHalfHeight !== null && transition.toHalfHeight !== null && this.camera instanceof THREE.OrthographicCamera) {
      this.setOrthographicHalfHeight(THREE.MathUtils.lerp(transition.fromHalfHeight, transition.toHalfHeight, t));
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
    if (raw >= 1) this.cameraTransition = null;
    return true;
  }

  private setOrthographicHalfHeight(halfHeight: number) {
    if (!(this.camera instanceof THREE.OrthographicCamera)) return;
    const aspect = Math.max(this.container.clientWidth / Math.max(this.container.clientHeight, 1), 1e-6);
    this.camera.left = -halfHeight * aspect; this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight; this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
  }

  viewQuaternion(): [number, number, number, number] {
    return this.camera.quaternion.toArray() as [number, number, number, number];
  }

  orbitFromWidget(deltaX: number, deltaY: number): void {
    this.cameraTransition = null;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * 0.012;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - deltaY * 0.012, 0.02, Math.PI - 0.02);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
    this.controls.update();
    this.invalidate();
  }

  private applyStandardView(view: StandardView, bounds: { min: Vec3; max: Vec3 }) {
    const pose = standardViewPose(bounds, view, 50);
    this.camera.up.set(...pose.up);
    this.camera.position.set(...pose.position);
    this.controls.target.set(...pose.target);
    this.fitOrthographicFrustum(bounds);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
    this.controls.update();
    this.invalidate();
  }

  private fitOrthographicFrustum(bounds: { min: Vec3; max: Vec3 }) {
    if (!(this.camera instanceof THREE.OrthographicCamera)) return;
    const diagonal = new THREE.Vector3(...bounds.min).distanceTo(new THREE.Vector3(...bounds.max));
    const halfHeight = Math.max(diagonal * 0.55, 0.05);
    this.setOrthographicHalfHeight(halfHeight);
  }

  /** Switch projection while preserving the target and apparent vertical span. */
  setProjection(projection: 'perspective' | 'orthographic') {
    if (projection === this.projection) return;
    const target = this.controls.target.clone();
    const direction = this.camera.position.clone().sub(target);
    const distance = Math.max(direction.length(), 0.1);
    direction.normalize();
    const aspect = Math.max(this.container.clientWidth / Math.max(this.container.clientHeight, 1), 1e-6);
    let replacement: THREE.PerspectiveCamera | THREE.OrthographicCamera;

    if (projection === 'orthographic') {
      const source = this.camera as THREE.PerspectiveCamera;
      const halfHeight = distance * Math.tan((source.fov * Math.PI) / 360) / source.zoom;
      replacement = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, 50_000);
      replacement.position.copy(source.position);
    } else {
      const source = this.camera as THREE.OrthographicCamera;
      const halfHeight = (source.top - source.bottom) / (2 * source.zoom);
      replacement = new THREE.PerspectiveCamera(50, aspect, 0.01, 50_000);
      const nextDistance = halfHeight / Math.tan((replacement.fov * Math.PI) / 360);
      replacement.position.copy(target).addScaledVector(direction, nextDistance);
    }
    replacement.up.copy(this.camera.up);
    replacement.quaternion.copy(this.camera.quaternion);
    replacement.updateProjectionMatrix();
    replacement.updateMatrixWorld();

    this.camera = replacement;
    (this.controls as unknown as { object: THREE.Camera }).object = replacement;
    this.gizmo.setCamera(replacement);
    this.projection = projection;
    this.controls.update();
    this.invalidate();
  }

  captureNamedView(name: string): NamedProjectView {
    const cleanName = name.trim().slice(0, 256);
    if (!cleanName) throw new Error('View name is required');
    const target = this.controls.target;
    const distance = Math.max(this.camera.position.distanceTo(target), 1e-6);
    const verticalSpan = this.camera instanceof THREE.PerspectiveCamera
      ? 2 * distance * Math.tan((this.camera.fov * Math.PI) / 360) / this.camera.zoom
      : (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const viewport = useViewportStore.getState();
    const view: NamedProjectView = {
      id: crypto.randomUUID(), name: cleanName, createdAt: new Date().toISOString(),
      position: this.camera.position.toArray() as [number, number, number],
      target: target.toArray() as [number, number, number],
      up: this.camera.up.toArray() as [number, number, number],
      projection: this.projection,
      verticalSpan,
      clipping: { enabled: viewport.clipEnabled, axis: viewport.clipAxis, position: viewport.clipPosition, flip: viewport.clipFlip },
    };
    if (!hasValidCameraBasis(view.position, view.target, view.up)) {
      throw new Error('The current camera orientation cannot be saved; orbit the view slightly and try again');
    }
    return view;
  }

  applyNamedView(view: NamedProjectView): void {
    if (!hasValidCameraBasis(view.position, view.target, view.up)) {
      throw new Error('Named view has an invalid camera orientation');
    }
    if (view.projection !== this.projection) this.setProjection(view.projection);
    this.camera.position.fromArray(view.position);
    this.camera.up.fromArray(view.up).normalize();
    this.controls.target.fromArray(view.target);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const distance = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-6);
      this.camera.zoom = Math.max(1e-4, Math.min(1e4,
        2 * distance * Math.tan((this.camera.fov * Math.PI) / 360) / view.verticalSpan));
    } else {
      const halfHeight = view.verticalSpan / 2;
      const aspect = Math.max(this.container.clientWidth / Math.max(this.container.clientHeight, 1), 1e-6);
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.zoom = 1;
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    useViewportStore.setState({
      projection: view.projection,
      clipEnabled: view.clipping.enabled,
      clipAxis: view.clipping.axis,
      clipPosition: view.clipping.position,
      clipFlip: view.clipping.flip,
    });
    this.controls.update();
    this.invalidate();
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
    const savedProjection = this.camera instanceof THREE.PerspectiveCamera
      ? { kind: 'perspective' as const, aspect: this.camera.aspect }
      : { kind: 'orthographic' as const, left: this.camera.left, right: this.camera.right, top: this.camera.top, bottom: this.camera.bottom };
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
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = 1;
    } else {
      const half = Math.max(radius * 1.2, 0.05);
      this.camera.left = -half; this.camera.right = half;
      this.camera.top = half; this.camera.bottom = -half;
    }
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
    if (savedProjection.kind === 'perspective' && this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = savedProjection.aspect;
    } else if (savedProjection.kind === 'orthographic' && this.camera instanceof THREE.OrthographicCamera) {
      this.camera.left = savedProjection.left; this.camera.right = savedProjection.right;
      this.camera.top = savedProjection.top; this.camera.bottom = savedProjection.bottom;
    }
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
    const visibleHeight = this.camera instanceof THREE.OrthographicCamera
      ? (this.camera.top - this.camera.bottom) / this.camera.zoom
      : 2 * Math.tan((this.camera.fov * Math.PI) / 360) * cameraDist;
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
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.frameListeners.clear();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    useViewportStore.getState().setHoveredNode(null);
    this.sdfMesh.dispose();
    this.outlinePass.dispose();
    this.gizmo.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

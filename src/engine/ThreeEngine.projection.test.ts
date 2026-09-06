import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ThreeEngine } from './ThreeEngine';
import { useViewportStore } from '../store/viewportStore';

function harness() {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.01, 5_000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const controls = { target: new THREE.Vector3(), object: camera as THREE.Camera, update: vi.fn() };
  const gizmo = { setCamera: vi.fn() };
  const engine = Object.create(ThreeEngine.prototype) as ThreeEngine;
  Object.assign(engine, {
    camera, controls, gizmo,
    container: { clientWidth: 800, clientHeight: 400 },
    projection: 'perspective', dirty: false, invalidate: vi.fn(),
  });
  return { engine, controls, gizmo };
}

describe('ThreeEngine projection switching', () => {
  it('preserves target, direction, and apparent vertical framing round-trip', () => {
    const { engine, controls, gizmo } = harness();
    const perspective = engine.camera as THREE.PerspectiveCamera;
    const beforeHalfHeight = perspective.position.distanceTo(controls.target) * Math.tan(perspective.fov * Math.PI / 360);

    engine.setProjection('orthographic');
    expect(engine.camera).toBeInstanceOf(THREE.OrthographicCamera);
    const orthographic = engine.camera as THREE.OrthographicCamera;
    expect((orthographic.top - orthographic.bottom) / 2 / orthographic.zoom).toBeCloseTo(beforeHalfHeight, 10);
    expect(controls.object).toBe(orthographic);
    expect(gizmo.setCamera).toHaveBeenLastCalledWith(orthographic);

    engine.setProjection('perspective');
    expect(engine.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    const restored = engine.camera as THREE.PerspectiveCamera;
    const afterHalfHeight = restored.position.distanceTo(controls.target) * Math.tan(restored.fov * Math.PI / 360);
    expect(afterHalfHeight).toBeCloseTo(beforeHalfHeight, 10);
    expect(restored.position.clone().sub(controls.target).normalize().toArray()).toEqual([0, 0, 1]);
  });

  it('frames bounds by changing the orthographic frustum', () => {
    const { engine } = harness();
    engine.setProjection('orthographic');
    const camera = engine.camera as THREE.OrthographicCamera;
    const previousHeight = camera.top - camera.bottom;

    (engine as unknown as { applyStandardView: (view: string, bounds: { min: [number, number, number]; max: [number, number, number] }) => void })
      .applyStandardView('front', { min: [-5, -10, -15], max: [5, 10, 15] });

    expect(camera.top - camera.bottom).not.toBe(previousHeight);
    expect(camera.top - camera.bottom).toBeCloseTo(Math.hypot(10, 20, 30) * 1.1, 10);
    expect(camera.right - camera.left).toBeCloseTo((camera.top - camera.bottom) * 2, 10);
  });

  it('captures and restores camera, projection, framing, and clipping exactly', () => {
    const { engine, controls } = harness();
    useViewportStore.setState({ clipEnabled: true, clipAxis: 'x', clipPosition: 7, clipFlip: true });
    const saved = engine.captureNamedView('Inspection');

    engine.setProjection('orthographic');
    engine.camera.position.set(20, 30, 40);
    controls.target.set(1, 2, 3);
    useViewportStore.setState({ clipEnabled: false, clipAxis: 'y', clipPosition: 0, clipFlip: false });
    engine.applyNamedView(saved);

    expect(engine.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(engine.camera.position.toArray()).toEqual(saved.position);
    expect(controls.target.toArray()).toEqual(saved.target);
    const camera = engine.camera as THREE.PerspectiveCamera;
    const span = 2 * camera.position.distanceTo(controls.target) * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
    expect(span).toBeCloseTo(saved.verticalSpan, 10);
    expect(useViewportStore.getState()).toMatchObject({ projection: 'perspective', clipEnabled: true, clipAxis: 'x', clipPosition: 7, clipFlip: true });
  });

  it('refuses to capture or apply a camera with undefined roll', () => {
    const { engine, controls } = harness();
    engine.camera.up.set(0, 0, 1);
    expect(() => engine.captureNamedView('Broken')).toThrow(/cannot be saved/);

    engine.camera.up.set(0, 1, 0);
    const valid = engine.captureNamedView('Valid');
    expect(() => engine.applyNamedView({ ...valid, up: [0, 0, -1] })).toThrow(/invalid camera orientation/);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
  });

  it('eases camera transitions to the exact requested pose and allows replacement mid-flight', () => {
    const { engine, controls } = harness();
    const internals = engine as unknown as {
      transitionCamera: (position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, halfHeight: number | null) => void;
      stepCameraTransition: (now: number) => boolean;
      cameraTransition: { startedAt: number; duration: number } | null;
    };
    internals.transitionCamera(new THREE.Vector3(10, 20, 30), new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 1, 0), null);
    internals.stepCameraTransition(internals.cameraTransition!.startedAt + 100);
    internals.transitionCamera(new THREE.Vector3(-30, 10, 5), new THREE.Vector3(4, 5, 6), new THREE.Vector3(0, 1, 0), null);
    internals.stepCameraTransition(internals.cameraTransition!.startedAt + internals.cameraTransition!.duration);
    expect(engine.camera.position.toArray()).toEqual([-30, 10, 5]);
    expect(controls.target.toArray()).toEqual([4, 5, 6]);
    expect(internals.cameraTransition).toBeNull();
  });
});

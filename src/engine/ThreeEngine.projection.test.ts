import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ThreeEngine } from './ThreeEngine';

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
});

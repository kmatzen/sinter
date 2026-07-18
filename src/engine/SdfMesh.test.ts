import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SdfMesh } from './SdfMesh';
import { useModelerStore, type SDFDisplayData } from '../store/modelerStore';
import type { ThreeEngine } from './ThreeEngine';

/**
 * Three.js does not free GPU resources when an object leaves the scene graph,
 * so SdfMesh must dispose the material, geometry, and textures itself on every
 * rebuild. These tests pin that contract — they fail against the pre-fix code,
 * which only called scene.remove().
 */

function display(glsl: string, textureCount = 0): SDFDisplayData {
  return {
    glsl,
    paramCount: 1,
    paramValues: [0],
    textures: Array.from({ length: textureCount }, (_, i) => ({
      name: `u_tex${i}`,
      width: 2,
      height: 2,
      data: [0, 0, 0, 0],
    })),
    bbMin: [-1, -1, -1],
    bbMax: [1, 1, 1],
    hasWarn: false,
  };
}

/** Minimal stand-in for ThreeEngine — SdfMesh only touches `scene`. */
function fakeEngine() {
  return { scene: new THREE.Scene() } as unknown as ThreeEngine;
}

/** The material/geometry/textures SdfMesh is currently holding. */
function currentResources(sdfMesh: SdfMesh) {
  const self = sdfMesh as unknown as {
    mesh: THREE.Mesh | null;
    material: THREE.ShaderMaterial | null;
  };
  const textures = self.material
    ? Object.values(self.material.uniforms)
        .map((u) => u?.value)
        .filter((v): v is THREE.Texture => v instanceof THREE.Texture)
    : [];
  return { mesh: self.mesh, material: self.material, textures };
}

beforeEach(() => {
  useModelerStore.setState({ sdfDisplay: null });
});

describe('SdfMesh GPU resource lifecycle', () => {
  it('disposes the previous material, geometry, and textures on rebuild', () => {
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}', 2) });
    const sdfMesh = new SdfMesh(fakeEngine());

    const first = currentResources(sdfMesh);
    expect(first.material).not.toBeNull();
    expect(first.textures).toHaveLength(2);

    const materialSpy = vi.spyOn(first.material!, 'dispose');
    const geometrySpy = vi.spyOn(first.mesh!.geometry, 'dispose');
    const textureSpies = first.textures.map((t) => vi.spyOn(t, 'dispose'));

    // A structurally different tree forces a rebuild.
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 2.0;}', 2) });

    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    for (const spy of textureSpies) expect(spy).toHaveBeenCalledTimes(1);

    // And the replacement is live, not disposed along with it.
    const second = currentResources(sdfMesh);
    expect(second.material).not.toBe(first.material);
    expect(second.mesh).not.toBeNull();
  });

  it('disposes when the display clears', () => {
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}', 1) });
    const sdfMesh = new SdfMesh(fakeEngine());

    const { material, mesh, textures } = currentResources(sdfMesh);
    const materialSpy = vi.spyOn(material!, 'dispose');
    const geometrySpy = vi.spyOn(mesh!.geometry, 'dispose');
    const textureSpy = vi.spyOn(textures[0], 'dispose');

    useModelerStore.setState({ sdfDisplay: null });

    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
    expect(currentResources(sdfMesh).material).toBeNull();
  });

  it('disposes on dispose()', () => {
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}', 1) });
    const sdfMesh = new SdfMesh(fakeEngine());

    const { material, mesh, textures } = currentResources(sdfMesh);
    const materialSpy = vi.spyOn(material!, 'dispose');
    const geometrySpy = vi.spyOn(mesh!.geometry, 'dispose');
    const textureSpy = vi.spyOn(textures[0], 'dispose');

    sdfMesh.dispose();

    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
  });

  it('removes the mesh from the scene when it is released', () => {
    const engine = fakeEngine();
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}') });
    const sdfMesh = new SdfMesh(engine);

    expect(engine.scene.children).toHaveLength(1);
    sdfMesh.dispose();
    expect(engine.scene.children).toHaveLength(0);
  });
});

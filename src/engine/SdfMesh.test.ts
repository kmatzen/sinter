import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { MAX_GENERATED_SHADER_CHARS, SdfMesh, shaderCapacityError } from './SdfMesh';
import { useModelerStore, type SDFDisplayData } from '../store/modelerStore';
import { useViewportStore } from '../store/viewportStore';
import type { ThreeEngine } from './ThreeEngine';
import { generateSDFFunction } from '../worker/sdf/codegen';
import type { SDFNode } from '../worker/sdf/types';

/**
 * Three.js does not free GPU resources when an object leaves the scene graph,
 * so SdfMesh must dispose the material, geometry, and textures itself on every
 * rebuild. These tests pin that contract — they fail against the pre-fix code,
 * which only called scene.remove().
 */

function display(
  glsl: string,
  textureCount = 0,
  overrides: Partial<SDFDisplayData> = {},
): SDFDisplayData {
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
    ...overrides,
  };
}

/** Minimal stand-in for ThreeEngine — SdfMesh only touches `scene`. */
function fakeEngine() {
  return { scene: new THREE.Scene() } as unknown as ThreeEngine;
}

function constrainedEngine(uniformVectors: number, textureUnits: number) {
  const context = {
    MAX_FRAGMENT_UNIFORM_VECTORS: 1,
    MAX_TEXTURE_IMAGE_UNITS: 2,
    getParameter: (parameter: number) => parameter === 1 ? uniformVectors : textureUnits,
  };
  return {
    scene: new THREE.Scene(),
    renderer: { getContext: () => context },
  } as unknown as ThreeEngine;
}

function renderableEngine() {
  const engine = constrainedEngine(1_024, 16) as unknown as {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: {
      getContext: () => unknown;
      getSize: (target: THREE.Vector2) => THREE.Vector2;
      getPixelRatio: () => number;
    };
  };
  engine.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10_000);
  engine.camera.position.set(0, 0, 10);
  engine.camera.updateMatrixWorld();
  engine.renderer.getSize = (target) => target.set(800, 600);
  engine.renderer.getPixelRatio = () => 1;
  return engine as unknown as ThreeEngine;
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

describe('shader capacity preflight', () => {
  it('rejects a document-sized parameter array on minimum WebGL 2 limits', () => {
    let level: SDFNode[] = Array.from({ length: 500 }, () => ({ kind: 'box', size: [1, 1, 1] }));
    while (level.length > 1) {
      const next: SDFNode[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? { kind: 'union', a: level[i], b: level[i + 1], k: 0 } : level[i]);
      level = next;
    }
    const generated = generateSDFFunction(level[0]);
    expect(generated.paramCount).toBe(1_500);
    expect(shaderCapacityError({ ...display(generated.glsl), ...generated }, {
      maxFragmentUniformComponents: 1_024,
      maxTextureImageUnits: 16,
    })).toMatch(/needs 1538.*supports 1024/);
  });

  it('accounts for fixed uniforms and imported-field samplers', () => {
    const capacity = { maxFragmentUniformComponents: 64, maxTextureImageUnits: 1 };
    expect(shaderCapacityError(display('', 0, { paramCount: 31 }), capacity)).toMatch(/fragment-uniform/);
    expect(shaderCapacityError(display('', 2, { paramCount: 1 }), capacity)).toMatch(/needs 2 fragment textures/);
    expect(shaderCapacityError(display('', 1, { paramCount: 1 }), capacity)).toBeNull();
  });

  it('rejects overly large generated source before compilation', () => {
    expect(shaderCapacityError(display('x'.repeat(MAX_GENERATED_SHADER_CHARS + 1)), {
      maxFragmentUniformComponents: 4_096, maxTextureImageUnits: 16,
    })).toMatch(/generated shader source.*above the supported/i);
  });

  it('refuses an unsupported display before allocating GPU resources', () => {
    const engine = constrainedEngine(16, 8); // 64 fragment-uniform components
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}', 0, { paramCount: 31 }), error: null });

    const sdfMesh = new SdfMesh(engine);

    expect(engine.scene.children).toHaveLength(0);
    expect(currentResources(sdfMesh).material).toBeNull();
    expect(useModelerStore.getState().sdfDisplay).not.toBeNull();
    expect(useModelerStore.getState().error).toMatch(/this GPU supports 64/i);
    expect(useModelerStore.getState().error).toMatch(/CPU export remains available/i);
  });

  it('preserves the prior material when a replacement shader fails compilation', () => {
    const engine = renderableEngine() as any;
    engine.renderer.debug = { onShaderError: null };
    const compile = vi.fn();
    engine.renderer.compile = compile;
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}'), error: null });
    const sdfMesh = new SdfMesh(engine);
    const prior = currentResources(sdfMesh);
    compile.mockImplementationOnce(() => engine.renderer.debug.onShaderError?.(null, null, null, null));

    const failed = display('float sdf(vec3 p){return 2.0;}', 0, { paramValues: [99], bbMin: [50, 50, 50], bbMax: [60, 60, 60] });
    useModelerStore.setState({ sdfDisplay: failed, error: null });
    sdfMesh.update();

    expect(currentResources(sdfMesh)).toMatchObject({ material: prior.material, mesh: prior.mesh });
    expect(useModelerStore.getState().sdfDisplay).toBe(failed);
    expect(useModelerStore.getState().error).toMatch(/prior preview is preserved/i);
    expect((prior.material!.uniforms.u_p.value as Float32Array)[0]).toBe(0);
    expect(prior.material!.uniforms.u_bbMin.value.toArray()).toEqual([-Math.sqrt(3), -Math.sqrt(3), -Math.sqrt(3)]);
  });
});

describe('viewport clipping uniforms', () => {
  it('uses the same active clipping plane for rendering and depth picking', () => {
    useViewportStore.setState({ clipEnabled: true, clipAxis: 'z', clipPosition: 2.5, clipFlip: true });
    useModelerStore.setState({ sdfDisplay: display('float sdf(vec3 p){return 1.0;}') });
    const sdfMesh = new SdfMesh(renderableEngine());

    sdfMesh.update();

    const material = currentResources(sdfMesh).material!;
    expect(material.uniforms.u_clipEnabled.value).toBe(1);
    expect(material.uniforms.u_clipAxis.value).toBe(2);
    expect(material.uniforms.u_clipPos.value).toBe(2.5);
    expect(material.uniforms.u_clipFlip.value).toBe(1);
  });
});

describe('SdfMesh rebuild cache key', () => {
  const GLSL = 'float sdf(vec3 p){return 1.0;}';

  it('rebuilds when hasWarn changes at identical GLSL', () => {
    useModelerStore.setState({ sdfDisplay: display(GLSL, 0, { hasWarn: false }) });
    const sdfMesh = new SdfMesh(fakeEngine());
    const before = currentResources(sdfMesh).material;

    // Same GLSL and param count; only the warn flag differs. It is compiled
    // into the fragment source, so the material must be rebuilt.
    useModelerStore.setState({ sdfDisplay: display(GLSL, 0, { hasWarn: true }) });

    expect(currentResources(sdfMesh).material).not.toBe(before);
  });

  it('rebuilds when texture content changes at identical dimensions', () => {
    const withData = (data: number[]) =>
      display(GLSL, 0, { textures: [{ name: 'u_tex0', width: 2, height: 2, data }] });

    useModelerStore.setState({ sdfDisplay: withData([0, 0, 0, 0]) });
    const sdfMesh = new SdfMesh(fakeEngine());
    const before = currentResources(sdfMesh).material;

    useModelerStore.setState({ sdfDisplay: withData([1, 2, 3, 4]) });

    expect(currentResources(sdfMesh).material).not.toBe(before);
  });

  it('does not rebuild when nothing baked into the material changed', () => {
    useModelerStore.setState({ sdfDisplay: display(GLSL) });
    const sdfMesh = new SdfMesh(fakeEngine());
    const before = currentResources(sdfMesh).material;

    // A fresh object with identical contents must not force a recompile.
    useModelerStore.setState({ sdfDisplay: display(GLSL) });

    expect(currentResources(sdfMesh).material).toBe(before);
  });
});

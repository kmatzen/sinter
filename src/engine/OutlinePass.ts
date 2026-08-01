import * as THREE from 'three';
export interface OutlinePassEngine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  container: HTMLElement;
}

const GIZMO_OUTLINE_FRAG = `
precision highp float;
uniform sampler2D u_gizmo;
uniform vec2 u_resolution;
varying vec2 vUv;

void main() {
  float px = 1.0 / u_resolution.x;
  float py = 1.0 / u_resolution.y;
  float center = texture2D(u_gizmo, vUv).a;

  // Dilate: check if any neighbor has gizmo alpha
  float maxAlpha = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      if (x == 0 && y == 0) continue;
      float r = sqrt(float(x*x + y*y));
      if (r > 2.5) continue;
      vec2 offset = vec2(float(x) * px, float(y) * py);
      float a = texture2D(u_gizmo, vUv + offset).a;
      maxAlpha = max(maxAlpha, a);
    }
  }

  // Outline where neighbors have alpha but center doesn't (or is different)
  float edge = maxAlpha * (1.0 - center);
  if (edge < 0.01) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, edge * 0.5);
}
`;

const QUAD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * Copy the offscreen scene colour to the screen, alpha and all.
 *
 * This exists so the scene is marched once instead of twice. The pass that
 * fills the depth texture used to be a *separate* full render — meaning the
 * 256-iteration sphere trace plus its six-evaluation normal ran twice per
 * frame at full device-pixel resolution, and the first run's colour was thrown
 * away. Now one render fills colour and depth together, and getting it onto the
 * screen costs a texture fetch per pixel.
 */
const BLIT_FRAG = `
precision highp float;
uniform sampler2D u_color;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(u_color, vUv);
}
`;

const OUTLINE_FRAG = `
precision highp float;
uniform sampler2D u_depth;
uniform vec2 u_resolution;
uniform float u_near;
uniform float u_far;
uniform float u_radius;
varying vec2 vUv;

void main() {
  float px = 1.0 / u_resolution.x;
  float py = 1.0 / u_resolution.y;
  float d = texture2D(u_depth, vUv).r;
  float farThreshold = u_far * 0.99;
  float linearD = u_near * u_far / (u_far - d * (u_far - u_near));
  bool isBg = linearD > farThreshold;
  bool isShape = !isBg;

  float outline = 0.0;
  float total = 0.0;

  for (int x = -4; x <= 4; x++) {
    for (int y = -4; y <= 4; y++) {
      if (x == 0 && y == 0) continue;
      float r = sqrt(float(x*x + y*y));
      if (r > u_radius) continue;
      vec2 offset = vec2(float(x) * px, float(y) * py);
      float nd = texture2D(u_depth, vUv + offset).r;
      float nLinear = u_near * u_far / (u_far - nd * (u_far - u_near));
      bool nShape = nLinear < farThreshold;
      float w = 1.0 - r / (u_radius + 1.0);
      if (isShape && !nShape) outline += w;
      if (isBg && nShape) outline += w;
      if (isShape && nShape) {
        float relDiff = abs(linearD - nLinear) / linearD;
        if (relDiff > 0.01) outline += w * smoothstep(0.01, 0.03, relDiff);
      }
      total += w;
    }
  }

  // Shape pixels never received an outline: the quad used to carry
  // NotEqualStencilFunc against the stencil the SDF material wrote, so this
  // branch's contribution was masked out. isShape is that same fact read from
  // the depth texture, which is why the stencil on both materials could go.
  // Dropping the branch would change the rendered image -- interior crease
  // outlines would start appearing -- so it is a discard, not a deletion.
  if (isShape) discard;

  outline = clamp(outline / total * 3.0, 0.0, 1.0);
  float alpha = smoothstep(0.0, 0.3, outline);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
}
`;

export class OutlinePass {
  private engine: OutlinePassEngine;
  /** Colour *and* depth from the one scene render. */
  private sceneTarget: THREE.WebGLRenderTarget;
  private gizmoTarget: THREE.WebGLRenderTarget;
  private quadScene: THREE.Scene;
  private blitScene: THREE.Scene;
  private gizmoQuadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private material: THREE.ShaderMaterial;
  private blitMaterial: THREE.ShaderMaterial;
  private gizmoMaterial: THREE.ShaderMaterial;
  private gizmoScene: THREE.Scene;

  // Picking: lazily-created resources for reading a single depth value
  private pickTarget: THREE.WebGLRenderTarget | null = null;
  private pickMaterial: THREE.ShaderMaterial | null = null;
  private pickScene: THREE.Scene | null = null;

  constructor(engine: OutlinePassEngine) {
    this.engine = engine;
    const dpr = engine.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(engine.container.clientWidth * dpr));
    const h = Math.max(1, Math.floor(engine.container.clientHeight * dpr));

    // `samples` keeps the multisampling the default framebuffer used to
    // provide. It buys nothing on the SDF itself — its silhouette comes from
    // `discard`, which MSAA cannot smooth — but the gizmo's thin lines render
    // through here too, and they did have it.
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      depthTexture: new THREE.DepthTexture(w, h),
      depthBuffer: true,
      samples: 4,
    });
    this.sceneTarget.depthTexture!.type = THREE.FloatType;

    this.gizmoTarget = new THREE.WebGLRenderTarget(w, h);
    this.gizmoScene = new THREE.Scene();

    this.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: OUTLINE_FRAG,
      uniforms: {
        u_depth: { value: this.sceneTarget.depthTexture },
        u_resolution: { value: new THREE.Vector2(w, h) },
        u_near: { value: 0.01 },
        u_far: { value: 5000 },
        u_radius: { value: 3.0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    // NoBlending: this replaces the framebuffer rather than compositing over
    // it, so the scene's own alpha reaches the canvas unchanged and a
    // transparent background stays transparent.
    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: { u_color: { value: this.sceneTarget.texture } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.gizmoMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: GIZMO_OUTLINE_FRAG,
      uniforms: {
        u_gizmo: { value: this.gizmoTarget.texture },
        u_resolution: { value: new THREE.Vector2(w, h) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    this.blitScene = new THREE.Scene();
    this.gizmoQuadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial));
    this.gizmoQuadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gizmoMaterial));
  }

  resize(w: number, h: number) {
    const dpr = this.engine.renderer.getPixelRatio();
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    this.sceneTarget.setSize(pw, ph);
    this.gizmoTarget.setSize(pw, ph);
    if (this.sceneTarget.depthTexture) {
      this.sceneTarget.depthTexture.image = { width: pw, height: ph };
      this.sceneTarget.depthTexture.needsUpdate = true;
    }
    this.material.uniforms.u_resolution.value.set(pw, ph);
    this.gizmoMaterial.uniforms.u_resolution.value.set(pw, ph);
  }

  /**
   * Read the depth buffer value at a given UV coordinate (0-1 range).
   * Returns the raw depth (0 = near, 1 = far) from the last rendered frame.
   */
  readDepthAt(u: number, v: number): number {
    if (!this.pickTarget) {
      this.pickTarget = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
      });
      this.pickMaterial = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: `
          precision highp float;
          uniform sampler2D u_depthTex;
          uniform vec2 u_sampleUV;
          varying vec2 vUv;
          void main() {
            float d = texture2D(u_depthTex, u_sampleUV).r;
            gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
          }
        `,
        uniforms: {
          u_depthTex: { value: this.sceneTarget.depthTexture },
          u_sampleUV: { value: new THREE.Vector2() },
        },
      });
      this.pickScene = new THREE.Scene();
      this.pickScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pickMaterial));
    }

    this.pickMaterial!.uniforms.u_sampleUV.value.set(u, v);
    const renderer = this.engine.renderer;
    renderer.setRenderTarget(this.pickTarget);
    renderer.render(this.pickScene!, this.quadCamera);
    const buf = new Float32Array(4);
    renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, buf);
    renderer.setRenderTarget(null);
    return buf[0];
  }

  render() {
    const { renderer, scene, camera } = this.engine;

    this.material.uniforms.u_near.value = camera.near;
    this.material.uniforms.u_far.value = camera.far;

    // 1. The one scene render. Colour and depth come out of the same pass.
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 2. Put that colour on the screen.
    renderer.clear();
    renderer.autoClear = false;
    renderer.render(this.blitScene, this.quadCamera);

    // 3. Outline quad, masked by depth rather than by a stencil.
    renderer.render(this.quadScene, this.quadCamera);

    // 4. Capture gizmo-only to offscreen target for edge detection
    // Find TransformControls in scene and render only those
    const gizmoObjects: { obj: THREE.Object3D; parent: THREE.Object3D }[] = [];
    for (const child of [...scene.children]) {
      if ((child as any).isTransformControls) {
        gizmoObjects.push({ obj: child, parent: scene });
      }
    }
    if (gizmoObjects.length > 0 && gizmoObjects.some(g => g.obj.visible)) {
      // Move gizmos to isolated scene
      for (const g of gizmoObjects) this.gizmoScene.add(g.obj);
      renderer.setRenderTarget(this.gizmoTarget);
      renderer.clear();
      renderer.render(this.gizmoScene, camera);
      renderer.setRenderTarget(null);
      // Move back
      for (const g of gizmoObjects) g.parent.add(g.obj);

      // 5. Render gizmo outline quad
      renderer.render(this.gizmoQuadScene, this.quadCamera);
    }

    renderer.autoClear = true;
  }

  dispose() {
    this.sceneTarget.dispose();
    this.gizmoTarget.dispose();
    this.material.dispose();
    this.blitMaterial.dispose();
    this.gizmoMaterial.dispose();
    this.pickTarget?.dispose();
    this.pickMaterial?.dispose();
  }
}

import * as THREE from 'three';
export interface OutlinePassEngine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  container: HTMLElement;
}

const QUAD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
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

  outline = clamp(outline / total * 3.0, 0.0, 1.0);
  float alpha = smoothstep(0.0, 0.3, outline);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
}
`;

export class OutlinePass {
  private engine: OutlinePassEngine;
  private depthTarget: THREE.WebGLRenderTarget;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private material: THREE.ShaderMaterial;

  constructor(engine: OutlinePassEngine) {
    this.engine = engine;
    const dpr = engine.renderer.getPixelRatio();
    const w = Math.floor(engine.container.clientWidth * dpr);
    const h = Math.floor(engine.container.clientHeight * dpr);

    this.depthTarget = new THREE.WebGLRenderTarget(w, h, {
      depthTexture: new THREE.DepthTexture(w, h),
      depthBuffer: true,
    });
    this.depthTarget.depthTexture!.type = THREE.FloatType;

    this.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: OUTLINE_FRAG,
      uniforms: {
        u_depth: { value: this.depthTarget.depthTexture },
        u_resolution: { value: new THREE.Vector2(w, h) },
        u_near: { value: 0.01 },
        u_far: { value: 5000 },
        u_radius: { value: 3.0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  resize(w: number, h: number) {
    const dpr = this.engine.renderer.getPixelRatio();
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    this.depthTarget.setSize(pw, ph);
    if (this.depthTarget.depthTexture) {
      this.depthTarget.depthTexture.image = { width: pw, height: ph };
      this.depthTarget.depthTexture.needsUpdate = true;
    }
    this.material.uniforms.u_resolution.value.set(pw, ph);
  }

  render() {
    const { renderer, scene, camera } = this.engine;

    this.material.uniforms.u_near.value = camera.near;
    this.material.uniforms.u_far.value = camera.far;

    // 1. Capture depth
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 2. Render scene to screen (color + stencil)
    renderer.clear();
    renderer.render(scene, camera);

    // 3. Render outline quad (stencil blocks shape pixels)
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = true;
  }

  dispose() {
    this.depthTarget.dispose();
    this.material.dispose();
  }
}

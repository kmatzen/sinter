import * as THREE from 'three';
import type { ThreeEngine } from './ThreeEngine';
import { useModelerStore } from '../store/modelerStore';
import { useViewportStore } from '../store/viewportStore';

const VERT = `
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vViewDir = cameraPosition - worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SHARED_GLSL = `
vec2 boxIntersect(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 invRd = 1.0 / rd;
  vec3 t1 = (bmin - ro) * invRd;
  vec3 t2 = (bmax - ro) * invRd;
  vec3 tmin = min(t1, t2);
  vec3 tmax = max(t1, t2);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
bool isClipped(vec3 p) {
  if (u_clipEnabled < 0.5) return false;
  float v;
  if (u_clipAxis == 0) v = p.x;
  else if (u_clipAxis == 1) v = p.y;
  else v = p.z;
  return u_clipFlip > 0.5 ? v < u_clipPos : v > u_clipPos;
}
`;

function buildFrag(sdfFunc: string, paramCount: number, hasWarn: boolean): string {
  return `
precision highp float;
uniform float u_p[${paramCount}];
uniform vec3 u_cameraPos;
uniform vec3 u_lightDir;
uniform vec3 u_bbMin;
uniform vec3 u_bbMax;
uniform float u_clipEnabled;
uniform float u_clipPos;
uniform int u_clipAxis;
uniform float u_clipFlip;
uniform mat4 u_projView;

varying vec3 vWorldPos;
varying vec3 vViewDir;

${sdfFunc}

vec3 calcNormal(vec3 p) {
  float e = length(u_bbMax - u_bbMin) * 0.0002;
  return normalize(vec3(
    sdf(p + vec3(e,0,0)) - sdf(p - vec3(e,0,0)),
    sdf(p + vec3(0,e,0)) - sdf(p - vec3(0,e,0)),
    sdf(p + vec3(0,0,e)) - sdf(p - vec3(0,0,e))
  ));
}

${SHARED_GLSL}

void main() {
  vec3 ro = u_cameraPos;
  vec3 rd = normalize(-vViewDir);
  vec2 tb = boxIntersect(ro, rd, u_bbMin, u_bbMax);
  float tStart = max(tb.x, 0.0);
  float tEnd = tb.y;
  if (tStart >= tEnd) discard;

  float t = tStart;
  bool hit = false;
  vec3 p;
  float camDist = length(u_cameraPos);
  float minStep = camDist * 0.00005;

  // Enhanced sphere tracing (Keinert et al. 2014): over-relax the marching
  // step by omega, and back off if the over-relaxed step overshot the field's
  // safe radius. The backtrack guarantees a surface is never skipped, so this
  // is at least as robust as plain sphere tracing, but converges in far fewer
  // steps through *conservative* fields. That matters because a non-uniform
  // scale multiplies the field by min(sx,sy,sz) (a 1-Lipschitz correction), so
  // a heavily-scaled axis under-reports distance and otherwise starved the
  // fixed step budget — thin scaled geometry then vanished at grazing angles
  // (issue #76).
  float omega = 1.6;
  float prevRadius = 0.0;
  float stepLength = 0.0;
  for (int i = 0; i < 1024; i++) {
    p = ro + rd * t;
    if (isClipped(p)) {
      float clipAdvance;
      if (u_clipAxis == 0) clipAdvance = (u_clipPos - ro.x) / rd.x - t;
      else if (u_clipAxis == 1) clipAdvance = (u_clipPos - ro.y) / rd.y - t;
      else clipAdvance = (u_clipPos - ro.z) / rd.z - t;
      if (clipAdvance > 0.0) {
        t += clipAdvance + minStep * 0.5;
        vec3 clipP = ro + rd * t;
        if (!isClipped(clipP) && sdf(clipP) < 0.0) { p = clipP; hit = true; break; }
      } else { t += minStep; }
      // A clip-plane jump breaks the step continuity the relaxation relies on.
      omega = 1.6; prevRadius = 0.0; stepLength = 0.0;
      continue;
    }
    float radius = abs(sdf(p));
    bool sorFail = (omega > 1.0) && (radius + prevRadius < stepLength);
    if (sorFail) {
      // The over-relaxed step overshot: retreat it and fall back to plain
      // (unrelaxed) sphere tracing for the rest of the ray.
      stepLength -= omega * stepLength;
      omega = 1.0;
    } else {
      stepLength = radius * omega;
    }
    prevRadius = radius;
    if (!sorFail && radius < minStep) { hit = true; break; }
    t += stepLength;
    if (t > tEnd) break;
  }
  if (!hit) discard;

  vec3 normal = calcNormal(p);
  vec3 baseColor = vec3(0.45, 0.56, 0.82);
${hasWarn ? `  float warnDist = abs(sdfWarn(p));
  float warnEps = length(u_bbMax - u_bbMin) * 0.002;
  if (warnDist < warnEps) baseColor = vec3(0.85, 0.45, 0.25);` : ''}
  vec3 viewDir = normalize(vViewDir);
  vec3 lightDir = normalize(u_lightDir);

  float NdotL = max(0.0, dot(normal, lightDir));
  vec3 key = baseColor * NdotL * vec3(1.1, 1.05, 1.0);
  float fill = max(0.0, dot(normal, normalize(vec3(-0.4, 0.3, -0.6))));
  vec3 fillColor = baseColor * fill * 0.3 * vec3(0.85, 0.9, 1.1);
  float hemi = normal.y * 0.5 + 0.5;
  vec3 ambient = baseColor * mix(0.18, 0.35, hemi);
  float cavity = smoothstep(-0.6, 0.2, NdotL + fill);
  vec3 color = (ambient + key + fillColor) * mix(0.7, 1.0, cavity);
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 60.0);
  color += vec3(0.2) * spec;
  float rim = 1.0 - abs(dot(viewDir, normal));
  rim = smoothstep(0.55, 0.8, rim);
  color += vec3(0.15, 0.2, 0.3) * rim;

  if (u_clipEnabled > 0.5) {
    float clipDist;
    if (u_clipAxis == 0) clipDist = abs(p.x - u_clipPos);
    else if (u_clipAxis == 1) clipDist = abs(p.y - u_clipPos);
    else clipDist = abs(p.z - u_clipPos);
    if (clipDist < minStep * 3.0) {
      gl_FragColor = vec4(0.83, 0.65, 0.46, 1.0);
      vec4 cp = u_projView * vec4(p, 1.0);
      gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
      return;
    }
  }

  vec4 clipPos = u_projView * vec4(p, 1.0);
  gl_FragDepth = clipPos.z / clipPos.w * 0.5 + 0.5;
  gl_FragColor = vec4(color, 1.0);
}
`;
}

/** FNV-1a over the texture payload, so content edits at unchanged dimensions
 *  still invalidate the material. */
function hashBytes(data: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Cache key for the texture uniforms baked into the material.
 *
 * Note that codegen never populates `textures` today — the array is declared,
 * reset, and returned, but nothing pushes to it — so this is always '' at
 * runtime and costs nothing. It is here so the key is already correct when
 * textures do get wired up, rather than being a latent stale-render bug
 * waiting for that change.
 */
function textureKey(textures: { name: string; width: number; height: number; data: number[] }[] | undefined): string {
  if (!textures || textures.length === 0) return '';
  return textures.map((t) => `${t.name}:${t.width}x${t.height}:${hashBytes(t.data)}`).join('|');
}

export class SdfMesh {
  private engine: ThreeEngine;
  private mesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private lastGlsl = '';
  private lastParamCount = 0;
  private lastHasWarn = false;
  private lastTextureKey = '';
  private lastBBKey = '';
  private unsubs: (() => void)[] = [];

  constructor(engine: ThreeEngine) {
    this.engine = engine;
    this.unsubs.push(
      useModelerStore.subscribe(() => this.onStoreChange())
    );
    this.onStoreChange();
  }

  /**
   * Free the GPU-side resources backing the current mesh.
   *
   * Three.js does not release the compiled program, the geometry buffers, or
   * textures when an object leaves the scene graph — `scene.remove()` only
   * unlinks it. Anything that drops the current mesh must come through here,
   * or every rebuild leaks a shader program, a geometry, and its textures.
   */
  private releaseGpu() {
    if (this.mesh) {
      this.engine.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.material) {
      // Textures are reachable only via the uniforms, not through the mesh.
      for (const uniform of Object.values(this.material.uniforms)) {
        const value = uniform?.value;
        if (value instanceof THREE.Texture) value.dispose();
      }
      this.material.dispose();
    }
    this.mesh = null;
    this.material = null;
  }

  private onStoreChange() {
    const sdf = useModelerStore.getState().sdfDisplay;
    if (!sdf || !sdf.glsl) {
      this.releaseGpu();
      this.lastGlsl = '';
      this.lastParamCount = 0;
      this.lastHasWarn = false;
      this.lastTextureKey = '';
      this.lastBBKey = '';
      return;
    }

    // Rebuild when anything baked into the material changes. hasWarn selects
    // the fragment source via buildFrag, and the textures become uniforms, so
    // neither can be left out of the key without rendering a stale material.
    const texKey = textureKey(sdf.textures);
    if (
      sdf.glsl !== this.lastGlsl ||
      sdf.paramCount !== this.lastParamCount ||
      sdf.hasWarn !== this.lastHasWarn ||
      texKey !== this.lastTextureKey
    ) {
      this.lastGlsl = sdf.glsl;
      this.lastParamCount = sdf.paramCount;
      this.lastHasWarn = sdf.hasWarn;
      this.lastTextureKey = texKey;
      this.rebuild(sdf);
    }
  }

  private rebuild(sdf: { glsl: string; paramCount: number; paramValues: number[]; textures: any[]; bbMin: [number,number,number]; bbMax: [number,number,number]; hasWarn: boolean }) {
    // Dispose the previous build before allocating its replacement.
    this.releaseGpu();

    const initialParams = new Float32Array(sdf.paramCount);
    for (let i = 0; i < sdf.paramValues.length; i++) initialParams[i] = sdf.paramValues[i];

    // Texture uniforms
    const texUniforms: Record<string, THREE.IUniform> = {};
    for (const tex of (sdf.textures || [])) {
      const data = new Uint8Array(tex.data);
      const dt = new THREE.DataTexture(data, tex.width, tex.height, THREE.RedFormat, THREE.UnsignedByteType);
      dt.minFilter = THREE.LinearFilter;
      dt.magFilter = THREE.LinearFilter;
      dt.wrapS = THREE.ClampToEdgeWrapping;
      dt.wrapT = THREE.ClampToEdgeWrapping;
      dt.needsUpdate = true;
      texUniforms[tex.name] = { value: dt };
    }

    const clipEnabled = useViewportStore.getState().clipEnabled;
    const clipAxis = useViewportStore.getState().clipAxis;
    const clipPosition = useViewportStore.getState().clipPosition;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: buildFrag(sdf.glsl, sdf.paramCount, sdf.hasWarn),
      uniforms: {
        u_p: { value: initialParams },
        u_cameraPos: { value: new THREE.Vector3() },
        u_lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
        u_bbMin: { value: new THREE.Vector3(...sdf.bbMin) },
        u_bbMax: { value: new THREE.Vector3(...sdf.bbMax) },
        u_clipEnabled: { value: clipEnabled ? 1.0 : 0.0 },
        u_clipPos: { value: clipPosition },
        u_clipAxis: { value: clipAxis === 'x' ? 0 : clipAxis === 'z' ? 2 : 1 },
        u_clipFlip: { value: useViewportStore.getState().clipFlip ? 1.0 : 0.0 },
        u_projView: { value: new THREE.Matrix4() },
        ...texUniforms,
      },
      side: THREE.BackSide,
      depthWrite: true,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
    });

    // Geometry: diagonal-expanded bbox
    const [x0, y0, z0] = sdf.bbMin;
    const [x1, y1, z1] = sdf.bbMax;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const diag = Math.sqrt(w * w + h * h + d * d);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const geo = new THREE.BoxGeometry(diag, diag, diag);
    geo.translate(cx, cy, cz);

    this.mesh = new THREE.Mesh(geo, this.material);
    this.engine.scene.add(this.mesh);
  }

  update() {
    if (!this.material) return;
    const u = this.material.uniforms;
    const cam = this.engine.camera;

    u.u_cameraPos.value.copy(cam.position);
    u.u_projView.value.copy(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const vs = useViewportStore.getState();
    u.u_clipEnabled.value = vs.clipEnabled ? 1.0 : 0.0;
    u.u_clipPos.value = vs.clipPosition;
    u.u_clipAxis.value = vs.clipAxis === 'x' ? 0 : vs.clipAxis === 'z' ? 2 : 1;
    u.u_clipFlip.value = vs.clipFlip ? 1.0 : 0.0;

    const sdf = useModelerStore.getState().sdfDisplay;
    if (sdf) {
      const [x0, y0, z0] = sdf.bbMin;
      const [x1, y1, z1] = sdf.bbMax;
      const cx = (x0+x1)/2, cy = (y0+y1)/2, cz = (z0+z1)/2;
      const w = x1-x0, h = y1-y0, d = z1-z0;
      const half = Math.sqrt(w*w + h*h + d*d) / 2;
      u.u_bbMin.value.set(cx - half, cy - half, cz - half);
      u.u_bbMax.value.set(cx + half, cy + half, cz + half);

      // Update mesh geometry if bounding box changed
      if (this.mesh) {
        const bbKey = `${x0},${y0},${z0},${x1},${y1},${z1}`;
        if (bbKey !== this.lastBBKey) {
          this.lastBBKey = bbKey;
          this.mesh.geometry.dispose();
          const diag = half * 2;
          const geo = new THREE.BoxGeometry(diag, diag, diag);
          geo.translate(cx, cy, cz);
          this.mesh.geometry = geo;
        }
      }

      const arr = u.u_p.value as Float32Array;
      for (let i = 0; i < sdf.paramValues.length && i < arr.length; i++) {
        arr[i] = sdf.paramValues[i];
      }

    }
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.releaseGpu();
  }
}

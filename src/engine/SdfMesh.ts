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
float clipCoord(vec3 p) {
  if (u_clipAxis == 0) return p.x;
  if (u_clipAxis == 1) return p.y;
  return p.z;
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
// World-space size of one pixel per unit of distance from the camera:
// 2*tan(fov/2) / viewportHeightPx. Everything the marcher needs to decide
// "close enough" is expressed against this, so the answer scales with zoom.
uniform float u_pixelRadius;
// Absolute floor for that, so a ray starting at t = 0 (camera inside the
// bounding box) still advances instead of spinning out its step budget.
uniform float u_stepFloor;

varying vec3 vWorldPos;
varying vec3 vViewDir;

${sdfFunc}

/**
 * Gradient by the tetrahedron technique: four samples at the corners of a
 * regular tetrahedron rather than six along three axes. Same gradient, two
 * thirds of the cost, and this runs once per *hit* pixel — so on a shape
 * filling the viewport it is a third of the shading work.
 *
 * The offset is a fraction of the marched distance rather than of the scene size.
 * The old epsilon was length(u_bbMax - u_bbMin) * 0.0002, and u_bbMin/u_bbMax
 * are the *diagonal-expanded cube* the mesh is drawn as, not the model's box —
 * so it was ~1.7x larger than it reads as intending, and being tied to the
 * whole scene it did not shrink when you zoomed into a small feature of a large
 * model, which is exactly where an oversized epsilon smooths detail away.
 * Scaling with t keeps the offset at a fixed fraction of a pixel at any zoom.
 */
vec3 calcNormal(vec3 p, float t) {
  float e = max(t * u_pixelRadius * 0.35, u_stepFloor);
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * sdf(p + k.xyy * e) +
    k.yyx * sdf(p + k.yyx * e) +
    k.yxy * sdf(p + k.yxy * e) +
    k.xxx * sdf(p + k.xxx * e)
  );
}

${SHARED_GLSL}

void main() {
  vec3 ro = u_cameraPos;
  vec3 rd = normalize(-vViewDir);
  vec2 tb = boxIntersect(ro, rd, u_bbMin, u_bbMax);
  float tStart = max(tb.x, 0.0);
  float tEnd = tb.y;
  if (tStart >= tEnd) discard;

  /**
   * Where the section plane meets this ray.
   *
   * The clip region is a half-space, so a ray crosses it at most once: solving
   * for that single crossing here replaces the per-step point test the march
   * used to do. Written so "kept" is f(t) = slope * t + offset <= 0, which
   * folds both clip directions into one sign test rather than branching on
   * u_clipFlip.
   *
   * The old code tested the point inside the march and, when it landed on the
   * cut-away side, tried to jump to the plane with (u_clipPos - ro.a) / rd.a.
   * The division has no guard, so a view that grazes the plane (rd.a
   * approaching 0) yields an enormous value or an infinity, and a camera on the
   * plane as well yields 0/0 = NaN — and since NaN > 0.0 is false, such a ray
   * fell into the fallback branch. That branch advanced by minStep, the *hit
   * threshold*, about half a pixel, and never checked t > tEnd, so a ray that
   * had already left the kept half-space could not terminate at all: it spent
   * every one of its 1024 iterations creeping forward a fraction of a pixel.
   * Rays with real surface still ahead of them ran out of budget before
   * reaching it and the model dropped out of the frame.
   *
   * tClip bounds which hits count, *not* how far the march may travel — see
   * the marching loop for why those must be separate.
   */
  bool onCutFace = false;
  float tClip = tEnd;
  if (u_clipEnabled > 0.5) {
    float side = u_clipFlip > 0.5 ? -1.0 : 1.0;
    float slope = side * clipCoord(rd);
    float offset = side * (clipCoord(ro) - u_clipPos);
    if (slope == 0.0) {
      // The ray runs inside the plane, so the whole span sits on one side of
      // it and there is no finite crossing to solve for.
      if (offset > 0.0) discard;
    } else {
      float tPlane = -offset / slope;
      if (slope > 0.0) {
        // Ray crosses from the kept side to the cut side. Nothing at or beyond
        // the crossing is visible.
        tClip = min(tClip, tPlane);
      } else if (tPlane > tStart) {
        // Ray starts on the cut side and emerges at the plane, so the first
        // thing it could possibly see is the cross-section there.
        tStart = tPlane;
        onCutFace = true;
      }
    }
    if (tStart >= tClip) discard;
  }

  /**
   * The cross-section itself. Where the plane cuts through solid material the
   * ray becomes visible already inside the shape, so no surface lies ahead of
   * it — the cut face is the nearest thing this pixel sees.
   *
   * Deciding it from the ray's own entry point replaces the old test, which
   * shaded any *marched* hit landing within three hit-thresholds of the plane.
   * That measured proximity rather than causation, so a genuine surface that
   * happened to run close to the plane — a face lying flat against it, common
   * once you position the plane against a feature — was painted as cut face
   * across its whole extent.
   */
  vec3 capP = ro + rd * tStart;
  if (onCutFace && sdf(capP) < 0.0) {
    gl_FragColor = vec4(0.83, 0.65, 0.46, 1.0);
    vec4 capClip = u_projView * vec4(capP, 1.0);
    gl_FragDepth = capClip.z / capClip.w * 0.5 + 0.5;
    return;
  }

  float t = tStart;
  bool hit = false;
  vec3 p;
  // Hit threshold, recomputed per step from how far the ray has travelled.
  //
  // It used to be length(u_cameraPos) * 0.00005 -- distance from the world
  // *origin*, which is neither where the camera is looking nor how big a pixel
  // is. A model translated away from the origin got a coarser threshold for no
  // reason, and zooming into a small feature did not tighten it. Half a pixel
  // at the current distance is the quantity that actually matters: there is
  // nothing to resolve below it, and it costs steps to try.
  float minStep = max(tStart * u_pixelRadius * 0.5, u_stepFloor);

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
    minStep = max(t * u_pixelRadius * 0.5, u_stepFloor);
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

    /**
     * Stop at the section plane — but only from a settled step.
     *
     * The march may not simply end at tClip. Over-relaxation deliberately
     * overshoots and corrects on the following iteration, so the step that
     * finds a surface routinely lands *past* it first; cutting the ray off the
     * moment t exceeds the plane throws that pending correction away. A surface
     * sitting just short of the plane — which is the common case, since the
     * plane is usually placed against the geometry the user wants to see
     * inside — then vanishes. Looking along the kept side made every ray reach
     * the plane within about one step of the surface, so the model disappeared
     * wholesale rather than in patches.
     *
     * When sorFail is false, Keinert's condition (radius + prevRadius >=
     * stepLength) has just certified that the segment behind t holds no
     * surface, so there is nothing before the plane left to find and the ray
     * can be abandoned. Ordering this ahead of the hit test is what keeps a hit
     * on the cut-away side from being accepted.
     */
    if (!sorFail && t > tClip) break;
    if (!sorFail && radius < minStep) { hit = true; break; }
    t += stepLength;
    if (t > tEnd) break;
  }
  if (!hit) discard;

  vec3 normal = calcNormal(p, t);
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
      const format = tex.channels === 4 ? THREE.RGBAFormat : THREE.RedFormat;
      const dt = new THREE.DataTexture(data, tex.width, tex.height, format, THREE.UnsignedByteType);
      // NEAREST, deliberately. A baked mesh field is stored as tiled z-slices,
      // and hardware filtering would blend across a tile boundary — mixing the
      // edge of one slice with geometry from the far side of the model. The
      // trilinear blend is written out in the emitted GLSL instead.
      dt.minFilter = THREE.NearestFilter;
      dt.magFilter = THREE.NearestFilter;
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
        u_pixelRadius: { value: 0.002 },
        u_stepFloor: { value: 1e-4 },
        ...texUniforms,
      },
      side: THREE.BackSide,
      depthWrite: true,
      // No stencil. It existed only so the outline quad could mask itself off
      // shape pixels, and the outline shader already derives that from the
      // depth texture it is sampling anyway (`isShape = !isBg`). Keeping it
      // would also mean carrying a stencil attachment on the offscreen target
      // the scene now renders into, for information nothing reads.
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

      // One pixel's world-space width per unit of camera distance. The marcher
      // states both its hit threshold and its normal offset against this, so
      // both track zoom instead of tracking the scene's size or the model's
      // distance from the world origin.
      const cam = this.engine.camera;
      const size = new THREE.Vector2();
      this.engine.renderer.getSize(size);
      const heightPx = Math.max(1, size.y * this.engine.renderer.getPixelRatio());
      u.u_pixelRadius.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / heightPx;
      // A ray that starts inside the bounding box has t = 0, where a purely
      // relative threshold is zero and the march would spend its whole budget
      // creeping. Tied to the model rather than to a constant so it means the
      // same thing for a 1mm part and a 1m one.
      u.u_stepFloor.value = Math.max(half * 1e-5, 1e-9);

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

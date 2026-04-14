import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OutlinePass } from '../../engine/OutlinePass';

const VERT = `
varying vec3 vViewDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vViewDir = cameraPosition - worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = `
precision highp float;
uniform vec3 u_cameraPos;
uniform float u_time;
uniform mat4 u_projView;
varying vec3 vViewDir;

float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdCylinder(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdTorus(vec3 p, float major, float minor) { vec2 q = vec2(length(p.xz) - major, p.y); return length(q) - minor; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z); }

float sdVase(vec3 p) {
  float base = sdCylinder(p - vec3(0.0,-3.0,0.0), 4.5, 3.0);
  float neck = sdCylinder(p - vec3(0.0,2.0,0.0), 2.5, 4.0);
  float rim = sdTorus(p - vec3(0.0,6.0,0.0), 3.2, 0.6);
  float solid = smin(smin(base, neck, 3.0), rim, 1.5) - 0.3;
  float iBase = sdCylinder(p - vec3(0.0,-2.0,0.0), 3.7, 2.5);
  float iNeck = sdCylinder(p - vec3(0.0,2.5,0.0), 1.8, 4.0);
  float iRim = sdTorus(p - vec3(0.0,6.0,0.0), 2.5, 0.4);
  float cavity = max(smin(smin(iBase, iNeck, 3.0), iRim, 1.5) - 0.3, -(p.y + 3.5));
  return max(solid, -cavity);
}

float sdGear(vec3 p) {
  float ring = max(sdCylinder(p, 6.0, 1.5), -sdCylinder(p, 4.5, 2.0));
  float angle = atan(p.z, p.x); float sector = 6.2831853/12.0;
  angle = mod(angle + sector*0.5, sector) - sector*0.5;
  float rad = length(p.xz);
  ring = min(ring, sdBox(vec3(rad*cos(angle), p.y, rad*sin(angle)) - vec3(6.5,0,0), vec3(1.2,1.5,0.8)));
  ring = min(ring, sdCylinder(p, 2.0, 2.0));
  ring = max(ring, -sdCylinder(p, 0.8, 3.0));
  float sa = atan(p.z,p.x); float ss = 6.2831853/4.0;
  sa = mod(sa+ss*0.5,ss)-ss*0.5;
  float sr = length(p.xz);
  ring = max(ring, -sdCylinder(vec3(sr*cos(sa),p.y,sr*sin(sa))-vec3(3.3,0,0), 0.8, 3.0));
  return ring - 0.15;
}

float sdf(vec3 p) {
  vec3 mp = rotY(p - vec3(-22.0,0,0), u_time*0.4);
  float body = sdCylinder(mp, 5.0, 6.0) - 0.4;
  float interior = sdCylinder(mp - vec3(0,0.8,0), 4.2, 5.8);
  vec2 hq = vec2(length((mp-vec3(6.5,0.5,0)).xy) - 3.5, (mp-vec3(6.5,0.5,0)).z);
  float mug = max(smin(body, length(hq)-1.0, 0.8), -interior);
  vec3 gp = rotY(rotX(p - vec3(0,-2,0), 1.1), -u_time*0.25);
  float gear = sdGear(gp);
  vec3 vp = rotY(p - vec3(22,0,0), u_time*0.35+2.0);
  float vase = smin(sdVase(vp), sdSphere(vp-vec3(3.5,2,0), 1.8), 1.2);
  return min(min(mug, gear), vase);
}

vec3 calcNormal(vec3 p) { float e=0.01; return normalize(vec3(sdf(p+vec3(e,0,0))-sdf(p-vec3(e,0,0)),sdf(p+vec3(0,e,0))-sdf(p-vec3(0,e,0)),sdf(p+vec3(0,0,e))-sdf(p-vec3(0,0,e)))); }
vec2 boxIntersect(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) { vec3 inv=1.0/rd; vec3 t1=(bmin-ro)*inv; vec3 t2=(bmax-ro)*inv; return vec2(max(max(min(t1,t2).x,min(t1,t2).y),min(t1,t2).z), min(min(max(t1,t2).x,max(t1,t2).y),max(t1,t2).z)); }

void main() {
  vec3 ro = u_cameraPos, rd = normalize(-vViewDir);
  vec2 tb = boxIntersect(ro, rd, vec3(-40.0), vec3(40.0));
  float t = max(tb.x, 0.0), tEnd = tb.y;
  if (t >= tEnd) discard;
  bool hit = false; vec3 p;
  for (int i = 0; i < 128; i++) { p = ro+rd*t; float d = sdf(p); if (abs(d)<0.02) { hit=true; break; } t+=abs(d); if (t>tEnd) break; }
  if (!hit) discard;
  vec3 n = calcNormal(p), v = normalize(vViewDir), l = normalize(vec3(0.5,0.8,0.4));
  vec3 bc = vec3(0.45,0.56,0.82);
  float NdL = max(0.0,dot(n,l));
  vec3 color = bc*mix(0.18,0.35,n.y*0.5+0.5) + bc*NdL*vec3(1.1,1.05,1.0) + bc*max(0.0,dot(n,normalize(vec3(-0.4,0.3,-0.6))))*0.3*vec3(0.85,0.9,1.1);
  color *= mix(0.7, 1.0, smoothstep(-0.6,0.2,NdL+max(0.0,dot(n,normalize(vec3(-0.4,0.3,-0.6))))));
  color += vec3(0.2)*pow(max(dot(n,normalize(l+v)),0.0),60.0);
  float rim = smoothstep(0.55,0.8,1.0-abs(dot(v,n)));
  color += vec3(0.15,0.2,0.3)*rim;
  vec4 cp = u_projView * vec4(p, 1.0);
  gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
  gl_FragColor = vec4(color, 1.0);
}
`;

class HeroDemoEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private material: THREE.ShaderMaterial;
  private outlinePass: OutlinePass;
  private clock = new THREE.Clock();
  private animId = 0;
  private disposed = false;
  private userActive = false;
  private blending = false;
  private blendStart = 0;
  private blendFrom = new THREE.Vector3();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private container: HTMLDivElement;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLDivElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 5000);
    this.camera.position.set(30, 16, 30);

    // Shape
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        u_cameraPos: { value: new THREE.Vector3() },
        u_time: { value: 0 },
        u_projView: { value: new THREE.Matrix4() },
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
    this.scene.add(new THREE.Mesh(new THREE.BoxGeometry(80, 80, 80), this.material));

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.addEventListener('start', () => {
      this.userActive = true;
      if (this.idleTimer) clearTimeout(this.idleTimer);
    });
    this.controls.addEventListener('end', () => {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.userActive = false;
        this.blending = true;
        this.blendFrom.copy(this.camera.position);
        this.blendStart = -1;
      }, 3000);
    });

    // Outline
    // Create a minimal engine-like object for OutlinePass
    this.outlinePass = new OutlinePass({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      container,
    } as any);

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.outlinePass.resize(w, h);
  }

  private getAutoPos(t: number): THREE.Vector3 {
    const radius = 28;
    const angle = t * 0.08;
    return new THREE.Vector3(radius * Math.cos(angle), 14 + Math.sin(t * 0.15) * 2, radius * Math.sin(angle));
  }

  private animate = () => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.animate);

    const t = this.clock.getElapsedTime();

    // Auto-orbit with blend-back
    if (!this.userActive) {
      const target = this.getAutoPos(t);
      if (this.blending) {
        if (this.blendStart < 0) this.blendStart = t;
        const elapsed = t - this.blendStart;
        const alpha = Math.min(1, elapsed / 1.5);
        const ease = alpha < 0.5 ? 2 * alpha * alpha : 1 - (-2 * alpha + 2) ** 2 / 2;
        this.camera.position.lerpVectors(this.blendFrom, target, ease);
        if (alpha >= 1) this.blending = false;
      } else {
        this.camera.position.copy(target);
      }
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      this.controls.update();
    } else {
      this.controls.update();
    }

    // Update uniforms
    const pv = new THREE.Matrix4().copy(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    this.material.uniforms.u_cameraPos.value.copy(this.camera.position);
    this.material.uniforms.u_time.value = t;
    this.material.uniforms.u_projView.value.copy(pv);

    // Render with outline
    this.outlinePass.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.outlinePass.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

export function HeroDemo() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new HeroDemoEngine(containerRef.current);
    return () => engine.dispose();
  }, []);

  return (
    <div className="w-full h-[280px] md:h-[320px] relative">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, var(--bg-deep) 80%)',
      }} />
    </div>
  );
}

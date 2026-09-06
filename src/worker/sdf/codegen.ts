import type { SDFNode } from './types';
import { hasGlyphOutlines, SDF_PARAM_EPSILON } from './types';
import { linearWindow, circularWindow } from './patternWindow';
import { fieldScale, MODIFIER_DISTANCE_SAFETY } from './bounds';

let varCounter = 0;
let paramIndex = 0;
let paramValues: number[] = [];
let textures: TextureData[] = [];
let helperFunctions: string[] = [];
let helperCounter = 0;

function nextVar(): string {
  return `d${varCounter++}`;
}

/** Row-major 3x3 matrices, flattened, for composing Euler rotations. */
type Mat3 = [number, number, number, number, number, number, number, number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;

function rotX(deg: number): Mat3 {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rotY(deg: number): Mat3 {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rotZ(deg: number): Mat3 {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}

// Register a parameter value as a uniform slot — returns GLSL reference
function up(value: number): string {
  if (!isFinite(value) || isNaN(value)) value = 0;
  const idx = paramIndex++;
  paramValues.push(value);
  return `u_p[${idx}]`;
}

// Hardcoded constant (for non-parametric values like axis directions)
function g(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '0.0';
  return n.toFixed(6);
}

/**
 * Bounding-box early-out, deliberately disabled. Measured, not assumed.
 *
 * The comment here used to say the discontinuity caused jagged artifacts on
 * sharp features, and to imply the cost of evaluating every node every step was the
 * price of correctness. Both halves have now been tested (#89 item 7), and the
 * conclusion is stronger: a correct version exists, and it is *slower*.
 *
 * **Returning the box distance is unsound as a field.** It is a valid lower
 * bound, so marching is safe, but it is not 1-Lipschitz — and `round`, `offset`
 * and `shell` all read a non-zero level set of their child, so a child that
 * under-reports distance puts their offset surface in the wrong place. It also
 * stops `union` being the pointwise minimum and stops the interval enclosure
 * containing the field, which the mesher's octree prunes on. The property
 * suites fail on all of those. That is very likely what the artifacts were.
 *
 * **An exact version is possible.** A boolean can skip an operand when it can
 * prove the operand cannot change the answer — for `min(a,b)`, when
 * `distToBox(b) / fieldScale(b) >= a` — and then return the answer it already
 * had. The value is bit-identical, so nothing about the field changes. That
 * version passes the property suites, all 19 parity cases, and the golden
 * images.
 *
 * **And it is 10-14% slower on the GPU.** Measured at 700x700, minimum of 15
 * renders, three interleaved passes in both orders, on a model built for it —
 * eight spatially disjoint parts. A fragment shader executes divergent branches
 * by masking, not by skipping: neighbouring pixels in a warp are at different
 * distances from different parts, so both sides run anyway and only the results
 * are masked. What is left is the guard's own arithmetic, paid unconditionally
 * at every boolean on every march step.
 *
 * On the CPU it is a wash, because the export never marches — the octree in
 * `gridEval.ts` already prunes empty space by interval enclosure, so by the
 * time `evaluateSDF` is called we are near a surface and the guard never fires.
 *
 * So this stays stubbed, and the reason is the measurement rather than the
 * artifacts.
 */
function emitBBoxEarlyOut(_node: SDFNode, _pVar: string, _result: string, _lines: string[]): boolean {
  return false;
}

/** Emit a child node as a standalone GLSL function, returns the function name */
function emitAsFunction(node: SDFNode): string {
  const fnName = `sdf_helper_${helperCounter++}`;
  const fnLines: string[] = [];
  const childResult = emitNode(node, 'hp', fnLines);
  helperFunctions.push(
    `float ${fnName}(vec3 hp) {\n  ${fnLines.join('\n  ')}\n  return ${childResult};\n}`
  );
  return fnName;
}

/** Emit the CPU evaluator's bounded local gradient re-distancing. */
function emitDistanceFunction(node: SDFNode): string {
  const childFn = emitAsFunction(node);
  const scale = fieldScale(node);
  if (scale <= 1 + 1e-9) return childFn;
  const fnName = `sdf_distance_${helperCounter++}`;
  const s = up(scale);
  helperFunctions.push(`float ${fnName}(vec3 rp) {
  float raw = ${childFn}(rp);
  float e = 0.001;
  vec3 grad = vec3(
    ${childFn}(rp + vec3(e, 0.0, 0.0)) - ${childFn}(rp - vec3(e, 0.0, 0.0)),
    ${childFn}(rp + vec3(0.0, e, 0.0)) - ${childFn}(rp - vec3(0.0, e, 0.0)),
    ${childFn}(rp + vec3(0.0, 0.0, e)) - ${childFn}(rp - vec3(0.0, 0.0, e))
  ) / (2.0 * e);
  float correction = clamp(1.0 / max(length(grad), 1e-9), 1.0, ${s});
  return raw * correction;
}`);
  return fnName;
}

/**
 * 2D glyph-outline primitives, transcribed from `evaluate.ts` line for line.
 *
 * The point of this block is that it is a *transcription* and not a second
 * design. `sdf-parity` holds the two evaluators to agreement within
 * `scale * 2e-3`, and every constant here — the 9 samples, the 4 Newton steps,
 * the 1e-10 derivative floor, the 4-segment winding subdivision — exists
 * because the CPU side chose it. Changing one without changing the other
 * reopens exactly the divergence this replaces.
 *
 * Emitted once, and only when a text node actually carries outlines.
 */
const GLYPH_HELPERS = `float glyph_bez1(float t, float a, float b, float c) {
  float u = 1.0 - t;
  return u * u * a + 2.0 * u * t * b + t * t * c;
}

vec2 glyph_bez(float t, vec2 a, vec2 b, vec2 c) {
  return vec2(glyph_bez1(t, a.x, b.x, c.x), glyph_bez1(t, a.y, b.y, c.y));
}

float glyph_distLine(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  float t = clamp(dot(p - a, d) / dot(d, d), 0.0, 1.0);
  return length(a + t * d - p);
}

// Non-zero winding, counting only upward/downward crossings of the ray to the
// right of p. Matches windingLine() in evaluate.ts including its tie-breaking:
// the <= on one side and > on the other are what stop a vertex on the ray
// being counted twice.
float glyph_windLine(vec2 p, vec2 a, vec2 b) {
  float cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (a.y <= p.y) {
    if (b.y > p.y && cr > 0.0) return 1.0;
  } else {
    if (b.y <= p.y && cr < 0.0) return -1.0;
  }
  return 0.0;
}

// Sample-then-Newton, because a quadratic's closest-point equation is a cubic
// and the sampling pass is what picks the right root to converge to.
float glyph_distBez(vec2 p, vec2 a, vec2 b, vec2 c) {
  float minD = 1.0e30;
  float bestT = 0.0;
  for (int i = 0; i <= 8; i++) {
    float t = float(i) / 8.0;
    vec2 q = glyph_bez(t, a, b, c) - p;
    float d = dot(q, q);
    if (d < minD) { minD = d; bestT = t; }
  }
  for (int it = 0; it < 4; it++) {
    float t = bestT;
    vec2 f = glyph_bez(t, a, b, c) - p;
    vec2 df = 2.0 * ((1.0 - t) * (b - a) + t * (c - b));
    vec2 ddf = 2.0 * (c - 2.0 * b + a);
    float fv = dot(f, df);
    float dfv = dot(df, df) + dot(f, ddf);
    if (abs(dfv) < 1.0e-10) break;
    bestT = clamp(t - fv / dfv, 0.0, 1.0);
  }
  return length(glyph_bez(bestT, a, b, c) - p);
}

float glyph_windBez(vec2 p, vec2 a, vec2 b, vec2 c) {
  float w = 0.0;
  vec2 prev = a;
  for (int i = 1; i <= 4; i++) {
    vec2 nx = glyph_bez(float(i) / 4.0, a, b, c);
    w += glyph_windLine(p, prev, nx);
    prev = nx;
  }
  return w;
}

void glyph_accLine(vec2 p, vec2 a, vec2 b, inout float minD, inout float w) {
  minD = min(minD, glyph_distLine(p, a, b));
  w += glyph_windLine(p, a, b);
}

void glyph_accBez(vec2 p, vec2 a, vec2 b, vec2 c, inout float minD, inout float w) {
  minD = min(minD, glyph_distBez(p, a, b, c));
  w += glyph_windBez(p, a, b, c);
}`;

let glyphHelpersEmitted = false;

/**
 * GPU side of the imported-mesh field (#87).
 *
 * The field is a 3D grid and WebGL1 has no 3D textures, so the z-slices are
 * laid out as tiles in one 2D texture and the shader addresses them
 * arithmetically. Filtering is `NEAREST` and the trilinear blend is written out
 * by hand, because hardware bilinear would happily interpolate across a tile
 * boundary — mixing the edge of one z-slice with the start of the next, which
 * is geometry from the other side of the model.
 *
 * Values are 16-bit fixed point across the red and green channels rather than
 * 8-bit in one. Eight bits over a 25mm field is a 0.1mm quantisation step,
 * visible as terracing on a shaded surface; sixteen puts it at 0.0004mm.
 *
 * The texture is RGBA even though only two channels carry data. RG8 exists in
 * WebGL2, which is what the app renders with, but not in WebGL1, which is what
 * the parity harness uses — and a format that needs `.rg` on one and `.ra` on
 * the other would mean two shaders, which is the thing this whole design
 * exists to avoid. Two wasted bytes per texel is the price of one shader.
 *
 * The arithmetic below is the same as `sampleMeshField`, including the
 * out-of-box fallback, because `sdf-parity` compares the two and a mesh node
 * has no meaning if they disagree.
 */
const MESH_HELPERS = `float mesh_decode(vec2 rg, float lo, float hi) {
  float u16 = rg.r * 255.0 * 256.0 + rg.g * 255.0;
  return lo + (u16 / 65535.0) * (hi - lo);
}`;

let meshHelpersEmitted = false;

/** Tiles per row in the atlas, and the atlas size that implies. */
export function meshAtlasLayout(res: number) {
  const tilesPerRow = Math.ceil(Math.sqrt(res));
  const rows = Math.ceil(res / tilesPerRow);
  return { tilesPerRow, rows, width: tilesPerRow * res, height: rows * res };
}

/**
 * Pack a baked field into an RG8 atlas, and emit the function that samples it.
 */
function registerMeshTexture(node: Extract<SDFNode, { kind: 'mesh' }>): { fn: string } {
  if (!meshHelpersEmitted) {
    helperFunctions.push(MESH_HELPERS);
    meshHelpersEmitted = true;
  }

  const { field } = node;
  const { res, data, bbox } = field;
  const { tilesPerRow, width, height } = meshAtlasLayout(res);

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lo) lo = data[i];
    if (data[i] > hi) hi = data[i];
  }
  // A constant field would divide by zero on decode.
  if (!(hi > lo)) hi = lo + 1;

  const bytes = new Array<number>(width * height * 4).fill(0);
  for (let k = 0; k < res; k++) {
    const tx = (k % tilesPerRow) * res;
    const ty = Math.floor(k / tilesPerRow) * res;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const u = (data[k * res * res + j * res + i] - lo) / (hi - lo);
        const q = Math.max(0, Math.min(65535, Math.round(u * 65535)));
        const o = ((ty + j) * width + (tx + i)) * 4;
        bytes[o] = q >> 8;
        bytes[o + 1] = q & 0xff;
        bytes[o + 3] = 255;
      }
    }
  }

  const name = `u_mesh_${textures.length}`;
  textures.push({ name, width, height, data: bytes, channels: 4 });

  const fn = `sdf_mesh_${helperCounter++}`;
  const R = g(res), TPR = g(tilesPerRow), W = g(width), H = g(height);
  helperFunctions.push(`float ${fn}(vec3 mp) {
  vec3 lo = vec3(${g(bbox.min[0])}, ${g(bbox.min[1])}, ${g(bbox.min[2])});
  vec3 hi = vec3(${g(bbox.max[0])}, ${g(bbox.max[1])}, ${g(bbox.max[2])});
  vec3 scale = vec3(${R} - 1.0) / (hi - lo);
  vec3 gp = (mp - lo) * scale;
  // Distance travelled to reach the box, kept so the out-of-box branch below
  // can bound the result the same way the CPU does.
  vec3 over = (max(vec3(0.0) - gp, 0.0) + max(gp - (${R} - 1.0), 0.0)) / scale;
  float outside = length(over);
  gp = clamp(gp, 0.0, ${R} - 1.0);
  vec3 base = min(floor(gp), ${R} - 2.0);
  vec3 f = gp - base;

  float v[8];
  for (int c = 0; c < 8; c++) {
    vec3 off = vec3(float(c - (c / 2) * 2), float((c / 2) - (c / 4) * 2), float(c / 4));
    vec3 idx = base + off;
    float tileX = mod(idx.z, ${TPR});
    float tileY = floor(idx.z / ${TPR});
    vec2 uv = (vec2(tileX * ${R} + idx.x, tileY * ${R} + idx.y) + 0.5) / vec2(${W}, ${H});
    v[c] = mesh_decode(texture2D(${name}, uv).rg, ${g(lo)}, ${g(hi)});
  }

  float c00 = mix(v[0], v[1], f.x);
  float c10 = mix(v[2], v[3], f.x);
  float c01 = mix(v[4], v[5], f.x);
  float c11 = mix(v[6], v[7], f.x);
  float value = mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
  if (outside > 0.0) return max(outside, value - outside);
  return value;
}`);
  return { fn };
}

type GlyphSeg = { x0: number; y0: number; x1: number; y1: number };
type GlyphBez = { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number };

/**
 * Emit a per-node function evaluating one text node's outlines.
 *
 * Outlines are baked as literals rather than uniforms. They are not a
 * parameter the user drags — changing the text or the font changes how many
 * there are, which forces a shader rebuild regardless — and a glyph run of any
 * length would otherwise need hundreds of uniform slots, well past what the
 * uniform budget allows. `depth` stays a uniform, so extrusion depth is still
 * editable without a recompile.
 */
function emitGlyphHelper(
  node: Extract<SDFNode, { kind: 'text' }>,
  segs: GlyphSeg[],
  bezs: GlyphBez[],
): string {
  if (!glyphHelpersEmitted) {
    helperFunctions.push(GLYPH_HELPERS);
    glyphHelpersEmitted = true;
  }

  const gw = node.glyphWidth || 1;
  const ga = node.glyphAscent || node.size;
  const gd = node.glyphDescent || 0;
  const hh = (ga - gd) / 2;

  const body: string[] = [];
  // Same bbox early-out the CPU takes. It reports the distance to the glyph
  // bounding box, which never exceeds the distance to the glyphs inside it, so
  // it stays a safe under-estimate for sphere tracing.
  body.push(`vec3 bq = abs(gp) - vec3(${g(gw / 2)}, ${g(hh)}, halfDepth);`);
  body.push(`float boxDist = length(max(bq, 0.0)) + min(max(bq.x, max(bq.y, bq.z)), 0.0);`);
  body.push(`if (boxDist > ${g(hh * 0.1)}) return boxDist;`);
  // Glyph space: origin at the left edge, y down.
  body.push(`vec2 q = vec2(gp.x + ${g(gw / 2)}, -(gp.y - ${g((ga + gd) / 2)}));`);
  body.push(`float minD = 1.0e30;`);
  body.push(`float w = 0.0;`);
  for (const s of segs) {
    body.push(`glyph_accLine(q, vec2(${g(s.x0)}, ${g(s.y0)}), vec2(${g(s.x1)}, ${g(s.y1)}), minD, w);`);
  }
  for (const b of bezs) {
    body.push(
      `glyph_accBez(q, vec2(${g(b.x0)}, ${g(b.y0)}), vec2(${g(b.x1)}, ${g(b.y1)}), vec2(${g(b.x2)}, ${g(b.y2)}), minD, w);`,
    );
  }
  body.push(`float d2d = (w != 0.0 ? -1.0 : 1.0) * minD;`);
  body.push(`float dz = abs(gp.z) - halfDepth;`);
  body.push(`if (d2d < 0.0 && dz < 0.0) return max(d2d, dz);`);
  body.push(`return length(vec2(max(d2d, 0.0), max(dz, 0.0)));`);

  const fnName = `sdf_glyph_${helperCounter++}`;
  helperFunctions.push(`float ${fnName}(vec3 gp, float halfDepth) {\n  ${body.join('\n  ')}\n}`);
  return fnName;
}

function emitNode(node: SDFNode, pVar: string, lines: string[]): string {
  const result = nextVar();

  switch (node.kind) {
    case 'box': {
      lines.push(`vec3 q_${result} = abs(${pVar}) - vec3(${up(node.size[0]/2)}, ${up(node.size[1]/2)}, ${up(node.size[2]/2)});`);
      lines.push(`float ${result} = length(max(q_${result}, 0.0)) + min(max(q_${result}.x, max(q_${result}.y, q_${result}.z)), 0.0);`);
      return result;
    }
    case 'sphere':
      lines.push(`float ${result} = length(${pVar}) - ${up(node.radius)};`);
      return result;
    case 'cylinder': {
      lines.push(`vec2 cd_${result} = abs(vec2(length(${pVar}.xz), ${pVar}.y)) - vec2(${up(node.radius)}, ${up(node.height / 2)});`);
      lines.push(`float ${result} = min(max(cd_${result}.x, cd_${result}.y), 0.0) + length(max(cd_${result}, 0.0));`);
      return result;
    }
    case 'torus': {
      lines.push(`vec2 tq_${result} = vec2(length(${pVar}.xz) - ${up(node.major)}, ${pVar}.y);`);
      lines.push(`float ${result} = length(tq_${result}) - ${up(node.minor)};`);
      return result;
    }
    case 'cone': {
      // IQ sdCappedCone: base radius r at y=-h/2, apex (radius 0) at y=+h/2
      const r1 = up(node.radius);
      const hh = up(node.height / 2);
      lines.push(`float cq_${result} = length(${pVar}.xz);`);
      // ca: distance to nearest cap edge (top or bottom)
      lines.push(`vec2 cca_${result} = vec2(cq_${result} - min(cq_${result}, (${pVar}.y < 0.0) ? ${r1} : 0.0), abs(${pVar}.y) - ${hh});`);
      // cb: distance to the slanted surface. Project (q,y) onto the line from base-edge to apex
      lines.push(`vec2 cbA_${result} = vec2(cq_${result}, ${pVar}.y) - vec2(${r1}, -${hh});`);
      lines.push(`vec2 cbB_${result} = vec2(-${r1}, 2.0 * ${hh});`);
      lines.push(`float cbt_${result} = clamp(dot(cbA_${result}, cbB_${result}) / dot(cbB_${result}, cbB_${result}), 0.0, 1.0);`);
      lines.push(`vec2 ccb_${result} = cbA_${result} - cbB_${result} * cbt_${result};`);
      // Sign: negative if inside both tests
      lines.push(`float cs_${result} = (ccb_${result}.x < 0.0 && cca_${result}.y < 0.0) ? -1.0 : 1.0;`);
      lines.push(`float ${result} = cs_${result} * sqrt(min(dot(cca_${result}, cca_${result}), dot(ccb_${result}, ccb_${result})));`);
      return result;
    }
    case 'capsule': {
      // max(0, ...): below height = 2*radius the segment degenerates to a
      // point.  Without it clamp() gets min > max, which is undefined in GLSL.
      lines.push(`float chh_${result} = max(0.0, ${up(node.height)} * 0.5 - ${up(node.radius)});`);
      lines.push(`float cpy_${result} = clamp(${pVar}.y, -chh_${result}, chh_${result});`);
      lines.push(`float ${result} = length(vec3(${pVar}.x, ${pVar}.y - cpy_${result}, ${pVar}.z)) - ${up(node.radius)};`);
      return result;
    }
    case 'ellipsoid': {
      // Ellipsoid as the scaled sphere it is — see evaluate.ts for why the
      // sharper Quilez form is not used: it is not 1-Lipschitz, and its
      // Lipschitz clamp collapses to exactly this expression.
      const sx = up(node.size[0]/2), sy = up(node.size[1]/2), sz = up(node.size[2]/2);
      lines.push(`vec3 ep_${result} = ${pVar} / vec3(${sx}, ${sy}, ${sz});`);
      lines.push(`float ek0_${result} = length(ep_${result});`);
      lines.push(`float ${result} = (ek0_${result} - 1.0) * min(min(${sx}, ${sy}), ${sz});`);
      return result;
    }
    case 'union': {
      const hasBBox = emitBBoxEarlyOut(node, pVar, result, lines);
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > SDF_PARAM_EPSILON) {
        lines.push(`float h_${result} = clamp(0.5 + 0.5 * (${b} - ${a}) / ${up(node.k)}, 0.0, 1.0);`);
        lines.push(`${hasBBox ? '' : 'float '}${result} = mix(${b}, ${a}, h_${result}) - ${up(node.k)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`${hasBBox ? '' : 'float '}${result} = min(${a}, ${b});`);
      }
      if (hasBBox) lines.push(`}`);
      return result;
    }
    case 'subtract': {
      const hasBBox = emitBBoxEarlyOut(node, pVar, result, lines);
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > SDF_PARAM_EPSILON) {
        lines.push(`float h_${result} = clamp(0.5 - 0.5 * (${a} + ${b}) / ${up(node.k)}, 0.0, 1.0);`);
        lines.push(`${hasBBox ? '' : 'float '}${result} = mix(${a}, -${b}, h_${result}) + ${up(node.k)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`${hasBBox ? '' : 'float '}${result} = max(${a}, -${b});`);
      }
      if (hasBBox) lines.push(`}`);
      return result;
    }
    case 'intersect': {
      const hasBBox = emitBBoxEarlyOut(node, pVar, result, lines);
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > SDF_PARAM_EPSILON) {
        lines.push(`float h_${result} = clamp(0.5 - 0.5 * (${b} - ${a}) / ${up(node.k)}, 0.0, 1.0);`);
        lines.push(`${hasBBox ? '' : 'float '}${result} = mix(${b}, ${a}, h_${result}) + ${up(node.k)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`${hasBBox ? '' : 'float '}${result} = max(${a}, ${b});`);
      }
      if (hasBBox) lines.push(`}`);
      return result;
    }
    case 'shell': {
      const child = emitDistanceFunction(node.child);
      lines.push(`float ${result} = (abs(${child}(${pVar})) - ${up(node.thickness / 2)}) / ${up(fieldScale(node.child) * MODIFIER_DISTANCE_SAFETY)};`);
      return result;
    }
    case 'offset': {
      if (Math.abs(node.distance) <= SDF_PARAM_EPSILON) return emitNode(node.child, pVar, lines);
      const child = emitDistanceFunction(node.child);
      lines.push(`float ${result} = (${child}(${pVar}) - ${up(node.distance)}) / ${up(fieldScale(node.child) * MODIFIER_DISTANCE_SAFETY)};`);
      return result;
    }
    case 'round': {
      if (node.radius <= SDF_PARAM_EPSILON) return emitNode(node.child, pVar, lines);
      const child = emitDistanceFunction(node.child);
      lines.push(`float ${result} = (${child}(${pVar}) - ${up(node.radius)}) / ${up(fieldScale(node.child) * MODIFIER_DISTANCE_SAFETY)};`);
      return result;
    }
    case 'transform': {
      const tp = `tp_${result}`;
      lines.push(`vec3 ${tp} = ${pVar} - vec3(${up(node.tx)}, ${up(node.ty)}, ${up(node.tz)});`);
      // Always emit scale (uniform can change from 1 to non-1)
      lines.push(`${tp} = ${tp} / vec3(${up(node.sx)}, ${up(node.sy)}, ${up(node.sz)});`);
      // Rotation as a 3x3 matrix (9 uniforms) — computed on CPU from Euler
      // angles, which keeps Euler decomposition out of the shader.
      //
      // evaluate.ts undoes the rotation by applying Rz(-rz), then Ry(-ry),
      // then Rx(-rx) to the point, so as a matrix the inverse is
      // Rx(-rx) * Ry(-ry) * Rz(-rz).  Composing it in the other order gives a
      // different orientation for any node with two or more non-zero angles,
      // which is how the viewport and the exported mesh came to disagree.
      // Multiplied out rather than hand-expanded so the order stays legible.
      const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = mul3(
        rotX(-node.rx), mul3(rotY(-node.ry), rotZ(-node.rz)),
      );
      const r00=up(m00), r01=up(m01), r02=up(m02);
      const r10=up(m10), r11=up(m11), r12=up(m12);
      const r20=up(m20), r21=up(m21), r22=up(m22);
      lines.push(`${tp} = vec3(${r00}*${tp}.x + ${r01}*${tp}.y + ${r02}*${tp}.z, ${r10}*${tp}.x + ${r11}*${tp}.y + ${r12}*${tp}.z, ${r20}*${tp}.x + ${r21}*${tp}.y + ${r22}*${tp}.z);`);
      const child = emitNode(node.child, tp, lines);
      const ms = up(Math.min(node.sx, node.sy, node.sz));
      lines.push(`float ${result} = ${child} * ${ms};`);
      return result;
    }
    case 'mirror': {
      const mp = `mp_${result}`;
      const absX = node.axes[0] ? `abs(${pVar}.x)` : `${pVar}.x`;
      const absY = node.axes[1] ? `abs(${pVar}.y)` : `${pVar}.y`;
      const absZ = node.axes[2] ? `abs(${pVar}.z)` : `${pVar}.z`;
      lines.push(`vec3 ${mp} = vec3(${absX}, ${absY}, ${absZ});`);
      const child = emitNode(node.child, mp, lines);
      lines.push(`float ${result} = ${child};`);
      return result;
    }
    case 'linearPattern': {
      // Domain repetition over a window sized from the child's own extent.
      // The window width is a compile-time constant, which GLSL needs for the
      // loop bound; SdfMesh keys its shader rebuild on the emitted source, so a
      // parameter change that resizes the window recompiles rather than going
      // stale through the uniform path.
      const { axis: nax, hi, width } = linearWindow(node);
      const axVec = `vec3(${g(nax[0])}, ${g(nax[1])}, ${g(nax[2])})`;
      const fnName = emitAsFunction(node.child);
      lines.push(`float ldot_${result} = dot(${pVar}, ${axVec});`);
      lines.push(`float lbase_${result} = clamp(floor((ldot_${result} - ${up(hi)}) / ${up(node.spacing)}) - 1.0, 0.0, ${g(node.count - width)});`);
      lines.push(`float ${result} = 1e10;`);
      lines.push(`for (int lj_${result} = 0; lj_${result} < ${width}; lj_${result}++) {`);
      lines.push(`  float lii_${result} = lbase_${result} + float(lj_${result});`);
      lines.push(`  ${result} = min(${result}, ${fnName}(${pVar} - ${axVec} * (lii_${result} * ${up(node.spacing)})));`);
      lines.push(`}`);
      return result;
    }
    case 'circularPattern': {
      // Angular domain repetition over a window sized from the child's angular
      // extent.  Instances tile the full turn, so the index needs no clamping.
      const { isX, isZ, hiAng, width } = circularWindow(node);
      const fnName = emitAsFunction(node.child);
      const sector = `${g(2 * Math.PI / node.count)}`;
      // Compute angle and radius in the rotation plane
      if (isX) {
        lines.push(`float cang_${result} = atan(${pVar}.z, ${pVar}.y);`);
        lines.push(`float crad_${result} = length(${pVar}.yz);`);
      } else if (isZ) {
        lines.push(`float cang_${result} = atan(${pVar}.y, ${pVar}.x);`);
        lines.push(`float crad_${result} = length(${pVar}.xy);`);
      } else {
        lines.push(`float cang_${result} = atan(${pVar}.z, ${pVar}.x);`);
        lines.push(`float crad_${result} = length(${pVar}.xz);`);
      }
      lines.push(`float cbase_${result} = floor((cang_${result} - ${up(hiAng)}) / ${sector}) - 1.0;`);
      lines.push(`float ${result} = 1e10;`);
      lines.push(`for (int ci_${result} = 0; ci_${result} < ${width}; ci_${result}++) {`);
      lines.push(`  float ca_${result} = cang_${result} - (cbase_${result} + float(ci_${result})) * ${sector};`);
      if (isX) {
        lines.push(`  ${result} = min(${result}, ${fnName}(vec3(${pVar}.x, crad_${result} * cos(ca_${result}), crad_${result} * sin(ca_${result}))));`);
      } else if (isZ) {
        lines.push(`  ${result} = min(${result}, ${fnName}(vec3(crad_${result} * cos(ca_${result}), crad_${result} * sin(ca_${result}), ${pVar}.z)));`);
      } else {
        lines.push(`  ${result} = min(${result}, ${fnName}(vec3(crad_${result} * cos(ca_${result}), ${pVar}.y, crad_${result} * sin(ca_${result}))));`);
      }
      lines.push(`}`);
      return result;
    }
    case 'halfSpace': {
      const component = node.axis === 'x' ? 'x' : node.axis === 'y' ? 'y' : 'z';
      if (node.flip) {
        lines.push(`float ${result} = ${up(node.position)} - ${pVar}.${component};`);
      } else {
        lines.push(`float ${result} = ${pVar}.${component} - ${up(node.position)};`);
      }
      return result;
    }
    case 'text': {
      if (hasGlyphOutlines(node)) {
        const segs = node.glyphSegments || [];
        const bezs = node.glyphBeziers || [];
        const fn = emitGlyphHelper(node, segs, bezs);
        lines.push(`float ${result} = ${fn}(${pVar}, ${up(node.depth / 2)});`);
        return result;
      }
      // No outlines: both evaluators fall back to the same box.
      const charW = node.size * 0.6;
      const totalW = node.text.length * charW;
      lines.push(`vec3 qt_${result} = abs(${pVar}) - vec3(${up(totalW / 2)}, ${up(node.size / 2)}, ${up(node.depth / 2)});`);
      lines.push(`float ${result} = length(max(qt_${result}, 0.0)) + min(max(qt_${result}.x, max(qt_${result}.y, qt_${result}.z)), 0.0);`);
      return result;
    }
    case 'mesh': {
      const tex = registerMeshTexture(node);
      lines.push(`float ${result} = ${tex.fn}(${pVar});`);
      return result;
    }
    case '_far':
      lines.push(`float ${result} = 1e10;`);
      return result;
  }
}

export interface TextureData {
  name: string;
  width: number;
  height: number;
  data: number[];
  /** Bytes per texel: 1 for a single-channel map, 4 for RGBA. */
  channels: number;
}

export interface SDFCompileResult {
  glsl: string;
  paramCount: number;
  paramValues: number[];
  textures: TextureData[];
  hasWarn: boolean;
}

/** Check if any node in the subtree has warn=true */
function hasWarnDescendant(node: SDFNode): boolean {
  if (node.warn) return true;
  if ('a' in node && 'b' in node) return hasWarnDescendant(node.a) || hasWarnDescendant(node.b);
  if ('child' in node) return hasWarnDescendant(node.child);
  return false;
}

/** Sentinel node that emits 1e10 (no surface) — used to blank non-warned branches */
const FAR_NODE: SDFNode = { kind: '_far' };

/**
 * Build a filtered copy of the tree that keeps only the path to warned
 * nodes.  Non-warned leaf branches are replaced with FAR_NODE so the
 * normal emitNode produces 1e10 there, while transforms/modifiers along
 * the path to warned geometry are preserved.
 */
function filterWarnTree(node: SDFNode): SDFNode {
  if (node.warn) return node; // whole subtree is warned — keep as-is

  if ('a' in node && 'b' in node) {
    const aHas = hasWarnDescendant(node.a);
    const bHas = hasWarnDescendant(node.b);
    if (!aHas && !bHas) return FAR_NODE;
    // Replace the full boolean with a union of the filtered branches
    // so that both warned sides contribute without the boolean's
    // subtract/intersect semantics removing warned surfaces.
    const fa = aHas ? filterWarnTree(node.a) : FAR_NODE;
    const fb = bHas ? filterWarnTree(node.b) : FAR_NODE;
    return { kind: 'union', a: fa, b: fb, k: 0 };
  }

  if ('child' in node) {
    if (!hasWarnDescendant(node.child)) return FAR_NODE;
    return { ...node, child: filterWarnTree(node.child) } as SDFNode;
  }

  // Leaf without warn
  return FAR_NODE;
}

// Compile SDF tree to GLSL with uniform parameters
export function generateSDFFunction(root: SDFNode): SDFCompileResult {
  varCounter = 0;
  paramIndex = 0;
  paramValues = [];
  textures = [];
  helperFunctions = [];
  helperCounter = 0;
  glyphHelpersEmitted = false;
  meshHelpersEmitted = false;
  const lines: string[] = [];
  const finalVar = emitNode(root, 'p', lines);

  // Check for warned subtrees and generate sdfWarn() if any exist.
  // Skip if root itself is warned — the entire shape is incomplete,
  // so there's nothing to localize. The tree UI handles that case.
  const hasWarn = !root.warn && hasWarnDescendant(root);
  let warnFunc = '';

  if (hasWarn) {
    const warnTree = filterWarnTree(root);
    const warnLines: string[] = [];
    const wv = emitNode(warnTree, 'p', warnLines);
    warnLines.push(`return ${wv};`);
    warnFunc = `\n\nfloat sdfWarn(vec3 p) {\n  ${warnLines.join('\n  ')}\n}`;
  }

  const count = Math.max(paramIndex, 1);
  const texDecls = textures.map((t) => `uniform sampler2D ${t.name};`).join('\n');
  const helpers = helperFunctions.join('\n\n');
  const glsl = `${texDecls}${texDecls ? '\n' : ''}${helpers}${helpers ? '\n\n' : ''}float sdf(vec3 p) {
  ${lines.join('\n  ')}
  return ${finalVar};
}${warnFunc}`;

  return { glsl, paramCount: count, paramValues: [...paramValues], textures: [...textures], hasWarn };
}

// Legacy: baked constants for export (no uniforms)
export function generateGLSL(root: SDFNode): string {
  const result = generateSDFFunction(root);
  let sdfBody = result.glsl;
  for (let i = result.paramCount - 1; i >= 0; i--) {
    sdfBody = sdfBody.split(`u_p[${i}]`).join(g(result.paramValues[i]));
  }

  return `
precision highp float;

uniform float u_z;
uniform vec3 u_bbMin;
uniform vec3 u_bbMax;
uniform vec2 u_resolution;

${sdfBody}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 p = mix(u_bbMin, u_bbMax, vec3(uv, u_z));
  float d = sdf(p);
  gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
}
`;
}

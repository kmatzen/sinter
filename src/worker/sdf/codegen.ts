import type { SDFNode } from './types';

let varCounter = 0;
let paramIndex = 0;
let paramValues: number[] = [];
let textures: TextureData[] = [];
let helperFunctions: string[] = [];
let helperCounter = 0;

function nextVar(): string {
  return `d${varCounter++}`;
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

// Bbox early-out disabled: the SDF discontinuity at the threshold boundary
// caused visible jagged artifacts on sharp features.
// Bbox early-out disabled: the SDF discontinuity at the threshold boundary
// caused visible jagged artifacts on sharp features. The performance cost of
// evaluating all nodes every step is acceptable for correctness.
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
      lines.push(`float chh_${result} = ${up(node.height)} * 0.5 - ${up(node.radius)};`);
      lines.push(`float cpy_${result} = clamp(${pVar}.y, -chh_${result}, chh_${result});`);
      lines.push(`float ${result} = length(vec3(${pVar}.x, ${pVar}.y - cpy_${result}, ${pVar}.z)) - ${up(node.radius)};`);
      return result;
    }
    case 'ellipsoid': {
      // Gradient-corrected ellipsoid SDF approximation
      const sx = up(node.size[0]/2), sy = up(node.size[1]/2), sz = up(node.size[2]/2);
      lines.push(`vec3 ep_${result} = ${pVar} / vec3(${sx}, ${sy}, ${sz});`);
      lines.push(`float ek0_${result} = length(ep_${result});`);
      lines.push(`float ek1_${result} = length(ep_${result} / vec3(${sx}, ${sy}, ${sz}));`);
      lines.push(`float ${result} = ek0_${result} * (ek0_${result} - 1.0) / max(ek1_${result}, 1e-8);`);
      return result;
    }
    case 'union': {
      const hasBBox = emitBBoxEarlyOut(node, pVar, result, lines);
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > 0) {
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
      if (node.k > 0) {
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
      if (node.k > 0) {
        lines.push(`float h_${result} = clamp(0.5 - 0.5 * (${b} - ${a}) / ${up(node.k)}, 0.0, 1.0);`);
        lines.push(`${hasBBox ? '' : 'float '}${result} = mix(${b}, ${a}, h_${result}) + ${up(node.k)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`${hasBBox ? '' : 'float '}${result} = max(${a}, ${b});`);
      }
      if (hasBBox) lines.push(`}`);
      return result;
    }
    case 'shell': {
      const child = emitNode(node.child, pVar, lines);
      lines.push(`float ${result} = abs(${child}) - ${up(node.thickness / 2)};`);
      return result;
    }
    case 'offset': {
      const child = emitNode(node.child, pVar, lines);
      lines.push(`float ${result} = ${child} - ${up(node.distance)};`);
      return result;
    }
    case 'round': {
      const child = emitNode(node.child, pVar, lines);
      lines.push(`float ${result} = ${child} - ${up(node.radius)};`);
      return result;
    }
    case 'transform': {
      const tp = `tp_${result}`;
      lines.push(`vec3 ${tp} = ${pVar} - vec3(${up(node.tx)}, ${up(node.ty)}, ${up(node.tz)});`);
      // Always emit scale (uniform can change from 1 to non-1)
      lines.push(`${tp} = ${tp} / vec3(${up(node.sx)}, ${up(node.sy)}, ${up(node.sz)});`);
      // Rotation as a 3x3 matrix (9 uniforms) — computed on CPU from Euler angles.
      // This avoids all Euler decomposition issues in the shader.
      const cx = Math.cos(-node.rx * Math.PI / 180), sx = Math.sin(-node.rx * Math.PI / 180);
      const cy = Math.cos(-node.ry * Math.PI / 180), sy = Math.sin(-node.ry * Math.PI / 180);
      const cz = Math.cos(-node.rz * Math.PI / 180), sz = Math.sin(-node.rz * Math.PI / 180);
      // Inverse rotation matrix = Rz(-rz) * Ry(-ry) * Rx(-rx) (column-major multiply)
      const m00 = cy*cz,           m01 = sx*sy*cz - cx*sz,  m02 = cx*sy*cz + sx*sz;
      const m10 = cy*sz,           m11 = sx*sy*sz + cx*cz,  m12 = cx*sy*sz - sx*cz;
      const m20 = -sy,             m21 = sx*cy,             m22 = cx*cy;
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
      // Domain repetition with 3-neighbor check via helper function
      const ax = node.axis;
      const axLen = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]);
      const nax = axLen > 1e-8 ? [ax[0] / axLen, ax[1] / axLen, ax[2] / axLen] : [0, 1, 0];
      const axVec = `vec3(${g(nax[0])}, ${g(nax[1])}, ${g(nax[2])})`;
      const fnName = emitAsFunction(node.child);
      lines.push(`float ldot_${result} = dot(${pVar}, ${axVec});`);
      lines.push(`float lclamped_${result} = clamp(ldot_${result}, 0.0, ${up(node.spacing * (node.count - 1))});`);
      lines.push(`float lidx_${result} = floor(lclamped_${result} / ${up(node.spacing)} + 0.5);`);
      lines.push(`float ${result} = 1e10;`);
      lines.push(`for (int li_${result} = -1; li_${result} <= 1; li_${result}++) {`);
      lines.push(`  float lii_${result} = lidx_${result} + float(li_${result});`);
      lines.push(`  if (lii_${result} >= 0.0 && lii_${result} < ${g(node.count)}) {`);
      lines.push(`    ${result} = min(${result}, ${fnName}(${pVar} - ${axVec} * (lii_${result} * ${up(node.spacing)})));`);
      lines.push(`  }`);
      lines.push(`}`);
      return result;
    }
    case 'circularPattern': {
      // Angular domain repetition with 3-sector check via helper function
      const ax = node.axis;
      const isX = Math.abs(ax[0]) > Math.abs(ax[1]) && Math.abs(ax[0]) > Math.abs(ax[2]);
      const isZ = !isX && Math.abs(ax[2]) > Math.abs(ax[1]);
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
      lines.push(`float csect_${result} = floor(cang_${result} / ${sector} + 0.5);`);
      lines.push(`float ${result} = 1e10;`);
      lines.push(`for (int ci_${result} = -1; ci_${result} <= 1; ci_${result}++) {`);
      lines.push(`  float ca_${result} = cang_${result} - (csect_${result} + float(ci_${result})) * ${sector};`);
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
      // GPU: box approximation (fast). CPU evaluator uses full glyph paths for export.
      const charW = node.size * 0.6;
      const totalW = node.text.length * charW;
      lines.push(`vec3 qt_${result} = abs(${pVar}) - vec3(${up(totalW / 2)}, ${up(node.size / 2)}, ${up(node.depth / 2)});`);
      lines.push(`float ${result} = length(max(qt_${result}, 0.0)) + min(max(qt_${result}.x, max(qt_${result}.y, qt_${result}.z)), 0.0);`);
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

import type { SDFNode } from './types';

let varCounter = 0;

function nextVar(): string {
  return `d${varCounter++}`;
}

function emitNode(node: SDFNode, pVar: string, lines: string[]): string {
  const result = nextVar();

  switch (node.kind) {
    case 'box': {
      const [w, h, d] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      lines.push(`vec3 q_${result} = abs(${pVar}) - vec3(${w}, ${h}, ${d});`);
      lines.push(`float ${result} = length(max(q_${result}, 0.0)) + min(max(q_${result}.x, max(q_${result}.y, q_${result}.z)), 0.0);`);
      return result;
    }
    case 'sphere':
      lines.push(`float ${result} = length(${pVar}) - ${node.radius.toFixed(6)};`);
      return result;
    case 'cylinder': {
      const r = node.radius;
      const hh = node.height / 2;
      lines.push(`vec2 cd_${result} = abs(vec2(length(${pVar}.xz), ${pVar}.y)) - vec2(${r}, ${hh});`);
      lines.push(`float ${result} = min(max(cd_${result}.x, cd_${result}.y), 0.0) + length(max(cd_${result}, 0.0));`);
      return result;
    }
    case 'torus': {
      lines.push(`vec2 tq_${result} = vec2(length(${pVar}.xz) - ${node.major.toFixed(6)}, ${pVar}.y);`);
      lines.push(`float ${result} = length(tq_${result}) - ${node.minor.toFixed(6)};`);
      return result;
    }
    case 'union': {
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > 0) {
        lines.push(`float h_${result} = clamp(0.5 + 0.5 * (${b} - ${a}) / ${node.k.toFixed(6)}, 0.0, 1.0);`);
        lines.push(`float ${result} = mix(${b}, ${a}, h_${result}) - ${node.k.toFixed(6)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`float ${result} = min(${a}, ${b});`);
      }
      return result;
    }
    case 'subtract': {
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > 0) {
        lines.push(`float h_${result} = clamp(0.5 - 0.5 * (${a} + ${b}) / ${node.k.toFixed(6)}, 0.0, 1.0);`);
        lines.push(`float ${result} = mix(${a}, -${b}, h_${result}) + ${node.k.toFixed(6)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`float ${result} = max(${a}, -${b});`);
      }
      return result;
    }
    case 'intersect': {
      const a = emitNode(node.a, pVar, lines);
      const b = emitNode(node.b, pVar, lines);
      if (node.k > 0) {
        lines.push(`float h_${result} = clamp(0.5 - 0.5 * (${b} - ${a}) / ${node.k.toFixed(6)}, 0.0, 1.0);`);
        lines.push(`float ${result} = mix(${b}, ${a}, h_${result}) + ${node.k.toFixed(6)} * h_${result} * (1.0 - h_${result});`);
      } else {
        lines.push(`float ${result} = max(${a}, ${b});`);
      }
      return result;
    }
    case 'shell': {
      const child = emitNode(node.child, pVar, lines);
      lines.push(`float ${result} = abs(${child}) - ${(node.thickness / 2).toFixed(6)};`);
      return result;
    }
    case 'offset': {
      const child = emitNode(node.child, pVar, lines);
      lines.push(`float ${result} = ${child} - ${node.distance.toFixed(6)};`);
      return result;
    }
    case 'round': {
      const child = emitNode(node.child, pVar, lines);
      lines.push(`float ${result} = ${child} - ${node.radius.toFixed(6)};`);
      return result;
    }
    case 'transform': {
      // Apply inverse transform to the point
      const tp = `tp_${result}`;
      lines.push(`vec3 ${tp} = ${pVar} - vec3(${node.tx.toFixed(6)}, ${node.ty.toFixed(6)}, ${node.tz.toFixed(6)});`);
      // Apply inverse scale
      if (node.sx !== 1 || node.sy !== 1 || node.sz !== 1) {
        lines.push(`${tp} = ${tp} / vec3(${node.sx.toFixed(6)}, ${node.sy.toFixed(6)}, ${node.sz.toFixed(6)});`);
      }
      // Apply inverse rotation (Z, Y, X order - reversed for inverse)
      if (node.rz !== 0) {
        const a = (-node.rz * Math.PI / 180).toFixed(6);
        lines.push(`${tp} = vec3(${tp}.x * cos(${a}) - ${tp}.y * sin(${a}), ${tp}.x * sin(${a}) + ${tp}.y * cos(${a}), ${tp}.z);`);
      }
      if (node.ry !== 0) {
        const a = (-node.ry * Math.PI / 180).toFixed(6);
        lines.push(`${tp} = vec3(${tp}.x * cos(${a}) + ${tp}.z * sin(${a}), ${tp}.y, -${tp}.x * sin(${a}) + ${tp}.z * cos(${a}));`);
      }
      if (node.rx !== 0) {
        const a = (-node.rx * Math.PI / 180).toFixed(6);
        lines.push(`${tp} = vec3(${tp}.x, ${tp}.y * cos(${a}) - ${tp}.z * sin(${a}), ${tp}.y * sin(${a}) + ${tp}.z * cos(${a}));`);
      }
      const child = emitNode(node.child, tp, lines);
      // Scale correction for non-uniform scale
      const minScale = Math.min(node.sx, node.sy, node.sz);
      if (minScale !== 1) {
        lines.push(`float ${result} = ${child} * ${minScale.toFixed(6)};`);
      } else {
        lines.push(`float ${result} = ${child};`);
      }
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
      const lp = `lp_${result}`;
      const ax = node.axis;
      const totalLen = (node.spacing * (node.count - 1)).toFixed(6);
      lines.push(`float ldot_${result} = dot(${pVar}, vec3(${ax[0]}, ${ax[1]}, ${ax[2]}));`);
      lines.push(`float lclamped_${result} = clamp(ldot_${result}, 0.0, ${totalLen});`);
      lines.push(`float lidx_${result} = floor(lclamped_${result} / ${node.spacing.toFixed(6)} + 0.5);`);
      lines.push(`float loff_${result} = lidx_${result} * ${node.spacing.toFixed(6)};`);
      lines.push(`vec3 ${lp} = ${pVar} - vec3(${ax[0]}, ${ax[1]}, ${ax[2]}) * loff_${result};`);
      const child = emitNode(node.child, lp, lines);
      lines.push(`float ${result} = ${child};`);
      return result;
    }
    case 'circularPattern': {
      const cp = `cp_${result}`;
      const n = node.count;
      const sector = (2 * Math.PI / n).toFixed(6);
      // Assume Y-axis rotation for now (most common for 3D printing)
      lines.push(`float cang_${result} = atan(${pVar}.z, ${pVar}.x);`);
      lines.push(`float crad_${result} = length(${pVar}.xz);`);
      lines.push(`cang_${result} -= ${sector} * floor(cang_${result} / ${sector} + 0.5);`);
      lines.push(`vec3 ${cp} = vec3(crad_${result} * cos(cang_${result}), ${pVar}.y, crad_${result} * sin(cang_${result}));`);
      const child = emitNode(node.child, cp, lines);
      lines.push(`float ${result} = ${child};`);
      return result;
    }
    case 'halfSpace': {
      const component = node.axis === 'x' ? 'x' : node.axis === 'y' ? 'y' : 'z';
      lines.push(`float ${result} = ${pVar}.${component} - ${node.position.toFixed(6)};`);
      return result;
    }
  }
}

export function generateGLSL(root: SDFNode): string {
  varCounter = 0;
  const lines: string[] = [];
  const finalVar = emitNode(root, 'p', lines);

  return `
precision highp float;

uniform float u_z;
uniform vec3 u_bbMin;
uniform vec3 u_bbMax;
uniform vec2 u_resolution;

float sdf(vec3 p) {
  ${lines.join('\n  ')}
  return ${finalVar};
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 p = mix(u_bbMin, u_bbMax, vec3(uv, u_z));
  float d = sdf(p);
  gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
}
`;
}

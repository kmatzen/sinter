import type { BBox, SDFNode, Vec3 } from './types';

export interface HullPlane { normal: Vec3; offset: number }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function boxSupport(bounds: BBox, direction: Vec3): number {
  return direction.reduce((sum, value, axis) => value === 0
    ? sum
    : sum + value * (value > 0 ? bounds.max[axis] : bounds.min[axis]), 0);
}

function inverseRotateDirection(direction: Vec3, rx: number, ry: number, rz: number): Vec3 {
  let [x, y, z] = direction;
  if (rz !== 0) {
    const a = -rz * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (ry !== 0) {
    const a = -ry * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rx !== 0) {
    const a = -rx * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  return [x, y, z];
}

/** Conservative support value, exact for core analytic primitives and their transforms. */
export function supportBound(node: SDFNode, direction: Vec3, fallback: BBox): number {
  switch (node.kind) {
    case 'box': return (Math.abs(direction[0]) * node.size[0] + Math.abs(direction[1]) * node.size[1] + Math.abs(direction[2]) * node.size[2]) / 2;
    case 'sphere': return Math.hypot(...direction) * node.radius;
    case 'ellipsoid': return Math.hypot(direction[0] * node.size[0] / 2, direction[1] * node.size[1] / 2, direction[2] * node.size[2] / 2);
    case 'cylinder': return node.radius * Math.hypot(direction[0], direction[2]) + node.height * Math.abs(direction[1]) / 2;
    case 'capsule': return node.radius * Math.hypot(...direction) + Math.max(0, node.height / 2 - node.radius) * Math.abs(direction[1]);
    case 'torus': return node.major * Math.hypot(direction[0], direction[2]) + node.minor * Math.hypot(...direction);
    case 'cone': return Math.max(node.height * direction[1] / 2, -node.height * direction[1] / 2 + node.radius * Math.hypot(direction[0], direction[2]));
    case 'transform': {
      const scaled: Vec3 = [direction[0] * node.sx, direction[1] * node.sy, direction[2] * node.sz];
      const local = inverseRotateDirection(scaled, node.rx, node.ry, node.rz);
      const childFallback: BBox = { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] };
      const childSupport = supportBound(node.child, local, childFallback);
      if (!Number.isFinite(childSupport)) return boxSupport(fallback, direction);
      return direction[0] * node.tx + direction[1] * node.ty + direction[2] * node.tz + childSupport;
    }
    case 'union':
      if (node.k === 0) return Math.max(supportBound(node.a, direction, fallback), supportBound(node.b, direction, fallback));
      return boxSupport(fallback, direction);
    case 'subtract': return supportBound(node.a, direction, fallback);
    default: return boxSupport(fallback, direction);
  }
}

/** Nested deterministic directions: raising detail only adds support planes. */
export function hullDirections(detail: number): Vec3[] {
  const directions: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const seen = new Set(directions.map((d) => d.join(',')));
  const candidates: Array<{ v: Vec3; length2: number }> = [];
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) for (let z = -4; z <= 4; z++) {
    if (x === 0 && y === 0 && z === 0) continue;
    const divisor = gcd3(Math.abs(x), Math.abs(y), Math.abs(z));
    const primitive: Vec3 = [x / divisor, y / divisor, z / divisor];
    const key = primitive.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ v: primitive, length2: dot(primitive, primitive) });
  }
  candidates.sort((a, b) => a.length2 - b.length2 || a.v[0] - b.v[0] || a.v[1] - b.v[1] || a.v[2] - b.v[2]);
  for (const { v } of candidates) {
    const length = Math.hypot(...v);
    directions.push([v[0] / length, v[1] / length, v[2] / length]);
  }
  return directions.slice(0, Math.max(6, Math.min(98, Math.round(detail))));
}

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a || 1; }
function gcd3(a: number, b: number, c: number): number { return gcd(gcd(a, b), c); }

export function buildHullPlanes(a: SDFNode, b: SDFNode, aBounds: BBox, bBounds: BBox, detail: number): HullPlane[] {
  return hullDirections(detail).map((normal) => ({
    normal,
    offset: Math.max(supportBound(a, normal, aBounds), supportBound(b, normal, bBounds)),
  }));
}

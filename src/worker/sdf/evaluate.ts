import type { SDFNode, Vec3 } from './types';
import { hasGlyphOutlines, SDF_PARAM_EPSILON } from './types';
import { sampleMeshField } from './meshField';
import { linearWindow, circularWindow } from './patternWindow';
import { fieldScale, MODIFIER_DISTANCE_SAFETY } from './bounds';

/**
 * Evaluate the field at a point.
 *
 * Kept as the public entry point — 140-odd call sites and every test use it —
 * but it is a one-line adapter over `evalAt`, which takes loose scalars.
 *
 * The tuple was not free. Every `transform`, `mirror`, `linearPattern` and
 * `circularPattern` built a fresh three-element array to hand to its child,
 * once per node per sample. An export evaluates the field a few million times
 * and each of those walks the whole tree, so the allocation count ran to tens
 * of millions of short-lived arrays — and a pattern inside a pattern multiplies
 * it by the product of the two window widths. `evalAt` passes x, y and z as
 * arguments and allocates nothing.
 */
export function evaluateSDF(node: SDFNode, p: Vec3): number {
  return evalAt(node, p[0], p[1], p[2]);
}

const scaleCache = new WeakMap<object, number>();
function cachedFieldScale(node: SDFNode): number {
  let scale = scaleCache.get(node);
  if (scale === undefined) { scale = fieldScale(node); scaleCache.set(node, scale); }
  return scale;
}

/** Convert a conservative implicit field into a local world-space distance. */
function localDistance(node: SDFNode, px: number, py: number, pz: number): number {
  const raw = evalAt(node, px, py, pz);
  const maxCorrection = cachedFieldScale(node);
  if (maxCorrection <= 1 + 1e-9) return raw;
  const e = 1e-3;
  const gx = (evalAt(node, px + e, py, pz) - evalAt(node, px - e, py, pz)) / (2 * e);
  const gy = (evalAt(node, px, py + e, pz) - evalAt(node, px, py - e, pz)) / (2 * e);
  const gz = (evalAt(node, px, py, pz + e) - evalAt(node, px, py, pz - e)) / (2 * e);
  const gradient = Math.hypot(gx, gy, gz);
  const correction = Math.max(1, Math.min(maxCorrection, 1 / Math.max(gradient, 1e-9)));
  return raw * correction;
}

/**
 * Cached rotation matrices for `transform`.
 *
 * The Euler angles are fixed for the life of a converted tree, but the field
 * was recomputing three cosines and three sines of them on every sample.
 * Keyed on the node itself, so a re-converted tree gets fresh entries and a
 * discarded one is collected.
 */
const rotCache = new WeakMap<object, Float64Array>();

function inverseRotation(node: Extract<SDFNode, { kind: 'transform' }>): Float64Array | null {
  if (node.rx === 0 && node.ry === 0 && node.rz === 0) return null;
  const hit = rotCache.get(node);
  if (hit) return hit;
  const az = (-node.rz * Math.PI) / 180;
  const ay = (-node.ry * Math.PI) / 180;
  const ax = (-node.rx * Math.PI) / 180;
  const m = new Float64Array(6);
  m[0] = Math.cos(az); m[1] = Math.sin(az);
  m[2] = Math.cos(ay); m[3] = Math.sin(ay);
  m[4] = Math.cos(ax); m[5] = Math.sin(ax);
  rotCache.set(node, m);
  return m;
}

export function evalAt(node: SDFNode, px: number, py: number, pz: number): number {
  switch (node.kind) {
    case 'box': {
      const qx = Math.abs(px) - node.size[0] / 2;
      const qy = Math.abs(py) - node.size[1] / 2;
      const qz = Math.abs(pz) - node.size[2] / 2;
      const outside = Math.sqrt(
        Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2,
      );
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      return outside + inside;
    }
    case 'sphere':
      return Math.sqrt(px ** 2 + py ** 2 + pz ** 2) - node.radius;
    case 'cylinder': {
      const dxz = Math.sqrt(px ** 2 + pz ** 2) - node.radius;
      const dy = Math.abs(py) - node.height / 2;
      return Math.min(Math.max(dxz, dy), 0) + Math.sqrt(Math.max(dxz, 0) ** 2 + Math.max(dy, 0) ** 2);
    }
    case 'torus': {
      const qx = Math.sqrt(px ** 2 + pz ** 2) - node.major;
      return Math.sqrt(qx ** 2 + py ** 2) - node.minor;
    }
    case 'cone': {
      // IQ sdCappedCone: base radius r at y=-h/2, apex at y=+h/2
      const r = node.radius, hh = node.height / 2;
      const q = Math.sqrt(px ** 2 + pz ** 2);
      // Cap distance
      const cax = q - Math.min(q, py < 0 ? r : 0);
      const cay = Math.abs(py) - hh;
      // Surface distance: project onto line from base-edge (r,-hh) to apex (0,+hh)
      const ax = q - r, ay = py + hh;
      const bx = -r, by = 2 * hh;
      const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by)));
      const cbx = ax - bx * t, cby = ay - by * t;
      const s = (cbx < 0 && cay < 0) ? -1 : 1;
      return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
    }
    case 'capsule': {
      // Capsule along Y axis (line segment + radius).  The segment degenerates
      // to a point once height <= 2*radius; without the clamp the surrounding
      // min/max invert and yield a sphere displaced by radius - height/2.
      const halfH = Math.max(0, node.height / 2 - node.radius);
      const cy = Math.max(-halfH, Math.min(halfH, py));
      return Math.sqrt(px * px + (py - cy) * (py - cy) + pz * pz) - node.radius;
    }
    case 'ellipsoid': {
      // An ellipsoid is a non-uniformly scaled sphere, and this reports it as
      // one: k0 = length(p/r) is the scaled radius, and one unit of travel in
      // space changes k0 by at most 1/min(r), so (k0-1)*min(r) never overstates
      // the clearance and is 1-Lipschitz.  It is the same treatment `transform`
      // already gives an anisotropic scale.
      //
      // Quilez's sharper form, k0*(k0-1)/length(p/(r*r)), is the
      // separating-hyperplane bound and so never overstates distance either —
      // but it is not 1-Lipschitz (|grad| reaches ~7 on a 6:1 ellipsoid), and
      // round()/offset()/shell() read a non-zero level set of their child,
      // where that matters: the composite then claims more clearance than
      // exists.  Since length(p/(r*r)) * min(r) <= k0 always, the Lipschitz
      // clamp of that form collapses to exactly the expression below, so
      // there is nothing to gain by computing both.
      //
      // The cost is tightness: along a long axis this reports min(r)/max(r) of
      // the true distance, so an elongated ellipsoid needs more ray-march
      // steps.  That is already what scaling a sphere costs here.
      const sx = node.size[0] / 2, sy = node.size[1] / 2, sz = node.size[2] / 2;
      const npx = px / sx, npy = py / sy, npz = pz / sz;
      const k0 = Math.sqrt(npx * npx + npy * npy + npz * npz);
      return (k0 - 1.0) * Math.min(sx, sy, sz);
    }
    case 'union': {
      const a = evalAt(node.a, px, py, pz);
      const b = evalAt(node.b, px, py, pz);
      if (node.k > SDF_PARAM_EPSILON) {
        const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / node.k));
        return b + (a - b) * h - node.k * h * (1 - h);
      }
      return Math.min(a, b);
    }
    case 'subtract': {
      const a = evalAt(node.a, px, py, pz);
      const b = evalAt(node.b, px, py, pz);
      if (node.k > SDF_PARAM_EPSILON) {
        const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (a + b) / node.k));
        return a + (-b - a) * h + node.k * h * (1 - h);
      }
      return Math.max(a, -b);
    }
    case 'intersect': {
      const a = evalAt(node.a, px, py, pz);
      const b = evalAt(node.b, px, py, pz);
      if (node.k > SDF_PARAM_EPSILON) {
        const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (b - a) / node.k));
        return b + (a - b) * h + node.k * h * (1 - h);
      }
      return Math.max(a, b);
    }
    case 'shell':
      return (Math.abs(localDistance(node.child, px, py, pz)) - node.thickness / 2) /
        (cachedFieldScale(node.child) * MODIFIER_DISTANCE_SAFETY);
    case 'offset':
      if (Math.abs(node.distance) <= SDF_PARAM_EPSILON) return evalAt(node.child, px, py, pz);
      return (localDistance(node.child, px, py, pz) - node.distance) /
        (cachedFieldScale(node.child) * MODIFIER_DISTANCE_SAFETY);
    case 'round':
      if (node.radius <= SDF_PARAM_EPSILON) return evalAt(node.child, px, py, pz);
      return (localDistance(node.child, px, py, pz) - node.radius) /
        (cachedFieldScale(node.child) * MODIFIER_DISTANCE_SAFETY);
    case 'transform': {
      // Inverse transform the point: R^-1((p - t) / s).
      let qx = (px - node.tx) / node.sx;
      let qy = (py - node.ty) / node.sy;
      let qz = (pz - node.tz) / node.sz;
      const m = inverseRotation(node);
      if (m !== null) {
        // Inverse rotation: Z then Y then X (inverse of XYZ Euler).
        const cz = m[0], sz = m[1];
        const nx = qx * cz - qy * sz, ny = qx * sz + qy * cz;
        qx = nx; qy = ny;
        const cy = m[2], sy = m[3];
        const nx2 = qx * cy + qz * sy, nz2 = -qx * sy + qz * cy;
        qx = nx2; qz = nz2;
        const cx = m[4], sx = m[5];
        const ny2 = qy * cx - qz * sx, nz3 = qy * sx + qz * cx;
        qy = ny2; qz = nz3;
      }
      return evalAt(node.child, qx, qy, qz) * Math.min(node.sx, node.sy, node.sz);
    }
    case 'mirror':
      return evalAt(
        node.child,
        node.axes[0] ? Math.abs(px) : px,
        node.axes[1] ? Math.abs(py) : py,
        node.axes[2] ? Math.abs(pz) : pz,
      );
    case 'linearPattern': {
      // Domain repetition over a window sized from the child's own extent, so
      // an offset or wider-than-spacing child still finds its nearest copy.
      const axLen = Math.hypot(node.axis[0], node.axis[1], node.axis[2]);
      if (axLen < 1e-8) return evalAt(node.child, px, py, pz);
      const { axis: nax, hi, width } = linearWindow(node);
      const dot = px * nax[0] + py * nax[1] + pz * nax[2];
      // First instance whose span can reach p, backed off by one.
      const base = Math.min(
        Math.max(Math.floor((dot - hi) / node.spacing) - 1, 0),
        node.count - width,
      );
      let best = Infinity;
      for (let j = 0; j < width; j++) {
        const offset = (base + j) * node.spacing;
        const d = evalAt(
          node.child,
          px - nax[0] * offset,
          py - nax[1] * offset,
          pz - nax[2] * offset,
        );
        if (d < best) best = d;
      }
      return best;
    }
    case 'circularPattern': {
      // Angular domain repetition over a window sized from the child's angular
      // extent.  Instances tile the full turn, so the index needs no clamping —
      // rotating by any integer multiple of the sector stays in the pattern.
      const { isX, isZ, hiAng, sector, width } = circularWindow(node);
      let angle: number, radius: number;
      if (isX) {
        angle = Math.atan2(pz, py);
        radius = Math.sqrt(py ** 2 + pz ** 2);
      } else if (isZ) {
        angle = Math.atan2(py, px);
        radius = Math.sqrt(px ** 2 + py ** 2);
      } else {
        angle = Math.atan2(pz, px);
        radius = Math.sqrt(px ** 2 + pz ** 2);
      }
      const base = Math.floor((angle - hiAng) / sector) - 1;
      let best = Infinity;
      for (let j = 0; j < width; j++) {
        const a = angle - (base + j) * sector;
        const c = Math.cos(a), s = Math.sin(a);
        const d = isX ? evalAt(node.child, px, radius * c, radius * s)
                : isZ ? evalAt(node.child, radius * c, radius * s, pz)
                :       evalAt(node.child, radius * c, py, radius * s);
        if (d < best) best = d;
      }
      return best;
    }
    case 'halfSpace': {
      const v = node.axis === 'x' ? px : node.axis === 'y' ? py : pz;
      const d = v - node.position;
      return node.flip ? -d : d;
    }
    case 'text': {
      if (hasGlyphOutlines(node)) {
        const gw = node.glyphWidth || 1;
        const ga = node.glyphAscent || node.size;
        const gd = node.glyphDescent || 0;
        const hh = (ga - gd) / 2;

        // Bounding box early-out
        const bqx = Math.abs(px) - gw / 2;
        const bqy = Math.abs(py) - hh;
        const bqz = Math.abs(pz) - node.depth / 2;
        const boxDist = Math.sqrt(Math.max(bqx, 0) ** 2 + Math.max(bqy, 0) ** 2 + Math.max(bqz, 0) ** 2) +
                        Math.min(Math.max(bqx, bqy, bqz), 0);
        if (boxDist > hh * 0.1) return boxDist;

        // Glyph space: origin at the left edge, y down.
        const gx = px + gw / 2;
        const gy = -(py - (ga + gd) / 2);

        let minDist = Infinity;
        let winding = 0;

        for (const seg of (node.glyphSegments || [])) {
          const d = distToLine(gx, gy, seg.x0, seg.y0, seg.x1, seg.y1);
          minDist = Math.min(minDist, d);
          winding += windingLine(gx, gy, seg.x0, seg.y0, seg.x1, seg.y1);
        }
        for (const bez of (node.glyphBeziers || [])) {
          const d = distToQuadBezier(gx, gy, bez.x0, bez.y0, bez.x1, bez.y1, bez.x2, bez.y2);
          minDist = Math.min(minDist, d);
          winding += windingBezier(gx, gy, bez.x0, bez.y0, bez.x1, bez.y1, bez.x2, bez.y2);
        }

        const sign = winding !== 0 ? -1 : 1;
        const d2d = sign * minDist;

        // Extrude along Z
        const dz = Math.abs(pz) - node.depth / 2;
        const d2dc = Math.max(d2d, 0);
        const dzc = Math.max(dz, 0);
        if (d2d < 0 && dz < 0) return Math.max(d2d, dz);
        return Math.sqrt(d2dc ** 2 + dzc ** 2);
      }

      // Fallback: box
      const charWidth = node.size * 0.6;
      const totalWidth = node.text.length * charWidth;
      const qx = Math.abs(px) - totalWidth / 2;
      const qy = Math.abs(py) - node.size / 2;
      const qz = Math.abs(pz) - node.depth / 2;
      const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2);
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      return outside + inside;
    }
    case 'mesh':
      return sampleMeshField(node.field, px, py, pz);
    case '_far':
      return 1e10;
  }
}

// --- 2D geometry helpers for glyph SDF ---

function distToLine(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
  const cx = x0 + t * dx - px, cy = y0 + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function windingLine(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  if (y0 <= py) {
    if (y1 > py && cross2d(x1 - x0, y1 - y0, px - x0, py - y0) > 0) return 1;
  } else {
    if (y1 <= py && cross2d(x1 - x0, y1 - y0, px - x0, py - y0) < 0) return -1;
  }
  return 0;
}

function cross2d(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function distToQuadBezier(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  // Find closest point on quadratic bezier by sampling + Newton refinement
  // Sample at several points for robustness
  let minD = Infinity;
  const steps = 8;
  let bestT = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bx = bezierX(t, x0, x1, x2), by = bezierY(t, y0, y1, y2);
    const d = (bx - px) ** 2 + (by - py) ** 2;
    if (d < minD) { minD = d; bestT = t; }
  }
  // Newton refinement
  for (let iter = 0; iter < 4; iter++) {
    const t = bestT;
    const bx = bezierX(t, x0, x1, x2) - px;
    const by = bezierY(t, y0, y1, y2) - py;
    const dbx = 2 * ((1 - t) * (x1 - x0) + t * (x2 - x1));
    const dby = 2 * ((1 - t) * (y1 - y0) + t * (y2 - y1));
    const ddbx = 2 * (x2 - 2 * x1 + x0);
    const ddby = 2 * (y2 - 2 * y1 + y0);
    const f = bx * dbx + by * dby;
    const df = dbx * dbx + bx * ddbx + dby * dby + by * ddby;
    if (Math.abs(df) < 1e-10) break;
    bestT = Math.max(0, Math.min(1, t - f / df));
  }
  const fx = bezierX(bestT, x0, x1, x2) - px;
  const fy = bezierY(bestT, y0, y1, y2) - py;
  return Math.sqrt(fx * fx + fy * fy);
}

function bezierX(t: number, x0: number, x1: number, x2: number): number {
  return (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2;
}

function bezierY(t: number, y0: number, y1: number, y2: number): number {
  return (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2;
}

function windingBezier(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  // Approximate winding by subdividing bezier into line segments
  let w = 0;
  const n = 4;
  let prevX = x0, prevY = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const nx = bezierX(t, x0, x1, x2);
    const ny = bezierY(t, y0, y1, y2);
    w += windingLine(px, py, prevX, prevY, nx, ny);
    prevX = nx; prevY = ny;
  }
  return w;
}

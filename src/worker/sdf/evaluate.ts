import type { SDFNode, Vec3 } from './types';
import { linearWindow, circularWindow } from './patternWindow';

export function evaluateSDF(node: SDFNode, p: Vec3): number {
  switch (node.kind) {
    case 'box': {
      const qx = Math.abs(p[0]) - node.size[0] / 2;
      const qy = Math.abs(p[1]) - node.size[1] / 2;
      const qz = Math.abs(p[2]) - node.size[2] / 2;
      const outside = Math.sqrt(
        Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2,
      );
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      return outside + inside;
    }
    case 'sphere':
      return Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2) - node.radius;
    case 'cylinder': {
      const dxz = Math.sqrt(p[0] ** 2 + p[2] ** 2) - node.radius;
      const dy = Math.abs(p[1]) - node.height / 2;
      return Math.min(Math.max(dxz, dy), 0) + Math.sqrt(Math.max(dxz, 0) ** 2 + Math.max(dy, 0) ** 2);
    }
    case 'torus': {
      const qx = Math.sqrt(p[0] ** 2 + p[2] ** 2) - node.major;
      return Math.sqrt(qx ** 2 + p[1] ** 2) - node.minor;
    }
    case 'cone': {
      // IQ sdCappedCone: base radius r at y=-h/2, apex at y=+h/2
      const r = node.radius, hh = node.height / 2;
      const q = Math.sqrt(p[0] ** 2 + p[2] ** 2);
      // Cap distance
      const cax = q - Math.min(q, p[1] < 0 ? r : 0);
      const cay = Math.abs(p[1]) - hh;
      // Surface distance: project onto line from base-edge (r,-hh) to apex (0,+hh)
      const ax = q - r, ay = p[1] + hh;
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
      const py = Math.max(-halfH, Math.min(halfH, p[1]));
      return Math.sqrt(p[0] ** 2 + (p[1] - py) ** 2 + p[2] ** 2) - node.radius;
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
      const npx = p[0] / sx, npy = p[1] / sy, npz = p[2] / sz;
      const k0 = Math.sqrt(npx * npx + npy * npy + npz * npz);
      return (k0 - 1.0) * Math.min(sx, sy, sz);
    }
    case 'union': {
      const a = evaluateSDF(node.a, p);
      const b = evaluateSDF(node.b, p);
      if (node.k > 0) {
        const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / node.k));
        return b + (a - b) * h - node.k * h * (1 - h);
      }
      return Math.min(a, b);
    }
    case 'subtract': {
      const a = evaluateSDF(node.a, p);
      const b = evaluateSDF(node.b, p);
      if (node.k > 0) {
        const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (a + b) / node.k));
        return a + (-b - a) * h + node.k * h * (1 - h);
      }
      return Math.max(a, -b);
    }
    case 'intersect': {
      const a = evaluateSDF(node.a, p);
      const b = evaluateSDF(node.b, p);
      if (node.k > 0) {
        const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (b - a) / node.k));
        return b + (a - b) * h + node.k * h * (1 - h);
      }
      return Math.max(a, b);
    }
    case 'shell':
      return Math.abs(evaluateSDF(node.child, p)) - node.thickness / 2;
    case 'offset':
      return evaluateSDF(node.child, p) - node.distance;
    case 'round':
      return evaluateSDF(node.child, p) - node.radius;
    case 'transform': {
      // Inverse transform the point
      let px = p[0] - node.tx;
      let py = p[1] - node.ty;
      let pz = p[2] - node.tz;
      // Inverse scale
      px /= node.sx; py /= node.sy; pz /= node.sz;
      // Inverse rotation: Z then Y then X (inverse of XYZ Euler)
      {
        const a = -node.rz * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        [px, py] = [px * c - py * s, px * s + py * c];
      }
      {
        const a = -node.ry * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        [px, pz] = [px * c + pz * s, -px * s + pz * c];
      }
      {
        const a = -node.rx * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        [py, pz] = [py * c - pz * s, py * s + pz * c];
      }
      return evaluateSDF(node.child, [px, py, pz]) * Math.min(node.sx, node.sy, node.sz);
    }
    case 'mirror': {
      const mp: Vec3 = [
        node.axes[0] ? Math.abs(p[0]) : p[0],
        node.axes[1] ? Math.abs(p[1]) : p[1],
        node.axes[2] ? Math.abs(p[2]) : p[2],
      ];
      return evaluateSDF(node.child, mp);
    }
    case 'linearPattern': {
      // Domain repetition over a window sized from the child's own extent, so
      // an offset or wider-than-spacing child still finds its nearest copy.
      const axLen = Math.hypot(node.axis[0], node.axis[1], node.axis[2]);
      if (axLen < 1e-8) return evaluateSDF(node.child, p);
      const { axis: nax, hi, width } = linearWindow(node);
      const dot = p[0] * nax[0] + p[1] * nax[1] + p[2] * nax[2];
      // First instance whose span can reach p, backed off by one.
      const base = Math.min(
        Math.max(Math.floor((dot - hi) / node.spacing) - 1, 0),
        node.count - width,
      );
      let best = Infinity;
      for (let j = 0; j < width; j++) {
        const offset = (base + j) * node.spacing;
        const lp: Vec3 = [
          p[0] - nax[0] * offset,
          p[1] - nax[1] * offset,
          p[2] - nax[2] * offset,
        ];
        best = Math.min(best, evaluateSDF(node.child, lp));
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
        angle = Math.atan2(p[2], p[1]);
        radius = Math.sqrt(p[1] ** 2 + p[2] ** 2);
      } else if (isZ) {
        angle = Math.atan2(p[1], p[0]);
        radius = Math.sqrt(p[0] ** 2 + p[1] ** 2);
      } else {
        angle = Math.atan2(p[2], p[0]);
        radius = Math.sqrt(p[0] ** 2 + p[2] ** 2);
      }
      const base = Math.floor((angle - hiAng) / sector) - 1;
      let best = Infinity;
      for (let j = 0; j < width; j++) {
        const a = angle - (base + j) * sector;
        const c = Math.cos(a), s = Math.sin(a);
        let cp: Vec3;
        if (isX) {
          cp = [p[0], radius * c, radius * s];
        } else if (isZ) {
          cp = [radius * c, radius * s, p[2]];
        } else {
          cp = [radius * c, p[1], radius * s];
        }
        best = Math.min(best, evaluateSDF(node.child, cp));
      }
      return best;
    }
    case 'halfSpace': {
      const idx = node.axis === 'x' ? 0 : node.axis === 'y' ? 1 : 2;
      const d = p[idx] - node.position;
      return node.flip ? -d : d;
    }
    case 'text': {
      if (node.glyphSegments || node.glyphBeziers) {
        const gw = node.glyphWidth || 1;
        const ga = node.glyphAscent || node.size;
        const gd = node.glyphDescent || 0;
        const hh = (ga - gd) / 2;

        // Bounding box early-out
        const bqx = Math.abs(p[0]) - gw / 2;
        const bqy = Math.abs(p[1]) - hh;
        const bqz = Math.abs(p[2]) - node.depth / 2;
        const boxDist = Math.sqrt(Math.max(bqx, 0) ** 2 + Math.max(bqy, 0) ** 2 + Math.max(bqz, 0) ** 2) +
                        Math.min(Math.max(bqx, bqy, bqz), 0);
        if (boxDist > hh * 0.1) return boxDist;

        const px = p[0] + gw / 2;
        const py = -(p[1] - (ga + gd) / 2);

        let minDist = Infinity;
        let winding = 0;

        for (const seg of (node.glyphSegments || [])) {
          const d = distToLine(px, py, seg.x0, seg.y0, seg.x1, seg.y1);
          minDist = Math.min(minDist, d);
          winding += windingLine(px, py, seg.x0, seg.y0, seg.x1, seg.y1);
        }
        for (const bez of (node.glyphBeziers || [])) {
          const d = distToQuadBezier(px, py, bez.x0, bez.y0, bez.x1, bez.y1, bez.x2, bez.y2);
          minDist = Math.min(minDist, d);
          winding += windingBezier(px, py, bez.x0, bez.y0, bez.x1, bez.y1, bez.x2, bez.y2);
        }

        const sign = winding !== 0 ? -1 : 1;
        const d2d = sign * minDist;

        // Extrude along Z
        const dz = Math.abs(p[2]) - node.depth / 2;
        const d2dc = Math.max(d2d, 0);
        const dzc = Math.max(dz, 0);
        if (d2d < 0 && dz < 0) return Math.max(d2d, dz);
        return Math.sqrt(d2dc ** 2 + dzc ** 2);
      }

      // Fallback: box
      const charWidth = node.size * 0.6;
      const totalWidth = node.text.length * charWidth;
      const qx = Math.abs(p[0]) - totalWidth / 2;
      const qy = Math.abs(p[1]) - node.size / 2;
      const qz = Math.abs(p[2]) - node.depth / 2;
      const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2);
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      return outside + inside;
    }
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

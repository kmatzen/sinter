import type { SDFNode, Vec3 } from './types';

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
      // Inverse rotation (Z, Y, X - reversed order)
      if (node.rz !== 0) {
        const a = -node.rz * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        [px, py] = [px * c - py * s, px * s + py * c];
      }
      if (node.ry !== 0) {
        const a = -node.ry * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        [px, pz] = [px * c + pz * s, -px * s + pz * c];
      }
      if (node.rx !== 0) {
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
      // Repeat along axis with domain repetition
      const ax = node.axis;
      const dot = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
      const totalLen = node.spacing * (node.count - 1);
      // Clamp to the pattern range then find nearest instance
      const clamped = Math.max(0, Math.min(totalLen, dot));
      const idx = Math.round(clamped / node.spacing);
      const offset = idx * node.spacing;
      const lp: Vec3 = [
        p[0] - ax[0] * offset,
        p[1] - ax[1] * offset,
        p[2] - ax[2] * offset,
      ];
      return evaluateSDF(node.child, lp);
    }
    case 'circularPattern': {
      // Repeat around axis (Y by default) using angular repetition
      const ax = node.axis;
      // Project point onto the plane perpendicular to axis
      let angle: number;
      let radius: number;
      if (ax[1]) {
        // Y axis rotation
        angle = Math.atan2(p[2], p[0]);
        radius = Math.sqrt(p[0] ** 2 + p[2] ** 2);
      } else if (ax[2]) {
        angle = Math.atan2(p[1], p[0]);
        radius = Math.sqrt(p[0] ** 2 + p[1] ** 2);
      } else {
        angle = Math.atan2(p[2], p[1]);
        radius = Math.sqrt(p[1] ** 2 + p[2] ** 2);
      }
      const sector = (2 * Math.PI) / node.count;
      // Snap to nearest sector
      angle = angle - sector * Math.round(angle / sector);
      const cp: Vec3 = [...p];
      if (ax[1]) {
        cp[0] = radius * Math.cos(angle);
        cp[2] = radius * Math.sin(angle);
      } else if (ax[2]) {
        cp[0] = radius * Math.cos(angle);
        cp[1] = radius * Math.sin(angle);
      } else {
        cp[1] = radius * Math.cos(angle);
        cp[2] = radius * Math.sin(angle);
      }
      return evaluateSDF(node.child, cp);
    }
    case 'halfSpace': {
      const idx = node.axis === 'x' ? 0 : node.axis === 'y' ? 1 : 2;
      return p[idx] - node.position;
    }
  }
}

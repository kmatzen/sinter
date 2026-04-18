import type { SDFNode, BBox, Vec3 } from './types';

export function computeBounds(node: SDFNode): BBox {
  switch (node.kind) {
    case 'box': {
      const [hw, hh, hd] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      return { min: [-hw, -hh, -hd], max: [hw, hh, hd] };
    }
    case 'sphere':
      return { min: [-node.radius, -node.radius, -node.radius], max: [node.radius, node.radius, node.radius] };
    case 'cylinder': {
      const r = node.radius;
      const hh = node.height / 2;
      return { min: [-r, -hh, -r], max: [r, hh, r] };
    }
    case 'torus': {
      const outer = node.major + node.minor;
      return { min: [-outer, -node.minor, -outer], max: [outer, node.minor, outer] };
    }
    case 'cone': {
      const r = node.radius, hh = node.height / 2;
      return { min: [-r, -hh, -r], max: [r, hh, r] };
    }
    case 'capsule': {
      const r = node.radius, hh = node.height / 2;
      return { min: [-r, -hh, -r], max: [r, hh, r] };
    }
    case 'ellipsoid': {
      const [hx, hy, hz] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      return { min: [-hx, -hy, -hz], max: [hx, hy, hz] };
    }
    case 'union':
      return mergeBounds(computeBounds(node.a), computeBounds(node.b), node.k);
    case 'subtract':
      return expandBounds(computeBounds(node.a), node.k);
    case 'intersect': {
      // For intersect, the result is contained within either child.
      // Use the smaller of the two bounds.
      const ba = computeBounds(node.a);
      const bb = computeBounds(node.b);
      const result: BBox = {
        min: [Math.max(ba.min[0], bb.min[0]), Math.max(ba.min[1], bb.min[1]), Math.max(ba.min[2], bb.min[2])],
        max: [Math.min(ba.max[0], bb.max[0]), Math.min(ba.max[1], bb.max[1]), Math.min(ba.max[2], bb.max[2])],
      };
      return expandBounds(result, node.k);
    }
    case 'shell':
      return expandBounds(computeBounds(node.child), node.thickness);
    case 'offset':
      return expandBounds(computeBounds(node.child), Math.abs(node.distance));
    case 'round':
      return expandBounds(computeBounds(node.child), node.radius);
    case 'mirror': {
      const cb = computeBounds(node.child);
      return {
        min: [
          node.axes[0] ? -Math.max(Math.abs(cb.min[0]), Math.abs(cb.max[0])) : cb.min[0],
          node.axes[1] ? -Math.max(Math.abs(cb.min[1]), Math.abs(cb.max[1])) : cb.min[1],
          node.axes[2] ? -Math.max(Math.abs(cb.min[2]), Math.abs(cb.max[2])) : cb.min[2],
        ],
        max: [
          node.axes[0] ? Math.max(Math.abs(cb.min[0]), Math.abs(cb.max[0])) : cb.max[0],
          node.axes[1] ? Math.max(Math.abs(cb.min[1]), Math.abs(cb.max[1])) : cb.max[1],
          node.axes[2] ? Math.max(Math.abs(cb.min[2]), Math.abs(cb.max[2])) : cb.max[2],
        ],
      };
    }
    case 'linearPattern': {
      const cb = computeBounds(node.child);
      // Normalize axis for correct offset computation
      const ax = node.axis;
      const axLen = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]);
      const nax = axLen > 1e-8 ? [ax[0] / axLen, ax[1] / axLen, ax[2] / axLen] : [0, 1, 0];
      const totalOffset = node.spacing * (node.count - 1);
      // Expand in the direction of the axis (handles negative components)
      const dx = nax[0] * totalOffset;
      const dy = nax[1] * totalOffset;
      const dz = nax[2] * totalOffset;
      return {
        min: [
          cb.min[0] + Math.min(0, dx),
          cb.min[1] + Math.min(0, dy),
          cb.min[2] + Math.min(0, dz),
        ],
        max: [
          cb.max[0] + Math.max(0, dx),
          cb.max[1] + Math.max(0, dy),
          cb.max[2] + Math.max(0, dz),
        ],
      };
    }
    case 'circularPattern': {
      const cb = computeBounds(node.child);
      // Determine rotation axis (dominant component)
      const ax = node.axis;
      const isX = Math.abs(ax[0]) > Math.abs(ax[1]) && Math.abs(ax[0]) > Math.abs(ax[2]);
      const isZ = !isX && Math.abs(ax[2]) > Math.abs(ax[1]);
      // Compute max radius from origin to any child bbox corner in the rotation plane
      const xs = [cb.min[0], cb.max[0]];
      const ys = [cb.min[1], cb.max[1]];
      const zs = [cb.min[2], cb.max[2]];
      let maxR = 0;
      for (const x of xs) for (const y of ys) for (const z of zs) {
        const r = isX ? Math.sqrt(y * y + z * z)
                : isZ ? Math.sqrt(x * x + y * y)
                :        Math.sqrt(x * x + z * z);
        maxR = Math.max(maxR, r);
      }
      if (isX) {
        // Rotate in YZ plane, keep X from child
        return { min: [cb.min[0], -maxR, -maxR], max: [cb.max[0], maxR, maxR] };
      } else if (isZ) {
        // Rotate in XY plane, keep Z from child
        return { min: [-maxR, -maxR, cb.min[2]], max: [maxR, maxR, cb.max[2]] };
      }
      // Y-axis (default): rotate in XZ plane, keep Y from child
      return { min: [-maxR, cb.min[1], -maxR], max: [maxR, cb.max[1], maxR] };
    }
    case 'text': {
      if (node.glyphWidth) {
        const hw = node.glyphWidth / 2;
        const ga = node.glyphAscent || node.size;
        const gd = node.glyphDescent || 0;
        const hh = (ga - gd) / 2;
        return { min: [-hw, -hh, -node.depth / 2], max: [hw, hh, node.depth / 2] };
      }
      const charW = node.size * 0.6;
      const totalW = node.text.length * charW;
      const hw = totalW / 2, hh = node.size / 2, hd = node.depth / 2;
      return { min: [-hw, -hh, -hd], max: [hw, hh, hd] };
    }
    case 'halfSpace':
      // Half-space is infinite; bounds are meaningless on their own.
      // When intersected with geometry, the parent intersect node uses the other child's bounds.
      return { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] };
    case 'transform': {
      const cb = computeBounds(node.child);
      // Transform all 8 corners of the child AABB and compute the new AABB
      const corners: Vec3[] = [
        [cb.min[0], cb.min[1], cb.min[2]], [cb.max[0], cb.min[1], cb.min[2]],
        [cb.min[0], cb.max[1], cb.min[2]], [cb.max[0], cb.max[1], cb.min[2]],
        [cb.min[0], cb.min[1], cb.max[2]], [cb.max[0], cb.min[1], cb.max[2]],
        [cb.min[0], cb.max[1], cb.max[2]], [cb.max[0], cb.max[1], cb.max[2]],
      ];

      const rMin: Vec3 = [Infinity, Infinity, Infinity];
      const rMax: Vec3 = [-Infinity, -Infinity, -Infinity];

      for (const c of corners) {
        // Apply scale
        let px = c[0] * node.sx, py = c[1] * node.sy, pz = c[2] * node.sz;
        // Apply rotation (X, Y, Z order)
        if (node.rx !== 0) {
          const a = node.rx * Math.PI / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          const ny = py * cos - pz * sin, nz = py * sin + pz * cos;
          py = ny; pz = nz;
        }
        if (node.ry !== 0) {
          const a = node.ry * Math.PI / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          const nx = px * cos + pz * sin, nz = -px * sin + pz * cos;
          px = nx; pz = nz;
        }
        if (node.rz !== 0) {
          const a = node.rz * Math.PI / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          const nx = px * cos - py * sin, ny = px * sin + py * cos;
          px = nx; py = ny;
        }
        // Apply translation
        px += node.tx; py += node.ty; pz += node.tz;

        rMin[0] = Math.min(rMin[0], px); rMin[1] = Math.min(rMin[1], py); rMin[2] = Math.min(rMin[2], pz);
        rMax[0] = Math.max(rMax[0], px); rMax[1] = Math.max(rMax[1], py); rMax[2] = Math.max(rMax[2], pz);
      }

      return { min: rMin, max: rMax };
    }
    case '_far':
      return { min: [0, 0, 0], max: [0, 0, 0] };
  }
}

function mergeBounds(a: BBox, b: BBox, k: number): BBox {
  return {
    min: [Math.min(a.min[0], b.min[0]) - k, Math.min(a.min[1], b.min[1]) - k, Math.min(a.min[2], b.min[2]) - k],
    max: [Math.max(a.max[0], b.max[0]) + k, Math.max(a.max[1], b.max[1]) + k, Math.max(a.max[2], b.max[2]) + k],
  };
}

function expandBounds(bb: BBox, margin: number): BBox {
  return {
    min: [bb.min[0] - margin, bb.min[1] - margin, bb.min[2] - margin] as Vec3,
    max: [bb.max[0] + margin, bb.max[1] + margin, bb.max[2] + margin] as Vec3,
  };
}

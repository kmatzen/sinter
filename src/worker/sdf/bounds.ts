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
      const totalOffset = node.spacing * (node.count - 1);
      return {
        min: [cb.min[0], cb.min[1], cb.min[2]],
        max: [
          cb.max[0] + node.axis[0] * totalOffset,
          cb.max[1] + node.axis[1] * totalOffset,
          cb.max[2] + node.axis[2] * totalOffset,
        ],
      };
    }
    case 'circularPattern': {
      const cb = computeBounds(node.child);
      const maxExtent = Math.max(
        Math.abs(cb.min[0]), Math.abs(cb.max[0]),
        Math.abs(cb.min[1]), Math.abs(cb.max[1]),
        Math.abs(cb.min[2]), Math.abs(cb.max[2]),
      );
      return {
        min: [-maxExtent, cb.min[1], -maxExtent],
        max: [maxExtent, cb.max[1], maxExtent],
      };
    }
    case 'halfSpace':
      // Half-space is infinite; bounds are meaningless on their own.
      // When intersected with geometry, the parent intersect node uses the other child's bounds.
      return { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] };
    case 'transform': {
      const childBounds = computeBounds(node.child);
      // Rough expansion for transforms - proper rotation would need all 8 corners
      const dx = Math.abs(node.tx);
      const dy = Math.abs(node.ty);
      const dz = Math.abs(node.tz);
      const s = Math.max(node.sx, node.sy, node.sz);
      return {
        min: [childBounds.min[0] * s - dx, childBounds.min[1] * s - dy, childBounds.min[2] * s - dz],
        max: [childBounds.max[0] * s + dx, childBounds.max[1] * s + dy, childBounds.max[2] * s + dz],
      };
    }
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

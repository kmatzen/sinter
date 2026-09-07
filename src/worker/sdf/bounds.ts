import type { SDFNode, BBox, Vec3 } from './types';
import { SDF_PARAM_EPSILON } from './types';
import { hasGlyphOutlines } from './types';

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
      // Below height = 2*radius the capsule is just a sphere of that radius,
      // so the half-height can never fall under r.
      const r = node.radius, hh = Math.max(node.height / 2, r);
      return { min: [-r, -hh, -r], max: [r, hh, r] };
    }
    case 'ellipsoid': {
      const [hx, hy, hz] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      return { min: [-hx, -hy, -hz], max: [hx, hy, hz] };
    }
    case 'union':
      return mergeBounds(
        computeBounds(node.a),
        computeBounds(node.b),
        node.k > SDF_PARAM_EPSILON ? (node.k / 4) * Math.max(fieldScale(node.a), fieldScale(node.b)) : 0,
      );
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
    // Surface evaluation re-distances in world space. These are computational
    // safety bounds, so they retain the maximum correction factor: finite
    // gradient sampling can land a fraction beyond the analytic Minkowski box
    // off principal axes, and clipping is worse than a conservative margin.
    case 'shell':
      return expandBounds(computeBounds(node.child), (node.thickness / 2) * fieldScale(node.child));
    case 'offset':
      return expandBounds(computeBounds(node.child), Math.abs(node.distance) * fieldScale(node.child));
    case 'round':
      return expandBounds(computeBounds(node.child), node.radius * fieldScale(node.child));
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
      // Must agree with evaluate.ts and codegen.ts about which shape this is,
      // or the bound describes a different solid from the one rendered.
      if (hasGlyphOutlines(node) && node.glyphWidth) {
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
      // A half-space really is unbounded, so say so rather than substituting a
      // 1000mm box: `intersect` takes the tighter of the two bounds per axis,
      // so infinities there simply defer to the other child, which is the only
      // way a halfSpace reaches the tree (convert.ts wraps it in an intersect).
      // The old finite stand-in silently clipped any model over 1000mm.
      return {
        min: [-Infinity, -Infinity, -Infinity],
        max: [Infinity, Infinity, Infinity],
      };
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
        // Rotate, then scale, then translate.  evaluate.ts inverts the
        // transform as R^-1((p - t) / s), so the forward map is t + s * R(q) —
        // scaling before rotating instead gives a different solid whenever the
        // scale is non-uniform and the rotation is not a multiple of a
        // quarter turn, and the real geometry escapes these bounds.
        let px = c[0], py = c[1], pz = c[2];
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
        // Apply scale, then translation
        px *= node.sx; py *= node.sy; pz *= node.sz;
        px += node.tx; py += node.ty; pz += node.tz;

        rMin[0] = Math.min(rMin[0], px); rMin[1] = Math.min(rMin[1], py); rMin[2] = Math.min(rMin[2], pz);
        rMax[0] = Math.max(rMax[0], px); rMax[1] = Math.max(rMax[1], py); rMax[2] = Math.max(rMax[2], pz);
      }

      return { min: rMin, max: rMax };
    }
    // The baked grid's box, not the triangles' box. Outside the grid the
    // field is a loose under-estimate rather than a distance, so the grid is
    // where the surface can actually be resolved — and it already contains the
    // mesh with padding to spare.
    case 'mesh':
      return { min: [...node.field.bbox.min], max: [...node.field.bbox.max] };
    case '_far':
      return { min: [0, 0, 0], max: [0, 0, 0] };
  }
}

/**
 * How far a subtree's reported distance can fall short of the true distance.
 *
 * Nodes in this tree return three different things.  Most primitives return
 * exact Euclidean distance.  `transform` under a non-uniform scale returns a
 * 1-Lipschitz *lower bound* — it multiplies by min(scale) precisely so the
 * field stays safe for sphere tracing, at the cost of underestimating by up to
 * max(scale)/min(scale).  The ellipsoid is a gradient-corrected approximation
 * that also underestimates.
 *
 * `round`/`offset`/`shell` and their bounds are written as if the first case
 * always held, so they need to know the factor.  This returns an upper bound on
 * trueDistance / reportedDistance for the subtree — always >= 1.
 *
 * Caveat: the `max`-based booleans can also underestimate, by an amount that is
 * unbounded for a sufficiently thin wedge, so no finite factor is sound there.
 * This takes the children's factor, which covers every case observed in
 * practice; `boundsAreSound` in interval.ts is the check that actually holds
 * the line, and the interval-derived bounds are what the mesher uses.
 */
/**
 * Gradient re-distancing preserves a modifier's zero surface, but the
 * correction varies near seams and medial axes. Reserve slope headroom so the
 * resulting field remains a conservative sphere-tracing step there.
 */
// The local gradient correction can change across a modifier's medial seams.
// A 5% margin beyond the theoretical 2x bound keeps the composed field
// conservative under floating-point interpolation at those transitions.
export const MODIFIER_DISTANCE_SAFETY = 2.1;

export function fieldScale(node: SDFNode): number {
  switch (node.kind) {
    case 'transform': {
      const s = [Math.abs(node.sx), Math.abs(node.sy), Math.abs(node.sz)];
      const lo = Math.min(s[0], s[1], s[2]);
      const hi = Math.max(s[0], s[1], s[2]);
      const aniso = lo > 1e-9 ? hi / lo : 1;
      return fieldScale(node.child) * aniso;
    }
    case 'ellipsoid': {
      // Reported as a scaled sphere, so it underestimates by the aspect ratio.
      const h = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      const lo = Math.min(h[0], h[1], h[2]);
      const hi = Math.max(h[0], h[1], h[2]);
      return lo > 1e-9 ? hi / lo : 1;
    }
    case 'union':
    case 'subtract':
    case 'intersect':
      return Math.max(fieldScale(node.a), fieldScale(node.b));
    case 'offset':
      if (Math.abs(node.distance) <= SDF_PARAM_EPSILON) return fieldScale(node.child);
      return fieldScale(node.child) * MODIFIER_DISTANCE_SAFETY;
    case 'round':
      if (node.radius <= SDF_PARAM_EPSILON) return fieldScale(node.child);
      return fieldScale(node.child) * MODIFIER_DISTANCE_SAFETY;
    case 'shell':
      return fieldScale(node.child) * MODIFIER_DISTANCE_SAFETY;
    case 'mirror':
    case 'linearPattern':
    case 'circularPattern':
      return fieldScale(node.child);
    default:
      return 1;
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

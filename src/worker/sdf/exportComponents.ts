import { computeBounds } from './bounds';
import type { BBox, SDFNode } from './types';

type Feature3 = [number, number, number];
const min3 = (a: Feature3, b: Feature3): Feature3 => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];

/** Conservative source feature dimensions used to prove grid adequacy. */
export function sourceFeatureSize(node: SDFNode): Feature3 {
  switch (node.kind) {
    case 'box': return [...node.size];
    case 'sphere': return [node.radius * 2, node.radius * 2, node.radius * 2];
    case 'cylinder': return [node.radius * 2, node.height, node.radius * 2];
    case 'torus': return [node.minor * 2, node.minor * 2, node.minor * 2];
    case 'cone': return [node.radius * 2, node.height, node.radius * 2];
    case 'capsule': return [node.radius * 2, node.height + node.radius * 2, node.radius * 2];
    case 'ellipsoid': return [...node.size];
    case 'text': return [Math.max(node.glyphWidth ?? node.size, 0.1), node.size, node.depth];
    case 'mesh': return [0, 1, 2].map((axis) => (node.field.bbox.max[axis] - node.field.bbox.min[axis]) / Math.max(1, node.field.res - 1)) as Feature3;
    case 'union': case 'intersect': return min3(sourceFeatureSize(node.a), sourceFeatureSize(node.b));
    case 'subtract': {
      const feature = min3(sourceFeatureSize(node.a), sourceFeatureSize(node.b));
      const a = computeBounds(node.a), b = computeBounds(node.b);
      for (let axis = 0; axis < 3; axis++) {
        // When the cutter sits inside the stock, these are the remaining wall
        // widths on either side. A sub-voxel wall is just as easy to erase as
        // the cutter itself, even when both operands are individually large.
        const margins = [a.max[axis] - b.max[axis], b.min[axis] - a.min[axis]].filter((value) => value > 0);
        if (margins.length) feature[axis] = Math.min(feature[axis], ...margins);
      }
      return feature;
    }
    case 'shell': return min3(sourceFeatureSize(node.child), [node.thickness, node.thickness, node.thickness]);
    case 'offset': return node.distance === 0 ? sourceFeatureSize(node.child) : min3(sourceFeatureSize(node.child), [Math.abs(node.distance), Math.abs(node.distance), Math.abs(node.distance)]);
    case 'round': return node.radius === 0 ? sourceFeatureSize(node.child) : min3(sourceFeatureSize(node.child), [node.radius, node.radius, node.radius]);
    case 'transform': {
      const child = sourceFeatureSize(node.child);
      const smallest = Math.min(child[0] * Math.abs(node.sx), child[1] * Math.abs(node.sy), child[2] * Math.abs(node.sz));
      return node.rx || node.ry || node.rz ? [smallest, smallest, smallest] : [child[0] * Math.abs(node.sx), child[1] * Math.abs(node.sy), child[2] * Math.abs(node.sz)];
    }
    case 'mirror': case 'linearPattern': case 'circularPattern': return sourceFeatureSize(node.child);
    case 'halfSpace': case '_far': return [Infinity, Infinity, Infinity];
  }
}

export interface SamplingPlan { resolution: number; voxel: Feature3; tolerance: number }

/** Require at least two grid intervals across every known source feature. */
export function planComponentSampling(root: SDFNode, bbox: BBox, requested: number, maximum: number): SamplingPlan {
  const extent = [0, 1, 2].map((axis) => bbox.max[axis] - bbox.min[axis]) as Feature3;
  const feature = sourceFeatureSize(root);
  const required = Math.max(requested, ...extent.map((value, axis) => Number.isFinite(feature[axis]) ? Math.ceil(value * 2 / feature[axis]) : requested));
  if (!Number.isFinite(required) || required > maximum) {
    const limitingAxis = [0, 1, 2].reduce((best, axis) => extent[axis] / feature[axis] > extent[best] / feature[best] ? axis : best, 0);
    throw new Error(`Export cannot resolve a ${feature[limitingAxis].toPrecision(4)} mm source feature on ${'XYZ'[limitingAxis]} within the ${maximum}³ grid limit; simplify the surrounding span or enlarge the feature`);
  }
  const resolution = Math.max(2, Math.ceil(required));
  const voxel = extent.map((value) => value / resolution) as Feature3;
  // One maximum-axis voxel is the conservative geometric claim: vertices are
  // projected to the zero set, but planar triangles can still chord a curved
  // surface between those vertices.
  return { resolution, voxel, tolerance: Math.max(...voxel) };
}

function flattenSharpUnions(node: SDFNode, out: SDFNode[]): void {
  if (node.kind === 'union' && node.k === 0) {
    flattenSharpUnions(node.a, out);
    flattenSharpUnions(node.b, out);
  } else {
    out.push(node);
  }
}

function overlaps(a: BBox, b: BBox): boolean {
  return a.min[0] <= b.max[0] && b.min[0] <= a.max[0] &&
    a.min[1] <= b.max[1] && b.min[1] <= a.max[1] &&
    a.min[2] <= b.max[2] && b.min[2] <= a.max[2];
}

/**
 * Split a sharp-union forest into independent AABB-connected components.
 * Meshing each component in its own grid preserves small, distant islands
 * without allocating a cubic grid over the empty distance between them.
 */
export function partitionExportComponents(root: SDFNode): SDFNode[] {
  const atoms: SDFNode[] = [];
  flattenSharpUnions(root, atoms);
  if (atoms.length < 2) return [root];
  const bounds = atoms.map(computeBounds);
  const parent = atoms.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) if (overlaps(bounds[i], bounds[j])) join(i, j);

  const groups = new Map<number, SDFNode[]>();
  for (let i = 0; i < atoms.length; i++) {
    const rootIndex = find(i);
    const group = groups.get(rootIndex) ?? [];
    group.push(atoms[i]);
    groups.set(rootIndex, group);
  }
  return [...groups.values()].map((group) => group.slice(1).reduce<SDFNode>(
    (combined, node) => ({ kind: 'union', a: combined, b: node, k: 0 }), group[0],
  ));
}

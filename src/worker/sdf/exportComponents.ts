import { computeBounds } from './bounds';
import type { BBox, SDFNode } from './types';

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

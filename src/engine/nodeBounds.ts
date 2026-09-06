import type { SDFNodeUI } from '../types/operations';
import { NODE_LABELS } from '../types/operations';
import type { SDFNode, BBox } from '../worker/sdf/types';
import { toSDFNode } from '../worker/sdf/convert';
import { computeBounds } from '../worker/sdf/bounds';

/**
 * Where a single node lives in world space, and how it is reached.
 *
 * This lived inside `DimensionLabels`, which was the only thing that needed it
 * when the only 3D feedback for a selection was the dimension box. Now the
 * selection highlight, the hover highlight and the breadcrumb all need the same
 * two answers — "what box does this node occupy?" and "what is the chain of
 * nodes above it?" — so they ask one implementation rather than three.
 */

export function findNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Ancestors of `id`, root first, excluding the node itself. Null if absent. */
export function findAncestorPath(tree: SDFNodeUI, id: string): SDFNodeUI[] | null {
  if (tree.id === id) return [];
  for (const child of tree.children) {
    const path = findAncestorPath(child, id);
    if (path !== null) return [tree, ...path];
  }
  return null;
}

/**
 * The chain from the root down to `id` inclusive, as display crumbs.
 *
 * Empty when the node is not in the tree, which is a state the UI does hit:
 * undo can restore a tree the selection predates, and the store only clears a
 * dangling selection on the paths that go through `surviving()`.
 */
export function nodePath(
  tree: SDFNodeUI | null,
  id: string | null,
): { id: string; label: string; kind: string }[] {
  if (!tree || !id) return [];
  const ancestors = findAncestorPath(tree, id);
  if (ancestors === null) return [];
  const node = findNode(tree, id);
  if (!node) return [];
  return [...ancestors, node].map((n) => ({
    id: n.id,
    label: NODE_LABELS[n.kind] || n.kind,
    kind: n.kind,
  }));
}

/**
 * Compile `id`'s subtree, re-wrapped in the transforms of every ancestor, so
 * the bounds come out in world space rather than in the node's own frame.
 *
 * Only transform ancestors are replayed. A boolean or modifier above the node
 * can only ever *remove* material from it, so including them would report a
 * smaller box than the node occupies — and this box is drawn to say "here is
 * the thing you selected", which is a question about where it is, not about
 * what survives of it.
 */
function buildNodeWithAncestors(tree: SDFNodeUI, id: string): SDFNode | null {
  const node = findNode(tree, id);
  if (!node) return null;
  const sdfNode = toSDFNode(node);
  if (!sdfNode) return null;

  const ancestors = findAncestorPath(tree, id);
  if (!ancestors) return sdfNode;

  let result = sdfNode;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.kind === 'translate' || a.kind === 'rotate' || a.kind === 'scale') {
      const p = a.params;
      result = {
        kind: 'transform',
        child: result,
        tx: a.kind === 'translate' ? p.x : 0,
        ty: a.kind === 'translate' ? p.y : 0,
        tz: a.kind === 'translate' ? p.z : 0,
        rx: a.kind === 'rotate' ? p.x : 0,
        ry: a.kind === 'rotate' ? p.y : 0,
        rz: a.kind === 'rotate' ? p.z : 0,
        sx: a.kind === 'scale' ? p.x : 1,
        sy: a.kind === 'scale' ? p.y : 1,
        sz: a.kind === 'scale' ? p.z : 1,
      };
    }
  }

  return result;
}

/**
 * Memo for the current tree only, dropped whole the moment the tree changes.
 *
 * There are four callers asking for a box on the same render — the selection,
 * the hover, the measured root, and the dimension labels — and at least two of
 * them ask for the *same* node. Without this, each one independently compiles
 * the subtree and walks it for bounds, and they all run again on every frame of
 * a gizmo drag, which produces a new tree per pointer move.
 *
 * Keyed on tree identity, which is sound because every mutation goes through
 * the store's `commit()` and therefore produces a new object.
 */
let boundsCacheTree: SDFNodeUI | null = null;
let boundsCache = new Map<string, BBox | null>();

/**
 * World-space bounding box of one node, or null if it has no geometry.
 *
 * The returned box is shared between callers — treat it as read-only.
 */
export function nodeWorldBounds(tree: SDFNodeUI | null, id: string | null): BBox | null {
  if (!tree || !id) return null;

  if (boundsCacheTree !== tree) {
    boundsCacheTree = tree;
    boundsCache = new Map();
  }
  const cached = boundsCache.get(id);
  if (cached !== undefined) return cached;

  const bounds = computeNodeWorldBounds(tree, id);
  boundsCache.set(id, bounds);
  return bounds;
}

function computeNodeWorldBounds(tree: SDFNodeUI, id: string): BBox | null {
  const sdfNode = buildNodeWithAncestors(tree, id);
  if (!sdfNode) return null;
  const bounds = computeBounds(sdfNode);
  // A node whose field is empty in some axis (a degenerate primitive, a
  // subtract that removed everything) yields a non-finite or inverted box, and
  // feeding that to BoxGeometry produces NaN vertices that quietly poison the
  // whole draw call.
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(bounds.min[i]) || !Number.isFinite(bounds.max[i])) return null;
    if (bounds.max[i] < bounds.min[i]) return null;
  }
  return bounds;
}

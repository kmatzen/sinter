import { solveSymmetric3Anchored } from './qef';
import type { Vec3 } from './types';

/**
 * Octree vertex clustering for dual contouring.
 *
 * Dual contouring emits one vertex per surface cell, which on a flat face means
 * a vertex per voxel: a 64-voxel-wide wall becomes thousands of triangles that
 * QEM then collapses back to two. Simplification was ~80% of an export at res
 * 256 and 93% of the triangles it removed carried *zero* error, which is the
 * mesher undoing its own over-generation.
 *
 * This decides, before any triangle exists, which cells should share a vertex:
 * an octree node collapses to one vertex when a single point still fits every
 * hermite sample underneath it within the error budget.
 *
 * The reason this is safe is worth stating, because the literature's approach
 * is not. Adaptive dual contouring (Ju et al. 2002) contours the octree
 * directly, which needs cellProc/faceProc/edgeProc recursion to stitch
 * differently-sized neighbours, and gets holes in the mesh when that is wrong.
 * Clustering avoids all of it: `dualContour` still emits exactly one quad per
 * sign-changing grid edge, referencing the same four cells as before, and only
 * the vertex those cells name changes. The result is a quotient of a mesh that
 * was already watertight, so there are no cracks to patch.
 *
 * What clustering *can* break is manifoldness — two surface sheets merged into
 * one vertex is the same pinch that per-patch vertices exist to avoid — so a
 * cell holding more than one patch never joins a cluster.
 */

/** Doubles per QEF: A (6, upper triangle), b (3), c, mass point (3), count. */
export const QEF_STRIDE = 14;

export interface ClusterResult {
  /** vertex index -> cluster index */
  remap: Int32Array;
  /** Number of clusters, i.e. vertices in the output mesh. */
  count: number;
  /** Summed QEF per cluster, `QEF_STRIDE` doubles each. */
  qef: Float64Array;
  /** Grid cell index of each cluster's octree node origin. */
  key: Int32Array;
  /** Octree level of each cluster; 0 means it merged nothing. */
  level: Int32Array;
  /** How many input vertices each cluster absorbed. */
  size: Int32Array;
}

/** Accumulate one hermite sample (surface point + unit normal) into a QEF. */
export function addSample(q: Float64Array, o: number, p: Vec3, n: Vec3) {
  const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
  q[o] += n[0] * n[0]; q[o + 1] += n[0] * n[1]; q[o + 2] += n[0] * n[2];
  q[o + 3] += n[1] * n[1]; q[o + 4] += n[1] * n[2]; q[o + 5] += n[2] * n[2];
  q[o + 6] += n[0] * d; q[o + 7] += n[1] * d; q[o + 8] += n[2] * d;
  q[o + 9] += d * d;
  q[o + 10] += p[0]; q[o + 11] += p[1]; q[o + 12] += p[2]; q[o + 13]++;
}

/** Position minimising this QEF, anchored at its mass point. */
export function solveCluster(q: Float64Array, o: number): Vec3 {
  const n = q[o + 13];
  const anchor: Vec3 = n > 0 ? [q[o + 10] / n, q[o + 11] / n, q[o + 12] / n] : [0, 0, 0];
  return solveSymmetric3Anchored(
    q[o], q[o + 1], q[o + 2], q[o + 3], q[o + 4], q[o + 5],
    q[o + 6], q[o + 7], q[o + 8], anchor,
  );
}

/**
 * Squared error of the best single vertex for this QEF: min_x xᵀAx - 2bᵀx + c.
 *
 * Clamped at zero because that expression is a difference of large similar
 * numbers on a well-fitted plane and goes slightly negative in floating point;
 * a negative "error" would compare as comfortably under budget, which is the
 * right answer for the wrong reason.
 */
export function clusterError(q: Float64Array, o: number): number {
  if (q[o + 13] === 0) return 0;
  const x = solveCluster(q, o);
  const a0 = q[o] * x[0] + q[o + 1] * x[1] + q[o + 2] * x[2];
  const a1 = q[o + 1] * x[0] + q[o + 3] * x[1] + q[o + 4] * x[2];
  const a2 = q[o + 2] * x[0] + q[o + 4] * x[1] + q[o + 5] * x[2];
  const e = (x[0] * a0 + x[1] * a1 + x[2] * a2)
    - 2 * (q[o + 6] * x[0] + q[o + 7] * x[1] + q[o + 8] * x[2])
    + q[o + 9];
  return e > 0 ? e : 0;
}

/**
 * Group vertices into octree nodes that a single vertex can represent.
 *
 * `vertCell` is the grid cell each vertex came from, `vertQ` its hermite QEF,
 * and `mergeable` zero for vertices that must stay on their own — cells with
 * more than one surface patch. `maxError` is a distance; a node collapses when
 * its combined samples fit one point within it.
 *
 * A node collapses only if *every* node beneath it did. Once a subtree fails,
 * every ancestor fails, so each vertex ends up in the largest node that fitted.
 */
export function clusterByOctree(
  vertCount: number,
  vertCell: Int32Array,
  vertQ: Float64Array,
  mergeable: Uint8Array,
  res: number,
  maxError: number,
): ClusterResult {
  const maxErrorSq = maxError * maxError;
  const r2 = res * res;

  // Deepest octree node that still fitted, per vertex.
  const bestKey = new Int32Array(vertCount);
  const bestLevel = new Int32Array(vertCount);

  // Level 0: one node per grid cell, keyed by cell index. Vertices that end up
  // ineligible keep a negative, per-vertex `bestKey` so they cannot be pooled
  // with anything, while their *node* stays in place to fail its ancestors.
  interface Node { qOff: number; ok: boolean; first: number }
  let nodeQ = new Float64Array(vertCount * QEF_STRIDE);
  let nodes = new Map<number, Node>();
  // Vertices belonging to each node, as a linked list over `nextVert`.
  let nextVert = new Int32Array(vertCount).fill(-1);
  let nodeHead: number[] = [];

  let nodeCount = 0;
  for (let v = 0; v < vertCount; v++) {
    const key = vertCell[v];
    let node = nodes.get(key);
    if (node === undefined) {
      node = { qOff: nodeCount * QEF_STRIDE, ok: true, first: nodeCount };
      nodes.set(key, node);
      nodeHead.push(-1);
      nodeCount++;
    }
    for (let i = 0; i < QEF_STRIDE; i++) nodeQ[node.qOff + i] += vertQ[v * QEF_STRIDE + i];
    nextVert[v] = nodeHead[node.first];
    nodeHead[node.first] = v;
    bestKey[v] = key;
    bestLevel[v] = 0;
  }

  // A cell is ineligible if it was flagged, or if it produced more than one
  // vertex — two vertices means two surface sheets.
  //
  // Such a cell stays keyed by its real position rather than being lifted out
  // of the octree, so it also fails every node above it. That is deliberate and
  // conservative: a merged vertex is clamped into its node's box, and if that
  // box contains a cell with two sheets in it, the vertex representing the
  // neighbours can be placed among geometry it does not describe. Blocking the
  // ancestors keeps clusters away from those regions entirely.
  for (const node of nodes.values()) {
    let n = 0;
    let flagged = false;
    for (let v = nodeHead[node.first]; v !== -1; v = nextVert[v]) {
      n++;
      if (!mergeable[v]) flagged = true;
    }
    if (n > 1 || flagged) {
      node.ok = false;
      // Each vertex becomes its own cluster; a shared cell key would merge the
      // very sheets this is separating.
      for (let v = nodeHead[node.first]; v !== -1; v = nextVert[v]) bestKey[v] = -(v + 1);
    }
  }

  let levels = 0;
  while (1 << levels < res) levels++;

  for (let level = 1; level <= levels; level++) {
    const size = 1 << level;
    const parents = new Map<number, Node>();
    const parentQ = new Float64Array(nodes.size * QEF_STRIDE);
    // Vertices of a parent chain through its children's lists.
    const childOf: number[][] = [];
    let pCount = 0;

    for (const [key, node] of nodes) {
      const z = (key / r2) | 0, y = ((key % r2) / res) | 0, x = key % res;
      const pk = (((z / size) | 0) * size) * r2 + (((y / size) | 0) * size) * res + ((x / size) | 0) * size;
      let par = parents.get(pk);
      if (par === undefined) {
        par = { qOff: pCount * QEF_STRIDE, ok: true, first: pCount };
        parents.set(pk, par);
        childOf.push([]);
        pCount++;
      }
      for (let i = 0; i < QEF_STRIDE; i++) parentQ[par.qOff + i] += nodeQ[node.qOff + i];
      childOf[par.first].push(node.first);
      if (!node.ok) par.ok = false;
    }

    // Promote every vertex under a parent that fitted.
    for (const [pk, par] of parents) {
      if (!par.ok || clusterError(parentQ, par.qOff) > maxErrorSq) { par.ok = false; continue; }
      for (const childFirst of childOf[par.first]) {
        for (let v = nodeHead[childFirst]; v !== -1; v = nextVert[v]) {
          bestKey[v] = pk;
          bestLevel[v] = level;
        }
      }
    }

    // Re-chain each parent's vertices so the next level can walk them.
    const merged = new Int32Array(vertCount).fill(-1);
    const newHead: number[] = new Array(pCount).fill(-1);
    for (const par of parents.values()) {
      for (const childFirst of childOf[par.first]) {
        for (let v = nodeHead[childFirst]; v !== -1; v = nextVert[v]) {
          merged[v] = newHead[par.first];
          newHead[par.first] = v;
        }
      }
    }
    nextVert = merged;
    nodeHead = newHead;
    nodes = parents;
    nodeQ = parentQ;
  }

  // Distinct (key, level) pairs become the output vertices.
  const remap = new Int32Array(vertCount).fill(-1);
  const ids = new Map<string, number>();
  const keyOut: number[] = [];
  const levelOut: number[] = [];
  const sizeOut: number[] = [];
  let count = 0;
  for (let v = 0; v < vertCount; v++) {
    const id = `${bestKey[v]}:${bestLevel[v]}`;
    let c = ids.get(id);
    if (c === undefined) {
      c = count++;
      ids.set(id, c);
      keyOut.push(bestKey[v]);
      levelOut.push(bestLevel[v]);
      sizeOut.push(0);
    }
    remap[v] = c;
    sizeOut[c]++;
  }

  const qef = new Float64Array(count * QEF_STRIDE);
  for (let v = 0; v < vertCount; v++) {
    const o = remap[v] * QEF_STRIDE;
    for (let i = 0; i < QEF_STRIDE; i++) qef[o + i] += vertQ[v * QEF_STRIDE + i];
  }

  return {
    remap, count, qef,
    key: Int32Array.from(keyOut),
    level: Int32Array.from(levelOut),
    size: Int32Array.from(sizeOut),
  };
}

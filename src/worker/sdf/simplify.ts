/**
 * QEM (Quadric Error Metrics) mesh simplification.
 *
 * Implements Garland & Heckbert edge-collapse simplification:
 * 1. Compute a 4x4 error quadric for each vertex from its adjacent face planes
 * 2. For each edge, compute the optimal collapse point and its error cost
 * 3. Greedily collapse the lowest-cost edge, updating neighbors
 * 4. Repeat until target triangle count is reached
 *
 * Sharp features are naturally preserved because their quadrics accumulate
 * large errors, making those edges expensive to collapse.
 */

import type { MeshResult } from './marchingCubes';
import { solveSymmetric3Anchored } from './qef';

/** Symmetric 4x4 matrix stored as 10 floats (upper triangle) */
type Quadric = [number, number, number, number, number, number, number, number, number, number];
// Layout: [a00, a01, a02, a03, a11, a12, a13, a22, a23, a33]
//          0     1     2     3     4     5     6     7     8     9

function emptyQ(): Quadric { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }

/** Build a quadric from a plane equation ax + by + cz + d = 0 */
function planeQ(a: number, b: number, c: number, d: number): Quadric {
  return [
    a*a, a*b, a*c, a*d,
    b*b, b*c, b*d,
    c*c, c*d,
    d*d,
  ];
}

/** Evaluate quadric error at point (x, y, z): v^T Q v */
function evalQ(q: Quadric, x: number, y: number, z: number): number {
  return q[0]*x*x + 2*q[1]*x*y + 2*q[2]*x*z + 2*q[3]*x
       + q[4]*y*y + 2*q[5]*y*z + 2*q[6]*y
       + q[7]*z*z + 2*q[8]*z
       + q[9];
}

/**
 * Find the point minimizing the quadric error, anchored at `anchor`.
 *
 * The 3x3 system is legitimately singular exactly at the features that
 * matter most: a flat region is rank 1 and a straight crease is rank 2,
 * where any point on the plane / crease line has identical cost.  A
 * determinant solve there is ill-conditioned and lets the vertex slide
 * arbitrarily far along the null direction — on a box this shuffled crease
 * vertices out of order along the edge line and the triangulation chamfered
 * across the corner.  The truncated eigen solve keeps null-direction
 * coordinates at the anchor (the edge midpoint), which also preserves the
 * ordering of vertices along a crease.
 */
function optimalQ(q: Quadric, anchor: [number, number, number]): [number, number, number] {
  const [x, y, z] = solveSymmetric3Anchored(
    q[0], q[1], q[2], q[4], q[5], q[7],
    -q[3], -q[6], -q[8],
    anchor,
  );
  return [x, y, z];
}

/** Binary min-heap keyed by cost */
class MinHeap {
  private data: { va: number; vb: number; cost: number; gen: number }[] = [];

  get size() { return this.data.length; }

  push(va: number, vb: number, cost: number, gen: number) {
    this.data.push({ va, vb, cost, gen });
    this.bubbleUp(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].cost >= this.data[parent].cost) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  private sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].cost < this.data[smallest].cost) smallest = l;
      if (r < n && this.data[r].cost < this.data[smallest].cost) smallest = r;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }
}

/**
 * Edge identity as a number, not a string.
 *
 * This is built for every edge on every heap seed, every staleness check and
 * every neighbour re-insert — millions of times on a real export — and each
 * one allocated a string and hashed it. Packing the ordered pair into a single
 * float64 is exact for meshes under 2^21 vertices, and lets the maps behind it
 * be keyed on numbers.
 *
 * 2^21 = 2,097,152, and the product with the low index stays under 2^53, so
 * the key is an exact integer. `MAX_PACKED_VERTS` is checked at entry rather
 * than assumed: silently colliding two edges would collapse the wrong one.
 */
const EDGE_SHIFT = 2097152;
export const MAX_PACKED_VERTS = EDGE_SHIFT;

function edgeKey(a: number, b: number): number {
  return a < b ? a * EDGE_SHIFT + b : b * EDGE_SHIFT + a;
}

export interface SimplifyOptions {
  /** Ratio of triangles to keep (0..1). Omit to let maxError alone decide. */
  targetRatio?: number;
  /**
   * Geometric error budget: an edge is only collapsed while its quadric
   * cost (summed squared plane distances) stays at or below maxError^2.
   * Flat regions have near-zero cost and decimate freely; curved and sharp
   * regions stop as soon as collapsing would move the surface past the
   * budget. This trades triangles for quality adaptively instead of
   * blindly hitting a count.
   */
  maxError?: number;
}

/**
 * Simplify a triangle mesh using QEM edge collapse.
 * @param mesh Input mesh
 * @param target Ratio of triangles to keep (0..1), or a SimplifyOptions
 * @returns Simplified mesh
 */
export function simplifyMesh(mesh: MeshResult, target: number | SimplifyOptions, onProgress?: (pct: number) => void): MeshResult {
  const opts: SimplifyOptions = typeof target === 'number' ? { targetRatio: target } : target;
  const maxErrorSq = opts.maxError !== undefined ? opts.maxError * opts.maxError : Infinity;

  const { positions, normals, indices } = mesh;
  const numVerts = positions.length / 3;
  if (numVerts >= MAX_PACKED_VERTS) {
    // Edge identity is a packed pair of vertex indices. Past this the packing
    // is no longer injective and two different edges would collapse as one, so
    // refuse rather than corrupt the mesh.
    throw new Error(`simplifyMesh: ${numVerts} vertices exceeds the ${MAX_PACKED_VERTS} edge-key limit`);
  }
  const numTris = indices.length / 3;
  const ratio = opts.targetRatio !== undefined ? Math.max(0.01, Math.min(1, opts.targetRatio)) : 0;
  const targetTris = Math.max(4, Math.floor(numTris * ratio));

  if (numTris <= targetTris) return mesh;

  // Working copies
  const vx = new Float64Array(numVerts);
  const vy = new Float64Array(numVerts);
  const vz = new Float64Array(numVerts);
  for (let i = 0; i < numVerts; i++) {
    vx[i] = positions[i * 3];
    vy[i] = positions[i * 3 + 1];
    vz[i] = positions[i * 3 + 2];
  }

  // Triangle connectivity: [v0, v1, v2] for each triangle
  const triV = new Int32Array(numTris * 3);
  for (let i = 0; i < numTris * 3; i++) triV[i] = indices[i];
  const triAlive = new Uint8Array(numTris).fill(1);
  let aliveTris = numTris;

  /**
   * Vertex -> incident triangles, as singly linked lists over one preallocated
   * node array.
   *
   * This was `numVerts` separate `Set<number>`s. Two things made that the
   * dominant cost of the whole mesher: ~300k Set allocations up front plus an
   * iterator object per traversal, and — worse — the lists were never
   * compacted. A collapse merges rb's triangles into ra and kills the ones that
   * went degenerate, but the dead entries stayed in the set, so every later
   * collapse walked past a growing pile of corpses. Cost per collapse rose as
   * the mesh shrank, which is the wrong way round.
   *
   * Each triangle owns exactly three nodes at fixed slots (t*3+k), so no
   * allocation happens after setup: merging re-homes rb's nodes onto ra, and
   * dead nodes are unlinked by the traversals that already have to visit them.
   *
   * Appending preserves the Set's insertion order, and a triangle can never be
   * appended to a list it is already in — that would mean two of its corners
   * resolve to the same vertex, which is exactly the degenerate case killed
   * just above. So this reproduces `add`'s dedup without needing a membership
   * test, and every downstream traversal sees the same order it saw before.
   */
  const nodeTri = new Int32Array(numTris * 3);
  const nodeNext = new Int32Array(numTris * 3).fill(-1);
  const vtHead = new Int32Array(numVerts).fill(-1);
  const vtTail = new Int32Array(numVerts).fill(-1);
  function vtAppend(v: number, node: number) {
    nodeNext[node] = -1;
    if (vtTail[v] === -1) vtHead[v] = node;
    else nodeNext[vtTail[v]] = node;
    vtTail[v] = node;
  }
  for (let t = 0; t < numTris; t++) {
    for (let k = 0; k < 3; k++) {
      const n = t * 3 + k;
      nodeTri[n] = t;
      vtAppend(triV[n], n);
    }
  }

  // Union-find for merged vertices
  const rep = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) rep[i] = i;
  function find(v: number): number {
    while (rep[v] !== v) { rep[v] = rep[rep[v]]; v = rep[v]; }
    return v;
  }

  /**
   * All quadrics in one buffer, ten doubles each, accumulated in place.
   *
   * These used to be `numVerts` separate 10-element JS arrays, with `addQ`
   * allocating a fresh one per call — three times per triangle while building
   * them, and again inside `computeEdgeCost`, which runs for every heap seed
   * and every neighbour re-insert. The additions happen in the same order as
   * before, so the arithmetic is unchanged.
   */
  const quadrics = new Float64Array(numVerts * 10);

  for (let t = 0; t < numTris; t++) {
    const i0 = triV[t * 3], i1 = triV[t * 3 + 1], i2 = triV[t * 3 + 2];
    const e1x = vx[i1] - vx[i0], e1y = vy[i1] - vy[i0], e1z = vz[i1] - vz[i0];
    const e2x = vx[i2] - vx[i0], e2y = vy[i2] - vy[i0], e2z = vz[i2] - vz[i0];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-20) continue;
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * vx[i0] + ny * vy[i0] + nz * vz[i0]);
    const fq = planeQ(nx, ny, nz, d);
    for (let k = 0; k < 10; k++) {
      const v = fq[k];
      quadrics[i0 * 10 + k] += v;
      quadrics[i1 * 10 + k] += v;
      quadrics[i2 * 10 + k] += v;
    }
  }

  /** Scratch for the summed quadric of an edge, reused across calls. */
  const edgeQ: Quadric = emptyQ();
  function sumQuadrics(ra: number, rb: number): Quadric {
    const oa = ra * 10, ob = rb * 10;
    for (let k = 0; k < 10; k++) edgeQ[k] = quadrics[oa + k] + quadrics[ob + k];
    return edgeQ;
  }

  // Compute cost and optimal position for collapsing edge (ra, rb)
  function computeEdgeCost(ra: number, rb: number): { cost: number; pos: [number, number, number] } {
    const q = sumQuadrics(ra, rb);
    const mid: [number, number, number] = [
      (vx[ra] + vx[rb]) * 0.5, (vy[ra] + vy[rb]) * 0.5, (vz[ra] + vz[rb]) * 0.5,
    ];
    const opt = optimalQ(q, mid);

    // Even the anchored solve can move a long way when the strong directions
    // genuinely demand it; a collapse target far outside the edge's own
    // neighborhood is never geometrically sensible, so fall back to the
    // endpoint/midpoint candidates in that case.
    const ex = vx[rb] - vx[ra], ey = vy[rb] - vy[ra], ez = vz[rb] - vz[ra];
    const edgeLenSq = ex * ex + ey * ey + ez * ez;
    const ox = opt[0] - mid[0], oy = opt[1] - mid[1], oz = opt[2] - mid[2];
    const optDistSq = ox * ox + oy * oy + oz * oz;

    let best: [number, number, number] = opt;
    let bestCost = optDistSq <= Math.max(edgeLenSq * 4, 1e-12)
      ? evalQ(q, opt[0], opt[1], opt[2])
      : Infinity;
    for (const cand of [
      mid,
      [vx[ra], vy[ra], vz[ra]] as [number, number, number],
      [vx[rb], vy[rb], vz[rb]] as [number, number, number],
    ]) {
      const c = evalQ(q, cand[0], cand[1], cand[2]);
      if (c < bestCost) { bestCost = c; best = cand; }
    }
    return { cost: bestCost, pos: best };
  }

  // Priority queue — entries carry the original vertex pair and a generation
  // counter so stale entries (from edges that have been updated) are skipped.
  const heap = new MinHeap();
  let gen = 0;
  // Per-edge generation: only the latest generation is valid
  const edgeGen = new Map<number, number>();

  // Seed the heap with all edges
  const seenEdges = new Set<number>();
  for (let t = 0; t < numTris; t++) {
    const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
    for (const [u, v] of [[a,b],[a,c],[b,c]] as [number,number][]) {
      const ek = edgeKey(u, v);
      if (seenEdges.has(ek)) continue;
      seenEdges.add(ek);
      const { cost } = computeEdgeCost(u, v);
      edgeGen.set(ek, gen);
      heap.push(u, v, cost, gen);
    }
  }

  /** Compute triangle normal (unnormalized) */
  function triNormal(v0: number, v1: number, v2: number): [number, number, number] {
    const e1x = vx[v1] - vx[v0], e1y = vy[v1] - vy[v0], e1z = vz[v1] - vz[v0];
    const e2x = vx[v2] - vx[v0], e2y = vy[v2] - vy[v0], e2z = vz[v2] - vz[v0];
    return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
  }

  /**
   * Check if collapsing edge (ra, rb) to position pos would flip any
   * adjacent triangle's normal or create degenerate slivers.
   * Returns true if the collapse is safe.
   */
  function isCollapseValid(ra: number, rb: number, pos: [number, number, number]): boolean {
    const MIN_QUALITY = 0.05; // minimum triangle quality (0 = degenerate, 1 = equilateral)

    // Check all triangles that reference ra or rb
    for (let pass = 0; pass < 2; pass++) {
      for (let node = vtHead[pass === 0 ? ra : rb]; node !== -1; node = nodeNext[node]) {
        const t = nodeTri[node];
        if (!triAlive[t]) continue;

        const i0 = find(triV[t * 3]), i1 = find(triV[t * 3 + 1]), i2 = find(triV[t * 3 + 2]);

        // Triangle will be degenerate after collapse (shared edge) — that's fine, it'll be removed
        const touches = (i0 === ra || i0 === rb ? 1 : 0) + (i1 === ra || i1 === rb ? 1 : 0) + (i2 === ra || i2 === rb ? 1 : 0);
        if (touches >= 2) continue;

        // Compute normal before collapse
        const nBefore = triNormal(i0, i1, i2);
        const lenBefore = Math.sqrt(nBefore[0] ** 2 + nBefore[1] ** 2 + nBefore[2] ** 2);
        if (lenBefore < 1e-20) continue; // already degenerate

        // Simulate the collapse: replace ra/rb with pos
        const sv0 = (i0 === ra || i0 === rb) ? pos : [vx[i0], vy[i0], vz[i0]] as [number, number, number];
        const sv1 = (i1 === ra || i1 === rb) ? pos : [vx[i1], vy[i1], vz[i1]] as [number, number, number];
        const sv2 = (i2 === ra || i2 === rb) ? pos : [vx[i2], vy[i2], vz[i2]] as [number, number, number];

        const ae1x = sv1[0] - sv0[0], ae1y = sv1[1] - sv0[1], ae1z = sv1[2] - sv0[2];
        const ae2x = sv2[0] - sv0[0], ae2y = sv2[1] - sv0[1], ae2z = sv2[2] - sv0[2];
        const nAfter: [number, number, number] = [
          ae1y * ae2z - ae1z * ae2y, ae1z * ae2x - ae1x * ae2z, ae1x * ae2y - ae1y * ae2x,
        ];
        const lenAfter = Math.sqrt(nAfter[0] ** 2 + nAfter[1] ** 2 + nAfter[2] ** 2);

        // Reject if the triangle would flip (normal reverses direction)
        const dot = nBefore[0] * nAfter[0] + nBefore[1] * nAfter[1] + nBefore[2] * nAfter[2];
        if (dot < 0) return false;

        // Reject if the triangle becomes a sliver (very thin)
        // Quality = 2 * area / (max_edge_length^2 * sqrt(3)) — simplified check:
        // Use area / perimeter^2 as a proxy
        if (lenAfter < 1e-20) return false; // degenerate
        const l0 = Math.sqrt(ae1x ** 2 + ae1y ** 2 + ae1z ** 2);
        const l1 = Math.sqrt(ae2x ** 2 + ae2y ** 2 + ae2z ** 2);
        const ae3x = sv2[0] - sv1[0], ae3y = sv2[1] - sv1[1], ae3z = sv2[2] - sv1[2];
        const l2 = Math.sqrt(ae3x ** 2 + ae3y ** 2 + ae3z ** 2);
        const maxEdge = Math.max(l0, l1, l2);
        if (maxEdge < 1e-20) return false;
        // Aspect ratio: area / maxEdge^2.  For equilateral triangle this is ~0.43
        const quality = (lenAfter * 0.5) / (maxEdge * maxEdge);
        if (quality < MIN_QUALITY) return false;
      }
    }
    return true;
  }

  // Scratch for the one-ring of the merged vertex. A stamp per vertex gives the
  // dedup a `Set` provided, without allocating one per collapse.
  const nbStamp = new Int32Array(numVerts).fill(-1);
  let nbList = new Int32Array(64);
  let stamp = 0;

  // Collapse loop
  const trisToRemove = numTris - targetTris;
  let lastSimplifyPct = -1;
  while (aliveTris > targetTris && heap.size > 0) {
    if (onProgress) {
      const pct = Math.round(((numTris - aliveTris) / trisToRemove) * 100);
      if (pct > lastSimplifyPct) { lastSimplifyPct = pct; onProgress(pct); }
    }
    const top = heap.pop()!;
    const ra = find(top.va), rb = find(top.vb);
    if (ra === rb) continue; // already merged

    // Skip stale entries
    const ek = edgeKey(ra, rb);
    const currentGen = edgeGen.get(ek);
    if (currentGen !== undefined && top.gen < currentGen) continue;

    const { cost, pos } = computeEdgeCost(ra, rb);

    // Over the error budget — leave this edge alone. (Not a break: cheaper
    // edges may still surface as collapses elsewhere lower neighbors' costs.)
    if (cost > maxErrorSq) continue;

    // Reject collapses that would flip triangles or create slivers
    if (!isCollapseValid(ra, rb, pos)) continue;

    // Perform collapse: merge rb into ra
    rep[rb] = ra;
    vx[ra] = pos[0]; vy[ra] = pos[1]; vz[ra] = pos[2];
    for (let k = 0; k < 10; k++) quadrics[ra * 10 + k] += quadrics[rb * 10 + k];

    // Merge triangle lists: walk rb's nodes and re-home the survivors onto ra.
    // Nodes for triangles that died are simply not carried over, so a collapse
    // never grows ra's list by more than the triangles it actually gained.
    {
      let node = vtHead[rb];
      vtHead[rb] = -1; vtTail[rb] = -1;
      while (node !== -1) {
        const next = nodeNext[node];
        const t = nodeTri[node];
        if (triAlive[t]) {
          for (let k = 0; k < 3; k++) {
            triV[t * 3 + k] = find(triV[t * 3 + k]);
          }
          const v0 = triV[t * 3], v1 = triV[t * 3 + 1], v2 = triV[t * 3 + 2];
          if (v0 === v1 || v1 === v2 || v0 === v2) {
            triAlive[t] = 0;
            aliveTris--;
          } else {
            vtAppend(ra, node);
          }
        }
        node = next;
      }
    }

    // Re-insert affected edges with new costs. This walk is also where ra's
    // list gets swept: a triangle killed by some earlier collapse is unlinked
    // here rather than being stepped over again by every future collapse.
    // Unlinking only removes entries the loop already skips, so the live
    // entries keep their relative order and so does `nbList` after them.
    stamp++;
    let nbCount = 0;
    let prev = -1;
    for (let node = vtHead[ra]; node !== -1; ) {
      const next = nodeNext[node];
      const t = nodeTri[node];
      if (!triAlive[t]) {
        if (prev === -1) vtHead[ra] = next; else nodeNext[prev] = next;
        if (vtTail[ra] === node) vtTail[ra] = prev;
      } else {
        for (let k = 0; k < 3; k++) {
          const vi = find(triV[t * 3 + k]);
          if (vi !== ra && nbStamp[vi] !== stamp) {
            nbStamp[vi] = stamp;
            if (nbCount === nbList.length) {
              const grown = new Int32Array(nbList.length * 2);
              grown.set(nbList);
              nbList = grown;
            }
            nbList[nbCount++] = vi;
          }
        }
        prev = node;
      }
      node = next;
    }
    gen++;
    for (let i = 0; i < nbCount; i++) {
      const nb = nbList[i];
      const nek = edgeKey(ra, nb);
      edgeGen.set(nek, gen);
      const { cost } = computeEdgeCost(ra, nb);
      heap.push(ra, nb, cost, gen);
    }
  }

  // Rebuild compact mesh
  const vertMap = new Map<number, number>();
  let newVertCount = 0;

  const outPos: number[] = [];
  const outNorm: number[] = [];
  const outIdx: number[] = [];

  function mapVert(v: number): number {
    const r = find(v);
    let mapped = vertMap.get(r);
    if (mapped !== undefined) return mapped;
    mapped = newVertCount++;
    vertMap.set(r, mapped);
    outPos.push(vx[r], vy[r], vz[r]);
    // Use original normal if available, otherwise zero
    if (r < numVerts) {
      outNorm.push(normals[r * 3], normals[r * 3 + 1], normals[r * 3 + 2]);
    } else {
      outNorm.push(0, 0, 0);
    }
    return mapped;
  }

  // Deduplicate: multiple collapses can make distinct triangles resolve
  // to the same three vertices, producing overlapping faces.
  const emittedFaces = new Set<string>();
  for (let t = 0; t < numTris; t++) {
    if (!triAlive[t]) continue;
    const v0 = find(triV[t * 3]), v1 = find(triV[t * 3 + 1]), v2 = find(triV[t * 3 + 2]);
    if (v0 === v1 || v1 === v2 || v0 === v2) continue;
    // Canonical face key: sorted vertex representatives
    const sorted = [v0, v1, v2].sort((a, b) => a - b);
    const faceKey = `${sorted[0]},${sorted[1]},${sorted[2]}`;
    if (emittedFaces.has(faceKey)) continue;
    emittedFaces.add(faceKey);
    outIdx.push(mapVert(v0), mapVert(v1), mapVert(v2));
  }

  // Recompute normals from face geometry for repositioned vertices
  const finalNormals = new Float32Array(outNorm.length).fill(0);
  for (let t = 0; t < outIdx.length; t += 3) {
    const i0 = outIdx[t], i1 = outIdx[t + 1], i2 = outIdx[t + 2];
    const e1x = outPos[i1 * 3] - outPos[i0 * 3];
    const e1y = outPos[i1 * 3 + 1] - outPos[i0 * 3 + 1];
    const e1z = outPos[i1 * 3 + 2] - outPos[i0 * 3 + 2];
    const e2x = outPos[i2 * 3] - outPos[i0 * 3];
    const e2y = outPos[i2 * 3 + 1] - outPos[i0 * 3 + 1];
    const e2z = outPos[i2 * 3 + 2] - outPos[i0 * 3 + 2];
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;
    // Weight by face area (unnormalized cross product)
    finalNormals[i0 * 3] += fnx; finalNormals[i0 * 3 + 1] += fny; finalNormals[i0 * 3 + 2] += fnz;
    finalNormals[i1 * 3] += fnx; finalNormals[i1 * 3 + 1] += fny; finalNormals[i1 * 3 + 2] += fnz;
    finalNormals[i2 * 3] += fnx; finalNormals[i2 * 3 + 1] += fny; finalNormals[i2 * 3 + 2] += fnz;
  }
  // Normalize
  for (let i = 0; i < finalNormals.length; i += 3) {
    const len = Math.sqrt(finalNormals[i] ** 2 + finalNormals[i + 1] ** 2 + finalNormals[i + 2] ** 2) || 1;
    finalNormals[i] /= len; finalNormals[i + 1] /= len; finalNormals[i + 2] /= len;
  }

  return {
    positions: new Float32Array(outPos),
    normals: finalNormals,
    indices: new Uint32Array(outIdx),
  };
}

/**
 * Split vertices along sharp edges so each face gets its own normal.
 *
 * For each edge shared by two triangles whose face normals diverge beyond
 * `creaseAngle`, the shared vertices on that edge are duplicated so the
 * two faces have independent normals.  Smooth regions keep shared vertices
 * with area-weighted averaged normals.
 *
 * @param mesh        Input mesh (positions may be shared across faces)
 * @param creaseAngle Angle threshold in radians (default ~40°). Edges with
 *                    adjacent face normals diverging more than this get split.
 */
export function splitCreaseEdges(mesh: MeshResult, creaseAngle = 0.7): MeshResult {
  const { positions, indices } = mesh;
  const numTris = indices.length / 3;
  const cosThresh = Math.cos(creaseAngle);

  // Compute face normals (unnormalized — area-weighted)
  const faceNx = new Float32Array(numTris);
  const faceNy = new Float32Array(numTris);
  const faceNz = new Float32Array(numTris);
  for (let t = 0; t < numTris; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const e1x = positions[i1 * 3] - positions[i0 * 3];
    const e1y = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
    const e1z = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const e2x = positions[i2 * 3] - positions[i0 * 3];
    const e2y = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
    const e2z = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    faceNx[t] = nx / len; faceNy[t] = ny / len; faceNz[t] = nz / len;
  }

  // Build edge → [tri0, tri1] adjacency map
  const edgeToTris = new Map<string, number[]>();
  for (let t = 0; t < numTris; t++) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t * 3 + k], b = indices[t * 3 + (k + 1) % 3];
      const ek = a < b ? `${a},${b}` : `${b},${a}`;
      const list = edgeToTris.get(ek);
      if (list) list.push(t);
      else edgeToTris.set(ek, [t]);
    }
  }

  // Find crease edges: edges where adjacent face normals diverge
  const creaseEdges = new Set<string>();
  for (const [ek, tris] of edgeToTris) {
    if (tris.length !== 2) { creaseEdges.add(ek); continue; } // boundary = crease
    const [t0, t1] = tris;
    const dot = faceNx[t0] * faceNx[t1] + faceNy[t0] * faceNy[t1] + faceNz[t0] * faceNz[t1];
    if (dot < cosThresh) creaseEdges.add(ek);
  }

  if (creaseEdges.size === 0) {
    // No creases — just return with area-weighted normals
    return { ...mesh, normals: computeSmoothedNormals(positions, indices, numTris, faceNx, faceNy, faceNz) };
  }

  // Group each vertex's adjacent faces into smooth groups separated by creases.
  // Each smooth group gets its own copy of the vertex with an averaged normal.
  const numVerts = positions.length / 3;

  // vertex → list of adjacent triangle indices
  const vertFaces: number[][] = new Array(numVerts);
  for (let i = 0; i < numVerts; i++) vertFaces[i] = [];
  for (let t = 0; t < numTris; t++) {
    vertFaces[indices[t * 3]].push(t);
    vertFaces[indices[t * 3 + 1]].push(t);
    vertFaces[indices[t * 3 + 2]].push(t);
  }

  // For each vertex, flood-fill its adjacent faces into smooth groups.
  // Two faces are in the same group if the edge between them is not a crease.
  const outPos: number[] = [];
  const outNorm: number[] = [];
  const newIndices = new Uint32Array(indices.length);
  let newVertCount = 0;

  // Per-triangle per-corner: new vertex index
  const triCornerVert = new Int32Array(numTris * 3).fill(-1);

  for (let v = 0; v < numVerts; v++) {
    const faces = vertFaces[v];
    if (faces.length === 0) continue;

    const visited = new Set<number>();
    for (const startFace of faces) {
      if (visited.has(startFace)) continue;

      // Flood fill from startFace through non-crease edges that share vertex v
      const group: number[] = [];
      const queue = [startFace];
      visited.add(startFace);
      while (queue.length > 0) {
        const f = queue.pop()!;
        group.push(f);
        // Find neighbors of f that share vertex v and a non-crease edge with f
        for (const g of faces) {
          if (visited.has(g)) continue;
          // Check if f and g share an edge through v
          const sharedEdge = findSharedEdge(indices, f, g, v);
          if (sharedEdge === null) continue;
          if (!creaseEdges.has(sharedEdge)) {
            visited.add(g);
            queue.push(g);
          }
        }
      }

      // Create a new vertex for this smooth group with averaged normal
      const vi = newVertCount++;
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);

      // Average face normals in this group (area-weighted since faceN is normalized,
      // but face area weighting was already baked into the unnormalized cross product)
      let nx = 0, ny = 0, nz = 0;
      for (const f of group) {
        nx += faceNx[f]; ny += faceNy[f]; nz += faceNz[f];
      }
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-10) {
        outNorm.push(nx / len, ny / len, nz / len);
      } else {
        outNorm.push(0, 1, 0); // degenerate — arbitrary up vector
      }

      // Record which corner of which triangle maps to this new vertex
      for (const f of group) {
        for (let k = 0; k < 3; k++) {
          if (indices[f * 3 + k] === v) {
            triCornerVert[f * 3 + k] = vi;
          }
        }
      }
    }
  }

  // Build new index buffer
  for (let t = 0; t < numTris; t++) {
    newIndices[t * 3] = triCornerVert[t * 3];
    newIndices[t * 3 + 1] = triCornerVert[t * 3 + 1];
    newIndices[t * 3 + 2] = triCornerVert[t * 3 + 2];
  }

  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNorm),
    indices: newIndices,
  };
}

/** Find the shared edge key between two triangles that passes through vertex v, or null */
function findSharedEdge(indices: Uint32Array, f: number, g: number, v: number): string | null {
  // Get the other two vertices of f that are connected to v via an edge
  const fVerts: number[] = [];
  for (let k = 0; k < 3; k++) {
    const u = indices[f * 3 + k];
    if (u !== v) fVerts.push(u);
  }
  // Check if any of those form an edge that also appears in g
  const gSet = new Set([indices[g * 3], indices[g * 3 + 1], indices[g * 3 + 2]]);
  for (const u of fVerts) {
    if (gSet.has(u)) {
      return v < u ? `${v},${u}` : `${u},${v}`;
    }
  }
  return null;
}

function computeSmoothedNormals(
  positions: Float32Array, indices: Uint32Array, numTris: number,
  faceNx: Float32Array, faceNy: Float32Array, faceNz: Float32Array,
): Float32Array {
  const normals = new Float32Array(positions.length).fill(0);
  for (let t = 0; t < numTris; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      normals[vi * 3] += faceNx[t];
      normals[vi * 3 + 1] += faceNy[t];
      normals[vi * 3 + 2] += faceNz[t];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}

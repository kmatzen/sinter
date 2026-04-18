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

/** Symmetric 4x4 matrix stored as 10 floats (upper triangle) */
type Quadric = [number, number, number, number, number, number, number, number, number, number];
// Layout: [a00, a01, a02, a03, a11, a12, a13, a22, a23, a33]
//          0     1     2     3     4     5     6     7     8     9

function emptyQ(): Quadric { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }

function addQ(a: Quadric, b: Quadric): Quadric {
  return [
    a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3], a[4]+b[4],
    a[5]+b[5], a[6]+b[6], a[7]+b[7], a[8]+b[8], a[9]+b[9],
  ];
}

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

/** Find the point minimizing the quadric error. Returns null if the 3x3 system is singular. */
function optimalQ(q: Quadric): [number, number, number] | null {
  // Solve the 3x3 linear system:
  // [a00 a01 a02] [x]   [-a03]
  // [a01 a11 a12] [y] = [-a13]
  // [a02 a12 a22] [z]   [-a23]
  const a = q[0], b = q[1], c = q[2], d = q[3];
  const e = q[4], f = q[5], g = q[6];
  const h = q[7], k = q[8];

  const det = a*(e*h - f*f) - b*(b*h - f*c) + c*(b*f - e*c);
  if (Math.abs(det) < 1e-12) return null;

  const inv = 1 / det;
  return [
    ((e*h - f*f)*(-d) + (c*f - b*h)*(-g) + (b*f - c*e)*(-k)) * inv,
    ((c*f - b*h)*(-d) + (a*h - c*c)*(-g) + (b*c - a*f)*(-k)) * inv,
    ((b*f - c*e)*(-d) + (b*c - a*f)*(-g) + (a*e - b*b)*(-k)) * inv,
  ];
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

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * Simplify a triangle mesh using QEM edge collapse.
 * @param mesh Input mesh
 * @param targetRatio Target ratio of triangles to keep (0..1), e.g. 0.5 = keep 50%
 * @returns Simplified mesh
 */
export function simplifyMesh(mesh: MeshResult, targetRatio: number): MeshResult {
  const { positions, normals, indices } = mesh;
  const numVerts = positions.length / 3;
  const numTris = indices.length / 3;
  const targetTris = Math.max(4, Math.floor(numTris * Math.max(0.01, Math.min(1, targetRatio))));

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

  // Vertex -> list of triangle indices
  const vertTris: Set<number>[] = new Array(numVerts);
  for (let i = 0; i < numVerts; i++) vertTris[i] = new Set();
  for (let t = 0; t < numTris; t++) {
    vertTris[triV[t * 3]].add(t);
    vertTris[triV[t * 3 + 1]].add(t);
    vertTris[triV[t * 3 + 2]].add(t);
  }

  // Union-find for merged vertices
  const rep = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) rep[i] = i;
  function find(v: number): number {
    while (rep[v] !== v) { rep[v] = rep[rep[v]]; v = rep[v]; }
    return v;
  }

  // Compute per-vertex quadrics from face planes
  const quadrics: Quadric[] = new Array(numVerts);
  for (let i = 0; i < numVerts; i++) quadrics[i] = emptyQ();

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
    quadrics[i0] = addQ(quadrics[i0], fq);
    quadrics[i1] = addQ(quadrics[i1], fq);
    quadrics[i2] = addQ(quadrics[i2], fq);
  }

  // Compute cost and optimal position for collapsing edge (ra, rb)
  function computeEdgeCost(ra: number, rb: number): { cost: number; pos: [number, number, number] } {
    const q = addQ(quadrics[ra], quadrics[rb]);
    const opt = optimalQ(q);
    if (opt) {
      return { cost: evalQ(q, opt[0], opt[1], opt[2]), pos: opt };
    }
    const mid: [number, number, number] = [
      (vx[ra] + vx[rb]) * 0.5, (vy[ra] + vy[rb]) * 0.5, (vz[ra] + vz[rb]) * 0.5,
    ];
    const ea = evalQ(q, vx[ra], vy[ra], vz[ra]);
    const eb = evalQ(q, vx[rb], vy[rb], vz[rb]);
    const em = evalQ(q, mid[0], mid[1], mid[2]);
    if (ea <= eb && ea <= em) return { cost: ea, pos: [vx[ra], vy[ra], vz[ra]] };
    if (eb <= ea && eb <= em) return { cost: eb, pos: [vx[rb], vy[rb], vz[rb]] };
    return { cost: em, pos: mid };
  }

  // Priority queue — entries carry the original vertex pair and a generation
  // counter so stale entries (from edges that have been updated) are skipped.
  const heap = new MinHeap();
  let gen = 0;
  // Per-edge generation: only the latest generation is valid
  const edgeGen = new Map<string, number>();

  // Seed the heap with all edges
  const seenEdges = new Set<string>();
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

  // Collapse loop
  while (aliveTris > targetTris && heap.size > 0) {
    const top = heap.pop()!;
    const ra = find(top.va), rb = find(top.vb);
    if (ra === rb) continue; // already merged

    // Skip stale entries
    const ek = edgeKey(ra, rb);
    const currentGen = edgeGen.get(ek);
    if (currentGen !== undefined && top.gen < currentGen) continue;

    const { pos } = computeEdgeCost(ra, rb);

    // Perform collapse: merge rb into ra
    rep[rb] = ra;
    vx[ra] = pos[0]; vy[ra] = pos[1]; vz[ra] = pos[2];
    quadrics[ra] = addQ(quadrics[ra], quadrics[rb]);

    // Merge triangle lists
    for (const t of vertTris[rb]) {
      if (!triAlive[t]) continue;
      for (let k = 0; k < 3; k++) {
        triV[t * 3 + k] = find(triV[t * 3 + k]);
      }
      const v0 = triV[t * 3], v1 = triV[t * 3 + 1], v2 = triV[t * 3 + 2];
      if (v0 === v1 || v1 === v2 || v0 === v2) {
        triAlive[t] = 0;
        aliveTris--;
        vertTris[v0]?.delete(t);
        vertTris[v1]?.delete(t);
        vertTris[v2]?.delete(t);
      } else {
        vertTris[ra].add(t);
      }
    }

    // Re-insert affected edges with new costs
    const neighbors = new Set<number>();
    for (const t of vertTris[ra]) {
      if (!triAlive[t]) continue;
      for (let k = 0; k < 3; k++) {
        const vi = find(triV[t * 3 + k]);
        if (vi !== ra) neighbors.add(vi);
      }
    }
    gen++;
    for (const nb of neighbors) {
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

  for (let t = 0; t < numTris; t++) {
    if (!triAlive[t]) continue;
    const v0 = find(triV[t * 3]), v1 = find(triV[t * 3 + 1]), v2 = find(triV[t * 3 + 2]);
    if (v0 === v1 || v1 === v2 || v0 === v2) continue;
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

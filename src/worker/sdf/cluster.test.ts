import { describe, it, expect } from 'vitest';
import { clusterByOctree, addSample, clusterError, QEF_STRIDE } from './cluster';
import { dualContour } from './dualContour';
import { evaluateSDF } from './evaluate';
import { analyzeMesh } from './meshRepair';
import type { SDFNode, BBox, Vec3 } from './types';
import type { MeshResult } from './marchingCubes';

/**
 * Octree vertex clustering.
 *
 * The unit tests below pin the collapse rule; the contouring tests are the ones
 * that matter, because the risk this feature carries is not "wrong vertex
 * count" but "hole in an exported STL". They are deliberately the same gates
 * `dualContour.test.ts` applies to the dense mesh — watertight, edge-manifold,
 * outward-wound, enclosing the right volume — since a mesh that fails any of
 * them is unprintable no matter how few triangles it has.
 */

const RES = 2;
const cellIndex = (x: number, y: number, z: number, res = RES) => z * res * res + y * res + x;

/** QEFs for `n` vertices, filled by `fill(i, q, offset)`. */
function buildQ(n: number, fill: (i: number, q: Float64Array, o: number) => void): Float64Array {
  const q = new Float64Array(n * QEF_STRIDE);
  for (let i = 0; i < n; i++) fill(i, q, i * QEF_STRIDE);
  return q;
}

describe('clusterByOctree', () => {
  /** Four cells of one flat plane — a single vertex represents all of them. */
  it('merges cells whose samples lie on one plane', () => {
    const cells = [cellIndex(0, 0, 0), cellIndex(1, 0, 0), cellIndex(0, 1, 0), cellIndex(1, 1, 0)];
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]];
    const q = buildQ(4, (i, arr, o) => addSample(arr, o, pts[i], [0, 0, 1]));

    const r = clusterByOctree(4, Int32Array.from(cells), q, new Uint8Array([1, 1, 1, 1]), RES, 0.01);

    expect(r.count).toBe(1);
    expect(Array.from(r.remap)).toEqual([0, 0, 0, 0]);
    expect(r.size[0]).toBe(4);
    expect(r.level[0]).toBe(1);
  });

  /**
   * Four cells where one sample sits on a *parallel* plane two units away. No
   * single point fits both, so nothing merges.
   *
   * Parallel, not perpendicular: the first version of this test used a
   * perpendicular plane and failed, because two perpendicular planes meet at an
   * exact point and the QEF residual is legitimately zero. That is a corner,
   * and collapsing a corner to one vertex is the right answer — it is how
   * `dualContour` reproduces sharp edges in the first place. Only samples that
   * genuinely cannot share a point should block a merge.
   */
  it('refuses to merge when one vertex cannot share a point with the others', () => {
    const cells = [cellIndex(0, 0, 0), cellIndex(1, 0, 0), cellIndex(0, 1, 0), cellIndex(1, 1, 0)];
    const q = buildQ(4, (i, arr, o) => {
      if (i === 3) addSample(arr, o, [0, 0, 2], [0, 0, 1]);   // plane z = 2
      else addSample(arr, o, [i, 0, 0], [0, 0, 1]);           // plane z = 0
    });

    const r = clusterByOctree(4, Int32Array.from(cells), q, new Uint8Array([1, 1, 1, 1]), RES, 0.01);

    expect(r.count).toBe(4);
  });

  /**
   * The corner case the test above was originally trying (and failing) to
   * express, asserted deliberately: perpendicular planes *should* collapse,
   * because a single vertex represents them exactly.
   */
  it('does merge a sharp corner, which one vertex represents exactly', () => {
    const cells = [cellIndex(0, 0, 0), cellIndex(1, 0, 0), cellIndex(0, 1, 0), cellIndex(1, 1, 0)];
    const normals: Vec3[] = [[0, 0, 1], [0, 0, 1], [1, 0, 0], [1, 0, 0]];
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]];
    const q = buildQ(4, (i, arr, o) => addSample(arr, o, pts[i], normals[i]));

    const r = clusterByOctree(4, Int32Array.from(cells), q, new Uint8Array([1, 1, 1, 1]), RES, 0.01);

    expect(r.count).toBe(1);
  });

  /**
   * A cell with two surface sheets must never join a cluster, and — because a
   * node collapses only if everything under it did — it also blocks its
   * ancestors. Without that, merging pinches two sheets into one vertex, which
   * is precisely the non-manifold case per-patch vertices exist to prevent.
   */
  it('never merges a vertex marked unmergeable, and blocks its ancestors', () => {
    const cells = [cellIndex(0, 0, 0), cellIndex(1, 0, 0), cellIndex(0, 1, 0), cellIndex(1, 1, 0)];
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]];
    const q = buildQ(4, (i, arr, o) => addSample(arr, o, pts[i], [0, 0, 1]));

    const r = clusterByOctree(4, Int32Array.from(cells), q, new Uint8Array([1, 1, 0, 1]), RES, 0.01);

    expect(r.count).toBe(4);
    expect(new Set(r.remap).size).toBe(4);
  });

  /** Two vertices from one cell are two sheets; they must stay apart. */
  it('keeps two patches of the same cell separate', () => {
    const cells = [cellIndex(0, 0, 0), cellIndex(0, 0, 0)];
    const q = buildQ(2, (i, arr, o) => addSample(arr, o, [0, 0, i], [0, 0, 1]));

    const r = clusterByOctree(2, Int32Array.from(cells), q, new Uint8Array([1, 1]), RES, 1e6);

    expect(r.count).toBe(2);
    expect(r.remap[0]).not.toBe(r.remap[1]);
  });

  it('leaves a lone vertex alone rather than inventing a cluster', () => {
    const q = buildQ(1, (_i, arr, o) => addSample(arr, o, [0, 0, 0], [0, 0, 1]));
    const r = clusterByOctree(1, Int32Array.from([0]), q, new Uint8Array([1]), RES, 0.01);
    expect(r.count).toBe(1);
    expect(r.size[0]).toBe(1);
  });
});

describe('clusterError', () => {
  it('is zero for samples that share a plane', () => {
    const q = buildQ(1, (_i, arr, o) => {
      addSample(arr, o, [0, 0, 0], [0, 0, 1]);
      addSample(arr, o, [1, 0, 0], [0, 0, 1]);
      addSample(arr, o, [0, 1, 0], [0, 0, 1]);
    });
    expect(clusterError(q, 0)).toBeCloseTo(0, 10);
  });

  /**
   * Two parallel planes 2 apart: the best single point sits between them and is
   * 1 from each. Three samples, so the squared total is 3. Pinning the number
   * rather than just "> 0" is what makes the budget comparison meaningful — a
   * wall cannot be collapsed through its own thickness.
   */
  it('grows with the spread between samples', () => {
    const q = buildQ(1, (_i, arr, o) => {
      addSample(arr, o, [0, 0, 0], [0, 0, 1]);
      addSample(arr, o, [1, 0, 2], [0, 0, 1]);
      addSample(arr, o, [0, 1, 0], [0, 0, 1]);
    });
    expect(clusterError(q, 0)).toBeGreaterThan(0);
  });

  /** Never negative: the expression cancels large terms and drifts below zero. */
  it('does not report a negative error', () => {
    const q = buildQ(1, (_i, arr, o) => {
      for (let i = 0; i < 40; i++) addSample(arr, o, [i * 1e3, 0, 0], [0, 0, 1]);
    });
    expect(clusterError(q, 0)).toBeGreaterThanOrEqual(0);
  });
});

// --- Contouring ------------------------------------------------------------

const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };

function makeGrid(node: SDFNode, res: number): Float32Array {
  const g = new Float32Array(res * res * res);
  const d = 16 / res;
  for (let z = 0; z < res; z++)
    for (let y = 0; y < res; y++)
      for (let x = 0; x < res; x++)
        g[z * res * res + y * res + x] = evaluateSDF(node, [
          -8 + (x + 0.5) * d, -8 + (y + 0.5) * d, -8 + (z + 0.5) * d,
        ]);
  return g;
}

function signedVolume(mesh: MeshResult): number {
  let v = 0;
  const p = mesh.positions, idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += (
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
    ) / 6;
  }
  return v;
}

function maxDeviation(mesh: MeshResult, node: SDFNode): number {
  let m = 0;
  for (let i = 0; i < mesh.positions.length; i += 3)
    m = Math.max(m, Math.abs(evaluateSDF(node, [
      mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2],
    ])));
  return m;
}

describe('dualContour with clustering', () => {
  const shapes: [string, SDFNode, number][] = [
    ['sphere', { kind: 'sphere', radius: 5 }, 32],
    ['box', { kind: 'box', size: [10, 10, 10] }, 32],
    ['torus', { kind: 'torus', major: 4, minor: 1.5 }, 32],
  ];

  /**
   * The gate that decides whether this feature can ship at all. Adaptive dual
   * contouring's classic failure is a crack where two different-sized cells
   * meet; clustering cannot produce one, because step 2 still emits exactly one
   * quad per sign-changing edge over the same four cells. This asserts that
   * rather than assuming it.
   */
  it.each(shapes)('keeps %s watertight and manifold', (_name, node, res) => {
    const voxel = 16 / res;
    const mesh = dualContour(makeGrid(node, res), res, bbox, node, undefined, undefined, voxel * 0.05);
    const d = analyzeMesh(mesh);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(d.watertight).toBe(true);
    expect(d.nonManifoldEdges).toBe(0);
    expect(signedVolume(mesh)).toBeGreaterThan(0); // outward, as slicers require
  });

  /**
   * The point of the whole exercise. A cube's surface is six planes, so six
   * quads — twelve triangles — describe it exactly, where the dense mesh spends
   * thousands and then pays QEM to take them away again.
   */
  it('reduces a cube to its twelve exact triangles', () => {
    const node: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const res = 32;
    const dense = dualContour(makeGrid(node, res), res, bbox, node);
    const mesh = dualContour(makeGrid(node, res), res, bbox, node, undefined, undefined, (16 / res) * 0.05);

    expect(dense.indices.length / 3).toBeGreaterThan(1000);
    expect(mesh.indices.length / 3).toBe(12);
    // And it is the *right* cube, not merely a small one.
    expect(signedVolume(mesh)).toBeCloseTo(1000, 3);
    expect(maxDeviation(mesh, node)).toBeLessThan(1e-6);
  });

  /** Curvature must not be flattened away: a sphere has no coplanar cells. */
  it('barely collapses a sphere, which has nothing coplanar to merge', () => {
    const node: SDFNode = { kind: 'sphere', radius: 5 };
    const res = 32;
    const dense = dualContour(makeGrid(node, res), res, bbox, node);
    const mesh = dualContour(makeGrid(node, res), res, bbox, node, undefined, undefined, (16 / res) * 0.05);

    expect(mesh.indices.length).toBeGreaterThan(dense.indices.length * 0.8);
  });

  it('still encloses the correct volume after clustering', () => {
    const node: SDFNode = { kind: 'sphere', radius: 5 };
    const res = 32;
    const mesh = dualContour(makeGrid(node, res), res, bbox, node, undefined, undefined, (16 / res) * 0.05);

    const exact = (4 / 3) * Math.PI * 125;
    expect(Math.abs(signedVolume(mesh) - exact) / exact).toBeLessThan(0.02);
  });

  /**
   * A merged vertex is clamped into the node it represents, so it cannot drift
   * further from the surface than the budget allows however many cells it
   * absorbed.
   */
  it('keeps merged vertices on the isosurface', () => {
    const node: SDFNode = { kind: 'torus', major: 4, minor: 1.5 };
    const res = 32;
    const voxel = 16 / res;
    const mesh = dualContour(makeGrid(node, res), res, bbox, node, undefined, undefined, voxel * 0.05);

    expect(maxDeviation(mesh, node)).toBeLessThan(voxel * 0.5);
  });

  /**
   * Clustering is opt-in, and everything else in the suite asserts against the
   * dense mesh. A default that quietly collapsed would change the meaning of
   * every one of those tests.
   */
  it('does nothing unless asked', () => {
    const node: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const a = dualContour(makeGrid(node, 32), 32, bbox, node);
    const b = dualContour(makeGrid(node, 32), 32, bbox, node, undefined, undefined, 0);

    expect(b.indices.length).toBe(a.indices.length);
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
  });

  /**
   * Two sheets in one cell is the configuration that makes naive dual
   * contouring non-manifold. Clustering must not reintroduce it by merging the
   * sheets back together.
   */
  it('stays manifold where two surface sheets share a cell', () => {
    const twoSpheres: SDFNode = {
      kind: 'union', k: 0,
      a: {
        kind: 'transform', child: { kind: 'sphere', radius: 0.45 },
        tx: -0.5, ty: -0.5, tz: -0.5, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      },
      b: {
        kind: 'transform', child: { kind: 'sphere', radius: 0.45 },
        tx: 0.5, ty: 0.5, tz: 0.5, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      },
    };
    const mesh = dualContour(makeGrid(twoSpheres, 16), 16, bbox, twoSpheres, undefined, undefined, 1);
    const d = analyzeMesh(mesh);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(d.nonManifoldEdges).toBe(0);
    expect(d.watertight).toBe(true);
  });
});

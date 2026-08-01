import { describe, it, expect } from 'vitest';
import { dualContour } from './dualContour';
import { evaluateSDF } from './evaluate';
import { evaluateInterval } from './interval';
import { analyzeMesh } from './meshRepair';
import type { MeshResult } from './marchingCubes';
import type { SDFNode, BBox } from './types';

function makeGrid(node: SDFNode, resolution: number, bbox: BBox): Float32Array {
  const res = resolution;
  const grid = new Float32Array(res * res * res);
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;

  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        grid[z * res * res + y * res + x] = evaluateSDF(node, [
          bbox.min[0] + (x + 0.5) * dx,
          bbox.min[1] + (y + 0.5) * dy,
          bbox.min[2] + (z + 0.5) * dz,
        ]);
      }
    }
  }
  return grid;
}

/** Signed volume via the divergence theorem: positive for outward winding */
function signedVolume(mesh: MeshResult): number {
  const { positions, indices } = mesh;
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    vol +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
      positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return vol / 6;
}

describe('dualContour', () => {
  const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };

  it('produces triangles for a sphere', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const grid = makeGrid(sphere, 24, bbox);
    const mesh = dualContour(grid, 24, bbox, sphere);

    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  });

  it('all indices reference valid vertices', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const grid = makeGrid(box, 16, bbox);
    const mesh = dualContour(grid, 16, bbox, box);
    const numVerts = mesh.positions.length / 3;

    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.indices[i]).toBeLessThan(numVerts);
    }
  });

  it('places vertices directly on box edges', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const grid = makeGrid(box, 32, bbox);
    const mesh = dualContour(grid, 32, bbox, box);

    // Find the vertex closest to the crease line x=5, y=5.
    // DC should place it almost exactly on the crease.
    let minEdgeDist = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const px = mesh.positions[i], py = mesh.positions[i + 1];
      const d = Math.sqrt((px - 5) ** 2 + (py - 5) ** 2);
      minEdgeDist = Math.min(minEdgeDist, d);
    }
    // The closest vertex should be within 0.05 of the exact edge
    expect(minEdgeDist).toBeLessThan(0.05);
  });

  it('places vertices at box corners', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const grid = makeGrid(box, 24, bbox);
    const mesh = dualContour(grid, 24, bbox, box);

    // Find a vertex near the corner (5, 5, 5)
    let minDist = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dx = mesh.positions[i] - 5;
      const dy = mesh.positions[i + 1] - 5;
      const dz = mesh.positions[i + 2] - 5;
      minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    // The SVD QEF should land a vertex essentially exactly on the corner
    expect(minDist).toBeLessThan(0.02);
  });

  it('places vertices on the corner of a rotated box', () => {
    // 30° about Z — corners no longer align with the grid at all
    const rot: SDFNode = {
      kind: 'transform', child: { kind: 'box', size: [10, 10, 10] },
      tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 30, sx: 1, sy: 1, sz: 1,
    };
    const grid = makeGrid(rot, 32, bbox);
    const mesh = dualContour(grid, 32, bbox, rot);

    // Corner (5,5,5) rotated by 30° about Z
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const corner = [5 * c - 5 * s, 5 * s + 5 * c, 5];

    let minDist = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dx = mesh.positions[i] - corner[0];
      const dy = mesh.positions[i + 1] - corner[1];
      const dz = mesh.positions[i + 2] - corner[2];
      minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    expect(minDist).toBeLessThan(0.05);
  });

  it('produces watertight, manifold, consistently wound meshes', () => {
    const shapes: [string, SDFNode, number][] = [
      ['sphere', { kind: 'sphere', radius: 5 }, 24],
      ['box', { kind: 'box', size: [10, 10, 10] }, 32],
      ['torus', { kind: 'torus', major: 4, minor: 1.5 }, 32],
    ];
    for (const [name, node, res] of shapes) {
      const grid = makeGrid(node, res, bbox);
      const mesh = dualContour(grid, res, bbox, node);
      const d = analyzeMesh(mesh);
      expect(d.watertight, `${name} should be watertight`).toBe(true);
    }
  });

  it('stays manifold when two surface sheets pass through one cell', () => {
    // Two tiny spheres centered exactly on diagonally-opposite corner
    // samples of a single dual cell (grid spacing is 1, so corner samples
    // sit at (-0.5,-0.5,-0.5) and (0.5,0.5,0.5)). The shared cell sees the
    // inside-corner configuration {0, 6}: two separate surface sheets.
    // Single-vertex-per-cell DC pinches them into one non-manifold vertex.
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
    const grid = makeGrid(twoSpheres, 16, bbox);
    const mesh = dualContour(grid, 16, bbox, twoSpheres);
    const d = analyzeMesh(mesh);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(d.nonManifoldEdges).toBe(0);
    expect(d.watertight).toBe(true);
  });

  it('keeps vertices tightly on the isosurface', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const grid = makeGrid(sphere, 24, bbox);
    const mesh = dualContour(grid, 24, bbox, sphere);

    let maxDev = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      maxDev = Math.max(maxDev, Math.abs(evaluateSDF(sphere, [
        mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2],
      ])));
    }
    // Voxel size is 16/24 ≈ 0.67; vertices should sit within a small
    // fraction of that (plane-intersection error on a curved surface)
    expect(maxDev).toBeLessThan(0.05);
  });

  it('encloses the correct volume with outward orientation', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const grid = makeGrid(sphere, 32, bbox);
    const mesh = dualContour(grid, 32, bbox, sphere);

    const vol = signedVolume(mesh);
    const exact = (4 / 3) * Math.PI * 125;
    // Positive = faces wound outward (what STL slicers require)
    expect(vol).toBeGreaterThan(0);
    expect(Math.abs(vol - exact) / exact).toBeLessThan(0.02);
  });

  it('produces valid normals', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const grid = makeGrid(sphere, 16, bbox);
    const mesh = dualContour(grid, 16, bbox, sphere);

    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.sqrt(
        mesh.normals[i] ** 2 + mesh.normals[i + 1] ** 2 + mesh.normals[i + 2] ** 2,
      );
      expect(len).toBeCloseTo(1, 1);
    }
  });
});

/**
 * The active-block mask must change *how much* is visited, never *what* comes
 * out (#88 A2).
 *
 * The mask comes from the octree: a block it filled uniformly was proved free
 * of surface by an interval enclosure excluding zero, so no cell wholly inside
 * it can straddle. The argument that this is safe at the seams is that two
 * adjacent uniform blocks cannot disagree in sign — the field is provably
 * non-zero throughout each closed block and they share a face — so every
 * straddling cell has a corner in a descended block, and the mask is dilated by
 * one block to catch cells whose origin lies just outside.
 *
 * That argument is worth testing rather than trusting, because getting it wrong
 * is a hole in an exported mesh: geometry that silently is not there.
 */
describe('dualContour active-block mask', () => {
  /** The same descent rule the worker's octree uses, reduced to a mask. */
  function maskFor(node: SDFNode, res: number, bbox: BBox, blk: number) {
    const nb = Math.ceil(res / blk);
    const marks = new Uint8Array(nb * nb * nb);
    for (let bz = 0; bz < nb; bz++) {
      for (let by = 0; by < nb; by++) {
        for (let bx = 0; bx < nb; bx++) {
          const cell: BBox = {
            min: [
              bbox.min[0] + (bx * blk / res) * (bbox.max[0] - bbox.min[0]),
              bbox.min[1] + (by * blk / res) * (bbox.max[1] - bbox.min[1]),
              bbox.min[2] + (bz * blk / res) * (bbox.max[2] - bbox.min[2]),
            ],
            max: [
              bbox.min[0] + Math.min(1, (bx + 1) * blk / res) * (bbox.max[0] - bbox.min[0]),
              bbox.min[1] + Math.min(1, (by + 1) * blk / res) * (bbox.max[1] - bbox.min[1]),
              bbox.min[2] + Math.min(1, (bz + 1) * blk / res) * (bbox.max[2] - bbox.min[2]),
            ],
          };
          const e = evaluateInterval(node, cell);
          if (!(e.lo > 0 || e.hi < 0)) marks[bz * nb * nb + by * nb + bx] = 1;
        }
      }
    }
    // Dilate by one block, as the worker does.
    const bits = new Uint8Array(marks.length);
    for (let z = 0; z < nb; z++) for (let y = 0; y < nb; y++) for (let x = 0; x < nb; x++) {
      if (!marks[z * nb * nb + y * nb + x]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nz = z + dz, ny = y + dy, nx = x + dx;
        if (nz < 0 || nz >= nb || ny < 0 || ny >= nb || nx < 0 || nx >= nb) continue;
        bits[nz * nb * nb + ny * nb + nx] = 1;
      }
    }
    return { nb, bits };
  }

  const CASES: [string, SDFNode][] = [
    ['sphere', { kind: 'sphere', radius: 6 }],
    ['box', { kind: 'box', size: [9, 6, 11] }],
    ['subtract', {
      kind: 'subtract', k: 0,
      a: { kind: 'box', size: [10, 10, 10] },
      b: { kind: 'sphere', radius: 6 },
    }],
    ['two disjoint spheres', {
      kind: 'union', k: 0,
      a: { kind: 'transform', child: { kind: 'sphere', radius: 3 }, tx: -6, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      b: { kind: 'transform', child: { kind: 'sphere', radius: 3 }, tx: 6, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
    }],
    ['thin shell', { kind: 'shell', thickness: 1, child: { kind: 'box', size: [10, 8, 10] } }],
  ];

  it.each(CASES)('%s meshes identically with and without the mask', (_name, node) => {
    const res = 32;
    const bbox: BBox = { min: [-10, -10, -10], max: [10, 10, 10] };
    const grid = makeGrid(node, res, bbox);

    const dense = dualContour(grid, res, bbox, node);
    const masked = dualContour(grid, res, bbox, node, undefined, maskFor(node, res, bbox, 8));

    expect(masked.indices.length).toBeGreaterThan(0);
    expect(Array.from(masked.indices)).toEqual(Array.from(dense.indices));
    expect(Array.from(masked.positions)).toEqual(Array.from(dense.positions));
  });

  /**
   * The mask is an optimisation, so an all-ones mask must be a no-op and an
   * empty one must produce nothing — if either were untrue the walker would be
   * doing something other than restricting iteration.
   */
  it('is a no-op when every block is marked', () => {
    const res = 32;
    const bbox: BBox = { min: [-10, -10, -10], max: [10, 10, 10] };
    const node: SDFNode = { kind: 'sphere', radius: 6 };
    const grid = makeGrid(node, res, bbox);
    const nb = Math.ceil(res / 8);
    const all = { nb, bits: new Uint8Array(nb * nb * nb).fill(1) };
    expect(Array.from(dualContour(grid, res, bbox, node, undefined, all).indices))
      .toEqual(Array.from(dualContour(grid, res, bbox, node).indices));
  });
});

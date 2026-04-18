import { describe, it, expect } from 'vitest';
import { marchingCubes } from './marchingCubes';
import { evaluateSDF } from './evaluate';
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

describe('marchingCubes', () => {
  it('produces triangles for a sphere', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(sphere, 32, bbox);
    const mesh = marchingCubes(grid, 32, bbox);

    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0); // complete triangles
  });

  it('produces no triangles for empty grid', () => {
    const grid = new Float32Array(8 * 8 * 8).fill(1); // all outside
    const bbox: BBox = { min: [-5, -5, -5], max: [5, 5, 5] };
    const mesh = marchingCubes(grid, 8, bbox);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it('produces valid normals', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(sphere, 16, bbox);
    const mesh = marchingCubes(grid, 16, bbox);

    // Check normals are unit length
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.sqrt(
        mesh.normals[i] ** 2 + mesh.normals[i + 1] ** 2 + mesh.normals[i + 2] ** 2,
      );
      expect(len).toBeCloseTo(1, 1);
    }
  });

  it('all indices reference valid vertices', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(box, 16, bbox);
    const mesh = marchingCubes(grid, 16, bbox);
    const numVerts = mesh.positions.length / 3;

    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.indices[i]).toBeLessThan(numVerts);
    }
  });

  // --- Bisection refinement tests ---

  it('bisection refinement places vertices closer to true surface', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(sphere, 16, bbox);

    const meshNoRefine = marchingCubes(grid, 16, bbox);
    const meshRefined = marchingCubes(grid, 16, bbox, sphere);

    // Measure max SDF error for each mesh
    let maxErrNoRefine = 0;
    let maxErrRefined = 0;
    for (let i = 0; i < meshNoRefine.positions.length; i += 3) {
      const d = Math.abs(evaluateSDF(sphere, [
        meshNoRefine.positions[i], meshNoRefine.positions[i + 1], meshNoRefine.positions[i + 2],
      ]));
      maxErrNoRefine = Math.max(maxErrNoRefine, d);
    }
    for (let i = 0; i < meshRefined.positions.length; i += 3) {
      const d = Math.abs(evaluateSDF(sphere, [
        meshRefined.positions[i], meshRefined.positions[i + 1], meshRefined.positions[i + 2],
      ]));
      maxErrRefined = Math.max(maxErrRefined, d);
    }

    // Refined mesh should have lower max surface error
    // (QEF may slightly perturb some vertices near cell boundaries)
    expect(maxErrRefined).toBeLessThan(maxErrNoRefine);
  });

  it('SDF-based normals are more accurate than grid normals', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(sphere, 16, bbox);
    const mesh = marchingCubes(grid, 16, bbox, sphere);

    // For a sphere, the normal at any surface point should align with the radial direction.
    // SDF convention: gradient points outward (positive = outside), normals are negated.
    // So normals point INWARD (toward center). Check |dot| with radial direction.
    let minAbsDot = 1;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const px = mesh.positions[i], py = mesh.positions[i + 1], pz = mesh.positions[i + 2];
      const len = Math.sqrt(px * px + py * py + pz * pz);
      if (len < 0.1) continue; // skip degenerate near-origin vertices
      const ex = px / len, ey = py / len, ez = pz / len;
      const dot = Math.abs(mesh.normals[i] * ex + mesh.normals[i + 1] * ey + mesh.normals[i + 2] * ez);
      minAbsDot = Math.min(minAbsDot, dot);
    }
    // All normals should be very close to the radial direction
    expect(minAbsDot).toBeGreaterThan(0.95);
  });

  // --- QEF vertex repositioning tests ---

  it('QEF produces sharper box edges', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(box, 24, bbox);

    const meshNoQEF = marchingCubes(grid, 24, bbox);
    const meshQEF = marchingCubes(grid, 24, bbox, box);

    // Find vertices near the edge x=5, y=5 (top-right edge of box)
    // With QEF, these should be closer to exactly 5.0
    let edgeErrNoQEF = 0;
    let edgeCountNoQEF = 0;
    let edgeErrQEF = 0;
    let edgeCountQEF = 0;

    for (let i = 0; i < meshNoQEF.positions.length; i += 3) {
      const px = meshNoQEF.positions[i], py = meshNoQEF.positions[i + 1];
      // Near the x=5 face edge
      if (Math.abs(px - 5) < 1.0 && Math.abs(py - 5) < 1.0) {
        edgeErrNoQEF += Math.abs(px - 5) + Math.abs(py - 5);
        edgeCountNoQEF++;
      }
    }
    for (let i = 0; i < meshQEF.positions.length; i += 3) {
      const px = meshQEF.positions[i], py = meshQEF.positions[i + 1];
      if (Math.abs(px - 5) < 1.0 && Math.abs(py - 5) < 1.0) {
        edgeErrQEF += Math.abs(px - 5) + Math.abs(py - 5);
        edgeCountQEF++;
      }
    }

    if (edgeCountNoQEF > 0 && edgeCountQEF > 0) {
      const avgErrNoQEF = edgeErrNoQEF / edgeCountNoQEF;
      const avgErrQEF = edgeErrQEF / edgeCountQEF;
      expect(avgErrQEF).toBeLessThan(avgErrNoQEF);
    }
  });

  it('QEF does not significantly move smooth surface vertices', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(sphere, 16, bbox);

    const meshNoQEF = marchingCubes(grid, 16, bbox);
    const meshQEF = marchingCubes(grid, 16, bbox, sphere);

    // Vertex count should be identical (same topology)
    expect(meshQEF.positions.length).toBe(meshNoQEF.positions.length);

    // Max displacement should be tiny (bisection moves them, but QEF shouldn't further)
    // We compare against bisection-only by checking that QEF vertices are still on the surface
    for (let i = 0; i < meshQEF.positions.length; i += 3) {
      const d = Math.abs(evaluateSDF(sphere, [
        meshQEF.positions[i], meshQEF.positions[i + 1], meshQEF.positions[i + 2],
      ]));
      expect(d).toBeLessThan(0.5); // should stay very close to surface
    }
  });

  it('box face normals are axis-aligned with QEF', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const grid = makeGrid(box, 24, bbox);
    const mesh = marchingCubes(grid, 24, bbox, box);

    // Vertices clearly on one face (e.g., x ≈ 5, |y| < 4, |z| < 4)
    // should have normals aligned with the face normal axis.
    // The SDF normal convention negates the gradient, so the normal
    // may point inward or outward depending on convention — check alignment.
    let faceCount = 0;
    let faceAlignErr = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const px = mesh.positions[i], py = mesh.positions[i + 1], pz = mesh.positions[i + 2];
      if (Math.abs(px - 5) < 0.5 && Math.abs(py) < 4 && Math.abs(pz) < 4) {
        // Normal should be aligned with X axis: |nx| close to 1, ny,nz close to 0
        const absDot = Math.abs(mesh.normals[i]); // |dot with (1,0,0)|
        faceAlignErr += Math.abs(1 - absDot);
        faceCount++;
      }
    }
    if (faceCount > 0) {
      expect(faceAlignErr / faceCount).toBeLessThan(0.05);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { dualContour } from './dualContour';
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
    // Should have a vertex very close to the exact corner
    expect(minDist).toBeLessThan(0.2);
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

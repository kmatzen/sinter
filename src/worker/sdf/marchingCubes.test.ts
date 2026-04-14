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
});

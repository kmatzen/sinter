import { describe, it, expect } from 'vitest';
import { analyzeMesh, removeDegenerateTriangles, projectVerticesToSurface } from './meshRepair';
import { dualContour } from './dualContour';
import { evaluateSDF } from './evaluate';
import type { MeshResult } from './marchingCubes';
import type { SDFNode, BBox } from './types';

function makeGrid(node: SDFNode, res: number, bbox: BBox): Float32Array {
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

/** A closed tetrahedron with consistent outward winding */
function tetrahedron(): MeshResult {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]),
    normals: new Float32Array(12),
    indices: new Uint32Array([
      0, 2, 1, // bottom (z=0), outward -z
      0, 1, 3,
      1, 2, 3,
      2, 0, 3,
    ]),
  };
}

describe('analyzeMesh', () => {
  it('reports a closed tetrahedron as watertight', () => {
    const d = analyzeMesh(tetrahedron());
    expect(d.triangleCount).toBe(4);
    expect(d.boundaryEdges).toBe(0);
    expect(d.nonManifoldEdges).toBe(0);
    expect(d.inconsistentEdges).toBe(0);
    expect(d.watertight).toBe(true);
  });

  it('detects holes when a face is removed', () => {
    const tet = tetrahedron();
    const open: MeshResult = { ...tet, indices: tet.indices.slice(0, 9) as Uint32Array };
    const d = analyzeMesh(open);
    expect(d.boundaryEdges).toBe(3);
    expect(d.watertight).toBe(false);
  });

  it('detects inconsistent winding', () => {
    const tet = tetrahedron();
    const flipped = new Uint32Array(tet.indices);
    // Reverse one face
    [flipped[0], flipped[1]] = [flipped[1], flipped[0]];
    const d = analyzeMesh({ ...tet, indices: flipped });
    expect(d.inconsistentEdges).toBeGreaterThan(0);
    expect(d.watertight).toBe(false);
  });

  it('detects degenerate triangles', () => {
    const tet = tetrahedron();
    const withDegen = new Uint32Array([...tet.indices, 1, 1, 2]);
    const d = analyzeMesh({ ...tet, indices: withDegen });
    expect(d.degenerateTriangles).toBe(1);
    expect(d.watertight).toBe(false);
  });
});

describe('removeDegenerateTriangles', () => {
  it('removes repeated-index faces and compacts vertices', () => {
    const tet = tetrahedron();
    const withDegen: MeshResult = {
      // One extra vertex referenced only by the degenerate face
      positions: new Float32Array([...tet.positions, 5, 5, 5]),
      normals: new Float32Array(15),
      indices: new Uint32Array([...tet.indices, 4, 4, 2]),
    };
    const cleaned = removeDegenerateTriangles(withDegen);
    expect(cleaned.indices.length).toBe(12);
    expect(cleaned.positions.length / 3).toBe(4); // orphan vertex dropped
    expect(analyzeMesh(cleaned).watertight).toBe(true);
  });

  it('returns the mesh unchanged when nothing is degenerate', () => {
    const tet = tetrahedron();
    expect(removeDegenerateTriangles(tet)).toBe(tet);
  });
});

describe('projectVerticesToSurface', () => {
  const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };

  it('pulls sphere vertices onto the exact isosurface', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const grid = makeGrid(sphere, 24, bbox);
    const mesh = dualContour(grid, 24, bbox, sphere);
    const voxel = 16 / 24;

    // Perturb vertices off the surface to simulate simplification drift
    const drifted = new Float32Array(mesh.positions);
    for (let i = 0; i < drifted.length; i++) {
      drifted[i] += (((i * 2654435761) % 100) / 100 - 0.5) * voxel * 0.3;
    }
    const perturbed: MeshResult = { ...mesh, positions: drifted };

    let maxBefore = 0;
    for (let i = 0; i < drifted.length; i += 3) {
      maxBefore = Math.max(maxBefore, Math.abs(evaluateSDF(sphere, [drifted[i], drifted[i + 1], drifted[i + 2]])));
    }

    const projected = projectVerticesToSurface(perturbed, sphere, voxel * 0.5);

    let maxAfter = 0;
    for (let i = 0; i < projected.positions.length; i += 3) {
      maxAfter = Math.max(maxAfter, Math.abs(evaluateSDF(sphere, [
        projected.positions[i], projected.positions[i + 1], projected.positions[i + 2],
      ])));
    }

    expect(maxBefore).toBeGreaterThan(voxel * 0.05);
    expect(maxAfter).toBeLessThan(voxel * 0.01);
  });

  it('never moves a vertex more than the displacement clamp', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const grid = makeGrid(sphere, 16, bbox);
    const mesh = dualContour(grid, 16, bbox, sphere);
    const clamp = 0.05;
    const projected = projectVerticesToSurface(mesh, sphere, clamp);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dx = projected.positions[i] - mesh.positions[i];
      const dy = projected.positions[i + 1] - mesh.positions[i + 1];
      const dz = projected.positions[i + 2] - mesh.positions[i + 2];
      expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeLessThanOrEqual(clamp * 1.0001);
    }
  });
});

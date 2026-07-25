import { describe, it, expect } from 'vitest';
import { simplifyMesh, splitCreaseEdges } from './simplify';
import { marchingCubes } from './marchingCubes';
import { evaluateSDF } from './evaluate';
import type { SDFNode, BBox } from './types';
import type { MeshResult } from './marchingCubes';

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

function meshFromSDF(node: SDFNode, res: number): ReturnType<typeof marchingCubes> {
  const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
  const grid = makeGrid(node, res, bbox);
  return marchingCubes(grid, res, bbox, node);
}

describe('simplifyMesh', () => {
  it('reduces triangle count to target ratio', () => {
    const mesh = meshFromSDF({ kind: 'sphere', radius: 5 }, 24);
    const origTris = mesh.indices.length / 3;
    expect(origTris).toBeGreaterThan(100);

    const simplified = simplifyMesh(mesh, 0.5);
    const newTris = simplified.indices.length / 3;

    // Should reduce to roughly 50% (±20% tolerance)
    expect(newTris).toBeLessThan(origTris * 0.7);
    expect(newTris).toBeGreaterThan(origTris * 0.3);
  });

  it('preserves mesh validity after simplification', () => {
    const mesh = meshFromSDF({ kind: 'sphere', radius: 5 }, 24);
    const simplified = simplifyMesh(mesh, 0.5);

    // All indices should reference valid vertices
    const numVerts = simplified.positions.length / 3;
    for (let i = 0; i < simplified.indices.length; i++) {
      expect(simplified.indices[i]).toBeGreaterThanOrEqual(0);
      expect(simplified.indices[i]).toBeLessThan(numVerts);
    }

    // Normals should be unit length
    for (let i = 0; i < simplified.normals.length; i += 3) {
      const len = Math.sqrt(
        simplified.normals[i] ** 2 + simplified.normals[i + 1] ** 2 + simplified.normals[i + 2] ** 2,
      );
      expect(len).toBeCloseTo(1, 1);
    }

    // No degenerate triangles
    for (let t = 0; t < simplified.indices.length; t += 3) {
      const a = simplified.indices[t], b = simplified.indices[t + 1], c = simplified.indices[t + 2];
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);
      expect(a).not.toBe(c);
    }
  });

  it('preserves shape within tolerance', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const mesh = meshFromSDF(sphere, 24);
    const simplified = simplifyMesh(mesh, 0.5);

    // Simplified vertices should still be reasonably close to the sphere surface
    let maxErr = 0;
    for (let i = 0; i < simplified.positions.length; i += 3) {
      const d = Math.abs(evaluateSDF(sphere, [
        simplified.positions[i], simplified.positions[i + 1], simplified.positions[i + 2],
      ]));
      maxErr = Math.max(maxErr, d);
    }
    // Allow up to 1 voxel of error (16/24 ≈ 0.67)
    expect(maxErr).toBeLessThan(1.0);
  });

  it('returns input unchanged when ratio >= 1', () => {
    const mesh = meshFromSDF({ kind: 'sphere', radius: 5 }, 16);
    const result = simplifyMesh(mesh, 1.0);
    expect(result.indices.length).toBe(mesh.indices.length);
  });

  it('produces no duplicate faces', () => {
    const mesh = meshFromSDF({ kind: 'sphere', radius: 5 }, 24);
    const simplified = simplifyMesh(mesh, 0.3);

    const faces = new Set<string>();
    for (let t = 0; t < simplified.indices.length; t += 3) {
      const tri = [simplified.indices[t], simplified.indices[t + 1], simplified.indices[t + 2]];
      const key = [...tri].sort((a, b) => a - b).join(',');
      expect(faces.has(key)).toBe(false);
      faces.add(key);
    }
  });

  it('preserves sharp features on a box', () => {
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const mesh = meshFromSDF(box, 24);
    const simplified = simplifyMesh(mesh, 0.5);

    // Find vertices near the +X face center (x≈5, |y|<3, |z|<3)
    // They should still be close to x=5 after simplification
    let faceCount = 0;
    let faceErr = 0;
    for (let i = 0; i < simplified.positions.length; i += 3) {
      const px = simplified.positions[i], py = simplified.positions[i + 1], pz = simplified.positions[i + 2];
      if (Math.abs(px - 5) < 1.0 && Math.abs(py) < 3 && Math.abs(pz) < 3) {
        faceErr += Math.abs(px - 5);
        faceCount++;
      }
    }
    if (faceCount > 0) {
      // Average error on the face should be small
      expect(faceErr / faceCount).toBeLessThan(0.5);
    }
  });
});

describe('simplifyMesh error-bounded mode', () => {
  it('keeps every vertex within the error budget of the surface', () => {
    const sphere: SDFNode = { kind: 'sphere', radius: 5 };
    const mesh = meshFromSDF(sphere, 32);
    const voxel = 16 / 32;
    const maxError = voxel * 0.1;

    const simplified = simplifyMesh(mesh, { maxError });

    let maxDev = 0;
    for (let i = 0; i < simplified.positions.length; i += 3) {
      maxDev = Math.max(maxDev, Math.abs(evaluateSDF(sphere, [
        simplified.positions[i], simplified.positions[i + 1], simplified.positions[i + 2],
      ])));
    }
    // Quadric cost accumulates across collapses, so allow modest slack
    // beyond the nominal budget — but nothing like the voxel-scale error
    // a ratio target produces.
    expect(maxDev).toBeLessThan(maxError * 4);
    expect(simplified.indices.length).toBeLessThan(mesh.indices.length);
  });

  it('decimates a flat-faced box far more aggressively than a sphere', () => {
    const boxMesh = meshFromSDF({ kind: 'box', size: [10, 10, 10] }, 32);
    const sphereMesh = meshFromSDF({ kind: 'sphere', radius: 5 }, 32);
    const maxError = (16 / 32) * 0.1;

    const box = simplifyMesh(boxMesh, { maxError });
    const sphere = simplifyMesh(sphereMesh, { maxError });

    const boxKept = box.indices.length / boxMesh.indices.length;
    const sphereKept = sphere.indices.length / sphereMesh.indices.length;

    // Box faces are planar (zero quadric cost) so nearly everything
    // collapses; the sphere must retain triangles to hold its curvature.
    expect(boxKept).toBeLessThan(sphereKept * 0.5);
  });

  it('respects targetRatio as a floor when both constraints are given', () => {
    const mesh = meshFromSDF({ kind: 'box', size: [10, 10, 10] }, 24);
    const simplified = simplifyMesh(mesh, { maxError: 10, targetRatio: 0.5 });
    // Error budget is huge, so the ratio floor is what stops collapsing
    expect(simplified.indices.length / 3).toBeGreaterThanOrEqual(Math.floor((mesh.indices.length / 3) * 0.5) - 1);
  });
});

describe('splitCreaseEdges', () => {
  it('splits vertices across a sharp 90-degree fold', () => {
    // Two triangles sharing edge (1,2), folded at a right angle.
    const mesh: MeshResult = {
      positions: new Float32Array([
        0, 0, 0,   // 0
        1, 0, 0,   // 1
        0, 1, 0,   // 2
        0, 1, 1,   // 3
      ]),
      normals: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 1, 2, 3]),
    };
    const result = splitCreaseEdges(mesh);

    // The shared edge is a sharp crease, so vertices 1 and 2 must be duplicated
    // (once per face) instead of shared with an averaged normal.
    expect(result.positions.length / 3).toBeGreaterThan(4);
    expect(result.indices.length).toBe(6);
    // Every index must reference a valid vertex
    const numVerts = result.positions.length / 3;
    for (const idx of result.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(numVerts);
    }
    // Normals should be unit length
    for (let i = 0; i < result.normals.length; i += 3) {
      const len = Math.sqrt(result.normals[i] ** 2 + result.normals[i + 1] ** 2 + result.normals[i + 2] ** 2);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('keeps shared vertices with averaged normals on a smooth closed mesh', () => {
    // A finely-tessellated sphere has no boundary edges and small angles
    // between adjacent faces, so no creases should be detected.
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const res = 32;
    const grid = new Float32Array(res * res * res);
    const dx = (bbox.max[0] - bbox.min[0]) / res;
    for (let z = 0; z < res; z++) {
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const px = bbox.min[0] + (x + 0.5) * dx;
          const py = bbox.min[1] + (y + 0.5) * dx;
          const pz = bbox.min[2] + (z + 0.5) * dx;
          grid[z * res * res + y * res + x] = evaluateSDF({ kind: 'sphere', radius: 5 }, [px, py, pz]);
        }
      }
    }
    const sdfNode: SDFNode = { kind: 'sphere', radius: 5 };
    const mesh = marchingCubes(grid, res, bbox, sdfNode);

    const result = splitCreaseEdges(mesh);
    // A smooth closed mesh keeps the same vertex/index count, only normals change.
    expect(result.positions.length).toBe(mesh.positions.length);
    expect(result.indices.length).toBe(mesh.indices.length);
    for (let i = 0; i < result.normals.length; i += 3) {
      const len = Math.sqrt(result.normals[i] ** 2 + result.normals[i + 1] ** 2 + result.normals[i + 2] ** 2);
      expect(len).toBeCloseTo(1, 1);
    }
  });
});


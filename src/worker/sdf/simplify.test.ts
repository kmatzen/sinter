import { describe, it, expect } from 'vitest';
import { simplifyMesh, splitCreaseEdges } from './simplify';
import { marchingCubes } from './marchingCubes';
import { dualContour } from './dualContour';
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

/** Exact point-to-triangle distance (Ericson, Real-Time Collision Detection) */
function pointTriangleDistance(
  p: [number, number, number], positions: Float32Array,
  ia: number, ib: number, ic: number,
): number {
  const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
  const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
  const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
  const sub = (u: number[], v: number[]) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const len = (u: number[]) => Math.hypot(u[0], u[1], u[2]);

  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return len(sub(p, [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return len(sub(p, [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return len(sub(p, [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return len(sub(p, [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ]));
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

  it('keeps the mesh covering sharp creases (no chamfered edges)', () => {
    // Regression: the quadric cost along a straight crease is zero in the
    // direction of the crease line, so an unregularized optimal-point solve
    // let collapse targets slide arbitrarily far along the edge.  Vertices
    // ended up out of order along the crease and triangles chamfered across
    // the corner — vertices all exactly on the surface, mesh watertight,
    // but the crisp edge visibly cut off.  Measure actual coverage: every
    // point of the true crease line must be close to the simplified mesh.
    const bbox: BBox = { min: [-8, -8, -8], max: [8, 8, 8] };
    const res = 48;
    const voxel = 16 / res;
    const box: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const grid = makeGrid(box, res, bbox);
    const mesh = dualContour(grid, res, bbox, box);
    const simplified = simplifyMesh(mesh, { maxError: voxel * 0.05 });

    // All 12 crease edges of the box
    const creases: [number[], number[]][] = [];
    for (const axis of [0, 1, 2]) {
      for (const s1 of [-5, 5]) {
        for (const s2 of [-5, 5]) {
          const p0 = [0, 0, 0], p1 = [0, 0, 0];
          p0[axis] = -5; p1[axis] = 5;
          p0[(axis + 1) % 3] = p1[(axis + 1) % 3] = s1;
          p0[(axis + 2) % 3] = p1[(axis + 2) % 3] = s2;
          creases.push([p0, p1]);
        }
      }
    }

    let worst = 0;
    for (const [p0, p1] of creases) {
      for (let s = 0; s <= 40; s++) {
        const t = s / 40;
        const p: [number, number, number] = [
          p0[0] + (p1[0] - p0[0]) * t,
          p0[1] + (p1[1] - p0[1]) * t,
          p0[2] + (p1[2] - p0[2]) * t,
        ];
        let best = Infinity;
        const { positions, indices } = simplified;
        for (let f = 0; f < indices.length; f += 3) {
          best = Math.min(best, pointTriangleDistance(p,
            positions, indices[f], indices[f + 1], indices[f + 2]));
        }
        worst = Math.max(worst, best);
      }
    }
    // Before the anchored solve this was ~1.6 (half a face chamfered off);
    // grid-accurate creases sit essentially at 0.
    expect(worst).toBeLessThan(voxel * 0.5);
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


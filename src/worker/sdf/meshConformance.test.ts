import { describe, expect, it } from 'vitest';
import { combineConformance, sampleActiveGridSurface, verifyMeshConformance } from './meshConformance';
import type { MeshResult } from './marchingCubes';

const octahedron = (dx = 0): MeshResult => ({
  positions: new Float32Array([1+dx,0,0, -1+dx,0,0, dx,1,0, dx,-1,0, dx,0,1, dx,0,-1]),
  normals: new Float32Array(18),
  indices: new Uint32Array([0,2,4, 2,1,4, 1,3,4, 3,0,4, 2,0,5, 1,2,5, 3,1,5, 0,3,5]),
});

describe('mesh conformance', () => {
  const sphere = { kind: 'sphere' as const, radius: 1 };
  const bbox = { min: [-1.2,-1.2,-1.2] as [number,number,number], max: [1.2,1.2,1.2] as [number,number,number] };

  it('deterministically reports bidirectional max and RMS deviation', () => {
    const a = verifyMeshConformance(octahedron(), sphere, bbox, 0.7, { sourceGrid: 12 });
    const b = verifyMeshConformance(octahedron(), sphere, bbox, 0.7, { sourceGrid: 12 });
    expect(a).toEqual(b);
    expect(a.status).toBe('verified');
    expect(a.meshSamples).toBeGreaterThan(0);
    expect(a.sourceSamples).toBeGreaterThan(0);
    expect(a.maxDeviation).toBeGreaterThanOrEqual(a.rmsDeviation);
  });

  it('fails a watertight mesh that is geometrically displaced', () => {
    const result = verifyMeshConformance(octahedron(3), sphere, bbox, 0.7, { sourceGrid: 12 });
    expect(result.status).toBe('failed');
    expect(result.meshToSourceMax).toBeGreaterThan(2);
    expect(result.sourceToMeshMax).toBeGreaterThan(1);
  });

  it('is explicitly inconclusive when no source surface is sampled', () => {
    const result = verifyMeshConformance(octahedron(), { kind: 'sphere', radius: 100 }, bbox, 1, { sourceGrid: 6 });
    expect(result.status).toBe('inconclusive');
  });

  it('reports physical distance for anisotropically scaled fields', () => {
    const mesh: MeshResult = {
      positions: new Float32Array([11, 0, 0, 11, 0.1, 0, 11, 0, 0.1]),
      normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
    };
    const stretchedSphere = {
      kind: 'transform' as const, child: sphere,
      tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 10, sy: 1, sz: 1,
    };
    const result = verifyMeshConformance(mesh, stretchedSphere, {
      min: [-12, -2, -2], max: [12, 2, 2],
    }, 0.2, { sourceGrid: 8, maxSourceSamples: 10 });
    expect(result.meshToSourceMax).toBeGreaterThan(0.9);
  });

  it('combines component statistics with sample-weighted RMS', () => {
    const first = verifyMeshConformance(octahedron(), sphere, bbox, 0.7, { sourceGrid: 8 });
    const second = verifyMeshConformance(octahedron(), sphere, bbox, 0.7, { sourceGrid: 10 });
    const result = combineConformance([first, second]);
    expect(result.status).toBe('verified');
    expect(result.meshSamples).toBe(first.meshSamples + second.meshSamples);
    expect(result.sourceSamples).toBe(first.sourceSamples + second.sourceSamples);
    expect(result.maxDeviation).toBe(Math.max(first.maxDeviation, second.maxDeviation));
  });

  it('samples small source features from the export grid deterministically', () => {
    const res = 32;
    const grid = new Float32Array(res ** 3);
    const feature = { kind: 'sphere' as const, radius: 0.35 };
    const featureBox = { min: [-8, -8, -8] as [number, number, number], max: [8, 8, 8] as [number, number, number] };
    for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const p: [number, number, number] = [
        featureBox.min[0] + (x + 0.5) * 16 / res,
        featureBox.min[1] + (y + 0.5) * 16 / res,
        featureBox.min[2] + (z + 0.5) * 16 / res,
      ];
      grid[(z * res + y) * res + x] = Math.hypot(p[0] - 0.25, p[1] - 0.25, p[2] - 0.25) - feature.radius;
    }
    const active = { nb: 4, bits: new Uint8Array(4 ** 3).fill(1) };
    const first = sampleActiveGridSurface(grid, res, featureBox, active, 32);
    const second = sampleActiveGridSurface(grid, res, featureBox, active, 32);
    expect(first).toEqual(second);
    expect(first.points.length).toBeGreaterThan(0);
    // A 20³ lattice over this box has 0.84 mm spacing and can miss this
    // deliberately off-plane 0.7 mm feature; the 32³ export grid cannot.
    expect(first.coverageComplete).toBe(true);
  });

  it('marks regional source coverage incomplete when block representatives exceed the budget', () => {
    const res = 16;
    const grid = new Float32Array(res ** 3);
    for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      grid[(z * res + y) * res + x] = x % 2 ? -1 : 1;
    }
    const result = sampleActiveGridSurface(grid, res, { min: [0, 0, 0], max: [16, 16, 16] }, {
      nb: 2, bits: new Uint8Array(8).fill(1),
    }, 2);
    expect(result.surfaceBlocks).toBeGreaterThan(2);
    expect(result.coverageComplete).toBe(false);
    expect(result.points).toHaveLength(2);
  });
});

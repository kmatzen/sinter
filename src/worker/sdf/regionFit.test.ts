import { describe, expect, it } from 'vitest';
import { fitRegionSurface, rankRegionSurfaceCandidates } from './regionFit';
import { segmentMeshSurfaces } from './meshSegmentation';

const tri = (...points: number[][]) => points.flat();

function cylinderSide(radius = 4, height = 7, segments = 32): Float32Array {
  const values: number[] = [];
  const point = (index: number, z: number) => [radius * Math.cos(index * 2 * Math.PI / segments), radius * Math.sin(index * 2 * Math.PI / segments), z];
  for (let layer = 0; layer < 3; layer++) for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments, z0 = -height / 2 + height * layer / 3, z1 = -height / 2 + height * (layer + 1) / 3;
    const a = point(index, z0), b = point(next, z0), c = point(next, z1), d = point(index, z1);
    values.push(...tri(a, b, c), ...tri(a, c, d));
  }
  return new Float32Array(values);
}

function sphere(radius = 5, subdivisions = 2): Float32Array {
  const normalize = (point: number[]) => { const length = Math.hypot(...point); return point.map((value) => value * radius / length); };
  const middle = (a: number[], b: number[]) => normalize(a.map((value, index) => value + b[index]));
  const vertices = [[radius,0,0],[-radius,0,0],[0,radius,0],[0,-radius,0],[0,0,radius],[0,0,-radius]];
  let faces = [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]].map((face) => face.map((index) => vertices[index]));
  for (let pass = 0; pass < subdivisions; pass++) {
    const next: number[][][] = [];
    for (const [a, b, c] of faces) { const ab = middle(a,b), bc = middle(b,c), ca = middle(c,a); next.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]); }
    faces = next;
  }
  return new Float32Array(faces.flat(2));
}

describe('regional analytic surface fitting', () => {
  it('classifies a planar face with exact source mapping', () => {
    const positions = new Float32Array([...tri([0,0,2],[4,0,2],[4,3,2]), ...tri([0,0,2],[4,3,2],[0,3,2])]);
    const region = segmentMeshSurfaces(positions).regions[0], fit = fitRegionSurface(positions, region)!;
    expect(fit.parameters.kind).toBe('plane');
    expect(fit.surfaceMax).toBeLessThan(1e-10);
    expect(fit.triangleIds).toEqual(region.triangleIds);
    expect(fit.bounds).toEqual(region.bounds);
  });

  it('fits a cylindrical wall independently of its open end boundaries', () => {
    const positions = cylinderSide(), region = segmentMeshSurfaces(positions).regions[0];
    const fit = fitRegionSurface(positions, region)!;
    expect(fit.parameters.kind).toBe('cylinder');
    if (fit.parameters.kind === 'cylinder') {
      expect(fit.parameters.radius).toBeCloseTo(4, 5);
      expect(Math.abs(fit.parameters.axis[2])).toBeCloseTo(1, 5);
      expect(fit.parameters.outward).toBe(true);
    }
    expect(fit.surfaceMax).toBeLessThan(1e-5);
  });

  it('fits a spherical region deterministically', () => {
    const positions = sphere(), regions = segmentMeshSurfaces(positions, { smoothAngleDegrees: 50 }).regions;
    expect(regions).toHaveLength(1);
    const first = fitRegionSurface(positions, regions[0])!, second = fitRegionSurface(positions, regions[0])!;
    expect(first.parameters.kind).toBe('sphere');
    expect(first.surfaceMax).toBeLessThan(1e-5);
    expect(first).toEqual(second);
  });

  it('rejects ineligible and deliberately inaccurate regions', () => {
    const positions = cylinderSide(), region = segmentMeshSurfaces(positions).regions[0];
    expect(fitRegionSurface(positions, { ...region, eligible: false })).toBeNull();
    expect(fitRegionSurface(positions, region, -1)).toBeNull();
  });

  it('uses normals to distinguish a two-ring cylinder from its interpolating sphere', () => {
    const full = cylinderSide(), oneBand = full.slice(0, 32 * 2 * 9);
    const region = segmentMeshSurfaces(oneBand).regions[0];
    expect(region.eligible).toBe(true);
    expect(region.triangleIds).toHaveLength(64);
    expect(rankRegionSurfaceCandidates(oneBand, region).map((candidate) => candidate.parameters.kind)).toEqual(['sphere', 'cylinder']);
    expect(fitRegionSurface(oneBand, region)?.parameters.kind).toBe('cylinder');
  });
});

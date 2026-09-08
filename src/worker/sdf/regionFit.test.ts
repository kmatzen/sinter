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

function saddle(steps = 6): Float32Array {
  const values: number[] = [], point = (x: number, y: number) => [x, y, 0.25 * x * y];
  for (let y = -steps / 2; y < steps / 2; y++) for (let x = -steps / 2; x < steps / 2; x++) {
    const a = point(x, y), b = point(x + 1, y), c = point(x + 1, y + 1), d = point(x, y + 1);
    values.push(...tri(a, b, c), ...tri(a, c, d));
  }
  return new Float32Array(values);
}

function reversedTriangles(source: Float32Array): Float32Array {
  const output = new Float32Array(source.length);
  const count = source.length / 9;
  for (let triangle = 0; triangle < count; triangle++) output.set(source.slice((count - triangle - 1) * 9, (count - triangle) * 9), triangle * 9);
  return output;
}

function capsule(radius = 3, segmentHalf = 5, segments = 32, hemisphereSteps = 8, includeBottom = true): Float32Array {
  const rings: number[][][] = [];
  for (let step = includeBottom ? 0 : hemisphereSteps; step <= hemisphereSteps; step++) {
    const angle = -Math.PI / 2 + step * Math.PI / (2 * hemisphereSteps);
    rings.push([...Array(segments)].map((_, index) => [radius * Math.cos(angle) * Math.cos(index * 2 * Math.PI / segments), -segmentHalf + radius * Math.sin(angle), radius * Math.cos(angle) * Math.sin(index * 2 * Math.PI / segments)]));
  }
  rings.push([...Array(segments)].map((_, index) => [radius * Math.cos(index * 2 * Math.PI / segments), segmentHalf, radius * Math.sin(index * 2 * Math.PI / segments)]));
  for (let step = 1; step <= hemisphereSteps; step++) {
    const angle = step * Math.PI / (2 * hemisphereSteps);
    rings.push([...Array(segments)].map((_, index) => [radius * Math.cos(angle) * Math.cos(index * 2 * Math.PI / segments), segmentHalf + radius * Math.sin(angle), radius * Math.cos(angle) * Math.sin(index * 2 * Math.PI / segments)]));
  }
  const values: number[] = [];
  for (let ring = 0; ring < rings.length - 1; ring++) for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments, lower = rings[ring], upper = rings[ring + 1];
    if (ring === 0 && includeBottom) values.push(...tri(lower[0], upper[index], upper[next]));
    else if (ring === rings.length - 2) values.push(...tri(lower[index], upper[0], lower[next]));
    else values.push(...tri(lower[index], upper[index], upper[next]), ...tri(lower[index], upper[next], lower[next]));
  }
  return new Float32Array(values);
}

function transformSoup(source: Float32Array, degrees: [number, number, number], translation: [number, number, number]): Float32Array {
  const output = new Float32Array(source);
  for (let index = 0; index < output.length; index += 3) {
    let x = output[index], y = output[index + 1], z = output[index + 2];
    for (const [axis, value] of degrees.map((angle, axis) => [axis, angle * Math.PI / 180] as const)) {
      const c = Math.cos(value), s = Math.sin(value);
      if (axis === 0) [y, z] = [y * c - z * s, y * s + z * c];
      else if (axis === 1) [x, z] = [x * c + z * s, -x * s + z * c];
      else [x, y] = [x * c - y * s, x * s + y * c];
    }
    output[index] = x + translation[0]; output[index + 1] = y + translation[1]; output[index + 2] = z + translation[2];
  }
  return output;
}

function trianglesWhere(source: Float32Array, predicate: (triangle: Float32Array) => boolean): Float32Array {
  const kept: number[] = [];
  for (let index = 0; index < source.length; index += 9) {
    const triangle = source.slice(index, index + 9);
    if (predicate(triangle)) kept.push(...triangle);
  }
  return new Float32Array(kept);
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

  it('is stable under equivalent triangle ordering', () => {
    const positions = cylinderSide(), reordered = reversedTriangles(positions);
    const firstRegion = segmentMeshSurfaces(positions).regions[0], secondRegion = segmentMeshSurfaces(reordered).regions[0];
    const first = fitRegionSurface(positions, firstRegion)!, second = fitRegionSurface(reordered, secondRegion)!;
    expect(first.parameters.kind).toBe('cylinder');
    expect(second.parameters.kind).toBe('cylinder');
    if (first.parameters.kind === 'cylinder' && second.parameters.kind === 'cylinder') {
      expect(second.parameters.radius).toBeCloseTo(first.parameters.radius, 10);
      expect(second.parameters.origin).toEqual(first.parameters.origin.map((value) => expect.closeTo(value, 10)));
      expect(second.parameters.axis).toEqual(first.parameters.axis.map((value) => expect.closeTo(value, 10)));
    }
    expect(second.surfaceMax).toBeCloseTo(first.surfaceMax, 10);
    expect(second.surfaceRms).toBeCloseTo(first.surfaceRms, 10);
  });

  it('leaves a smooth but non-analytic saddle region unclassified', () => {
    const positions = saddle(), regions = segmentMeshSurfaces(positions, { smoothAngleDegrees: 80 }).regions;
    expect(regions).toHaveLength(1);
    expect(regions[0].eligible).toBe(true);
    expect(fitRegionSurface(positions, regions[0])).toBeNull();
  });

  it('fits a complete smooth capsule as one deterministic region', () => {
    const positions = capsule(), regions = segmentMeshSurfaces(positions).regions;
    expect(regions).toHaveLength(1);
    const fit = fitRegionSurface(positions, regions[0])!;
    expect(fit.parameters.kind).toBe('capsule');
    if (fit.parameters.kind === 'capsule') {
      expect(fit.parameters.radius).toBeCloseTo(3, 4);
      expect(fit.parameters.axialMax - fit.parameters.axialMin).toBeCloseTo(16, 4);
      expect(Math.abs(fit.parameters.axis[1])).toBeCloseTo(1, 4);
      expect(fit.parameters.outward).toBe(true);
    }
    expect(fit.relativeError).toBeLessThan(1e-4);
    expect(fitRegionSurface(positions, regions[0])).toEqual(fit);
  });

  it('fits the same capsule after rotation, translation, and triangle reordering', () => {
    const positions = transformSoup(capsule(), [27, -19, 13], [4, -3, 2]);
    const reordered = reversedTriangles(positions);
    const first = fitRegionSurface(positions, segmentMeshSurfaces(positions).regions[0])!;
    const second = fitRegionSurface(reordered, segmentMeshSurfaces(reordered).regions[0])!;
    expect(first.parameters.kind).toBe('capsule');
    expect(second.parameters.kind).toBe('capsule');
    if (first.parameters.kind === 'capsule' && second.parameters.kind === 'capsule') {
      expect(first.parameters.radius).toBeCloseTo(3, 4);
      expect(first.parameters.axialMax - first.parameters.axialMin).toBeCloseTo(16, 4);
      expect(second.parameters.radius).toBeCloseTo(first.parameters.radius, 8);
      expect(second.parameters.axis).toEqual(first.parameters.axis.map((value) => expect.closeTo(value, 8)));
      expect(second.parameters.origin).toEqual(first.parameters.origin.map((value) => expect.closeTo(value, 8)));
    }
    expect(first.relativeError).toBeLessThan(1e-4);
    expect(second.surfaceMax).toBeCloseTo(first.surfaceMax, 8);
  });

  it('infers the hidden cap of a capsule boss from its band and exposed cap', () => {
    const positions = capsule(3, 5, 32, 8, false), region = segmentMeshSurfaces(positions).regions[0];
    const fit = fitRegionSurface(positions, region)!;
    expect(fit.parameters.kind).toBe('capsule');
    if (fit.parameters.kind === 'capsule') {
      expect(fit.parameters.radius).toBeCloseTo(3, 4);
      expect(fit.parameters.axialMax - fit.parameters.axialMin).toBeCloseTo(16, 4);
      expect(fit.parameters.origin).toEqual([expect.closeTo(0, 4), expect.closeTo(0, 4), expect.closeTo(0, 4)]);
    }
    expect(fit.relativeError).toBeLessThan(1e-4);
  });

  it('does not label cylinders, near-spheres, or longitudinally open patches as capsules', () => {
    const cylinderPositions = cylinderSide(), cylinderFit = fitRegionSurface(cylinderPositions, segmentMeshSurfaces(cylinderPositions).regions[0]);
    expect(cylinderFit?.parameters.kind).toBe('cylinder');

    const nearSphere = capsule(3, 0.1), nearSphereFit = fitRegionSurface(nearSphere, segmentMeshSurfaces(nearSphere).regions[0]);
    expect(nearSphereFit?.parameters.kind).not.toBe('capsule');

    const partial = trianglesWhere(capsule(), (triangle) => [0,3,6].every((offset) => triangle[offset] >= -1e-7));
    const partialRegions = segmentMeshSurfaces(partial).regions;
    expect(partialRegions.length).toBeGreaterThan(0);
    expect(partialRegions.map((region) => fitRegionSurface(partial, region)?.parameters.kind)).not.toContain('capsule');
  });

  it('rejects a smoothly distorted capsule cap instead of hiding its error', () => {
    const distorted = capsule();
    for (let index = 0; index < distorted.length; index += 3) if (distorted[index + 1] > 5) distorted[index] *= 1.3;
    const regions = segmentMeshSurfaces(distorted, { smoothAngleDegrees: 80 }).regions;
    expect(regions.map((region) => fitRegionSurface(distorted, region)?.parameters.kind)).not.toContain('capsule');
  });
});

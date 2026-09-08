import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeBounds } from './bounds';
import { generateSDFFunction } from './codegen';
import { toSDFNode } from './convert';
import { evaluateSDF } from './evaluate';
import { evaluateInterval } from './interval';
import { extrudeDistance, parseProfile, profileFeatureSize, ProfileValidationError } from './profile';
import type { SDFNode } from './types';

const plate = parseProfile(JSON.stringify({
  outer: [[-5, -4], [5, -4], [5, 4], [-5, 4]],
  holes: [[[-2, -2], [-2, 2], [2, 2], [2, -2]]],
}));

describe('polygon profile extrusion', () => {
  it('creates a bounded plate and preserves its hole', () => {
    const node: SDFNode = { kind: 'extrude', profile: plate, depth: 3 };
    expect(evaluateSDF(node, [4, 0, 0])).toBeLessThan(0);
    expect(evaluateSDF(node, [0, 0, 0])).toBeGreaterThan(0);
    expect(evaluateSDF(node, [4, 0, 2])).toBeGreaterThan(0);
    expect(computeBounds(node)).toEqual({ min: [-5, -4, -1.5], max: [5, 4, 1.5] });
    expect(profileFeatureSize(plate)).toBe(2);
  });

  it('uses the exact capped extrusion distance', () => {
    expect(extrudeDistance(plate, 2, [6, 0, 2])).toBeCloseTo(Math.SQRT2);
    expect(profileFeatureSize(parseProfile(JSON.stringify({ outer: [[0, 0], [10, 0], [5, 0.2]], holes: [] })))).toBeCloseTo(0.2);
  });

  it('supports asymmetric extents, taper, and thin walls', () => {
    const solid = parseProfile(JSON.stringify({ outer: [[-5, -4], [5, -4], [5, 4], [-5, 4]], holes: [] }));
    const oneSided: SDFNode = { kind: 'extrude', profile: solid, depth: 4, zMin: 0, zMax: 4 };
    expect(computeBounds(oneSided)).toEqual({ min: [-5, -4, 0], max: [5, 4, 4] });
    expect(evaluateSDF(oneSided, [0, 0, -0.1])).toBeGreaterThan(0);
    expect(evaluateSDF(oneSided, [0, 0, 2])).toBeLessThan(0);

    const tapered: SDFNode = { ...oneSided, taper: 45 };
    expect(evaluateSDF(tapered, [4, 0, 0])).toBe(0);
    expect(evaluateSDF(tapered, [4, 0, 0.1])).toBeLessThan(0);
    expect(evaluateSDF(tapered, [4, 0, 3.9])).toBeGreaterThan(0);
    const expanding: SDFNode = { ...oneSided, taper: -45 };
    expect(computeBounds(expanding)).toEqual({ min: [-9, -8, 0], max: [9, 8, 4] });
    const draftedWall: SDFNode = { ...expanding, wallThickness: 2 };
    expect(computeBounds(draftedWall).min[0]).toBeCloseTo(-10.41421356);

    const thin: SDFNode = { ...oneSided, wallThickness: 1 };
    expect(evaluateSDF(thin, [0, 0, 2])).toBeGreaterThan(0);
    expect(evaluateSDF(thin, [4.8, 0, 2])).toBeLessThan(0);
    expect(computeBounds(thin)).toEqual({ min: [-5.5, -4.5, 0], max: [5.5, 4.5, 4] });
  });

  it('maps the same extrusion onto each named sketch plane', () => {
    const base: SDFNode = { kind: 'extrude', profile: plate, depth: 2, plane: 'xy' };
    expect(evaluateSDF(base, [4, 0, 0])).toBeLessThan(0);
    const xz: SDFNode = { ...base, plane: 'xz' };
    expect(evaluateSDF(xz, [4, 0, 0])).toBeLessThan(0);
    expect(evaluateSDF(xz, [4, 2, 0])).toBeGreaterThan(0);
    expect(computeBounds(xz)).toEqual({ min: [-5, -1, -4], max: [5, 1, 4] });
    const yz: SDFNode = { ...base, plane: 'yz' };
    expect(evaluateSDF(yz, [0, 4, 0])).toBeLessThan(0);
    expect(computeBounds(yz)).toEqual({ min: [-1, -5, -4], max: [1, 5, 4] });
    expect(generateSDFFunction(xz).glsl).toContain('.xz');
  });

  it('preserves and evaluates native circular-arc edges', () => {
    const arced = parseProfile(JSON.stringify({
      outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [],
      bulges: [0, 1, 0, 0],
    }));
    expect(arced.bulges).toEqual([0, 1, 0, 0]);
    const node: SDFNode = { kind: 'extrude', profile: arced, depth: 2 };
    expect(evaluateSDF(node, [15, 5, 0])).toBeCloseTo(0, 8);
    expect(evaluateSDF(node, [14, 5, 0])).toBeLessThan(0);
    expect(computeBounds(node)).toEqual({ min: [0, 0, -1], max: [15, 10, 1] });
    const shader = generateSDFFunction(node).glsl;
    expect(shader).toContain('paon_');
    expect(shader).toContain('pard_');
  });

  it('keeps randomized native arcs inside their bounds with conservative clearance', () => {
    fc.assert(fc.property(
      fc.double({ min: 4, max: 30, noNaN: true }), fc.double({ min: 4, max: 30, noNaN: true }),
      fc.double({ min: 1, max: 12, noNaN: true }), fc.double({ min: 0.05, max: 1, noNaN: true }),
      fc.constantFrom('xy' as const, 'xz' as const, 'yz' as const),
      fc.tuple(fc.double({ min: -20, max: 40, noNaN: true }), fc.double({ min: -20, max: 40, noNaN: true }), fc.double({ min: -20, max: 20, noNaN: true })),
      (width, height, depth, bulge, plane, point) => {
        const profile = parseProfile(JSON.stringify({ outer: [[0, 0], [width, 0], [width, height], [0, height]], holes: [], bulges: [0, bulge, 0, 0] }));
        const node: SDFNode = { kind: 'extrude', profile, depth, plane };
        const bounds = computeBounds(node), value = evaluateSDF(node, point);
        // Arc centre reconstruction loses sub-ulp endpoint offsets; those are
        // numerical surface points, not meaningful clearance claims.
        if (!Number.isFinite(value) || Math.abs(value) < 1e-7) return true;
        if (value < 0 && point.some((coordinate, axis) => coordinate < bounds.min[axis] - 1e-7 || coordinate > bounds.max[axis] + 1e-7)) throw new Error(JSON.stringify({ reason: 'bounds', point, value, bounds }));
        const probe: [number, number, number] = [point[0] + 0.3 * Math.abs(value), point[1] + 0.4 * Math.abs(value), point[2]];
        const probeValue = evaluateSDF(node, probe);
        if ((probeValue < 0) !== (value < 0)) throw new Error(JSON.stringify({ reason: 'clearance', point, value, probe, probeValue }));
        return true;
      },
    ), { numRuns: 200 });
  });

  it('rejects malformed, wrongly wound, and self-intersecting loops actionably', () => {
    expect(() => parseProfile('{')).toThrow(/not valid JSON/);
    expect(() => parseProfile(JSON.stringify({ outer: [[0, 0], [0, 2], [2, 2], [2, 0]], holes: [] }))).toThrow(/counter-clockwise/);
    expect(() => parseProfile(JSON.stringify({ outer: [[0, 0], [2, 2], [0, 2], [2, 0]], holes: [] }))).toThrow(ProfileValidationError);
  });

  it('converts serialized profile data and emits bounded shader and interval fields', () => {
    const node = toSDFNode({ id: 'p', kind: 'extrude', label: 'Plate', params: { depth: 3 }, data: { profile: JSON.stringify(plate) }, children: [], enabled: true })!;
    expect(node).toMatchObject({ kind: 'extrude', depth: 3, profile: plate, plane: 'xy' });
    expect(generateSDFFunction(node).glsl).toContain('sdf_profile_');
    const interval = evaluateInterval(node, computeBounds(node));
    expect(interval.lo).toBeLessThanOrEqual(-1);
    expect(interval.hi).toBe(Infinity);
  });

  it('converts all extent modes without changing legacy extrudes', () => {
    const base = { id: 'p', kind: 'extrude', label: 'Plate', data: { profile: JSON.stringify(plate) }, children: [], enabled: true };
    expect(toSDFNode({ ...base, params: { depth: 6 } })).toMatchObject({ depth: 6, zMin: -3, zMax: 3, taper: undefined, wallThickness: undefined });
    expect(toSDFNode({ ...base, params: { depth: 6, extentMode: 1, taper: 5, wallThickness: 2 } })).toMatchObject({ depth: 6, zMin: 0, zMax: 6, taper: 5, wallThickness: 2 });
    expect(toSDFNode({ ...base, params: { depth: 6, negativeDepth: 4, extentMode: 2 } })).toMatchObject({ depth: 10, zMin: -4, zMax: 6 });
  });
});

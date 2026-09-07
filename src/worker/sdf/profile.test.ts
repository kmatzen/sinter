import { describe, expect, it } from 'vitest';
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

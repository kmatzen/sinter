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

  it('rejects malformed, wrongly wound, and self-intersecting loops actionably', () => {
    expect(() => parseProfile('{')).toThrow(/not valid JSON/);
    expect(() => parseProfile(JSON.stringify({ outer: [[0, 0], [0, 2], [2, 2], [2, 0]], holes: [] }))).toThrow(/counter-clockwise/);
    expect(() => parseProfile(JSON.stringify({ outer: [[0, 0], [2, 2], [0, 2], [2, 0]], holes: [] }))).toThrow(ProfileValidationError);
  });

  it('converts serialized profile data and emits bounded shader and interval fields', () => {
    const node = toSDFNode({ id: 'p', kind: 'extrude', label: 'Plate', params: { depth: 3 }, data: { profile: JSON.stringify(plate) }, children: [], enabled: true })!;
    expect(node).toMatchObject({ kind: 'extrude', depth: 3, profile: plate });
    expect(generateSDFFunction(node).glsl).toContain('sdf_profile_');
    const interval = evaluateInterval(node, computeBounds(node));
    expect(interval.lo).toBeLessThanOrEqual(-1);
    expect(interval.hi).toBe(Infinity);
  });
});

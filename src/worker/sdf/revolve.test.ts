import { describe, expect, it } from 'vitest';
import { computeBounds } from './bounds';
import { generateSDFFunction } from './codegen';
import { toSDFNode } from './convert';
import { evaluateSDF } from './evaluate';
import { evaluateInterval } from './interval';
import { parseRevolveProfile, revolveDistance, sectorDistance } from './profile';
import type { SDFNode } from './types';

const cylinderProfile = parseRevolveProfile(JSON.stringify({ outer: [[0, -2], [5, -2], [5, 2], [0, 2]], holes: [] }));

describe('polygon profile revolve', () => {
  it('removes the construction edge on the axis for a full revolution', () => {
    const node: SDFNode = { kind: 'revolve', profile: cylinderProfile, axis: 'y', angle: 360 };
    expect(evaluateSDF(node, [0, 0, 0])).toBeCloseTo(-2);
    expect(evaluateSDF(node, [4, 0, 0])).toBeCloseTo(-1);
    expect(evaluateSDF(node, [5, 0, 0])).toBeCloseTo(0);
    expect(computeBounds(node)).toEqual({ min: [-5, -2, -5], max: [5, 2, 5] });
  });

  it('clips a partial revolution to the centred angular sector', () => {
    expect(revolveDistance(cylinderProfile, 'y', 90, [4, 0, 0])).toBeLessThan(0);
    expect(revolveDistance(cylinderProfile, 'y', 90, [-4, 0, 0])).toBeGreaterThan(0);
    expect(sectorDistance(0, 4, 90)).toBeGreaterThan(0);
  });

  it('supports alternate axes and rejects negative radius profiles', () => {
    const node: SDFNode = { kind: 'revolve', profile: cylinderProfile, axis: 'x', angle: 360 };
    expect(evaluateSDF(node, [0, 4, 0])).toBeLessThan(0);
    expect(computeBounds(node)).toEqual({ min: [-2, -5, -5], max: [2, 5, 5] });
    expect(() => parseRevolveProfile(JSON.stringify({ outer: [[-1, -1], [2, -1], [2, 1], [-1, 1]], holes: [] }))).toThrow(/radius.*non-negative/i);
  });

  it('converts, emits shader code, and provides a sound coarse interval', () => {
    const node = toSDFNode({ id: 'r', kind: 'revolve', label: 'Knob', params: { axis: 2, angle: 120 }, data: { profile: JSON.stringify(cylinderProfile) }, children: [], enabled: true })!;
    expect(node).toMatchObject({ kind: 'revolve', axis: 'z', angle: 120 });
    expect(generateSDFFunction(node).glsl).toContain('atan');
    const interval = evaluateInterval(node, computeBounds(node));
    expect(interval.lo).toBeLessThanOrEqual(0);
    expect(interval.hi).toBe(Infinity);
  });
});

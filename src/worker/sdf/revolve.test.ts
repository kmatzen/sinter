import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
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

  it('uses the sketch plane to orient a partial revolution', () => {
    const xy: SDFNode = { kind: 'revolve', profile: cylinderProfile, axis: 'y', angle: 90, plane: 'xy' };
    const yz: SDFNode = { ...xy, plane: 'yz' };
    expect(evaluateSDF(xy, [4, 0, 0])).toBeLessThan(0);
    expect(evaluateSDF(xy, [0, 0, 4])).toBeGreaterThan(0);
    expect(evaluateSDF(yz, [0, 0, 4])).toBeLessThan(0);
    expect(evaluateSDF(yz, [4, 0, 0])).toBeGreaterThan(0);
    expect(generateSDFFunction(yz).glsl).toContain('.z');
  });

  it('revolves around a selected straight profile edge', () => {
    const source = { outer: [[2, 1], [6, 1], [6, 4], [2, 4]], holes: [] };
    const node = toSDFNode({ id: 'r', kind: 'revolve', label: 'Offset knob', params: { axis: 1, axisEdge: 0, angle: 360, plane: 0 }, data: { profile: JSON.stringify(source) }, children: [], enabled: true })!;
    expect(node).toMatchObject({ kind: 'revolve', frame: { origin: [2, 1, 0], axial: [-1, 0, 0], radial: [0, 1, 0], normal: [0, 0, 1] } });
    expect(evaluateSDF(node, [4, 2, 0])).toBeLessThan(0);
    expect(evaluateSDF(node, [4, 5, 0])).toBeGreaterThan(0);
    expect(computeBounds(node)).toEqual({ min: [2, -2, -3], max: [6, 4, 3] });
    const glsl = generateSDFFunction(node).glsl;
    expect(glsl).toContain('dot(rq_');
  });

  it('rejects curved, missing, and interior-crossing profile axes', () => {
    const curved = JSON.stringify({ outer: [[0, 0], [4, 0], [4, 2], [0, 2]], holes: [], bulges: [0.2, 0, 0, 0] });
    expect(() => toSDFNode({ id: 'r', kind: 'revolve', label: 'Bad', params: { axis: 1, axisEdge: 0, angle: 360, plane: 0 }, data: { profile: curved }, children: [], enabled: true })).toThrow(/straight profile edge/i);
    const concave = JSON.stringify({ outer: [[0, 0], [4, 0], [5, -1], [5, 4], [0, 4]], holes: [] });
    expect(() => toSDFNode({ id: 'r', kind: 'revolve', label: 'Bad', params: { axis: 1, axisEdge: 0, angle: 360, plane: 0 }, data: { profile: concave }, children: [], enabled: true })).toThrow(/all material on one side/i);
  });

  it('keeps randomized selected-edge revolves inside conservative bounds', () => {
    fc.assert(fc.property(
      fc.double({ min: -50, max: 50, noNaN: true }), fc.double({ min: -50, max: 50, noNaN: true }),
      fc.double({ min: 0.2, max: 30, noNaN: true }), fc.double({ min: 0.2, max: 30, noNaN: true }),
      fc.constantFrom(0, 1, 2), fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      (x, y, width, height, plane, theta) => {
        const source = { outer: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], holes: [] };
        const node = toSDFNode({ id: 'r', kind: 'revolve', label: 'Random', params: { axis: 1, axisEdge: 0, angle: 360, plane }, data: { profile: JSON.stringify(source) }, children: [], enabled: true })!;
        if (node.kind !== 'revolve' || !node.frame) return false;
        const point = node.frame.origin.map((origin, index) => origin + node.frame!.axial[index] * (-width / 2) + node.frame!.radial[index] * (height / 2 * Math.cos(theta)) + node.frame!.normal[index] * (height / 2 * Math.sin(theta))) as [number, number, number];
        const bounds = computeBounds(node);
        return evaluateSDF(node, point) < 1e-7 && point.every((value, index) => value >= bounds.min[index] - 1e-9 && value <= bounds.max[index] + 1e-9);
      },
    ), { numRuns: 100 });
  });

  it('converts, emits shader code, and provides a sound coarse interval', () => {
    const node = toSDFNode({ id: 'r', kind: 'revolve', label: 'Knob', params: { axis: 2, angle: 120 }, data: { profile: JSON.stringify(cylinderProfile) }, children: [], enabled: true })!;
    expect(node).toMatchObject({ kind: 'revolve', axis: 'z', angle: 120, plane: 'xy' });
    expect(generateSDFFunction(node).glsl).toContain('atan');
    const interval = evaluateInterval(node, computeBounds(node));
    expect(interval.lo).toBeLessThanOrEqual(0);
    expect(interval.hi).toBe(Infinity);
  });
});

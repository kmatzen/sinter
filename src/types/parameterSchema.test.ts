import { describe, expect, it } from 'vitest';
import { NODE_DEFAULTS, type SDFNodeUI } from './operations';
import { applyNodeParamPatch, MODEL_SPATIAL_LIMIT_MM, normalizeNodeParams } from './parameterSchema';

describe('parameter schemas', () => {
  it('defines and produces finite defaults for every parameterized node kind', () => {
    for (const [kind, defaults] of Object.entries(NODE_DEFAULTS)) {
      const normalized = normalizeNodeParams(kind, {});
      expect(Object.keys(normalized).sort(), kind).toEqual(Object.keys(defaults).sort());
      expect(Object.values(normalized).every(Number.isFinite), kind).toBe(true);
    }
  });

  it('enforces physical, divisor, pattern, enum, and integer bounds consistently', () => {
    expect(normalizeNodeParams('box', { width: -1, height: 0, depth: Infinity })).toMatchObject({ width: 0.1, height: 0.1, depth: 50 });
    expect(normalizeNodeParams('scale', { x: 0, y: -2, z: Infinity })).toMatchObject({ x: 0.01, y: 0.01, z: 1 });
    expect(normalizeNodeParams('linearPattern', { count: 1.4, spacing: 0, axisX: 0, axisY: 0, axisZ: 0 }))
      .toMatchObject({ count: 2, spacing: 0.1, axisX: 1, axisY: 0, axisZ: 0 });
    expect(normalizeNodeParams('mesh', { resolution: 101.8 })).toMatchObject({ resolution: 96 });
    expect(normalizeNodeParams('halfSpace', { axis: 20, position: 0, flip: -5 })).toMatchObject({ axis: 2, flip: 1 });
  });

  it('enforces torus cross-field constraints', () => {
    expect(normalizeNodeParams('torus', { majorRadius: 5, minorRadius: 10 })).toMatchObject({ majorRadius: 5, minorRadius: 5 });
  });

  it('uses one spatial envelope and canonicalizes equivalent rotations', () => {
    expect(normalizeNodeParams('box', { width: 1e20, height: 1, depth: 1 }).width).toBe(MODEL_SPATIAL_LIMIT_MM);
    expect(normalizeNodeParams('translate', { x: 1e6, y: -1e6, z: 0 })).toMatchObject({
      x: MODEL_SPATIAL_LIMIT_MM, y: -MODEL_SPATIAL_LIMIT_MM,
    });
    expect(normalizeNodeParams('rotate', { x: 0, y: 360, z: 1_000_080 })).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('rejects a non-finite live patch atomically', () => {
    const node: SDFNodeUI = { id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true };
    expect(applyNodeParamPatch(node, { width: 40, height: Number.NaN })).toEqual({ error: 'height must be a finite number' });
  });
});

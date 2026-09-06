import { describe, expect, it } from 'vitest';
import { MAX_MODEL_SCALE_RATIO, ModelingEnvelopeError, validateModelingEnvelope } from './modelingEnvelope';
import { MODEL_BOUNDARY_TOLERANCE_MM, MODEL_EDGE_FLOAT32_ULP_MM, MODEL_SPATIAL_LIMIT_MM } from '../../types/modelingEnvelope';
import { computeBounds } from './bounds';
import { evaluateSDF } from './evaluate';
import { generateSDFFunction } from './codegen';
import type { SDFNode } from './types';

const box = (size: [number, number, number] = [10, 10, 10]): SDFNode => ({ kind: 'box', size });
const transform = (child: SDFNode, values: Partial<Extract<SDFNode, { kind: 'transform' }>>): SDFNode => ({
  kind: 'transform', child, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, ...values,
});

describe('resolved modeling envelope', () => {
  it('accepts a 0.1 mm feature at the furthest supported coordinate', () => {
    expect(() => validateModelingEnvelope(transform(box([0.1, 0.1, 0.1]), { tx: 8191.95 }))).not.toThrow();
  });

  it('preserves a 0.1 mm feature sign at both extremes of every axis in float32', () => {
    expect(MODEL_EDGE_FLOAT32_ULP_MM).toBeLessThanOrEqual(0.001);
    const half = 0.05;
    for (const axis of [0, 1, 2] as const) {
      for (const sign of [-1, 1]) {
        const translation = sign * (MODEL_SPATIAL_LIMIT_MM - half);
        const values = { tx: 0, ty: 0, tz: 0 };
        values[axis === 0 ? 'tx' : axis === 1 ? 'ty' : 'tz'] = translation;
        const node = transform(box([0.1, 0.1, 0.1]), values);
        expect(() => validateModelingEnvelope(node)).not.toThrow();
        const bounds = computeBounds(node);
        expect(Math.abs(bounds[sign > 0 ? 'max' : 'min'][axis])).toBeLessThanOrEqual(MODEL_SPATIAL_LIMIT_MM);

        const gpuBoxDistance = (delta: number) => Math.fround(Math.abs(Math.fround(Math.fround(translation + delta) - Math.fround(translation))) - Math.fround(half));
        const inside = [0, 0, 0] as [number, number, number]; inside[axis] = translation + 0.049;
        const outside = [0, 0, 0] as [number, number, number]; outside[axis] = translation + 0.051;
        expect(evaluateSDF(node, inside)).toBeLessThan(0);
        expect(evaluateSDF(node, outside)).toBeGreaterThan(0);
        expect(gpuBoxDistance(0.049)).toBeLessThan(0);
        expect(gpuBoxDistance(0.051)).toBeGreaterThan(0);
        expect(Math.abs(gpuBoxDistance(0.051) - 0.001)).toBeLessThanOrEqual(MODEL_BOUNDARY_TOLERANCE_MM);
        expect(generateSDFFunction(node).paramValues.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('rejects individually valid nested translations whose result leaves the envelope', () => {
    expect(() => validateModelingEnvelope(
      transform(transform(box(), { tx: 5_000 }), { tx: 5_000 }),
    )).toThrow(/resolved geometry must stay within/);
  });

  it('rejects features made sub-resolution by composed scales', () => {
    expect(() => validateModelingEnvelope(
      transform(transform(box([10, 10, 10]), { sx: 0.1, sy: 0.1, sz: 0.1 }), { sx: 0.01, sy: 0.01, sz: 0.01 }),
    )).toThrow(/at least 0.1 mm after scaling/);
  });

  it('rejects extreme composed anisotropy with an actionable ratio', () => {
    expect(() => validateModelingEnvelope(
      transform(box(), { sx: MAX_MODEL_SCALE_RATIO + 1, sy: 1, sz: 1 }),
    )).toThrow(ModelingEnvelopeError);
  });
});

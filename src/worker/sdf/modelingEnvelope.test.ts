import { describe, expect, it } from 'vitest';
import { MAX_MODEL_SCALE_RATIO, ModelingEnvelopeError, validateModelingEnvelope } from './modelingEnvelope';
import type { SDFNode } from './types';

const box = (size: [number, number, number] = [10, 10, 10]): SDFNode => ({ kind: 'box', size });
const transform = (child: SDFNode, values: Partial<Extract<SDFNode, { kind: 'transform' }>>): SDFNode => ({
  kind: 'transform', child, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, ...values,
});

describe('resolved modeling envelope', () => {
  it('accepts a 0.1 mm feature at the furthest supported coordinate', () => {
    expect(() => validateModelingEnvelope(transform(box([0.1, 0.1, 0.1]), { tx: 8191.95 }))).not.toThrow();
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

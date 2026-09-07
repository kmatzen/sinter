import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { RegionalPrimitiveEvidence } from './csgRecovery';
import { recoverLinearPatterns } from './patternRecovery';

const instance = (x: number, key: string, radius = 2, polarity: 'add' | 'subtract' = 'add'): RegionalPrimitiveEvidence => ({
  node: { kind: 'transform', child: { kind: 'cylinder', radius, height: 6 }, tx: x, ty: 1, tz: -2, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
  polarity, regionKeys: [key], surfaceRms: 0.02, surfaceMax: 0.04, occupancyAgreement: 1,
});

describe('regional pattern recovery', () => {
  it('recovers a deterministic equal-spaced linear pattern', () => {
    const input = [instance(10, 'c'), instance(0, 'a'), instance(5, 'b')];
    const pattern = recoverLinearPatterns(input)[0];
    expect(pattern.node).toMatchObject({ kind: 'linearPattern', axis: [1, 0, 0], count: 3, spacing: 5 });
    expect(pattern.regionKeys).toEqual(['a', 'b', 'c']);
    expect(pattern.instanceResiduals).toHaveLength(3);
  });

  it('is invariant to candidate ordering', () => {
    fc.assert(fc.property(fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }), (order) => {
      const source = [instance(0,'a'), instance(4,'b'), instance(8,'c'), instance(12,'d')];
      return JSON.stringify(recoverLinearPatterns(order.map((index) => source[index]))) === JSON.stringify(recoverLinearPatterns(source));
    }), { numRuns: 100 });
  });

  it('rejects ambiguous pairs, missing instances, drift, and mixed polarity', () => {
    expect(recoverLinearPatterns([instance(0,'a'), instance(5,'b')])).toEqual([]);
    expect(recoverLinearPatterns([instance(0,'a'), instance(5,'b'), instance(11,'c')])).toEqual([]);
    expect(recoverLinearPatterns([instance(0,'a'), instance(5,'b',2.1), instance(10,'c')])).toEqual([]);
    expect(recoverLinearPatterns([instance(0,'a'), instance(5,'b',2,'subtract'), instance(10,'c')])).toEqual([]);
  });
});

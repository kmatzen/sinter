import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { RegionalPrimitiveEvidence } from './csgRecovery';
import { compressRegionalPatterns, recoverCircularPatterns, recoverLinearPatterns, recoverMirrorPatterns } from './patternRecovery';

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

  it('recovers an equal-angle circular pattern around a stable offset axis', () => {
    const input = [...Array(4)].map((_, index) => {
      const angle = index * Math.PI / 2;
      return { ...instance(0, `r${index}`), node: { ...instance(0, `r${index}`).node, tx: 3 + 6 * Math.cos(angle), ty: -2, tz: 4 + 6 * Math.sin(angle) } } as RegionalPrimitiveEvidence;
    });
    const pattern = recoverCircularPatterns(input)[0];
    expect(pattern.pattern).toBe('circular');
    expect(pattern.node.kind).toBe('transform');
    if (pattern.node.kind === 'transform') {
      expect([pattern.node.tx, pattern.node.ty, pattern.node.tz]).toEqual([expect.closeTo(3), expect.closeTo(-2), expect.closeTo(4)]);
      expect(pattern.node.child).toMatchObject({ kind: 'circularPattern', count: 4 });
      if (pattern.node.child.kind === 'circularPattern') expect(pattern.node.child.axis).toEqual([expect.closeTo(0), expect.closeTo(1), expect.closeTo(0)]);
    }
    expect(pattern.regionKeys).toHaveLength(4);
  });

  it('rejects incomplete or unequal circular sequences', () => {
    const around = (angles: number[]) => angles.map((angle, index) => ({ ...instance(0, `${index}`), node: { ...instance(0, `${index}`).node, tx: 5 * Math.cos(angle), ty: 0, tz: 5 * Math.sin(angle) } } as RegionalPrimitiveEvidence));
    expect(recoverCircularPatterns(around([0, Math.PI / 2]))).toEqual([]);
    expect(recoverCircularPatterns(around([0, Math.PI / 2, Math.PI * 1.1, Math.PI * 1.5]))).toEqual([]);
  });

  it('recovers only an unambiguous single-plane mirror pair', () => {
    const pair = [instance(-5, 'left'), instance(5, 'right')];
    const pattern = recoverMirrorPatterns(pair)[0];
    expect(pattern.node).toMatchObject({ kind: 'mirror', axes: [1, 0, 0], child: { kind: 'transform', tx: 5 } });
    expect(pattern.regionKeys).toEqual(['left', 'right']);
    const diagonal = [
      { ...instance(-5, 'a'), node: { ...instance(-5, 'a').node, ty: -5 } } as RegionalPrimitiveEvidence,
      { ...instance(5, 'b'), node: { ...instance(5, 'b').node, ty: 5 } } as RegionalPrimitiveEvidence,
    ];
    expect(recoverMirrorPatterns(diagonal)).toEqual([]);
  });

  it('substitutes a maximal non-overlapping pattern set', () => {
    const line = [instance(0,'a'), instance(4,'b'), instance(8,'c')], unrelated = instance(30, 'solo', 3);
    const compressed = compressRegionalPatterns([...line, unrelated]);
    expect(compressed.patterns).toHaveLength(1);
    expect(compressed.patterns[0].pattern).toBe('linear');
    expect(compressed.evidence).toHaveLength(2);
    expect(compressed.evidence.flatMap((candidate) => candidate.regionKeys).sort()).toEqual(['a','b','c','solo']);
  });
});

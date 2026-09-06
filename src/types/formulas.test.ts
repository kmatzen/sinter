import { describe, expect, it } from 'vitest';
import { evaluateLengthExpression, FormulaError, resolveNamedParameters, resolveTreeFormulas } from './formulas';
import type { SDFNodeUI } from './operations';

const box = (): SDFNodeUI => ({
  id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 },
  expressions: { width: 'holeSpacing + 2 * wall' }, children: [], enabled: true,
});

describe('persistent formulas', () => {
  it('accepts fractions, compact suffixes, and mixed physical units as canonical millimeters', () => {
    expect(evaluateLengthExpression('1/4 in')).toBeCloseTo(6.35);
    expect(evaluateLengthExpression('12.7mm + 0.5 in')).toBeCloseTo(25.4);
    expect(evaluateLengthExpression('2 * 3 cm + 0.04 m')).toBeCloseTo(100);
    expect(() => evaluateLengthExpression('2 mm + 1 deg')).toThrow(FormulaError);
  });

  it('resolves deterministic dependencies independent of declaration order', () => {
    const result = resolveNamedParameters([
      { name: 'outer', expression: 'inner + 2 * wall', unit: 'mm' },
      { name: 'wall', expression: '2', unit: 'mm' },
      { name: 'inner', expression: '20', unit: 'mm' },
    ]);
    expect(result.map(({ name, value }) => [name, value])).toEqual([['outer', 24], ['wall', 2], ['inner', 20]]);
  });

  it('updates every dependent node from one consistent snapshot', () => {
    const definitions = [
      { name: 'holeSpacing', expression: '20', unit: 'mm' as const },
      { name: 'wall', expression: '3', unit: 'mm' as const },
    ];
    expect(resolveTreeFormulas(box(), definitions)?.params.width).toBe(26);
  });

  it('reports cycles, unknown names, unit mismatches, and invalid domains', () => {
    expect(() => resolveNamedParameters([
      { name: 'a', expression: 'b', unit: 'mm' }, { name: 'b', expression: 'a', unit: 'mm' },
    ])).toThrow(/cycle.*a.*b.*a/i);
    expect(() => resolveNamedParameters([{ name: 'a', expression: 'missing', unit: 'mm' }])).toThrow(/Unknown parameter/);
    expect(() => resolveNamedParameters([
      { name: 'length', expression: '2', unit: 'mm' }, { name: 'angle', expression: 'length', unit: 'deg' },
    ])).toThrow(/expects deg, got mm/);
    expect(() => resolveNamedParameters([
      { name: 'copies', expression: '2', unit: 'unitless' }, { name: 'length', expression: 'copies', unit: 'mm' },
    ])).toThrow(/expects mm, got unitless/);
    expect(() => resolveTreeFormulas({ ...box(), expressions: { width: '-1' } }, [])).toThrow(/outside its valid domain/);
  });

  it('allows named unitless scalars to multiply physical dimensions', () => {
    const result = resolveNamedParameters([
      { name: 'wall', expression: '2', unit: 'mm' },
      { name: 'factor', expression: '3', unit: 'unitless' },
      { name: 'width', expression: 'factor * wall', unit: 'mm' },
    ]);
    expect(result.find((item) => item.name === 'width')?.value).toBe(6);
  });

  it('validates cross-field domains from one atomic formula snapshot', () => {
    const torus: SDFNodeUI = {
      id: 't', kind: 'torus', label: 'Torus', params: { majorRadius: 20, minorRadius: 5 },
      expressions: { minorRadius: 'minor', majorRadius: 'major' }, children: [], enabled: true,
    };
    expect(() => resolveTreeFormulas(torus, [
      { name: 'major', expression: '5', unit: 'mm' },
      { name: 'minor', expression: '10', unit: 'mm' },
    ])).toThrow(/minorRadius.*outside its valid domain/);
  });

  it('rejects unsafe syntax and non-finite arithmetic', () => {
    expect(() => resolveNamedParameters([{ name: 'x', expression: 'globalThis.alert(1)', unit: 'unitless' }])).toThrow(FormulaError);
    expect(() => resolveNamedParameters([{ name: 'x', expression: '1 / 0', unit: 'unitless' }])).toThrow(/Division by zero/);
  });
});

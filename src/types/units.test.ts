import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIT_PREFERENCES, formatLength, fromMillimeters, normalizeUnitPreferences, toMillimeters } from './units';

describe('project units', () => {
  it('converts only at boundaries around canonical millimeters', () => {
    expect(toMillimeters(0.5, 'in')).toBeCloseTo(12.7);
    expect(toMillimeters(fromMillimeters(254, 'm'), 'm')).toBeCloseTo(254);
    expect(fromMillimeters(25.4, 'in')).toBeCloseTo(1);
  });

  it('formats every decimal display unit without changing the source value', () => {
    const value = 1234.5;
    expect(formatLength(value, { ...DEFAULT_UNIT_PREFERENCES, displayUnit: 'mm', decimalPrecision: 1 })).toBe('1234.5 mm');
    expect(formatLength(value, { ...DEFAULT_UNIT_PREFERENCES, displayUnit: 'cm', decimalPrecision: 2 })).toBe('123.45 cm');
    expect(formatLength(value, { ...DEFAULT_UNIT_PREFERENCES, displayUnit: 'm', decimalPrecision: 4 })).toBe('1.2345 m');
    expect(formatLength(25.4, { ...DEFAULT_UNIT_PREFERENCES, displayUnit: 'in', decimalPrecision: 3 })).toBe('1.000 in');
    expect(value).toBe(1234.5);
  });

  it('formats feet and reduced inch fractions with carry and sign', () => {
    const prefs = { ...DEFAULT_UNIT_PREFERENCES, displayUnit: 'ft-in' as const, fractionalDenominator: 16 as const };
    expect(formatLength(25.4 * 14.5, prefs)).toBe('1′ 2 1/2″');
    expect(formatLength(-25.4 * 0.25, prefs)).toBe('-1/4″');
    expect(formatLength(25.4 * 11.99, prefs)).toBe('1′ 0″');
  });

  it('migrates missing and bounds malformed preferences', () => {
    expect(normalizeUnitPreferences()).toEqual(DEFAULT_UNIT_PREFERENCES);
    expect(normalizeUnitPreferences({ displayUnit: 'wat' as never, decimalPrecision: 99, fractionalDenominator: 3 as never }))
      .toEqual({ displayUnit: 'mm', decimalPrecision: 6, fractionalDenominator: 16 });
  });
});

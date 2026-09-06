export type DisplayUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft-in';

export interface UnitPreferences {
  displayUnit: DisplayUnit;
  decimalPrecision: number;
  fractionalDenominator: 2 | 4 | 8 | 16 | 32 | 64;
}

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  displayUnit: 'mm', decimalPrecision: 2, fractionalDenominator: 16,
};

const MM_PER_UNIT: Record<Exclude<DisplayUnit, 'ft-in'>, number> = {
  mm: 1, cm: 10, m: 1000, in: 25.4,
};

export function toMillimeters(value: number, unit: Exclude<DisplayUnit, 'ft-in'>): number {
  return value * MM_PER_UNIT[unit];
}

export function fromMillimeters(valueMm: number, unit: DisplayUnit): number {
  return valueMm / (unit === 'ft-in' ? 25.4 : MM_PER_UNIT[unit]);
}

export function normalizeUnitPreferences(input?: Partial<UnitPreferences> | null): UnitPreferences {
  const displayUnit: DisplayUnit = ['mm', 'cm', 'm', 'in', 'ft-in'].includes(input?.displayUnit ?? '')
    ? input!.displayUnit as DisplayUnit : 'mm';
  const decimalPrecision = Number.isInteger(input?.decimalPrecision)
    ? Math.max(0, Math.min(6, input!.decimalPrecision!)) : 2;
  const denominator = input?.fractionalDenominator;
  const fractionalDenominator = ([2, 4, 8, 16, 32, 64] as const).includes(denominator as 2)
    ? denominator as UnitPreferences['fractionalDenominator'] : 16;
  return { displayUnit, decimalPrecision, fractionalDenominator };
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
}

function fraction(value: number, denominator: UnitPreferences['fractionalDenominator']): string {
  let whole = Math.floor(value);
  let numerator = Math.round((value - whole) * denominator);
  if (numerator === denominator) { whole += 1; numerator = 0; }
  if (!numerator) return String(whole);
  const divisor = gcd(numerator, denominator);
  const suffix = `${numerator / divisor}/${denominator / divisor}`;
  return whole ? `${whole} ${suffix}` : suffix;
}

export function formatLength(valueMm: number, preferences: UnitPreferences, withUnit = true): string {
  const prefs = normalizeUnitPreferences(preferences);
  if (prefs.displayUnit === 'ft-in') {
    const negative = valueMm < 0 ? '-' : '';
    const totalInches = Math.abs(valueMm) / 25.4;
    let feet = Math.floor(totalInches / 12);
    let inches = totalInches - feet * 12;
    const rounded = Math.round(inches * prefs.fractionalDenominator) / prefs.fractionalDenominator;
    if (rounded >= 12) { feet += 1; inches = 0; } else inches = rounded;
    return `${negative}${feet > 0 ? `${feet}′ ` : ''}${fraction(inches, prefs.fractionalDenominator)}″`;
  }
  const rendered = fromMillimeters(valueMm, prefs.displayUnit).toFixed(prefs.decimalPrecision);
  return withUnit ? `${rendered} ${prefs.displayUnit}` : rendered;
}

export function displayStepToMillimeters(step: number, unit: DisplayUnit): number {
  return unit === 'ft-in' ? step * 25.4 : toMillimeters(step, unit);
}

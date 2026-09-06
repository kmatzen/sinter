import { describe, expect, it } from 'vitest';
import { clampHeroPixelRatio, shouldAnimateHero } from './HeroDemo';

describe('landing hero performance policy', () => {
  it('caps expensive high-density rendering while preserving normal DPR', () => {
    expect(clampHeroPixelRatio(0.75)).toBe(1);
    expect(clampHeroPixelRatio(1)).toBe(1);
    expect(clampHeroPixelRatio(1.25)).toBe(1.25);
    expect(clampHeroPixelRatio(2)).toBe(1.5);
    expect(clampHeroPixelRatio(3)).toBe(1.5);
  });

  it('animates only when visible and motion is allowed', () => {
    expect(shouldAnimateHero(true, true, false)).toBe(true);
    expect(shouldAnimateHero(false, true, false)).toBe(false);
    expect(shouldAnimateHero(true, false, false)).toBe(false);
    expect(shouldAnimateHero(true, true, true)).toBe(false);
  });
});

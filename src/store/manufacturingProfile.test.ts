import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});

import { dimensionsOutsideBuildVolume, normalizeManufacturingProfile, useManufacturingProfileStore } from './manufacturingProfile';

describe('manufacturing profile', () => {
  beforeEach(() => storage.clear());

  it('normalizes corrupted and unsafe persisted values', () => {
    expect(normalizeManufacturingProfile({ nozzleDiameter: -1, layerHeight: Infinity, buildVolume: [0, 300, 'wide'] })).toEqual({
      nozzleDiameter: 0.1, layerHeight: 0.2, tolerance: 0.2, buildVolume: [1, 300, 250],
    });
  });

  it('compares actual part dimensions with each build axis', () => {
    const profile = normalizeManufacturingProfile({ buildVolume: [100, 200, 300] });
    expect(dimensionsOutsideBuildVolume([100, 200, 300], profile)).toBe(false);
    expect(dimensionsOutsideBuildVolume([101, 20, 30], profile)).toBe(true);
  });

  it('persists normalized edits', () => {
    useManufacturingProfileStore.getState().updateProfile({ nozzleDiameter: 99 });
    expect(JSON.parse(storage.get('sinter_manufacturing_profile')!).nozzleDiameter).toBe(5);
  });
});

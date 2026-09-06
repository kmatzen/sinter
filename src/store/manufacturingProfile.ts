import { create } from 'zustand';
import type { BuildDirection, ExportPreflightOptions } from '../types/geometry';

export interface ManufacturingProfile {
  nozzleDiameter: number;
  layerHeight: number;
  tolerance: number;
  buildVolume: [number, number, number];
  overhangAngle: number;
  buildDirection: BuildDirection;
}

export const DEFAULT_MANUFACTURING_PROFILE: ManufacturingProfile = {
  nozzleDiameter: 0.4,
  layerHeight: 0.2,
  tolerance: 0.2,
  buildVolume: [220, 220, 250],
  overhangAngle: 45,
  buildDirection: 'z',
};

const STORAGE_KEY = 'sinter_manufacturing_profile';

function finiteRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeManufacturingProfile(value: unknown): ManufacturingProfile {
  const input = value && typeof value === 'object' ? value as Partial<ManufacturingProfile> : {};
  const volume = Array.isArray(input.buildVolume) ? input.buildVolume : [];
  return {
    nozzleDiameter: finiteRange(input.nozzleDiameter, 0.1, 5, DEFAULT_MANUFACTURING_PROFILE.nozzleDiameter),
    layerHeight: finiteRange(input.layerHeight, 0.02, 2, DEFAULT_MANUFACTURING_PROFILE.layerHeight),
    tolerance: finiteRange(input.tolerance, 0.01, 10, DEFAULT_MANUFACTURING_PROFILE.tolerance),
    buildVolume: [
      finiteRange(volume[0], 1, 10_000, DEFAULT_MANUFACTURING_PROFILE.buildVolume[0]),
      finiteRange(volume[1], 1, 10_000, DEFAULT_MANUFACTURING_PROFILE.buildVolume[1]),
      finiteRange(volume[2], 1, 10_000, DEFAULT_MANUFACTURING_PROFILE.buildVolume[2]),
    ],
    overhangAngle: finiteRange(input.overhangAngle, 0, 89, DEFAULT_MANUFACTURING_PROFILE.overhangAngle),
    buildDirection: ['x', '-x', 'y', '-y', 'z', '-z'].includes(input.buildDirection as string)
      ? input.buildDirection as BuildDirection : DEFAULT_MANUFACTURING_PROFILE.buildDirection,
  };
}

export function exportPreflightOptions(profile: ManufacturingProfile): ExportPreflightOptions {
  return { overhangAngle: profile.overhangAngle, buildDirection: profile.buildDirection };
}

function loadProfile(): ManufacturingProfile {
  try { return normalizeManufacturingProfile(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return DEFAULT_MANUFACTURING_PROFILE; }
}

export function dimensionsOutsideBuildVolume(dimensions: [number, number, number], profile: ManufacturingProfile): boolean {
  return dimensions.some((dimension, axis) => dimension > profile.buildVolume[axis]);
}

interface ManufacturingProfileState extends ManufacturingProfile {
  updateProfile: (patch: Partial<ManufacturingProfile>) => void;
}

export const useManufacturingProfileStore = create<ManufacturingProfileState>((set) => ({
  ...loadProfile(),
  updateProfile: (patch) => set((state) => {
    const profile = normalizeManufacturingProfile({ ...state, ...patch });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* preference persistence is best effort */ }
    return profile;
  }),
}));

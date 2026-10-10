/** Minimal persisted slices used to avoid coupling this hot-path predicate to UI modules. */
interface PersistedModelerSlice {
  tree: unknown;
  projectName: string;
  namedParameters: unknown;
}

interface PersistedViewportSlice {
  namedViews: unknown;
  pinnedMeasurements: unknown;
  measurementUnit: unknown;
  measurementPrecision: number;
  measurementFractionalDenominator: unknown;
}

/** Persisted model fields that participate in the cloud document hash. */
export function modelerChangeAffectsCloudDocument<T extends PersistedModelerSlice>(state: T, previous: T): boolean {
  return state.tree !== previous.tree ||
    state.projectName !== previous.projectName ||
    state.namedParameters !== previous.namedParameters;
}

/** Persisted viewport fields that participate in the cloud document hash. */
export function viewportChangeAffectsCloudDocument<T extends PersistedViewportSlice>(state: T, previous: T): boolean {
  return state.namedViews !== previous.namedViews ||
    state.pinnedMeasurements !== previous.pinnedMeasurements ||
    state.measurementUnit !== previous.measurementUnit ||
    state.measurementPrecision !== previous.measurementPrecision ||
    state.measurementFractionalDenominator !== previous.measurementFractionalDenominator;
}

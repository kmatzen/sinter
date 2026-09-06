import { create } from 'zustand';
import type { MeasurementAnchor, PinnedMeasurement } from '../types/measurement';
import type { NamedProjectView } from '../types/view';
import { normalizeUnitPreferences, type DisplayUnit, type UnitPreferences } from '../types/units';

const GIZMO_SPACE_KEY = 'sinter_gizmo_space';
const MEASUREMENT_UNIT_KEY = 'sinter_measurement_unit';
const MEASUREMENT_PRECISION_KEY = 'sinter_measurement_precision';

function initialGizmoSpace(): 'world' | 'local' {
  try { return localStorage.getItem(GIZMO_SPACE_KEY) === 'local' ? 'local' : 'world'; }
  catch { return 'world'; }
}

function initialMeasurementUnit(): DisplayUnit {
  try { return ['mm', 'cm', 'm', 'in', 'ft-in'].includes(localStorage.getItem(MEASUREMENT_UNIT_KEY) ?? '')
    ? localStorage.getItem(MEASUREMENT_UNIT_KEY) as DisplayUnit : 'mm'; } catch { return 'mm'; }
}

function initialMeasurementPrecision(): number {
  try {
    const raw = localStorage.getItem(MEASUREMENT_PRECISION_KEY);
    if (raw === null) return 2;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 2;
  } catch { return 2; }
}

interface ViewportState {
  namedViews: NamedProjectView[];
  setNamedViews: (views: NamedProjectView[]) => void;
  addNamedView: (view: NamedProjectView) => void;
  removeNamedView: (id: string) => void;
  projection: 'perspective' | 'orthographic';
  setProjection: (projection: 'perspective' | 'orthographic') => void;
  // Gizmo
  gizmoMode: 'none' | 'translate' | 'rotate' | 'scale';
  setGizmoMode: (mode: 'none' | 'translate' | 'rotate' | 'scale') => void;
  gizmoSpace: 'world' | 'local';
  toggleGizmoSpace: () => void;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  snapEnabled: boolean;
  snapSize: number; // mm for translate, degrees for rotate, factor for scale
  toggleSnap: () => void;
  setSnapSize: (size: number) => void;

  // Clipping plane
  clipEnabled: boolean;
  clipAxis: 'x' | 'y' | 'z';
  clipFlip: boolean;
  clipPosition: number;

  toggleClip: () => void;
  setClipAxis: (axis: 'x' | 'y' | 'z') => void;
  setClipFlip: (flip: boolean) => void;
  setClipPosition: (pos: number) => void;

  // Resolution
  /**
   * Export grid resolution, samples per axis.
   *
   * This existed but nothing read it — the worker was hardcoded to 256. Cost
   * is cubic, so this is the single biggest lever a user has over export time,
   * and 128 is a perfectly good draft for checking a shape fits before paying
   * for the real one.
   */
  resolution: number;
  setResolution: (res: number) => void;

  // Dimensions overlay
  showDimensions: boolean;
  toggleDimensions: () => void;

  /**
   * The node the pointer is currently over, from either direction: hovering a
   * surface in the viewport, or hovering a row in the node tree. One field for
   * both so the highlight is symmetric — pointing at geometry names the node,
   * and pointing at a node shows you which geometry it is.
   *
   * Deliberately in the viewport store, not the modeler store. The modeler
   * store is the document, and every write to it wakes the evaluator, pushes
   * the tree through the identity check, and invalidates the frame. Hover fires
   * many times a second and changes nothing about the document.
   */
  hoveredNodeId: string | null;
  /**
   * Where that hover came from.
   *
   * Pointing at geometry and pointing at a row are the same highlight but not
   * the same statement. Only the viewport case means "a click here would
   * select this" — the breadcrumb says so out loud, and if it could not tell
   * the two apart, hovering a crumb would flip the chip into preview mode and
   * disable the button the pointer was on its way to.
   */
  hoverSource: 'viewport' | 'ui' | null;
  setHoveredNode: (id: string | null, source?: 'viewport' | 'ui') => void;

  measurementMode: boolean;
  measurementPoints: MeasurementAnchor[];
  pinnedMeasurements: PinnedMeasurement[];
  measurementUnit: DisplayUnit;
  measurementPrecision: number;
  measurementFractionalDenominator: UnitPreferences['fractionalDenominator'];
  toggleMeasurementMode: () => void;
  addMeasurementPoint: (anchor: MeasurementAnchor) => void;
  clearMeasurement: () => void;
  removeMeasurementPoint: () => void;
  pinMeasurement: () => void;
  removePinnedMeasurement: (id: string) => void;
  setPinnedMeasurements: (measurements: PinnedMeasurement[]) => void;
  resetMeasurementSession: () => void;
  setMeasurementUnit: (unit: DisplayUnit) => void;
  setMeasurementPrecision: (precision: number) => void;
  setMeasurementFractionalDenominator: (denominator: UnitPreferences['fractionalDenominator']) => void;
  setUnitPreferences: (preferences: UnitPreferences) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  namedViews: [],
  setNamedViews: (namedViews) => set({ namedViews }),
  addNamedView: (view) => set((state) => ({ namedViews: [...state.namedViews.filter((item) => item.id !== view.id), view].slice(-20) })),
  removeNamedView: (id) => set((state) => ({ namedViews: state.namedViews.filter((item) => item.id !== id) })),
  projection: 'perspective',
  setProjection: (projection) => set({ projection }),
  gizmoMode: 'translate',
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  gizmoSpace: initialGizmoSpace(),
  toggleGizmoSpace: () => set((s) => {
    const gizmoSpace = s.gizmoSpace === 'world' ? 'local' : 'world';
    try { localStorage.setItem(GIZMO_SPACE_KEY, gizmoSpace); } catch { /* preference persistence is best effort */ }
    return { gizmoSpace };
  }),
  dragging: false,
  setDragging: (v) => set({ dragging: v }),
  snapEnabled: false,
  snapSize: 5,
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setSnapSize: (size) => set({ snapSize: size }),
  clipEnabled: false,
  clipAxis: 'y',
  clipFlip: false,
  clipPosition: 0,
  toggleClip: () => set((s) => ({ clipEnabled: !s.clipEnabled })),
  setClipAxis: (axis) => set({ clipAxis: axis }),
  setClipFlip: (flip) => set({ clipFlip: flip }),
  setClipPosition: (pos) => set({ clipPosition: pos }),

  resolution: 256,
  setResolution: (res) => set({ resolution: res }),
  showDimensions: false,
  toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
  hoveredNodeId: null,
  hoverSource: null,
  setHoveredNode: (id, source = 'ui') => set((s) => {
    const next = id === null ? null : source;
    if (s.hoveredNodeId === id && s.hoverSource === next) return s;
    return { hoveredNodeId: id, hoverSource: next };
  }),
  measurementMode: false,
  measurementPoints: [],
  pinnedMeasurements: [],
  measurementUnit: initialMeasurementUnit(),
  measurementPrecision: initialMeasurementPrecision(),
  measurementFractionalDenominator: 16,
  toggleMeasurementMode: () => set((state) => ({ measurementMode: !state.measurementMode, measurementPoints: [] })),
  addMeasurementPoint: (anchor) => set((state) => ({ measurementPoints: [...state.measurementPoints, anchor].slice(-3) })),
  clearMeasurement: () => set({ measurementPoints: [] }),
  removeMeasurementPoint: () => set((state) => ({ measurementPoints: state.measurementPoints.slice(0, -1) })),
  pinMeasurement: () => set((state) => state.measurementPoints.length < 1 ? state : ({
    pinnedMeasurements: [...state.pinnedMeasurements, { id: crypto.randomUUID(), anchors: state.measurementPoints, createdAt: new Date().toISOString() }].slice(-20),
    measurementPoints: [],
  })),
  removePinnedMeasurement: (id) => set((state) => ({ pinnedMeasurements: state.pinnedMeasurements.filter((item) => item.id !== id) })),
  setPinnedMeasurements: (pinnedMeasurements) => set({ pinnedMeasurements, measurementPoints: [] }),
  resetMeasurementSession: () => set({ measurementMode: false, measurementPoints: [] }),
  setMeasurementUnit: (measurementUnit) => set(() => {
    try { localStorage.setItem(MEASUREMENT_UNIT_KEY, measurementUnit); } catch { /* preference persistence is best effort */ }
    return { measurementUnit };
  }),
  setMeasurementPrecision: (input) => set(() => {
    const measurementPrecision = Math.max(0, Math.min(6, Math.round(input)));
    try { localStorage.setItem(MEASUREMENT_PRECISION_KEY, String(measurementPrecision)); } catch { /* preference persistence is best effort */ }
    return { measurementPrecision };
  }),
  setMeasurementFractionalDenominator: (measurementFractionalDenominator) => set({ measurementFractionalDenominator }),
  setUnitPreferences: (input) => set(() => {
    const preferences = normalizeUnitPreferences(input);
    try {
      localStorage.setItem(MEASUREMENT_UNIT_KEY, preferences.displayUnit);
      localStorage.setItem(MEASUREMENT_PRECISION_KEY, String(preferences.decimalPrecision));
    } catch { /* preference persistence is best effort */ }
    return { measurementUnit: preferences.displayUnit, measurementPrecision: preferences.decimalPrecision,
      measurementFractionalDenominator: preferences.fractionalDenominator };
  }),
}));

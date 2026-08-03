import { create } from 'zustand';

interface ViewportState {
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
}

export const useViewportStore = create<ViewportState>((set) => ({
  gizmoMode: 'translate',
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  gizmoSpace: 'world',
  toggleGizmoSpace: () => set((s) => ({ gizmoSpace: s.gizmoSpace === 'world' ? 'local' : 'world' })),
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
}));

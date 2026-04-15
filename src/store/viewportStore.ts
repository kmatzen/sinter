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
  xray: boolean;

  toggleClip: () => void;
  setClipAxis: (axis: 'x' | 'y' | 'z') => void;
  setClipFlip: (flip: boolean) => void;
  setClipPosition: (pos: number) => void;
  toggleXray: () => void;

  // Resolution
  resolution: number;
  setResolution: (res: number) => void;

  // Dimensions overlay
  showDimensions: boolean;
  toggleDimensions: () => void;

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
  xray: false,
  toggleClip: () => set((s) => ({ clipEnabled: !s.clipEnabled })),
  setClipAxis: (axis) => set({ clipAxis: axis }),
  setClipFlip: (flip) => set({ clipFlip: flip }),
  setClipPosition: (pos) => set({ clipPosition: pos }),
  toggleXray: () => set((s) => ({ xray: !s.xray })),

  resolution: 192,
  setResolution: (res) => set({ resolution: res }),
  showDimensions: false,
  toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
}));

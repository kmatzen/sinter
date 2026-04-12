import { create } from 'zustand';

interface ViewportState {
  // Clipping plane
  clipEnabled: boolean;
  clipAxis: 'x' | 'y' | 'z';
  clipPosition: number;
  xray: boolean;

  heatmap: boolean;
  toggleHeatmap: () => void;

  toggleClip: () => void;
  setClipAxis: (axis: 'x' | 'y' | 'z') => void;
  setClipPosition: (pos: number) => void;
  toggleXray: () => void;

  // Resolution
  resolution: number;
  setResolution: (res: number) => void;

  // Dimensions overlay
  showDimensions: boolean;
  toggleDimensions: () => void;

  // Camera view request (consumed by ViewportControls)
  viewRequest: string | null;
  requestView: (view: string) => void;
  clearViewRequest: () => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  clipEnabled: false,
  clipAxis: 'y',
  clipPosition: 0,
  xray: false,
  heatmap: false,
  toggleHeatmap: () => set((s) => ({ heatmap: !s.heatmap })),

  toggleClip: () => set((s) => ({ clipEnabled: !s.clipEnabled })),
  setClipAxis: (axis) => set({ clipAxis: axis }),
  setClipPosition: (pos) => set({ clipPosition: pos }),
  toggleXray: () => set((s) => ({ xray: !s.xray })),

  resolution: 128,
  setResolution: (res) => set({ resolution: res }),
  showDimensions: false,
  toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
  viewRequest: null,
  requestView: (view) => set({ viewRequest: view }),
  clearViewRequest: () => set({ viewRequest: null }),
}));

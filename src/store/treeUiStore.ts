import { create } from 'zustand';

/**
 * Transient UI state for the node tree.
 *
 * Kept out of `modelerStore` deliberately: that store is the document, with
 * undo history and serialisation hanging off it, and "the user is halfway
 * through picking a destination" is neither undoable nor worth saving. A
 * separate store means a stray move-mode cannot end up in a project file or
 * eat an undo step.
 */
interface TreeUiState {
  /**
   * The node the user has picked up and not yet placed, or null.
   *
   * This is the touch path for reparenting. The tree's drag-and-drop is HTML5
   * DnD, which is never generated from touch input on iOS or Android — so on a
   * phone the only way to restructure a tree was to delete and rebuild it.
   * Move mode is two taps (pick up, then choose a destination) and works
   * identically with a mouse, a finger, or a keyboard.
   */
  movingNodeId: string | null;
  /** Editor-only guards. These never enter the model document or its undo history. */
  lockedNodeIds: Set<string>;
  hiddenNodeIds: Set<string>;
  isolatedNodeId: string | null;
  beginMove: (id: string) => void;
  cancelMove: () => void;
  toggleLocked: (id: string) => void;
  toggleHidden: (id: string) => void;
  isolate: (id: string | null) => void;
  showAll: () => void;
  resetViewState: () => void;
}

function toggled(values: Set<string>, id: string): Set<string> {
  const next = new Set(values);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export const useTreeUiStore = create<TreeUiState>((set) => ({
  movingNodeId: null,
  lockedNodeIds: new Set(),
  hiddenNodeIds: new Set(),
  isolatedNodeId: null,
  beginMove: (id) => set({ movingNodeId: id }),
  cancelMove: () => set({ movingNodeId: null }),
  toggleLocked: (id) => set((state) => ({ lockedNodeIds: toggled(state.lockedNodeIds, id) })),
  toggleHidden: (id) => set((state) => ({ hiddenNodeIds: toggled(state.hiddenNodeIds, id) })),
  isolate: (id) => set({ isolatedNodeId: id }),
  showAll: () => set({ hiddenNodeIds: new Set(), isolatedNodeId: null }),
  resetViewState: () => set({ movingNodeId: null, lockedNodeIds: new Set(), hiddenNodeIds: new Set(), isolatedNodeId: null }),
}));

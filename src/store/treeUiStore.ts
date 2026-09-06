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
  beginMove: (id: string) => void;
  cancelMove: () => void;
}

export const useTreeUiStore = create<TreeUiState>((set) => ({
  movingNodeId: null,
  beginMove: (id) => set({ movingNodeId: id }),
  cancelMove: () => set({ movingNodeId: null }),
}));

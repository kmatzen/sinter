import { create } from 'zustand';
import { useModelerStore } from './modelerStore';
import { captureCanvasThumbnail } from '../utils/thumbnail';

interface ProjectState {
  projectId: string | null;
  lastSavedHash: string;
  saving: boolean;
  dirty: boolean;
  saveError: string | null;
  shareToken: string | null;

  setProjectId: (id: string | null) => void;
  save: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: () => Promise<string>;
  toggleShare: () => Promise<void>;
  markClean: () => void;
  clearSaveError: () => void;
}

function treeHash(): string {
  const { tree, projectName } = useModelerStore.getState();
  return JSON.stringify({ tree, projectName });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  lastSavedHash: '',
  saving: false,
  dirty: false,
  saveError: null,
  shareToken: null,

  setProjectId: (id) => set({ projectId: id }),

  markClean: () => set({ lastSavedHash: treeHash(), dirty: false }),
  clearSaveError: () => set({ saveError: null }),

  save: async () => {
    const { projectId, saving } = get();
    if (saving) return;

    const hash = treeHash();
    if (hash === get().lastSavedHash) return;

    set({ saving: true, saveError: null });
    const { tree, projectName } = useModelerStore.getState();
    const thumbnail = captureCanvasThumbnail();
    const body = { name: projectName, tree_json: tree, thumbnail };

    try {
      if (projectId) {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `Save failed (${res.status})`);
        }
      } else {
        // Auto-create a new project on first save
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `Save failed (${res.status})`);
        }
        const data = await res.json();
        set({ projectId: data.id });
      }
      set({ lastSavedHash: hash, dirty: false });
    } catch (err: any) {
      console.error('Save failed:', err);
      set({ saveError: err.message || 'Save failed' });
    } finally {
      set({ saving: false });
    }
  },

  loadProject: async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load project');
    const data = await res.json();
    const store = useModelerStore.getState();
    store.setProjectName(data.name || 'Untitled');
    if (data.tree_json) {
      let tree;
      try { tree = typeof data.tree_json === 'string' ? JSON.parse(data.tree_json) : data.tree_json; } catch { tree = null; }
      store.setTree(tree);
    } else {
      store.setTree(null);
    }
    set({ projectId: id, shareToken: data.share_token || null, lastSavedHash: treeHash(), dirty: false });
  },

  toggleShare: async () => {
    const { projectId } = get();
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/share`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = await res.json();
    set({ shareToken: data.share_token || null });
  },

  createProject: async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: 'Untitled' }),
    });
    const data = await res.json();
    useModelerStore.getState().setTree(null);
    useModelerStore.getState().setProjectName('Untitled');
    set({ projectId: data.id, lastSavedHash: treeHash(), dirty: false });
    return data.id;
  },
}));

// Auto-save: check every 30 seconds
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave() {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(() => {
    const { projectId } = useProjectStore.getState();
    if (projectId) {
      const hash = treeHash();
      if (hash !== useProjectStore.getState().lastSavedHash) {
        useProjectStore.getState().save();
      }
    }
  }, 30000);
}

export function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

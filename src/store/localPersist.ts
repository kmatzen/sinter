import { useModelerStore } from './modelerStore';

const STORAGE_KEY = 'sinter_local_project';
let lastSavedJSON = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;

export function isDirty(): boolean {
  return useModelerStore.getState().toJSON() !== lastSavedJSON;
}

export function saveToLocal() {
  try {
    const json = useModelerStore.getState().toJSON();
    localStorage.setItem(STORAGE_KEY, json);
    lastSavedJSON = json;
  } catch {
    // localStorage might be full or unavailable
  }
}

export function loadFromLocal(): boolean {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (json) {
      useModelerStore.getState().fromJSON(json);
      lastSavedJSON = json;
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function markClean() {
  lastSavedJSON = useModelerStore.getState().toJSON();
}

// Autosave: debounced save on every store change
export function startLocalAutoSave() {
  if (unsub) return;
  loadFromLocal();

  unsub = useModelerStore.subscribe(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(saveToLocal, 1000);
  });
}

export function stopLocalAutoSave() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

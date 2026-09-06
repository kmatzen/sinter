import { create } from 'zustand';
import { openBrowserDB, LOCAL_BACKUP_STORE } from '../storage/browserDb';
import { useModelerStore } from './modelerStore';
import { ensureConsent, hasConsent } from './consent';

const LEGACY_STORAGE_KEY = 'sinter_local_project';
const CURRENT_KEY = 'current';
const PREVIOUS_KEY = 'previous';

export interface LocalBackupRecord {
  json: string;
  savedAt: string;
}

export interface LocalBackupSlots {
  current: LocalBackupRecord | null;
  previous: LocalBackupRecord | null;
}

export interface LocalBackupBackend {
  read(): Promise<LocalBackupSlots>;
  write(record: LocalBackupRecord): Promise<void>;
  clear(): Promise<void>;
}

type BackupStatus = 'idle' | 'saving' | 'saved' | 'failed';
interface LocalBackupState {
  status: BackupStatus;
  error: string | null;
  lastSavedAt: string | null;
}

export const useLocalBackupStore = create<LocalBackupState>(() => ({
  status: 'idle', error: null, lastSavedAt: null,
}));

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed'));
  });
}

const indexedDBBackend: LocalBackupBackend = {
  async read() {
    const db = await openBrowserDB();
    const tx = db.transaction(LOCAL_BACKUP_STORE, 'readonly');
    const store = tx.objectStore(LOCAL_BACKUP_STORE);
    const [current, previous] = await Promise.all([
      requestResult(store.get(CURRENT_KEY)),
      requestResult(store.get(PREVIOUS_KEY)),
    ]);
    return {
      current: (current as LocalBackupRecord | undefined) ?? null,
      previous: (previous as LocalBackupRecord | undefined) ?? null,
    };
  },

  async write(record) {
    const db = await openBrowserDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_BACKUP_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_BACKUP_STORE);
      const getCurrent = store.get(CURRENT_KEY);
      getCurrent.onsuccess = () => {
        const current = getCurrent.result as LocalBackupRecord | undefined;
        // Only advance a known-good snapshot. A corrupt current value must not
        // overwrite the last recoverable copy.
        if (current && parseProject(current.json)) store.put(current, PREVIOUS_KEY);
        store.put(record, CURRENT_KEY);
      };
      getCurrent.onerror = () => tx.abort();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local backup transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Local backup transaction was aborted'));
    });
  },

  async clear() {
    const db = await openBrowserDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_BACKUP_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_BACKUP_STORE);
      store.delete(CURRENT_KEY);
      store.delete(PREVIOUS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not clear local backup'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not clear local backup'));
    });
  },
};

let backend: LocalBackupBackend = indexedDBBackend;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;
let consentRequested = false;
let startGeneration = 0;

function parseProject(json: string): { projectName?: string; tree?: unknown } | null {
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function legacyRecord(): LocalBackupRecord | null {
  try {
    const json = localStorage.getItem(LEGACY_STORAGE_KEY);
    return json && parseProject(json) ? { json, savedAt: new Date().toISOString() } : null;
  } catch {
    return null;
  }
}

function failureMessage(error: unknown): string {
  const detail = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'browser storage is unavailable';
  return `Local backup failed: ${detail}. Free browser storage or download the project now.`;
}

async function bestRecord(): Promise<{ record: LocalBackupRecord | null; recovered: boolean }> {
  const slots = await backend.read();
  if (slots.current && parseProject(slots.current.json)) return { record: slots.current, recovered: false };
  if (slots.previous && parseProject(slots.previous.json)) return { record: slots.previous, recovered: true };
  return { record: null, recovered: false };
}

export async function saveToLocal(): Promise<boolean> {
  if (!hasConsent()) {
    if (consentRequested) return false;
    consentRequested = true;
    const granted = await ensureConsent('local');
    if (!granted) return false;
  }
  const json = useModelerStore.getState().toJSON();
  useLocalBackupStore.setState({ status: 'saving', error: null });
  try {
    const savedAt = new Date().toISOString();
    await backend.write({ json, savedAt });
    useLocalBackupStore.setState({ status: 'saved', error: null, lastSavedAt: savedAt });
    return true;
  } catch (error) {
    useLocalBackupStore.setState({ status: 'failed', error: failureMessage(error) });
    return false;
  }
}

export async function readLocalBackupJSON(): Promise<string | null> {
  try {
    const { record } = await bestRecord();
    return record?.json ?? legacyRecord()?.json ?? null;
  } catch {
    return legacyRecord()?.json ?? null;
  }
}

export async function loadFromLocal(): Promise<boolean> {
  try {
    let { record, recovered } = await bestRecord();
    if (!record) {
      const legacy = legacyRecord();
      if (legacy) {
        await backend.write(legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        record = legacy;
      }
    }
    if (!record) return false;
    useModelerStore.getState().fromJSON(record.json);
    useLocalBackupStore.setState({
      status: 'saved',
      error: recovered ? 'Recovered the previous valid local backup.' : null,
      lastSavedAt: record.savedAt,
    });
    return true;
  } catch (error) {
    // If migration storage fails, the legacy value remains untouched and can
    // still recover the session now and on a later attempt.
    const legacy = legacyRecord();
    if (legacy) {
      useModelerStore.getState().fromJSON(legacy.json);
    }
    useLocalBackupStore.setState({ status: 'failed', error: failureMessage(error) });
    return legacy !== null;
  }
}

export async function writeLocalBackupJSON(json: string): Promise<void> {
  if (!parseProject(json)) throw new Error('Local project data is invalid');
  const savedAt = new Date().toISOString();
  useLocalBackupStore.setState({ status: 'saving', error: null });
  try {
    await backend.write({ json, savedAt });
    useLocalBackupStore.setState({ status: 'saved', error: null, lastSavedAt: savedAt });
  } catch (error) {
    useLocalBackupStore.setState({ status: 'failed', error: failureMessage(error) });
    throw error;
  }
}

export async function deleteLocalBackup(): Promise<void> {
  try {
    await backend.clear();
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* legacy cleanup is best effort */ }
    useLocalBackupStore.setState({ status: 'idle', error: null, lastSavedAt: null });
  } catch (error) {
    useLocalBackupStore.setState({ status: 'failed', error: failureMessage(error) });
    throw error;
  }
}

export async function startLocalAutoSave(): Promise<void> {
  if (unsub) return;
  const generation = ++startGeneration;
  await loadFromLocal();
  if (generation !== startGeneration || unsub) return;
  unsub = useModelerStore.subscribe(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { void saveToLocal(); }, 1000);
  });
}

export function stopLocalAutoSave() {
  startGeneration++;
  if (unsub) { unsub(); unsub = null; }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
}

/** Test seam for deterministic quota, corruption, and migration coverage. */
export function setLocalBackupBackendForTests(replacement: LocalBackupBackend | null): void {
  backend = replacement ?? indexedDBBackend;
  consentRequested = false;
  useLocalBackupStore.setState({ status: 'idle', error: null, lastSavedAt: null });
}

// Tiny IndexedDB-backed cache of project thumbnails, keyed by externalId.
// Thumbnails are not fetched on the project list view; they appear once
// the user opens (or saves) a project, then persist locally.

const DB_NAME = 'sinter';
const DB_VERSION = 1;
const STORE = 'thumbnails';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getThumbnail(externalId: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(externalId);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putThumbnail(externalId: string, dataUrl: string | null): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (dataUrl == null) store.delete(externalId);
      else store.put(dataUrl, externalId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore — thumbnails are best-effort
  }
}

export async function deleteThumbnail(externalId: string): Promise<void> {
  return putThumbnail(externalId, null);
}

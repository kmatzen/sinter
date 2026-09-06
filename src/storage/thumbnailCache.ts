// Tiny IndexedDB-backed cache of project thumbnails, keyed by externalId.
// Thumbnails are not fetched on the project list view; they appear once
// the user opens (or saves) a project, then persist locally.

import { openBrowserDB, THUMBNAIL_STORE } from './browserDb';

export async function getThumbnail(externalId: string): Promise<string | null> {
  try {
    const db = await openBrowserDB();
    return new Promise((resolve) => {
      const tx = db.transaction(THUMBNAIL_STORE, 'readonly');
      const req = tx.objectStore(THUMBNAIL_STORE).get(externalId);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putThumbnail(externalId: string, dataUrl: string | null): Promise<void> {
  try {
    const db = await openBrowserDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(THUMBNAIL_STORE, 'readwrite');
      const store = tx.objectStore(THUMBNAIL_STORE);
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

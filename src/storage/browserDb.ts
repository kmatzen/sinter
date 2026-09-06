const DB_NAME = 'sinter';
const DB_VERSION = 2;

export const THUMBNAIL_STORE = 'thumbnails';
export const LOCAL_BACKUP_STORE = 'local-backups';

let dbPromise: Promise<IDBDatabase> | null = null;

/** One shared connection keeps every IndexedDB user on the same schema version. */
export function openBrowserDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THUMBNAIL_STORE)) db.createObjectStore(THUMBNAIL_STORE);
      if (!db.objectStoreNames.contains(LOCAL_BACKUP_STORE)) db.createObjectStore(LOCAL_BACKUP_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open browser storage'));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Browser storage upgrade is blocked by another Sinter tab'));
    };
  });
  return dbPromise;
}

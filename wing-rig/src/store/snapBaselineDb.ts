import type { ConsoleBaselineRecord } from '../schema/patch';

// Strict applet isolation: IndexedDB name prefixed with "wing-rig:"
const DB_NAME = 'wing-rig:snapshots:v1';
const DB_VERSION = 1;
const STORE_NAME = 'baselines';

function openBaselineDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'consoleNodeId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadAllBaselines(): Promise<Record<string, ConsoleBaselineRecord>> {
  const db = await openBaselineDb();
  if (!db) return {};
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const map: Record<string, ConsoleBaselineRecord> = {};
        const items = (req.result as ConsoleBaselineRecord[] | undefined) ?? [];
        for (const item of items) {
          if (item && item.consoleNodeId && typeof item.rawJson === 'string') {
            map[item.consoleNodeId] = item;
          }
        }
        resolve(map);
      };
      req.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  });
}

export async function saveBaselineRecord(record: ConsoleBaselineRecord): Promise<void> {
  const db = await openBaselineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteBaselineRecord(consoleNodeId: string): Promise<void> {
  const db = await openBaselineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(consoleNodeId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAllBaselines(): Promise<void> {
  const db = await openBaselineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

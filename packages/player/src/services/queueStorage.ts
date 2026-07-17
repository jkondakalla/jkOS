// services/queueStorage.ts — durable persistence for the offline write queue.
//
// Two implementations of one tiny interface:
//   - idbQueueStorage(dbName)  — IndexedDB, one 'writes' object store keyed by
//     `${collection}|${key}` (so coalescing is a plain overwrite-put). The DB is
//     the QUEUE'S OWN (an app passes its own name, e.g. papyros's
//     'papyros-write-queue') — deliberately NOT a new store inside an app's
//     existing offline DB, so adopting the queue never forces a version bump /
//     onupgradeneeded migration on an app's live cache bookkeeping.
//   - memoryQueueStorage()     — a Map; the SSR / private-mode / test fallback.
//     Writes queued in a context without IndexedDB survive the SESSION (replay on
//     reconnect still works) but not a reload — same graceful degradation as the
//     7.1 offline cache (offlineSupported() → feature-gate, never throw).
//
// The runtime (createWriteQueue.ts) persists on every queue mutation: put() after
// an enqueue/coalesce, remove() after a replay/cancel — the queue is never
// serialized wholesale.

import type { QueuedWrite } from './writeQueue';

export interface QueueStorage {
  /** Every persisted entry, unordered (the runtime sorts by seq). */
  load(): Promise<QueuedWrite[]>;
  /** Insert-or-replace one entry (keyed by collection|key). */
  put(w: QueuedWrite): Promise<void>;
  /** Remove one entry. No-op when absent. */
  remove(collection: string, key: string): Promise<void>;
}

/** True when this context can persist the queue across reloads. */
export function queuePersistenceSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

/* ── In-memory fallback ─────────────────────────────────────────────────────── */

export function memoryQueueStorage(): QueueStorage {
  const map = new Map<string, QueuedWrite>();
  return {
    load: async () => [...map.values()],
    put: async (w) => { map.set(`${w.collection}|${w.key}`, w); },
    remove: async (collection, key) => { map.delete(`${collection}|${key}`); },
  };
}

/* ── IndexedDB ──────────────────────────────────────────────────────────────── */

const STORE = 'writes';
const DB_VERSION = 1;

/** The persisted row shape: the QueuedWrite plus its store key. */
interface StoredWrite extends QueuedWrite {
  ck: string;
}

export function idbQueueStorage(dbName: string): QueueStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'ck' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return dbPromise;
  }

  function reqDone<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function txDone(t: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    async load() {
      const db = await openDB();
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const rows = await reqDone(store.getAll() as IDBRequest<StoredWrite[]>);
      // Strip the store key back off — callers see plain QueuedWrites.
      return rows.map(({ ck: _ck, ...w }) => w);
    },
    async put(w) {
      const db = await openDB();
      const t = db.transaction(STORE, 'readwrite');
      const row: StoredWrite = { ...w, ck: `${w.collection}|${w.key}` };
      t.objectStore(STORE).put(row);
      return txDone(t);
    },
    async remove(collection, key) {
      const db = await openDB();
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete(`${collection}|${key}`);
      return txDone(t);
    },
  };
}

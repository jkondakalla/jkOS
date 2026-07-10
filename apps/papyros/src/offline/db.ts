// offline/db.ts — the IndexedDB bookkeeping layer (a thin promisified wrapper, no dep).
// Holds one `books` object store of OfflineBookRecord rows keyed by bookId. This module
// is the ONLY place that opens the DB; everything else (the reactive store, 7.2, 7.3)
// goes through these four functions so there is exactly one connection per tab.

import { OFFLINE_DB, OFFLINE_DB_VERSION, BOOKS_STORE, type OfflineBookRecord } from './constants';

/** True when this context can persist offline books at all (Cache API + IndexedDB). SSR,
 *  a private-mode lockout, or an insecure origin all fail this — callers degrade to a
 *  no-op (no badge, download disabled) rather than throwing. */
export function offlineSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof caches !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'bookId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // A close from another tab's version change shouldn't wedge this promise's connection.
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

/** Every offline book, newest-completed first. */
export async function getAllOfflineBooks(): Promise<OfflineBookRecord[]> {
  const db = await openDB();
  const store = db.transaction(BOOKS_STORE, 'readonly').objectStore(BOOKS_STORE);
  const rows = await reqDone(store.getAll() as IDBRequest<OfflineBookRecord[]>);
  return rows.sort((a, b) => b.completedAt - a.completedAt);
}

/** One offline book's record, or null when it isn't cached. */
export async function getOfflineBook(bookId: number): Promise<OfflineBookRecord | null> {
  const db = await openDB();
  const store = db.transaction(BOOKS_STORE, 'readonly').objectStore(BOOKS_STORE);
  const row = await reqDone(store.get(bookId) as IDBRequest<OfflineBookRecord | undefined>);
  return row ?? null;
}

/** Insert/replace a book's record (written only once its bytes are fully cached). */
export async function putOfflineBook(record: OfflineBookRecord): Promise<void> {
  const db = await openDB();
  const t = db.transaction(BOOKS_STORE, 'readwrite');
  t.objectStore(BOOKS_STORE).put(record);
  return txDone(t);
}

/** Remove a book's record (the caller purges its Cache API bytes separately). */
export async function deleteOfflineBook(bookId: number): Promise<void> {
  const db = await openDB();
  const t = db.transaction(BOOKS_STORE, 'readwrite');
  t.objectStore(BOOKS_STORE).delete(bookId);
  return txDone(t);
}

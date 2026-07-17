// offline/store.ts — the download pipeline + the ONE module-level reactive store that
// every card, the detail view, and the settings summary read through useSyncExternalStore.
//
// Why a singleton (not a hook that opens IndexedDB per component): a library grid mounts
// dozens of BookCards, each wanting an "available offline" badge. One shared store hydrates
// from IndexedDB once, keeps an in-memory entry per book, and notifies a single listener
// set; React bails out of re-rendering any card whose own entry reference didn't change,
// so N badges cost one DB read and one listener, not N of each.
//
// State machine per book:  none ──download──▶ downloading ──▶ available
//                                              │  ▲ (retry)      │ (remove)
//                                              ▼  │              ▼
//                                            error┘            none
//
// Foundations for later waves (this wave does NOT implement them):
//   7.2 (write queue) can subscribe here / read getAllOfflineBooks to know what's offline.
//   7.3 (SW media router) reads the SAME MEDIA_CACHE + OFFLINE_DB back out; nothing here
//        touches public/sw.js routing.

import { useCallback, useSyncExternalStore } from 'react';
import { authFetch } from '@jkos/auth-client';
import type { BookDetail } from '../api';
import {
  MEDIA_CACHE, type OfflineBookRecord,
  streamKey, coverKey, detailKey,
} from './constants';
import {
  offlineSupported, getAllOfflineBooks, putOfflineBook, deleteOfflineBook,
} from './db';

export type OfflinePhase = 'none' | 'downloading' | 'available' | 'error';

/** The live per-book status a component renders. Immutable — replaced (never mutated) on
 *  every change so useSyncExternalStore's Object.is check re-renders only the book that
 *  actually moved. */
export interface OfflineStatus {
  bookId: number;
  phase: OfflinePhase;
  /** Files fetched so far this run (== fileCount when available). */
  filesDone: number;
  /** Total files in the book (0 until a download starts / a record is known). */
  filesTotal: number;
  /** Bytes cached so far this run / total when available. */
  bytes: number;
  /** Present only when phase === 'available'. */
  record: OfflineBookRecord | null;
  /** Present only when phase === 'error'. */
  error?: string;
}

// Shared stable sentinel for any book with no state — one reference for all "none" books
// so getSnapshot returns a referentially-stable value and those cards never re-render.
const NONE: OfflineStatus = Object.freeze({
  bookId: -1, phase: 'none', filesDone: 0, filesTotal: 0, bytes: 0, record: null,
});

const entries = new Map<number, OfflineStatus>();
const listeners = new Set<() => void>();
const aborters = new Map<number, AbortController>();

// Cached array snapshot for useOfflineLibrary — rebuilt only when the AVAILABLE set
// changes (not on every progress tick), so the settings list doesn't churn mid-download.
let librarySnapshot: OfflineBookRecord[] = [];

function rebuildLibrary(): void {
  librarySnapshot = [...entries.values()]
    .filter((e) => e.phase === 'available' && e.record)
    .map((e) => e.record as OfflineBookRecord)
    .sort((a, b) => b.completedAt - a.completedAt);
}

function emit(): void {
  for (const l of listeners) l();
}

/** Replace a book's entry and notify. `rebuild` when availability membership changed. */
function setEntry(bookId: number, status: OfflineStatus, rebuild = false): void {
  entries.set(bookId, status);
  if (rebuild) rebuildLibrary();
  emit();
}

function clearEntry(bookId: number, rebuild = false): void {
  entries.delete(bookId);
  if (rebuild) rebuildLibrary();
  emit();
}

// ── Hydration ────────────────────────────────────────────────────────────────────
// Fill the store from IndexedDB once, on first subscribe. Guarded so React StrictMode's
// double-subscribe (and every extra card) share the single load.

let hydrated = false;
let hydrating: Promise<void> | null = null;

function ensureHydrated(): void {
  if (hydrated || hydrating || !offlineSupported()) return;
  hydrating = getAllOfflineBooks()
    .then((rows) => {
      for (const r of rows) {
        // Don't clobber a book that's mid-download in this session.
        if (entries.get(r.bookId)?.phase === 'downloading') continue;
        entries.set(r.bookId, {
          bookId: r.bookId, phase: 'available',
          filesDone: r.fileCount, filesTotal: r.fileCount,
          bytes: r.bytes, record: r,
        });
      }
      hydrated = true;
      rebuildLibrary();
      emit();
    })
    .catch(() => { hydrated = true; })
    .finally(() => { hydrating = null; });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureHydrated();
  return () => { listeners.delete(listener); };
}

function getStatus(bookId: number): OfflineStatus {
  return entries.get(bookId) ?? NONE;
}

// ── Download pipeline ──────────────────────────────────────────────────────────────

function contentLength(resp: Response): number {
  const n = Number(resp.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Delete every Cache API entry for a book (audio files + detail + optional cover). */
async function purgeBookCache(bookId: number, fileIndexes: number[], hasCover: boolean): Promise<void> {
  const cache = await caches.open(MEDIA_CACHE);
  await Promise.all([
    cache.delete(detailKey(bookId)),
    hasCover ? cache.delete(coverKey(bookId)) : Promise.resolve(false),
    ...fileIndexes.map((i) => cache.delete(streamKey(bookId, i))),
  ]);
}

/**
 * Download every file of `book` into the Cache API, then record it offline. Sequential,
 * resume-safe (skips files already cached from a prior interrupted run), cancellable, and
 * atomic at the book level: the OfflineBookRecord — the thing that makes a book "available
 * offline" — is written ONLY after every file + the detail JSON are cached. A failed file
 * leaves the entry in `error` with the partial bytes intact so a retry resumes cheaply.
 *
 * No-op if the book is already downloading or available. Rejects only when offline is
 * unsupported; every other failure is surfaced through the store's `error` phase.
 */
export async function downloadBook(book: BookDetail): Promise<void> {
  const id = book.id;
  if (!offlineSupported()) {
    setEntry(id, { bookId: id, phase: 'error', filesDone: 0, filesTotal: book.files.length, bytes: 0, record: null, error: 'Offline storage unavailable in this browser.' });
    return;
  }
  const current = entries.get(id);
  if (current && (current.phase === 'downloading' || current.phase === 'available')) return;

  const ac = new AbortController();
  aborters.set(id, ac);

  const sortedFiles = [...book.files].sort((a, b) => a.index - b.index);
  const total = sortedFiles.length;
  setEntry(id, { bookId: id, phase: 'downloading', filesDone: 0, filesTotal: total, bytes: 0, record: null });

  let bytes = 0;
  let done = 0;
  const tick = () => setEntry(id, { bookId: id, phase: 'downloading', filesDone: done, filesTotal: total, bytes, record: null });

  try {
    const cache = await caches.open(MEDIA_CACHE);

    // 1. Audio files — the mandatory bytes. A no-Range GET returns 200 + the whole file.
    for (const f of sortedFiles) {
      if (ac.signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const key = streamKey(id, f.index);
      const already = await cache.match(key);
      if (already) {
        bytes += contentLength(already);
        done += 1;
        tick();
        continue;
      }
      const resp = await authFetch(key, { signal: ac.signal });
      if (!resp.ok) throw new Error(`stream ${id}/${f.index} → HTTP ${resp.status}`);
      await cache.put(key, resp.clone());
      bytes += contentLength(resp);
      done += 1;
      tick();
    }

    // 2. Cover — best-effort. A book with cover_path but a 404 cover (or an offline blip
    //    on the cover request while the audio was already cached) stays available; the UI
    //    already renders a placeholder for a missing cover.
    let coverCached = false;
    if (book.cover_path) {
      if (ac.signal.aborted) throw new DOMException('cancelled', 'AbortError');
      try {
        const resp = await authFetch(coverKey(id), { signal: ac.signal });
        if (resp.ok) {
          await cache.put(coverKey(id), resp.clone());
          bytes += contentLength(resp);
          coverCached = true;
        }
      } catch (err) {
        if (ac.signal.aborted) throw err;
        // swallow a non-abort cover failure — audio + detail are what matter
      }
    }

    // 3. Detail JSON — cached LAST (right before the record) so a cache-present detail
    //    entry lines up with an IndexedDB-present record. Built from the object we already
    //    hold; no extra round-trip. This is what a 7.3 SW serves for GET /api/book/:id.
    if (ac.signal.aborted) throw new DOMException('cancelled', 'AbortError');
    const detailBody = JSON.stringify(book);
    await cache.put(detailKey(id), new Response(detailBody, { headers: { 'Content-Type': 'application/json' } }));
    bytes += new Blob([detailBody]).size;

    const record: OfflineBookRecord = {
      bookId: id,
      title: book.title,
      author: book.author,
      fileCount: total,
      files: sortedFiles.map((f) => f.index),
      bytes,
      coverCached,
      completedAt: Date.now(),
    };
    await putOfflineBook(record);
    aborters.delete(id);
    setEntry(id, { bookId: id, phase: 'available', filesDone: total, filesTotal: total, bytes, record }, true);
  } catch (err) {
    aborters.delete(id);
    if (ac.signal.aborted) {
      // Explicit cancel: purge partial bytes (the user said stop) and drop the entry.
      await purgeBookCache(id, sortedFiles.map((f) => f.index), !!book.cover_path).catch(() => {});
      clearEntry(id);
      return;
    }
    // Network/HTTP failure: keep partial bytes so a retry resumes, surface the error.
    setEntry(id, { bookId: id, phase: 'error', filesDone: done, filesTotal: total, bytes, record: null, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Cancel an in-flight download (aborts the fetch; the pipeline purges its partials). */
export function cancelDownload(bookId: number): void {
  aborters.get(bookId)?.abort();
}

/** Remove a downloaded book: purge its Cache API bytes and its bookkeeping row. */
export async function removeDownload(bookId: number): Promise<void> {
  cancelDownload(bookId);
  const record = entries.get(bookId)?.record;
  const fileIndexes = record?.files ?? [];
  const hasCover = record?.coverCached ?? true; // unknown → attempt the cover key too
  if (offlineSupported()) {
    await purgeBookCache(bookId, fileIndexes, hasCover).catch(() => {});
  }
  await deleteOfflineBook(bookId).catch(() => {});
  clearEntry(bookId, true);
}

// ── Storage estimate ────────────────────────────────────────────────────────────────

export interface StorageEstimate {
  usage: number;
  quota: number;
  /** usage/quota as a 0–1 fraction (0 when quota is unknown). */
  ratio: number;
}

/** navigator.storage.estimate(), feature-detected. Null when the API is unavailable. */
export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
  } catch {
    return null;
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────────

/** Live offline status for one book. Shares the single store — safe to call from every
 *  card in a grid. */
export function useOfflineStatus(bookId: number): OfflineStatus {
  const getSnapshot = useCallback(() => getStatus(bookId), [bookId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The list of downloaded books (newest first) for the settings summary / eviction UI. */
export function useOfflineLibrary(): OfflineBookRecord[] {
  return useSyncExternalStore(subscribe, () => librarySnapshot, () => librarySnapshot);
}

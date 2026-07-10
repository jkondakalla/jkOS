// offline/constants.ts — the single source for every string the offline media cache
// stands on. Wave 7.3 (the service-worker media router) reads media bytes back out of
// this SAME cache and reconstructs a book's cache keys from these SAME helpers, so the
// names below are a wire contract shared across the app bundle AND public/sw.js — treat
// them as load-bearing (bump a version rather than silently rename one).
//
//   MEDIA_CACHE        Cache API bucket holding the actual bytes: one entry per file
//                      (keyed by its /api/stream URL), one per cover, one per detail JSON.
//   OFFLINE_DB         IndexedDB database holding book-level BOOKKEEPING only (never
//                      bytes) — which books are FULLY cached, their size + timestamp.
//   BOOKS_STORE        the one object store in that DB, keyed by numeric bookId.
//
// Bytes live in the Cache API (streams straight to disk, Range-servable by 7.3);
// bookkeeping lives in IndexedDB (cheap to query for badges without touching the bytes).

import { streamUrl, coverUrl, bookDetailUrl } from '../api';

/** Cache API bucket for media bytes. Kept distinct from the app-shell cache
 *  (`papyros-shell-*`, public/sw.js) so shell eviction never drops a downloaded book
 *  and a book removal never touches the shell. */
export const MEDIA_CACHE = 'papyros-media-v1'   /* MUST match public/sw.js's MEDIA_CACHE literal (7.3) — the SW can't import this module */;

/** IndexedDB database name for offline bookkeeping. */
export const OFFLINE_DB = 'papyros-offline';

/** IndexedDB schema version. Bump + handle in `onupgradeneeded` (offline/db.ts) on any
 *  store/keyPath change. */
export const OFFLINE_DB_VERSION = 1;

/** The one object store in OFFLINE_DB. keyPath = 'bookId' (number). */
export const BOOKS_STORE = 'books';

/** One row of offline bookkeeping. Written ONLY when a book is fully cached (all files +
 *  detail JSON, plus its cover when it has one) — its mere presence is what "available
 *  offline" means. 7.2 (write queue) and 7.3 (SW media router) both read this shape. */
export interface OfflineBookRecord {
  /** Primary key — the catalog book id. */
  bookId: number;
  title: string;
  author: string | null;
  /** Number of audio files in the book (== files.length). */
  fileCount: number;
  /** The fileIndexes cached (every file in the book, since a record is written only when
   *  complete). Lets a consumer rebuild each stream cache key without the detail JSON. */
  files: number[];
  /** Total bytes cached for this book (audio files + cover + detail JSON), from each
   *  response's Content-Length. */
  bytes: number;
  /** Whether the cover art is cached (false when the book has no cover, or its cover
   *  404s — audio + detail are mandatory for "available", the cover is best-effort). */
  coverCached: boolean;
  /** Epoch ms the download completed. */
  completedAt: number;
}

// ── Cache-key helpers ──────────────────────────────────────────────────────────────
// Every media entry is keyed by the EXACT URL the app already requests (api.ts owns
// that construction), so 7.3's SW can serve a cached response with `cache.match(request)`
// against the audio element's own request URL, and eviction can delete by the same key.

/** Cache key for one audio file (== the URL the player streams from). */
export function streamKey(bookId: number, fileIndex: number): string {
  return streamUrl(bookId, fileIndex);
}

/** Cache key for a book's cover art. */
export function coverKey(bookId: number): string {
  return coverUrl(bookId);
}

/** Cache key for a book's detail JSON (files/chapters manifest the player needs offline). */
export function detailKey(bookId: number): string {
  return bookDetailUrl(bookId);
}

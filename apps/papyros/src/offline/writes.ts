// offline/writes.ts — PapyrOS's offline WRITE QUEUE wiring (Wave 7.2 / git history
// item 16.5). The generic queue lives in @jkos/player/services (createWriteQueue —
// coalescing, durable IndexedDB persistence, ?since= reconciliation with
// last-write-wins on updated_at, serialized replay); this module is consumer #1:
// the papyros ADAPTER (how a queued write maps onto the progress/bookmarks
// defineCollection routes) plus wrappers that give ../api.ts's progress/bookmark
// write functions offline behavior WITHOUT changing their signatures.
//
// Wiring shape (cycle-free by construction): ../api.ts calls initOfflineWrites()
// with its DIRECT implementations (plain authFetch calls) and re-exports the
// wrapped functions under the original names. This module imports NOTHING from
// ../api at runtime (type-only imports erase) and NOTHING from ./constants (which
// imports ../api), so api → writes is the only runtime edge.
//
// Online behavior is UNCHANGED: every wrapper tries the direct write first and
// returns its result untouched. The queue only takes over when the write fails
// because the network is down (navigator.onLine === false, or fetch itself threw
// — isOfflineFetchError); an HTTP-status failure (400/500/…) still throws to the
// caller exactly as before.
//
// Record identity + replay mapping (the adapter):
//   progress   ONE row per (user, book) → op 'upsert' keyed 'ref:<book_ref>' with
//              the FULL desired state (the engine sends the full field set every
//              write; partial patches merge on coalesce). Replay finds the row by
//              book_ref (GET /api/progress) and PATCHes it, else POSTs.
//              A patch to a not-yet-known row id ('id:<id>') replays as a PATCH.
//   bookmarks  creates are NEW records → op 'create' keyed 'tmp:<clientKey>' (LWW
//              never drops a create; a queued create UPDATEs merge in, a DELETE
//              cancels it outright). Updates/deletes of server rows key 'id:<id>'.
//
// Offline create/upsert calls resolve with a SYNTHETIC row (negative id) so the
// player engine keeps its normal choreography: progress uses id = -book_ref
// (deterministic — a later updateProgress(-book_ref, …) recovers the book), and
// the first online update through that synthetic id self-heals by returning the
// REAL server row for the engine to adopt.

import {
  createWriteQueue, isOfflineFetchError, permanentWriteError,
  parseServerTimestamp, toSqliteUtc,
  type QueuedWrite, type WriteQueue, type WriteQueueAdapter,
} from '@jkos/player/services';
import type { ProgressRow, BookmarkRow } from '../api';

/** The queue's own IndexedDB database — separate from OFFLINE_DB (constants.ts)
 *  so adopting the queue never bumps the 7.1 cache-bookkeeping schema version. */
export const WRITE_QUEUE_DB = 'papyros-write-queue';

type ProgressWrite = Partial<Omit<ProgressRow, 'id' | 'updated_at'>>;
type BookmarkWrite = Partial<Omit<BookmarkRow, 'id'>>;

/** The DIRECT (plain authFetch) implementations ../api.ts injects. */
export interface DirectWriteApi {
  listProgress(): Promise<ProgressRow[]>;
  createProgress(row: ProgressWrite): Promise<ProgressRow>;
  updateProgress(id: number, patch: ProgressWrite): Promise<ProgressRow>;
  deleteProgress(id: number): Promise<void>;
  createBookmark(row: BookmarkWrite): Promise<BookmarkRow>;
  updateBookmark(id: number, patch: BookmarkWrite): Promise<BookmarkRow>;
  deleteBookmark(id: number): Promise<void>;
  /** GET /api/<collection>?since=<cursor> — the defineCollection delta read
   *  (bare-array rows carrying updated_at). `since` is SQLite-format UTC. */
  fetchDelta(collection: 'progress' | 'bookmarks', since: string): Promise<Array<Record<string, unknown>>>;
}

/** What initOfflineWrites returns — same signatures ../api.ts exports today. */
export interface QueuedWriteApi {
  createProgress(row: ProgressWrite): Promise<ProgressRow>;
  updateProgress(id: number, patch: ProgressWrite): Promise<ProgressRow>;
  deleteProgress(id: number): Promise<void>;
  createBookmark(row: BookmarkWrite): Promise<BookmarkRow>;
  updateBookmark(id: number, patch: BookmarkWrite): Promise<BookmarkRow>;
  deleteBookmark(id: number): Promise<void>;
}

/* ── Key vocabulary ─────────────────────────────────────────────────────────── */

const refKey = (bookRef: number): string => `ref:${bookRef}`;
const idKey = (id: number): string => `id:${id}`;
const idFromKey = (key: string): number | null => {
  if (!key.startsWith('id:')) return null;
  const n = Number(key.slice(3));
  return Number.isFinite(n) ? n : null;
};

/* ── Offline classification ─────────────────────────────────────────────────── */

const browserOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

/** Re-throw a push failure with permanence resolved: a definitive server verdict
 *  (4xx except auth/timeout/rate-limit) drops the queued write; everything else
 *  (network, 5xx, 401/403 — a dead session heals after re-login) stays queued.
 *  Relies on ../api.ts's apiJson attaching `.status` to HTTP-error throws. */
function rethrowClassified(err: unknown): never {
  const status = (err as { status?: number } | null)?.status;
  if (
    typeof status === 'number' && status >= 400 && status < 500
    && status !== 401 && status !== 403 && status !== 408 && status !== 429
  ) {
    throw permanentWriteError(`queued write rejected by server (${status})`, err);
  }
  throw err;
}

/* ── Module state (one queue per tab, like offline/store.ts) ────────────────── */

let queue: WriteQueue | null = null;

/** The live write queue, or null before ../api.ts has initialized the layer.
 *  Exposed as the 7.2 seam (e.g. a later sync-status surface); most callers
 *  never need it — the wrapped api functions are the interface. */
export function getWriteQueue(): WriteQueue | null {
  return queue;
}

export function initOfflineWrites(direct: DirectWriteApi): QueuedWriteApi {
  /* ── The adapter: queued writes ⇄ the papyros collection routes ──────────── */
  const adapter: WriteQueueAdapter = {
    async push(w: QueuedWrite): Promise<void> {
      try {
        if (w.collection === 'progress') {
          if (w.op === 'delete') {
            const id = idFromKey(w.key);
            if (id === null) return;   // malformed/temp key — nothing to delete server-side
            await direct.deleteProgress(id);
          } else if (w.op === 'update') {
            const id = idFromKey(w.key);
            if (id === null) return;
            await direct.updateProgress(id, w.payload as ProgressWrite);
          } else {
            // upsert — find the (user, book) row by book_ref, PATCH it, else POST.
            const p = w.payload as ProgressWrite;
            const rows = await direct.listProgress();
            const existing = rows.find((r) => r.book_ref === p.book_ref);
            if (existing) await direct.updateProgress(existing.id, p);
            else await direct.createProgress(p);
          }
        } else if (w.collection === 'bookmarks') {
          if (w.op === 'create') {
            await direct.createBookmark(w.payload as BookmarkWrite);
          } else if (w.op === 'update') {
            const id = idFromKey(w.key);
            if (id === null) return;
            await direct.updateBookmark(id, w.payload as BookmarkWrite);
          } else {
            const id = idFromKey(w.key);
            if (id === null) return;
            await direct.deleteBookmark(id);
          }
        }
      } catch (err) {
        rethrowClassified(err);
      }
    },

    fetchSince(collection, sinceMs) {
      // 5s margin: the collections stamp updated_at at SECOND resolution
      // (datetime('now')), so back the cursor off to guarantee a same-second
      // server write is not lexically excluded. Extra rows are harmless — they
      // only widen the conflict map.
      const cursor = toSqliteUtc(Math.max(0, sinceMs - 5_000));
      return direct.fetchDelta(collection as 'progress' | 'bookmarks', cursor);
    },

    keysOf(collection, row) {
      const r = row as { id?: number; book_ref?: number };
      if (collection === 'progress') {
        const keys: string[] = [];
        if (typeof r.book_ref === 'number') keys.push(refKey(r.book_ref));
        if (typeof r.id === 'number') keys.push(idKey(r.id));
        return keys;
      }
      return typeof r.id === 'number' ? [idKey(r.id)] : [];
    },

    updatedAtOf(_collection, row) {
      return parseServerTimestamp(String((row as { updated_at?: string }).updated_at ?? ''));
    },
  };

  const q = createWriteQueue({ adapter, dbName: WRITE_QUEUE_DB });
  queue = q;
  void q.start();   // hydrate persisted writes + replay any backlog on startup

  /* ── Synthetic rows (what an offline create/upsert resolves with) ──────────── */

  const nowIso = (): string => new Date().toISOString();

  function syntheticProgress(bookRef: number, w: ProgressWrite): ProgressRow {
    return {
      id: -bookRef,   // deterministic: updateProgress(-bookRef, …) recovers the book
      book_ref: bookRef,
      position: w.position ?? 0,
      duration: w.duration ?? 0,
      finished: w.finished ?? false,
      last_played: w.last_played ?? nowIso(),
      updated_at: nowIso(),
    };
  }

  // Bookmarks have no natural key, so offline creates get a per-session unique
  // negative id mapped to the queue entry's temp key. (Persisted queued creates
  // from an EARLIER session replay fine — nothing holds their old ids.)
  const tmpKeyById = new Map<number, string>();
  let tmpCounter = 0;

  function newTmpBookmark(): { id: number; key: string } {
    tmpCounter += 1;
    const id = -(Date.now() + tmpCounter);
    const key = `tmp:${Date.now().toString(36)}-${tmpCounter.toString(36)}`;
    tmpKeyById.set(id, key);
    return { id, key };
  }

  function syntheticBookmark(id: number, w: BookmarkWrite): BookmarkRow {
    return {
      id,
      book_ref: w.book_ref ?? 0,
      position: w.position ?? 0,
      title: w.title ?? null,
      note: w.note ?? null,
    };
  }

  /* ── Progress wrappers ─────────────────────────────────────────────────────── */

  async function enqueueProgressUpsert(bookRef: number, w: ProgressWrite): Promise<ProgressRow> {
    await q.enqueue({
      collection: 'progress', key: refKey(bookRef), op: 'upsert',
      payload: { ...w, book_ref: bookRef } as Record<string, unknown>,
    });
    return syntheticProgress(bookRef, w);
  }

  async function createProgress(row: ProgressWrite): Promise<ProgressRow> {
    const bookRef = Number(row.book_ref);
    if (!Number.isFinite(bookRef)) return direct.createProgress(row);   // let the server 400 as today
    if (!browserOffline()) {
      try {
        const real = await direct.createProgress(row);
        void q.clearKey('progress', refKey(bookRef));   // a stale queued write must not replay over this
        return real;
      } catch (err) {
        if (!isOfflineFetchError(err)) throw err;
      }
    }
    return enqueueProgressUpsert(bookRef, row);
  }

  async function updateProgress(id: number, patch: ProgressWrite): Promise<ProgressRow> {
    const bookRef = typeof patch.book_ref === 'number' ? patch.book_ref : (id < 0 ? -id : null);

    if (id < 0) {
      // A synthetic row from an offline create. Online: resolve the REAL row
      // (find-by-book_ref → PATCH, else POST) and return it — the engine adopts
      // it and self-heals onto the direct path. Offline: keep coalescing.
      if (bookRef === null) return enqueueProgressUpsert(-id, patch);   // unreachable via the engine
      if (!browserOffline()) {
        try {
          const rows = await direct.listProgress();
          const existing = rows.find((r) => r.book_ref === bookRef);
          const real = existing
            ? await direct.updateProgress(existing.id, patch)
            : await direct.createProgress({ ...patch, book_ref: bookRef });
          void q.clearKey('progress', refKey(bookRef));
          return real;
        } catch (err) {
          if (!isOfflineFetchError(err)) throw err;
        }
      }
      return enqueueProgressUpsert(bookRef, patch);
    }

    if (!browserOffline()) {
      try {
        const real = await direct.updateProgress(id, patch);
        void q.clearKey('progress', idKey(id));
        if (bookRef !== null) void q.clearKey('progress', refKey(bookRef));
        return real;
      } catch (err) {
        if (!isOfflineFetchError(err)) throw err;
      }
    }
    if (bookRef !== null) return enqueueProgressUpsert(bookRef, patch);
    // book_ref unknown (a caller outside the engine's full-field recipe): queue a
    // plain PATCH by id. The synthetic echo lacks book_ref, so the engine would
    // not adopt it — harmless, the next tick re-queues through the same key.
    await q.enqueue({
      collection: 'progress', key: idKey(id), op: 'update',
      payload: patch as Record<string, unknown>,
    });
    return { id, book_ref: 0, position: 0, duration: 0, finished: false, last_played: nowIso(), ...patch, updated_at: nowIso() } as ProgressRow;
  }

  async function deleteProgress(id: number): Promise<void> {
    if (id < 0) {
      // Never reached the server — cancel the queued upsert and we're done.
      await q.clearKey('progress', refKey(-id));
      return;
    }
    if (!browserOffline()) {
      try {
        await direct.deleteProgress(id);
        void q.clearKey('progress', idKey(id));
        return;
      } catch (err) {
        if (!isOfflineFetchError(err)) throw err;
      }
    }
    await q.enqueue({ collection: 'progress', key: idKey(id), op: 'delete' });
  }

  /* ── Bookmark wrappers ─────────────────────────────────────────────────────── */

  async function createBookmark(row: BookmarkWrite): Promise<BookmarkRow> {
    if (!browserOffline()) {
      try {
        return await direct.createBookmark(row);
      } catch (err) {
        if (!isOfflineFetchError(err)) throw err;
      }
    }
    const { id, key } = newTmpBookmark();
    await q.enqueue({
      collection: 'bookmarks', key, op: 'create',
      payload: row as Record<string, unknown>,
    });
    return syntheticBookmark(id, row);
  }

  async function updateBookmark(id: number, patch: BookmarkWrite): Promise<BookmarkRow> {
    if (id < 0) {
      const key = tmpKeyById.get(id);
      if (key) {
        await q.enqueue({ collection: 'bookmarks', key, op: 'update', payload: patch as Record<string, unknown> });
        const live = q.pending().find((w) => w.collection === 'bookmarks' && w.key === key);
        return syntheticBookmark(id, (live?.payload ?? patch) as BookmarkWrite);
      }
      return syntheticBookmark(id, patch);   // unknown synthetic id (other session) — best-effort echo
    }
    if (!browserOffline()) {
      try {
        const real = await direct.updateBookmark(id, patch);
        void q.clearKey('bookmarks', idKey(id));
        return real;
      } catch (err) {
        if (!isOfflineFetchError(err)) throw err;
      }
    }
    await q.enqueue({ collection: 'bookmarks', key: idKey(id), op: 'update', payload: patch as Record<string, unknown> });
    return { id, book_ref: 0, position: 0, title: null, note: null, ...patch } as BookmarkRow;
  }

  async function deleteBookmark(id: number): Promise<void> {
    if (id < 0) {
      const key = tmpKeyById.get(id);
      if (key) {
        // Coalesce rule B: a delete CANCELS the still-queued create (net zero).
        await q.enqueue({ collection: 'bookmarks', key, op: 'delete' });
        tmpKeyById.delete(id);
      }
      return;
    }
    if (!browserOffline()) {
      try {
        await direct.deleteBookmark(id);
        void q.clearKey('bookmarks', idKey(id));
        return;
      } catch (err) {
        if (!isOfflineFetchError(err)) throw err;
      }
    }
    await q.enqueue({ collection: 'bookmarks', key: idKey(id), op: 'delete' });
  }

  return { createProgress, updateProgress, deleteProgress, createBookmark, updateBookmark, deleteBookmark };
}

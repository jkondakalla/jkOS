// services/createWriteQueue.ts — the offline write queue's RUNTIME (Layer 2,
// ToDo §3 item 16.5 / PapyrOS §2 7.2). Wraps the pure policies in ./writeQueue.ts
// with durable persistence (./queueStorage.ts), online/offline listeners, and the
// serialized replay loop. GENERIC by construction: it never imports from apps/* —
// an app hands it a small WriteQueueAdapter (how to push a write, how to fetch a
// collection's ?since= delta, how to read record identity + updated_at off a
// server row) and this module owns everything else. Papyros is consumer #1
// (apps/papyros/src/offline/writes.ts); the music and video players inherit it.
//
// Replay contract (each clause pinned by test/services.test.mjs):
//   - Serialized: one flush at a time, one push in flight, first-queued order.
//   - Reconciled: before pushing, each collection's ?since= delta (cursor = its
//     oldest queuedAt, adapter-formatted) is fetched once per flush; every queued
//     write is resolved via resolveWrite (LWW on updated_at) — server-newer rows
//     DROP the local write, everything else pushes.
//   - Partial-failure-safe: a transient push failure halts the flush and keeps
//     the failed write AND everything after it queued (a retry is scheduled); a
//     PERMANENT failure (adapter marks err.permanent — e.g. a 404 on a delete)
//     drops just that write and continues.
//   - Coalesce-during-flush-safe: a write re-coalesced while its snapshot was in
//     flight survives for the next flush (removeIfUnchanged).

import {
  type QueuedWrite, type WriteIntent,
  coalesceWrite, clearKey as clearKeyPure, removeIfUnchanged, planReplay,
  oldestQueuedAt, resolveWrite, nextSeq,
} from './writeQueue';
import {
  type QueueStorage, idbQueueStorage, memoryQueueStorage, queuePersistenceSupported,
} from './queueStorage';

export interface WriteQueueAdapter {
  /** Apply one queued write to the server. Throw to signal failure: a plain
   *  throw halts the flush and keeps the write queued (transient — network,
   *  5xx, auth); a throw whose error carries `permanent: true` (see
   *  permanentWriteError) drops the write and continues (the server has
   *  definitively rejected it — 400, 404-on-delete, …). */
  push(write: QueuedWrite): Promise<void>;
  /** The collection's ?since= delta: every row updated STRICTLY after `sinceMs`
   *  (client epoch ms — the adapter converts to the server's cursor format,
   *  applying any clock-resolution margin it needs). Bare-array rows, per the
   *  suite dataset contract. */
  fetchSince(collection: string, sinceMs: number): Promise<unknown[]>;
  /** Every queue key this server row answers to (matched against
   *  QueuedWrite.key — e.g. a papyros progress row is both 'ref:<book_ref>' and
   *  'id:<id>'). Temp ('tmp:') keys never match a server row, by construction. */
  keysOf(collection: string, row: unknown): string[];
  /** The row's updated_at as epoch ms (parseServerTimestamp does the format
   *  bridging). NaN is treated as "no conflict" (resolveWrite fails open). */
  updatedAtOf(collection: string, row: unknown): number;
}

export interface WriteQueueConfig {
  adapter: WriteQueueAdapter;
  /** IndexedDB database name for the queue's own DB (ignored when `storage` is
   *  given). Falls back to in-memory when IndexedDB is unavailable. */
  dbName?: string;
  /** Override persistence entirely (tests use memoryQueueStorage()). */
  storage?: QueueStorage;
  /** Connectivity probe — default navigator.onLine !== false (assume online
   *  when the API is missing, e.g. Node). */
  isOnline?: () => boolean;
  /** Clock — default Date.now. */
  now?: () => number;
  /** Delay before retrying after a transient replay failure. Default 30s. */
  retryDelayMs?: number;
}

export interface WriteQueue {
  /** Hydrate from storage, attach the window 'online' listener, and attempt an
   *  initial flush. Idempotent. */
  start(): Promise<void>;
  /** Detach listeners and cancel any pending retry. Queued writes stay persisted. */
  stop(): void;
  /** Coalesce one write intent into the queue (durably), then attempt a flush
   *  if online. Resolves once the intent is persisted — never waits on network. */
  enqueue(intent: WriteIntent): Promise<void>;
  /** Drop any queued write for (collection, key) — call after a DIRECT write for
   *  the record succeeds, so a stale queued write can never replay over it. */
  clearKey(collection: string, key: string): Promise<void>;
  /** Replay now (serialized; no-op when offline, empty, or already flushing). */
  flush(): Promise<void>;
  /** Snapshot of everything queued, in replay order. */
  pending(): QueuedWrite[];
  size(): number;
}

/** Mark an error as a PERMANENT push failure: the write is dropped (not retried). */
export function permanentWriteError(message: string, cause?: unknown): Error {
  const err = new Error(message) as Error & { permanent: true; cause?: unknown };
  err.permanent = true;
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** True when `err` looks like "the network is down" rather than a server verdict:
 *  the browser says we're offline, or fetch itself failed (TypeError — DNS,
 *  refused connection, airplane mode). An HTTP-status error is NOT offline. */
export function isOfflineFetchError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError;
}

const DEFAULT_DB = 'jkos-player-write-queue';
const DEFAULT_RETRY_MS = 30_000;

export function createWriteQueue(config: WriteQueueConfig): WriteQueue {
  const { adapter } = config;
  const now = config.now ?? (() => Date.now());
  const isOnline = config.isOnline
    ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_MS;
  const storage: QueueStorage = config.storage
    ?? (queuePersistenceSupported() ? idbQueueStorage(config.dbName ?? DEFAULT_DB) : memoryQueueStorage());

  let queue: QueuedWrite[] = [];
  let seqCounter = 1;
  let hydration: Promise<void> | null = null;
  let flushing: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let onlineListener: (() => void) | null = null;

  function hydrate(): Promise<void> {
    if (!hydration) {
      hydration = storage.load()
        .then((rows) => {
          // Persisted entries win storage order; live (pre-hydration) enqueues —
          // possible when enqueue() runs before start() — keep their later seqs.
          const live = queue;
          queue = planReplay(rows);
          seqCounter = nextSeq(queue);
          for (const w of live) {
            const r = coalesceWrite(queue, w, w.queuedAt, seqCounter);
            queue = r.queue;
            seqCounter = nextSeq(queue);
            if (r.entry) void storage.put(r.entry).catch(() => {});
          }
        })
        .catch(() => { /* unreadable storage → start empty; enqueues still persist */ });
    }
    return hydration;
  }

  function scheduleRetry(): void {
    if (retryTimer != null || !started) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, retryDelayMs);
  }

  async function runFlush(): Promise<void> {
    await hydrate();
    if (!isOnline() || queue.length === 0) return;

    const plan = planReplay(queue);

    // 1. Reconcile — one ?since= delta per collection with queued writes, cursor
    //    = that collection's oldest queuedAt. A delta fetch failing is transient:
    //    halt (keep everything) and retry later.
    const conflicts = new Map<string, number>();   // `${collection}|${key}` → newest server updated_at ms
    const collections = [...new Set(plan.map((w) => w.collection))];
    try {
      for (const collection of collections) {
        const since = oldestQueuedAt(queue, collection);
        if (since === null) continue;
        const rows = await adapter.fetchSince(collection, since);
        for (const row of rows) {
          const ts = adapter.updatedAtOf(collection, row);
          if (!Number.isFinite(ts)) continue;
          for (const key of adapter.keysOf(collection, row)) {
            const ck = `${collection}|${key}`;
            const prev = conflicts.get(ck);
            if (prev === undefined || ts > prev) conflicts.set(ck, ts);
          }
        }
      }
    } catch {
      scheduleRetry();
      return;
    }

    // Settle one snapshot as "done" (dropped or pushed): remove it from the live
    // queue UNLESS a newer intent was re-coalesced onto the key mid-flight, and
    // only erase the persisted row when the live entry really went away (a
    // re-coalesced entry was re-put by enqueue() and must survive).
    async function settle(snapshot: QueuedWrite): Promise<void> {
      queue = removeIfUnchanged(queue, snapshot);
      if (!queue.some((w) => w.collection === snapshot.collection && w.key === snapshot.key)) {
        await storage.remove(snapshot.collection, snapshot.key).catch(() => {});
      }
    }

    // 2. Replay — in order, one in flight, LWW-resolved per write.
    for (const snapshot of plan) {
      const serverMs = conflicts.get(`${snapshot.collection}|${snapshot.key}`) ?? null;
      if (resolveWrite(snapshot, serverMs) === 'drop') {
        await settle(snapshot);
        continue;
      }
      try {
        await adapter.push(snapshot);
        await settle(snapshot);
      } catch (err) {
        if ((err as { permanent?: boolean } | null)?.permanent === true) {
          await settle(snapshot);
          continue;
        }
        scheduleRetry();
        return;   // transient: keep this write + everything after it
      }
    }

    // Anything re-coalesced mid-flush is still queued — pick it up soon.
    if (queue.length > 0) scheduleRetry();
  }

  function flush(): Promise<void> {
    if (flushing) return flushing;
    flushing = runFlush().finally(() => { flushing = null; });
    return flushing;
  }

  return {
    async start() {
      if (started) return hydrate();
      started = true;
      if (typeof window !== 'undefined') {
        onlineListener = () => { void flush(); };
        window.addEventListener('online', onlineListener);
      }
      await hydrate();
      void flush();
    },

    stop() {
      started = false;
      if (onlineListener && typeof window !== 'undefined') {
        window.removeEventListener('online', onlineListener);
        onlineListener = null;
      }
      if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; }
    },

    async enqueue(intent) {
      await hydrate();
      const r = coalesceWrite(queue, intent, now(), seqCounter);
      queue = r.queue;
      seqCounter = nextSeq(queue);
      if (r.entry) await storage.put(r.entry).catch(() => {});
      else await storage.remove(intent.collection, intent.key).catch(() => {});
      if (isOnline()) void flush();
    },

    async clearKey(collection, key) {
      await hydrate();
      queue = clearKeyPure(queue, collection, key);
      await storage.remove(collection, key).catch(() => {});
    },

    async flush() { return flush(); },

    pending() { return planReplay(queue); },

    size() { return queue.length; },
  };
}

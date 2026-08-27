// services/writeQueue.ts — the PURE half of the offline write queue (Layer 2,
// git history: PLAYER_PARITY.md, retired — "services"; git history item 16.5 / PapyrOS §2 7.2).
//
// Everything in this file is a pure function over plain data — no DOM, no network,
// no IndexedDB, no React — so the queue's three load-bearing policies are unit-
// testable in Node exactly like core/timeline.ts:
//   1. COALESCING  (coalesceWrite)  — writes are keyed per (collection, record
//      identity); repeated progress ticks for the same book collapse to the latest
//      payload instead of replaying 500 stale position writes, and a delete cancels
//      a still-queued create outright (the record never existed server-side).
//   2. REPLAY ORDER (planReplay / removeIfUnchanged) — entries replay in the order
//      first queued (a coalesced entry keeps its ORIGINAL seq, so refreshing a
//      write's payload never reorders it past a later dependent write), and a
//      mid-replay re-coalesce is never lost (removeIfUnchanged only removes the
//      exact snapshot that was pushed).
//   3. LAST-WRITE-WINS (resolveWrite) — before replaying, the runtime fetches the
//      server's delta (?since=) and drops any queued write whose server row is
//      STRICTLY newer than the moment the write was queued; ties and unknowns push
//      (matching the suite delta contract's strict `>` and today's online clobber
//      semantics).
//
// The impure runtime around these lives in ./createWriteQueue.ts (IndexedDB
// persistence + online/offline listeners + the serialized flush loop).

/** How a queued write should be applied to the server on replay.
 *  - 'upsert'  full desired state for a record with a natural key (papyros
 *              progress: one row per (user, book) keyed by book_ref) — the adapter
 *              finds-or-creates on push.
 *  - 'create'  a brand-new record keyed by a CLIENT temp key (papyros bookmarks) —
 *              no server counterpart can exist, so LWW never drops it.
 *  - 'update'  a partial patch to an existing server record (keyed by server id).
 *  - 'delete'  remove an existing server record (keyed by server id). */
export type WriteOp = 'upsert' | 'create' | 'update' | 'delete';

/** What a caller hands to the queue: the record identity + the latest intent. */
export interface WriteIntent<P = Record<string, unknown>> {
  /** Collection id — matches the backend collection ('progress', 'bookmarks'). */
  collection: string;
  /** Record identity WITHIN the collection — the coalescing key. Conventions used
   *  by the papyros adapter: 'ref:<naturalKey>' (upsert), 'id:<serverId>'
   *  (update/delete), 'tmp:<clientKey>' (create). Opaque to this module. */
  key: string;
  op: WriteOp;
  payload?: P;
}

/** One durable queue entry. Immutable — coalescing returns replacements. */
export interface QueuedWrite<P = Record<string, unknown>> {
  collection: string;
  key: string;
  op: WriteOp;
  payload: P;
  /** Client epoch-ms of the LATEST coalesced intent — the LWW timestamp the
   *  server row's updated_at is compared against. */
  queuedAt: number;
  /** Stable replay position: assigned when the key FIRST enters the queue and
   *  preserved across coalescing, so replay order is first-queued order. */
  seq: number;
}

export type ReplayDecision = 'push' | 'drop';

const ckOf = (collection: string, key: string): string => `${collection}|${key}`;

function findIndex<P>(queue: readonly QueuedWrite<P>[], collection: string, key: string): number {
  const ck = ckOf(collection, key);
  for (let i = 0; i < queue.length; i++) {
    if (ckOf(queue[i].collection, queue[i].key) === ck) return i;
  }
  return -1;
}

/** The next seq a brand-new key should take: strictly above every live entry. */
export function nextSeq(queue: readonly QueuedWrite[]): number {
  let max = 0;
  for (const w of queue) if (w.seq > max) max = w.seq;
  return max + 1;
}

export interface CoalesceResult<P = Record<string, unknown>> {
  queue: QueuedWrite<P>[];
  /** The live entry for the intent's key after coalescing — null when the intent
   *  net-cancelled it (delete of a still-queued create). The runtime persists this
   *  (put when non-null, remove when null). */
  entry: QueuedWrite<P> | null;
}

/**
 * Fold one intent into the queue. Rules (each unit-tested by name):
 *   A. new key                          → append with a fresh seq.
 *   B. queued 'create' + 'delete'       → REMOVE the entry (net zero — the record
 *                                         never reached the server).
 *   C. anything else + 'delete'         → entry becomes a 'delete' (payload
 *                                         dropped), keeps its seq.
 *   D. queued 'create' + update/upsert  → stays a 'create', payload MERGED (the
 *                                         eventual POST carries the latest fields).
 *   E. queued 'delete' + non-delete     → replaced by the incoming intent (latest
 *                                         intent wins), keeps its seq.
 *   F. upsert/update + upsert/update    → payload MERGED; op stays/promotes to
 *                                         'upsert' when either side is one (an
 *                                         upsert payload is full state, so the
 *                                         merge is still full state).
 * In every non-remove case queuedAt advances to `queuedAt` (the coalesced entry's
 * LWW timestamp is the LATEST intent's moment).
 */
export function coalesceWrite<P extends Record<string, unknown>>(
  queue: readonly QueuedWrite<P>[],
  intent: WriteIntent<P>,
  queuedAt: number,
  seq?: number,
): CoalesceResult<P> {
  const payload = (intent.payload ?? {}) as P;
  const i = findIndex(queue, intent.collection, intent.key);

  if (i === -1) {
    // A — brand-new key.
    const entry: QueuedWrite<P> = {
      collection: intent.collection, key: intent.key, op: intent.op,
      payload, queuedAt, seq: seq ?? nextSeq(queue),
    };
    return { queue: [...queue, entry], entry };
  }

  const existing = queue[i];

  if (intent.op === 'delete') {
    if (existing.op === 'create') {
      // B — delete cancels a never-pushed create.
      return { queue: queue.filter((_, j) => j !== i), entry: null };
    }
    // C — the record's fate is now deletion.
    const entry: QueuedWrite<P> = { ...existing, op: 'delete', payload: {} as P, queuedAt };
    return { queue: queue.map((w, j) => (j === i ? entry : w)), entry };
  }

  let op: WriteOp;
  let merged: P;
  if (existing.op === 'create') {
    // D — still a create; fold the newer fields in.
    op = 'create';
    merged = { ...existing.payload, ...payload };
  } else if (existing.op === 'delete') {
    // E — latest intent wins over a queued delete.
    op = intent.op;
    merged = payload;
  } else {
    // F — upsert/update lattice.
    op = existing.op === 'upsert' || intent.op === 'upsert' ? 'upsert' : intent.op;
    merged = { ...existing.payload, ...payload };
  }
  const entry: QueuedWrite<P> = { ...existing, op, payload: merged, queuedAt };
  return { queue: queue.map((w, j) => (j === i ? entry : w)), entry };
}

/** Drop the entry for (collection, key) — the direct-write-success guard: once a
 *  DIRECT write for a record lands, any stale queued write for it must never
 *  replay over the fresher server state (strict-`>` LWW at second resolution
 *  cannot break a same-second tie, so this is removed explicitly). */
export function clearKey<P>(
  queue: readonly QueuedWrite<P>[], collection: string, key: string,
): QueuedWrite<P>[] {
  const i = findIndex(queue, collection, key);
  return i === -1 ? [...queue] : queue.filter((_, j) => j !== i);
}

/** Remove `snapshot` from the queue ONLY if the live entry is still byte-for-byte
 *  the one that was pushed (same seq AND same queuedAt). If a newer intent was
 *  coalesced onto the key while the push was in flight, the live entry survives
 *  for the next flush — the newer write is never lost. */
export function removeIfUnchanged<P>(
  queue: readonly QueuedWrite<P>[], snapshot: QueuedWrite<P>,
): QueuedWrite<P>[] {
  const i = findIndex(queue, snapshot.collection, snapshot.key);
  if (i === -1) return [...queue];
  const live = queue[i];
  if (live.seq !== snapshot.seq || live.queuedAt !== snapshot.queuedAt) return [...queue];
  return queue.filter((_, j) => j !== i);
}

/** The replay plan: every entry, in first-queued order (seq ascending). */
export function planReplay<P>(queue: readonly QueuedWrite<P>[]): QueuedWrite<P>[] {
  return [...queue].sort((a, b) => a.seq - b.seq);
}

/** The oldest queuedAt among a collection's entries — the reconnect ?since=
 *  cursor's basis (any server row updated after this moment could conflict with a
 *  queued write). Null when the collection has nothing queued. */
export function oldestQueuedAt(queue: readonly QueuedWrite[], collection: string): number | null {
  let min: number | null = null;
  for (const w of queue) {
    if (w.collection !== collection) continue;
    if (min === null || w.queuedAt < min) min = w.queuedAt;
  }
  return min;
}

/**
 * Last-write-wins on updated_at. `serverUpdatedAtMs` is the newest updated_at the
 * reconnect delta returned for this write's record (null/NaN when the record
 * didn't appear in the delta — i.e. the server hasn't touched it since the write
 * was queued).
 *   - 'create' writes always push: a temp-keyed record has no server counterpart,
 *     so there is nothing to lose a conflict to.
 *   - Otherwise: DROP iff the server row is STRICTLY newer than the queued write
 *     (server wrote after we did → the local write is stale). Ties and unknowns
 *     push — strict `>` mirrors the suite's ?since= delta contract, and pushing on
 *     a tie reproduces today's online behavior (the later writer clobbers).
 */
export function resolveWrite(
  write: Pick<QueuedWrite, 'op' | 'queuedAt'>,
  serverUpdatedAtMs: number | null,
): ReplayDecision {
  if (write.op === 'create') return 'push';
  if (serverUpdatedAtMs === null || !Number.isFinite(serverUpdatedAtMs)) return 'push';
  return serverUpdatedAtMs > write.queuedAt ? 'drop' : 'push';
}

/* ── Timestamp bridge ──────────────────────────────────────────────────────────
   The suite's collection rows stamp updated_at with SQLite's datetime('now') —
   "YYYY-MM-DD HH:MM:SS", UTC, SECOND resolution, no timezone marker — while
   BeigeBoard's items (BUG-6.1) carry ISO-millisecond stamps. Date.parse treats a
   space-separated stamp as LOCAL time (or rejects it), so parsing must be explicit
   or LWW silently skews by the client's UTC offset. */

const SQLITE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

/** Parse a server updated_at — SQLite "YYYY-MM-DD HH:MM:SS[.SSS]" (treated as
 *  UTC) or ISO-8601 with an explicit offset/Z — to epoch ms. NaN when
 *  unparseable (resolveWrite fails open to 'push' on NaN). */
export function parseServerTimestamp(s: string): number {
  if (typeof s !== 'string' || !s) return NaN;
  const m = SQLITE_RE.exec(s.trim());
  if (m) {
    const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  }
  // Anything else must carry its own timezone (Z or ±hh:mm) to be trustworthy.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s.trim())) return Date.parse(s);
  return NaN;
}

/** Epoch ms → SQLite-format UTC "YYYY-MM-DD HH:MM:SS" — the shape a ?since=
 *  cursor must take to compare lexically against datetime('now') stamps (an ISO
 *  'T' sorts ABOVE ' ' and would exclude every same-day row). Truncates to the
 *  second, matching the stored stamps' resolution. */
export function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

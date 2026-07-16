/**
 * weave/resumeCursor.ts — createResumeCursor, the debounced find-or-create upsert
 * (ToDo.md §3 Wave 16, item 16.4), extracted VERBATIM from
 * packages/player/src/engine/usePlayerEngine.ts's doWrite/scheduleWrite/flushNow —
 * that mechanism was [INVARIANT d], "serialized single-flight writes". Nothing here
 * is media-specific: it is "debounce a write against a per-key row, skip it when
 * nothing changed, serialize concurrent attempts, and guard a write that resolves
 * after its key has moved on" over ANY collection that supports find/create/update.
 *
 * Framework-free: no React, no DOM — the only platform dependency is setTimeout/
 * clearTimeout, so this runs identically in a browser or under plain Node (see
 * test/resumeCursor.mjs, which drives it exactly that way). usePlayerEngine.ts is
 * the first consumer (its write path now delegates here with zero behavior
 * change); ./useResumeCursor.ts is the React-hook face for any OTHER app that wants
 * the same debounced upsert over its own collection.
 *
 * [INVARIANT d] rules, preserved exactly:
 *  - 5000ms debounce window (default; caller-overridable), one timer at a time —
 *    schedule() mid-window is a no-op; the eventual write reads getSnapshot() FRESH,
 *    so it always uses the latest position regardless of when schedule() was called
 *  - skip-unchanged: floor(position) + finished compared to the last successful write
 *  - serialized single-flight: one write in flight; a write requested mid-flight is
 *    QUEUED (only the latest finished-flag survives — never a growing backlog)
 *  - find-or-create: no tracked row yet → store.create(); a tracked row → update()
 *  - OUTGOING-KEY GUARD: a write started for key K may resolve after the caller has
 *    moved on to key K'. getSnapshot() is called AGAIN after the store call resolves
 *    — if it now reports a different (or no) live key, the returned row is dropped
 *    rather than adopted. This is why the snapshot is a PULLED callback, not a value
 *    captured once at schedule()-time: the guard needs two reads of "what's live",
 *    one before the write and one after, and they must be free to disagree.
 *  - non-fatal failure: a thrown create/update is swallowed; the next tick's fresh
 *    snapshot (a newer position) retries — no error is ever thrown by this module
 *  - invalidateLastWritten(): forces the next write to persist even if position+
 *    finished still match the last write (the seek idiom: "same position, but the
 *    user just re-committed to it, so persist it now rather than waiting on skip")
 *  - flush triggers are NOT this module's concern: it owns no pause/visibility/
 *    beforeunload wiring. usePlayerEngine.ts keeps wiring its own (pause handler,
 *    visibilitychange, beforeunload — a "pause" event is player-specific); only
 *    useResumeCursor.ts additionally wires the DOM-generic visibility/beforeunload
 *    pair, since it IS a generic React consumer of this same core.
 */

/** The two fields a resume-cursor row must carry for the skip-unchanged check. */
export interface ResumeCursorRowLike {
  position: number;
  finished: boolean;
}

/** A neutral write the store maps onto its own column names. */
export interface ResumeCursorWrite<TId> {
  itemId: TId;
  position: number;
  duration: number;
  finished: boolean;
  /** ISO timestamp of this write. */
  playedAt: string;
}

/**
 * The find-or-create collection seam. Structurally identical to
 * packages/player/src/engine/types.ts's `ProgressStore<TProgress>` — that type can
 * be passed here unchanged (see usePlayerEngine.ts's migration onto this module).
 */
export interface ResumeCursorStore<TId, TRow extends ResumeCursorRowLike> {
  /** This caller's saved row for the key, or null. */
  find(itemId: TId): Promise<TRow | null>;
  create(write: ResumeCursorWrite<TId>): Promise<TRow>;
  /** Update the given row. The store owns the row's own id. */
  update(row: TRow, write: ResumeCursorWrite<TId>): Promise<TRow>;
  /** The key a returned row belongs to — the outgoing-key guard compares this
   *  against the LIVE key at completion time. */
  itemIdOf(row: TRow): TId;
}

/**
 * What the core needs to attempt (or skip) a write. PULLED fresh at every write
 * attempt — never cached across the debounce window by this module. Return null
 * when there's no live key to write for (the write becomes a no-op, mirroring the
 * engine's original `if (!it) return`).
 */
export type ResumeCursorSnapshot<TId> = {
  itemId: TId;
  position: number;
  duration: number;
} | null;

export interface ResumeCursorOptions {
  /** Debounce window in ms. Default 5000 (the player's original constant). */
  debounceMs?: number;
}

export interface ResumeCursor<TRow> {
  /** Arm the debounce timer if one isn't already running (one window at a time —
   *  a call mid-window is a no-op). */
  schedule(): void;
  /** Cancel any pending timer and attempt a write right now. `finished` defaults to
   *  false (mirrors the original flushNow()); pass true for an explicit
   *  end-of-item write (mirrors the original onEnded's direct doWrite(true)). */
  flush(finished?: boolean): void;
  /** Clear the tracked row + last-written memory — call when the caller is about to
   *  resolve a DIFFERENT key's saved row, before that lookup resolves. */
  resetItem(): void;
  /** Adopt an externally-resolved row (e.g. from the caller's own find(key) lookup)
   *  as the row future writes UPDATE instead of CREATE. Does not touch
   *  last-written memory. */
  setRow(row: TRow | null): void;
  /** Force the next write to persist even if position+finished still match the
   *  last write (the seek idiom). */
  invalidateLastWritten(): void;
  /** Cancel any pending timer without writing (unmount / teardown). */
  dispose(): void;
}

/**
 * Build one resume-cursor instance. Construct ONCE per (store, key-space) — e.g.
 * once per mounted player, once per hook instance — and reuse it; it owns closures
 * over its own row/timer/in-flight state, not a value type.
 *
 * `getSnapshot` is called fresh at EVERY write attempt (schedule fire, flush, and
 * the queued-retry tail-call) and AGAIN after the store call resolves, for the
 * outgoing-key guard — never memoized by this module. See the header comment for
 * why the pull has to be live rather than a value captured once.
 */
export function createResumeCursor<TId, TRow extends ResumeCursorRowLike>(
  store: ResumeCursorStore<TId, TRow>,
  getSnapshot: () => ResumeCursorSnapshot<TId>,
  opts: ResumeCursorOptions = {},
): ResumeCursor<TRow> {
  const debounceMs = opts.debounceMs ?? 5000;

  let row: TRow | null = null;
  let timer: number | null = null;
  let inFlight = false;
  let queued: boolean | null = null;   // latest queued finished-flag
  let lastWritten: { pos: number; finished: boolean } | null = null;

  // ---- The upsert — [INVARIANT d] serialized single-flight, skip-unchanged -----
  async function doWrite(finished: boolean): Promise<void> {
    const snap = getSnapshot();
    if (!snap) return;
    const posInt = Math.floor(snap.position);
    if (lastWritten && lastWritten.pos === posInt && lastWritten.finished === finished) return;   // unchanged
    if (inFlight) { queued = finished; return; }   // one in flight
    inFlight = true;
    const write: ResumeCursorWrite<TId> = {
      itemId: snap.itemId, position: snap.position, duration: snap.duration, finished,
      playedAt: new Date().toISOString(),
    };
    try {
      const written = row ? await store.update(row, write) : await store.create(write);
      // Guard against a late write for the OUTGOING key (a swap can start while this
      // one is in flight): only adopt the row/cursor if it's still the live key.
      const post = getSnapshot();
      if (post && post.itemId === store.itemIdOf(written)) {
        row = written;
        lastWritten = { pos: posInt, finished };
      }
    } catch {
      /* non-fatal — a later tick retries with the newer position */
    } finally {
      inFlight = false;
    }
    const q = queued;
    if (q != null) { queued = null; void doWrite(q); }
  }

  function schedule(): void {
    if (timer != null) return;   // one debounce window at a time
    timer = setTimeout(() => { timer = null; void doWrite(false); }, debounceMs) as unknown as number;
  }

  function flush(finished = false): void {
    if (timer != null) { clearTimeout(timer); timer = null; }
    void doWrite(finished);
  }

  function resetItem(): void {
    row = null;
    lastWritten = null;
  }

  function setRow(r: TRow | null): void {
    row = r;
  }

  function invalidateLastWritten(): void {
    lastWritten = null;
  }

  function dispose(): void {
    if (timer != null) { clearTimeout(timer); timer = null; }
  }

  return { schedule, flush, resetItem, setRow, invalidateLastWritten, dispose };
}

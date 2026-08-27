// player/queuePrefs.ts — small pure helpers the adapter (usePlayerEngine.ts) composes
// around @jkos/player/core's Queue (git history: Wave 18 item 18.4). Two things live
// here that the primitive itself does NOT provide (see this wave's report for why —
// git history: PLAYER_PARITY.md, retired's queue-composition verdict):
//
//  1. Shuffle/repeat PERSISTENCE. core/queue's reducers are pure state transforms —
//     by design they never touch localStorage (unlike engine/rate.ts's
//     readPersistedRate/persistRate, which DO own persistence for the rate axis).
//     `kouros.player.queue` is this app's own key, holding just the two user-facing
//     toggles ({shuffle, repeat}) — never the shuffleOrder/seed, which is a
//     within-session derived value the adapter recomputes via the real `shuffle()`
//     reducer whenever it builds a queue.
//
//  2. `removeAt` — @jkos/player/core/queue ships `next`/`prev`/`shuffle`/`repeat`/
//     `reorder`/`insertNext`/`append` but NO removal reducer, even though
//     @jkos/player/ui's <QueuePanel> takes an `onRemove` prop expecting one. This is
//     a real gap (flagged in the wave report, not fixed here per the file-ownership
//     rule — packages/player is under a zero-behavior-change contract for papyros).
//     `removeAt` below mirrors `reorder`'s cursor-preservation shape (the only public
//     reducer that already has to reason about "an index vanished/shifted under the
//     cursor") and re-normalizes shuffleOrder via the PUBLIC `shuffle()` reducer
//     (never the module-private `resyncShuffle`) so the items.length ===
//     shuffleOrder.length invariant documented in queue.ts's header never breaks.
import { shuffle, type Queue, type RepeatMode } from '@jkos/player/core';
import { MAX_CROSSFADE_SEC } from '@jkos/player/backend';

const QUEUE_PREFS_KEY = 'kouros.player.queue';

export interface QueuePrefs {
  shuffle: boolean;
  repeat: RepeatMode;
  /** Crossfade seconds for the gaplessDual backend (18.5); 0 = gapless swap at the
   *  track boundary. Persisted alongside shuffle/repeat because it's the same class
   *  of standing user preference — a player-wide toggle, not per-queue state. */
  crossfadeSec: number;
}

const DEFAULT_PREFS: QueuePrefs = { shuffle: false, repeat: 'off', crossfadeSec: 0 };

/** Same clamp the backend applies (0..MAX_CROSSFADE_SEC, non-finite → 0) so a
 *  hand-edited/stale stored value can never smuggle an out-of-range fade in. */
export function clampCrossfadeSec(sec: unknown): number {
  const n = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0;
  return Math.min(MAX_CROSSFADE_SEC, Math.max(0, n));
}

export function readQueuePrefs(): QueuePrefs {
  try {
    const raw = localStorage.getItem(QUEUE_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<QueuePrefs>;
    const repeat: RepeatMode = parsed.repeat === 'all' || parsed.repeat === 'one' ? parsed.repeat : 'off';
    return { shuffle: !!parsed.shuffle, repeat, crossfadeSec: clampCrossfadeSec(parsed.crossfadeSec) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeQueuePrefs(prefs: QueuePrefs): void {
  try {
    localStorage.setItem(QUEUE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — non-fatal, session-only */
  }
}

/** Same canonical-order item-list comparison the adapter's transport.subscribe uses
 *  to decide "is this the SAME queue, just a cursor move" vs "a genuinely new list". */
export function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Remove the item at canonical index `index`. Cursor handling mirrors `reorder`'s
 *  three cases (before / at / after the cursor) collapsed to a deletion:
 *   - index < cursor  → cursor shifts back one (an earlier item vanished under it)
 *   - index === cursor → cursor stays AT this canonical slot, now pointing at
 *     whatever shifted into it (the next item) — the currently-loaded/playing track
 *     itself is untouched (removing from the queue never interrupts playback; see
 *     usePlayerEngine.ts's removeQueueItem)
 *   - index > cursor  → cursor unchanged
 *  Out-of-range indices return the queue unchanged, matching reorder's own guard. */
export function removeAt(queue: Queue, index: number): Queue {
  const n = queue.items.length;
  if (index < 0 || index >= n) return { ...queue };

  const items = queue.items.filter((_, i) => i !== index);
  let cursor = queue.cursor;
  if (items.length === 0) {
    cursor = -1;
  } else if (index < cursor) {
    cursor -= 1;
  } else if (index === cursor) {
    cursor = Math.min(cursor, items.length - 1);
  }

  let next: Queue = { ...queue, items, cursor };
  if (next.policy.shuffle) next = shuffle(next, true, next.policy.shuffleSeed);
  return next;
}

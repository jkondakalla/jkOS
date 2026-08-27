// queue.ts — pure Queue reducers (Layer 0, git history — PLAYER_PARITY.md §1/§3, retired). A Queue is an
// ordered list of opaque item ids (a Timeline id, a track id, whatever the caller
// hands it — this module never looks inside one) plus a cursor and a policy
// (shuffle, repeat). No classes, no mutable state: every reducer takes a Queue and
// returns a NEW Queue.
//
// Design decisions load-bearing for callers (the engine layer consumes these next):
//
// - `cursor` is always an index into `items` in CANONICAL (insertion) order — never
//   into the shuffled order. Shuffle only changes how `next`/`prev` WALK the queue;
//   it never renumbers `items` or reinterprets `cursor`. That is what makes
//   "turning shuffle off restores canonical order while keeping the current item as
//   cursor" free: cursor never stopped meaning "canonical index".
// - Shuffle is a STABLE SEEDED permutation: `shuffle(queue, true, seed)` computes
//   `policy.shuffleOrder` once from `seed` via a deterministic PRNG (mulberry32, no
//   `Math.random`/wall-clock — this module stays pure). Calling `next`/`prev`
//   (skipping) never touches `shuffleOrder`; only a structural change to `items`
//   (`reorder`/`insertNext`/`append`) or an explicit re-`shuffle` call resyncs it.
// - `items.length === 0 <=> cursor === -1` is the empty-queue invariant every
//   reducer preserves.

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueuePolicy {
  shuffle: boolean;
  repeat: RepeatMode;
  /** Seed the current `shuffleOrder` permutation was derived from. Reused verbatim
   *  by `resyncShuffle` whenever `items` changes shape, so a queue mutation never
   *  re-rolls the shuffle either — only an explicit new seed does. */
  shuffleSeed: number;
  /** A permutation of `items` indices (length === items.length whenever `shuffle`
   *  is true). `next`/`prev` walk THIS array while shuffle is on. Empty while
   *  shuffle is off. */
  shuffleOrder: number[];
}

export interface Queue {
  /** Canonical (insertion) order. `cursor`, `reorder`, `insertNext`, and `append`
   *  all operate in this order — shuffle never touches it, only how `next`/`prev`
   *  traverse it. */
  items: string[];
  /** Index into `items` of the currently-playing entry, or -1 when the queue is
   *  empty. */
  cursor: number;
  policy: QueuePolicy;
}

const DEFAULT_SHUFFLE_SEED = 1;

export const EMPTY_QUEUE: Queue = {
  items: [],
  cursor: -1,
  policy: { shuffle: false, repeat: 'off', shuffleSeed: DEFAULT_SHUFFLE_SEED, shuffleOrder: [] },
};

/** Convenience constructor: builds a well-formed Queue (cursor at 0 iff non-empty)
 *  from a plain list of item ids, in canonical order. */
export function createQueue(items: string[], policy?: Partial<QueuePolicy>): Queue {
  return {
    items: [...items],
    cursor: items.length > 0 ? 0 : -1,
    policy: {
      shuffle: false,
      repeat: 'off',
      shuffleSeed: DEFAULT_SHUFFLE_SEED,
      shuffleOrder: [],
      ...policy,
    },
  };
}

/** mulberry32 — a tiny deterministic PRNG (no Math.random, no wall-clock: this
 *  module is pure). Same seed ⇒ same stream of numbers, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic Fisher-Yates permutation of `[0..n-1]` seeded by `seed`. This IS
 *  the "stable seeded order": called twice with the same `(n, seed)` it returns the
 *  same array, element-for-element. */
function seededPermutation(n: number, seed: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Recompute `shuffleOrder` for a new item count using the SAME seed, if shuffle is
 *  on. Used by the structural reducers (`reorder`/`insertNext`/`append`) so the
 *  invariant `shuffleOrder.length === items.length` never breaks — this is a
 *  RESYNC, not a re-roll: skipping (`next`/`prev`) never calls this. */
function resyncShuffle(policy: QueuePolicy, itemCount: number): QueuePolicy {
  if (!policy.shuffle) return policy;
  return { ...policy, shuffleOrder: seededPermutation(itemCount, policy.shuffleSeed) };
}

/** The canonical-index order `next`/`prev` walk: the shuffle permutation while
 *  shuffle is on (and valid for the current item count), else identity order. */
function walkOrder(queue: Queue): number[] {
  if (queue.policy.shuffle && queue.policy.shuffleOrder.length === queue.items.length) {
    return queue.policy.shuffleOrder;
  }
  return queue.items.map((_, i) => i);
}

/** Advance the cursor one step along the walk order.
 *  - Empty queue: no-op.
 *  - `repeat: 'one'`: no-op (restart the same item — the caller re-seeks to 0).
 *  - Mid-queue: steps to the next entry in walk order.
 *  - At the end: wraps to the first entry under `repeat: 'all'`, else stays put. */
export function next(queue: Queue): Queue {
  if (queue.items.length === 0) return { ...queue };
  if (queue.policy.repeat === 'one') return { ...queue };
  const order = walkOrder(queue);
  const at = Math.max(0, order.indexOf(queue.cursor));
  if (at + 1 < order.length) return { ...queue, cursor: order[at + 1] };
  if (queue.policy.repeat === 'all') return { ...queue, cursor: order[0] };
  return { ...queue };
}

/** Mirror of `next`: steps backward along the walk order, wraps to the LAST entry
 *  under `repeat: 'all'` at the start, else stays put. */
export function prev(queue: Queue): Queue {
  if (queue.items.length === 0) return { ...queue };
  if (queue.policy.repeat === 'one') return { ...queue };
  const order = walkOrder(queue);
  const at = Math.max(0, order.indexOf(queue.cursor));
  if (at - 1 >= 0) return { ...queue, cursor: order[at - 1] };
  if (queue.policy.repeat === 'all') return { ...queue, cursor: order[order.length - 1] };
  return { ...queue };
}

/** Turn shuffle on/off.
 *  - `on: false` — restores canonical order. `cursor` needs no translation (it was
 *    always a canonical index); only `policy.shuffle` flips.
 *  - `on: true` — computes `shuffleOrder` once from `seed` (falling back to the
 *    queue's last-known seed, then the module default, if omitted). Re-enabling
 *    with the SAME seed and an already-valid order is a no-op — it does not re-roll. */
export function shuffle(queue: Queue, on: boolean, seed?: number): Queue {
  if (!on) {
    return { ...queue, policy: { ...queue.policy, shuffle: false } };
  }
  const effectiveSeed = seed ?? queue.policy.shuffleSeed ?? DEFAULT_SHUFFLE_SEED;
  const alreadyStable =
    queue.policy.shuffle &&
    queue.policy.shuffleSeed === effectiveSeed &&
    queue.policy.shuffleOrder.length === queue.items.length;
  const shuffleOrder = alreadyStable
    ? queue.policy.shuffleOrder
    : seededPermutation(queue.items.length, effectiveSeed);
  return {
    ...queue,
    policy: { ...queue.policy, shuffle: true, shuffleSeed: effectiveSeed, shuffleOrder },
  };
}

/** Set the repeat policy. Doesn't touch items/cursor/shuffle. */
export function repeat(queue: Queue, mode: RepeatMode): Queue {
  return { ...queue, policy: { ...queue.policy, repeat: mode } };
}

/** Move the item at canonical index `from` to canonical index `to`, keeping
 *  `cursor` pointing at the SAME logical item through the move (the
 *  reorder-across-the-cursor case): if the moved item WAS the cursor, cursor
 *  follows it to `to`; otherwise cursor shifts by one only if the move passed over
 *  it. Out-of-range or no-op indices return the queue unchanged. */
export function reorder(queue: Queue, from: number, to: number): Queue {
  const n = queue.items.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return { ...queue };

  const items = [...queue.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);

  let cursor = queue.cursor;
  if (cursor === from) {
    cursor = to;
  } else if (from < cursor && cursor <= to) {
    cursor -= 1; // the moved item passed over `cursor` moving forward
  } else if (to <= cursor && cursor < from) {
    cursor += 1; // the moved item passed over `cursor` moving backward
  }

  return { ...queue, items, cursor, policy: resyncShuffle(queue.policy, n) };
}

/** Insert `id` to play immediately after the current item (canonical index
 *  `cursor + 1`) — or as the sole/first item if the queue was empty, becoming the
 *  cursor. Never shifts `cursor` when the queue was non-empty (insertion happens
 *  strictly after it). */
export function insertNext(queue: Queue, id: string): Queue {
  const wasEmpty = queue.items.length === 0;
  const items = [...queue.items];
  items.splice(wasEmpty ? 0 : queue.cursor + 1, 0, id);
  return {
    ...queue,
    items,
    cursor: wasEmpty ? 0 : queue.cursor,
    policy: resyncShuffle(queue.policy, items.length),
  };
}

/** Append `id` to the end of the canonical order — or as the sole item if the queue
 *  was empty, becoming the cursor. Never shifts `cursor` when the queue was
 *  non-empty. */
export function append(queue: Queue, id: string): Queue {
  const wasEmpty = queue.items.length === 0;
  const items = [...queue.items, id];
  return {
    ...queue,
    items,
    cursor: wasEmpty ? 0 : queue.cursor,
    policy: resyncShuffle(queue.policy, items.length),
  };
}

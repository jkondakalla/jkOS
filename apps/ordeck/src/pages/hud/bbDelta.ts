/**
 * bbDelta.ts — the delta-merge behind ORDECK's BeigeBoard poll (XC-3).
 *
 * ⚠️ Extracted into its own module for ONE reason: it is the part that can be
 * wrong in a way nothing would notice. A dropped row, a cursor that advances one
 * millisecond too far, a failed delta that empties the board — none of those throw,
 * and all of them look like "the dashboard is a bit stale". So it is pure: no React,
 * no fetch, no imports at all, and `pnpm check:hud` drives it directly.
 *
 * The poll it serves used to re-fetch BeigeBoard's WHOLE items table every 60
 * seconds, using none of the seven filters BeigeBoard declares and never the `since`
 * cursor — from the flagship consumer of a fabric whose premise is that an app's
 * declaration can be composed against.
 *
 * ⚠️ A DELTA CANNOT SEE A DELETE, and no cursor scheme can: `?since=` returns rows
 * whose `updated_at` moved, and a deleted row's simply is not there. BeigeBoard keeps
 * no tombstones, so completeness comes from periodically re-asking for everything —
 * which is what `full` is, and why the caller must force it on any invalidate.
 */

/** The subset of a BeigeBoard row this merge needs. Structural on purpose so the
 *  hook's richer BbItem satisfies it without this module importing that type. */
export interface DeltaRow {
  id: number;
  updated_at: string | null;
}

export interface BbCacheState<T extends DeltaRow> {
  byId: Map<number, T>;
  /** The newest `updated_at` the SERVER has returned, or null before the first
   *  full fetch. Never a local clock reading — see advanceCursor. */
  cursor: string | null;
  /** Polls since the last full resync. */
  sinceResync: number;
}

export function emptyCache<T extends DeltaRow>(): BbCacheState<T> {
  return { byId: new Map(), cursor: null, sinceResync: 0 };
}

/**
 * Should this fetch ask for everything?
 *
 * ⚠️ `!cursor` (no full fetch yet) is load-bearing beyond correctness: BeigeBoard's
 * lazy first-run seed is suppressed on a filtered read, so a brand-new account whose
 * very first request came from this poll with `?since=` would be handed an empty
 * board and never seeded.
 */
export function shouldResync(
  cache: BbCacheState<DeltaRow>,
  { forced = false, every = 3 }: { forced?: boolean; every?: number } = {},
): boolean {
  return forced || !cache.cursor || cache.sinceResync >= every;
}

/**
 * Fold a response into the cache. A FULL response replaces the map; a delta merges
 * over it. Returns the merged rows, newest state first-class.
 *
 * ⚠️ The cursor advances only to a stamp the SERVER sent, and only forward. Two
 * consequences worth stating: an EMPTY delta leaves it untouched (advancing past
 * rows written in the same instant would skip them forever), and a local clock is
 * never consulted (a few seconds of skew silently drops rows).
 *
 * ⚠️ The compare is a plain string `>` and that is only correct because every
 * `updated_at` in this suite is canonical millisecond ISO (XC-1). The two formats
 * that used to coexist sort against each other INCORRECTLY as strings, which is
 * exactly how a cursor silently returns the wrong window.
 */
export function mergeDelta<T extends DeltaRow>(
  cache: BbCacheState<T>,
  rows: T[],
  full: boolean,
): T[] {
  if (full) { cache.byId = new Map(); cache.sinceResync = 0; }
  else cache.sinceResync += 1;
  for (const row of rows) cache.byId.set(row.id, row);
  for (const row of rows) {
    if (row.updated_at && (!cache.cursor || row.updated_at > cache.cursor)) cache.cursor = row.updated_at;
  }
  return [...cache.byId.values()];
}

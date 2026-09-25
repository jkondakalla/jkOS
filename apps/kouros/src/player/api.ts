// player/api.ts — what the player adapter needs beyond ../api.ts's wire types and URL
// builders: an id-keyed cache over the `tracks` catalog (the controller seam carries only
// track ids) and the append-only history writer. It used to re-declare Track, HistoryRow,
// the fetch helper and both URL builders; those live once, in ../api.ts and ../http.ts.
import { useEffect, useState } from 'react';
import { JSON_HEADERS, apiJson } from '../http';
import type { HistoryRow, Track } from '../api';

// ─── Track catalog + a tiny id-keyed cache ──────────────────────────────────────────
// The backend's `tracks` dataset (apps/kouros/backend/src/routes/tracks.js) is a
// filtered LIST route only — title/artist/album/genre/since, no `id` filter, no
// GET /api/tracks/:id detail route (unlike GET /api/book/:id) — `tracks` is
// hand-rolled, not a defineCollection, and 18.2 never added a single-row read. The
// player's controller seam only carries `trackIds: number[]` (git history: item 18.4's
// contract), so the adapter's ItemLoader.load(id) needs a way to resolve a track by id
// without a dedicated endpoint. For a personal-library-sized catalog, fetching the
// WHOLE unfiltered list once and caching every row by id is the simplest fix that
// needs no backend change: a cache miss triggers one full re-fetch (covers the
// scanner-added-a-track-mid-session case), and every subsequent lookup — including
// what <QueuePanel>'s row labels need for tracks the user hasn't "loaded" yet — is
// free. Module-level (one cache for the whole tab, same lifetime as controller.ts's
// listener Sets).
const cache = new Map<number, Track>();
let inflight: Promise<Track[]> | null = null;
const cacheListeners = new Set<() => void>();

function notifyCacheListeners(): void {
  for (const l of cacheListeners) l();
}

async function fetchAllTracks(): Promise<Track[]> {
  const rows = await apiJson<Track[]>('/api/tracks');
  for (const t of rows) cache.set(t.id, t);
  notifyCacheListeners();
  return rows;
}

/** Resolve one track by id — cache hit is instant; a miss triggers (or joins) one
 *  whole-catalog re-fetch. Throws if the id genuinely isn't in the catalog after that
 *  refetch (the engine's itemLoader.load() lets that rejection propagate — its
 *  handleRequest already treats a thrown load() as "abandon this request", the same
 *  path getBook(404) takes). */
export async function getTrack(id: number): Promise<Track> {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!inflight) inflight = fetchAllTracks().finally(() => { inflight = null; });
  await inflight;
  const found = cache.get(id);
  if (!found) throw new Error(`kouros: track ${id} not found`);
  return found;
}

/** Subscribe to cache updates (a fetchAllTracks() completing) — <QueuePanel> row
 *  labels want to re-render once a not-yet-cached track resolves. Returns the
 *  unsubscribe fn, same Set-based shape as controller.ts's listeners. */
function onTrackCacheChange(l: () => void): () => void {
  cacheListeners.add(l);
  return () => { cacheListeners.delete(l); };
}

/** React binding over the module-level cache — a live snapshot that re-renders on
 *  every fetchAllTracks() completion (used for QueuePanel's labelOf). */
export function useTrackCache(): ReadonlyMap<number, Track> {
  const [, bump] = useState(0);
  useEffect(() => onTrackCacheChange(() => bump((n) => n + 1)), []);
  return cache;
}

// ─── Play history (17.4-style — append-only, plain authFetch) ──────────────────────
// One row per LISTENING SESSION. Here (unlike multi-file books) a session
// boundary IS a track change: each track is its own history row (see
// usePlayerEngine.ts's session recorder). Best-effort telemetry, same as the books'
// createHistoryEvent — a failed POST is swallowed with a console.warn by the caller,
// never surfaced to playback UI.
export function createHistoryEvent(
  row: {
    item_ref: number; started_at: string; ms_played: number; completed: boolean;
    /** Where it was played FROM (player/context.ts) — null for an ad-hoc list. */
    context?: string | null;
  },
): Promise<HistoryRow> {
  return apiJson<HistoryRow>('/api/history', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

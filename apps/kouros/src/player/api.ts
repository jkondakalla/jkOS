// player/api.ts — KourOS's player-scoped API helpers (ToDo.md §3 Wave 18, item 18.4).
// Deliberately separate from a hypothetical top-level ../api.ts (18.3 owns that file;
// file ownership for this task is apps/kouros/src/player/** only) — everything the
// player adapter needs to talk to apps/kouros/backend lives here: the `tracks` catalog
// reader (GET /api/tracks — the backend has no single-track GET, see the header note
// on `getTrack` below), stream/cover URL builders (defineMediaRoutes' wire, 18.2's
// src/media.js), and the append-only history writer (17.4-style, HISTORY collection).
import { useEffect, useState } from 'react';
import { authFetch } from '@jkos/auth-client';

const API = (import.meta as any).env?.VITE_API_URL ?? '';

/** A `tracks` list row (discovery.js TRACK_SHAPE) — scalar catalog metadata only, one
 *  row per file (unit:'file' scanning). `genres` arrives pre-parsed (the server
 *  JSON.parses the TEXT column before responding). */
export interface Track {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  albumartist: string | null;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  genres: string[];
  duration: number;   // seconds
  cover_path: string | null;
  updated_at: string;
}

/** POST /api/history's response shape (HISTORY collection, `only: ['create']` — no
 *  PATCH/DELETE route exists). */
export interface HistoryRow {
  id: number;
  item_ref: number;
  started_at: string;
  ms_played: number;
  completed: boolean;
  updated_at: string;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${API}${path}`, init);
  if (!r.ok) {
    const err = new Error(`${init?.method ?? 'GET'} ${path} failed: ${r.status}`) as Error & { status: number };
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ─── Track catalog + a tiny id-keyed cache ──────────────────────────────────────────
// The backend's `tracks` dataset (apps/kouros/backend/src/routes/tracks.js) is a
// filtered LIST route only — title/artist/album/genre/since, no `id` filter, no
// GET /api/tracks/:id detail route (unlike papyros's GET /api/book/:id) — `tracks` is
// hand-rolled, not a defineCollection, and 18.2 never added a single-row read. The
// player's controller seam only carries `trackIds: number[]` (ToDo.md §3 18.4's
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

/** The full `tracks` catalog (unfiltered) — also the cache-populating call. */
export function listTracks(): Promise<Track[]> {
  return fetchAllTracks();
}

/** Resolve one track by id — cache hit is instant; a miss triggers (or joins) one
 *  whole-catalog re-fetch. Throws if the id genuinely isn't in the catalog after that
 *  refetch (the engine's itemLoader.load() lets that rejection propagate — its
 *  handleRequest already treats a thrown load() as "abandon this request", the same
 *  path papyros's getBook(404) takes). */
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
export function onTrackCacheChange(l: () => void): () => void {
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

// ─── Stream / cover URLs (defineMediaRoutes' wire, src/media.js) ───────────────────

/** Range-aware audio stream URL. `fileIndex` is always 0 — a `tracks` row is always
 *  exactly one file (unit:'file' scanning; src/media.js's resolveFile returns a
 *  single-entry files array) — but the parameter stays explicit so this reads
 *  identically to papyros's streamUrl(id, fileIndex) rather than hiding the URL shape. */
export function streamUrl(id: number, fileIndex = 0): string {
  return `${API}/api/stream/${id}/${fileIndex}`;
}

/** Cover image URL — 404s when the track has no extracted art. Not fetched through
 *  authFetch; an <img src> / canvas-sampling <img> needs a plain URL. */
export function coverUrl(id: number): string {
  return `${API}/api/cover/${id}`;
}

// ─── Play history (17.4-style — append-only, plain authFetch) ──────────────────────
// One row per LISTENING SESSION. Here (unlike papyros's multi-file books) a session
// boundary IS a track change: each track is its own history row (see
// usePlayerEngine.ts's session recorder). Best-effort telemetry, same as papyros's
// createHistoryEvent — a failed POST is swallowed with a console.warn by the caller,
// never surfaced to playback UI.
export function createHistoryEvent(
  row: { item_ref: number; started_at: string; ms_played: number; completed: boolean },
): Promise<HistoryRow> {
  return apiJson<HistoryRow>('/api/history', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

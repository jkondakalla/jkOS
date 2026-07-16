// api.ts — KourOS's typed API client. One module every view/hook imports instead
// of hand-rolling fetch calls, mirroring papyros's api.ts (ToDo.md §2 Wave 5.1's
// crib) so the wire contract (mirrored from apps/kouros/backend/discovery.js +
// src/{media,routes/{library,tracks}}.js) lives in one place.
//
//   tracks                 → weaveClient('kouros').list('tracks', filters) — a real
//                            declared dataset (discovery.js TRACKS_DATASET); same-
//                            origin, edge-proxied, bare-array rows (the suite-wide
//                            dataset contract). Local dev's vite proxy only maps
//                            bare `/api`, not `/api/kouros`, so this path is
//                            exercised at build+preview / prod, not `pnpm dev` —
//                            same verify-via-build note as papyros's api.ts.
//   everything else        → plain authFetch against this app's own unprefixed
//                            /api/* routes (src/media.js, src/routes/library.js,
//                            @jkos/weave/server's defineCollection mount for
//                            history). Simpler than round-tripping through weave
//                            discovery for routes this app already owns.
import { authFetch } from '@jkos/auth-client';
import { weaveClient, type ListFilters } from '@jkos/weave';

const API = (import.meta as any).env?.VITE_API_URL ?? '';

// ─── Wire types (mirrors discovery.js's TRACK_SHAPE + HISTORY fields) ─────────────

/** A `tracks` list row — scalar catalog metadata only (see discovery.js
 *  TRACK_SHAPE). No `path`/`files`/`chapters` — those are the scanner's own
 *  bookkeeping columns, never served. `genres` arrives as a real string[] (the
 *  server JSON-parses the TEXT column, routes/tracks.js's `toRow`). */
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

/** POST /api/library/rescan's response — what one walk of MUSIC_DIR did. */
export interface RescanCounts {
  scanned: number;
  upserted: number;
  removed: number;
  skipped: number;
}

/** GET/POST /api/history — one row per LISTENING STRETCH (mirrors papyros's
 *  17.4 `history`, apps/kouros/backend/discovery.js's HISTORY collection —
 *  `only: ['create']` server-side, so there is no PATCH/DELETE for this row
 *  shape at all, append-only). List rows come back newest-first (the generic
 *  defineCollection mount orders `ORDER BY id DESC`), which is exactly the
 *  order "recently played" wants — see hooks/useRecentlyPlayed.ts. */
export interface HistoryRow {
  id: number;
  item_ref: number;   // a `tracks.id`
  started_at: string;   // ISO timestamp — when this session began
  ms_played: number;    // accumulated milliseconds actually played this session
  completed: boolean;   // true when this session's playback reached the track's end
  updated_at: string;
}

/** Server-driven `tracks` filters (discovery.js TRACKS_DATASET.filters). `title`/
 *  `artist` are PREFIX matches (Search's two query boxes); `album`/`genre` are
 *  exact. `since` (the delta cursor) is omitted — no view here needs it yet. */
export interface TrackFilters {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
}

// ─── Shared fetch helper ───────────────────────────────────────────────────────────

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

// ─── Tracks ─────────────────────────────────────────────────────────────────────

/** The `tracks` catalog, via the weave dataset contract (bare-array rows). Falls
 *  back to [] on any discovery/network miss (weaveClient's documented behaviour).
 *  No filters ⇒ the WHOLE catalog — Home/Artists/Artist/Album all derive their own
 *  grouping client-side (no artists/albums table server-side, and the `artist`
 *  filter is a PREFIX match, not the exact grouping key this app needs — see
 *  views/library/format.ts's trackArtist()), so they call this unfiltered and
 *  group/filter in memory. Search is the one caller that passes real filters
 *  (server-side title/artist prefix search). */
export function listTracks(filters?: TrackFilters): Promise<Track[]> {
  return weaveClient('kouros').list<Track>('tracks', filters as ListFilters);
}

/** Cover image URL (may 404 when the track has no extracted/matched cover). Not
 *  fetched through authFetch — an <img src> needs a plain URL. */
export function coverUrl(id: number): string {
  return `${API}/api/cover/${id}`;
}

/** Range-aware audio stream URL for one track. A `tracks` row is always exactly
 *  one file (unit:'file' scanning — src/media.js's header), so `fileIndex` is
 *  always 0; kept as a real path segment (not baked into the function name) so
 *  the wire shape matches papyros's `/api/stream/:id/:fileIndex` verbatim for
 *  18.4's player seam. */
export function streamUrl(id: number): string {
  return `${API}/api/stream/${id}/0`;
}

/** Whole-track download URL. */
export function downloadUrl(id: number): string {
  return `${API}/api/download/${id}`;
}

/** The `rescanLibrary` capability — walk MUSIC_DIR and upsert the `tracks`
 *  catalog. Admin-only server-side (routes/library.js gates on req.user.role),
 *  so callers should only offer it when the signed-in user is an admin; a
 *  non-admin gets a 403. */
export function rescanLibrary(): Promise<RescanCounts> {
  return apiJson<RescanCounts>('/api/library/rescan', { method: 'POST' });
}

// ─── Playlists (18.6 — genuine per-user CRUD via defineCollection; plain authFetch,
// same "route this app already owns, no weave round-trip" call as history above) ──

/** A `playlists` row (discovery.js PLAYLISTS). `track_refs` arrives as a real
 *  number[] — the collection's generic `toRow()` JSON.parses the `list:true`
 *  TEXT column back into an array (same convention as `tracks.genres`); the
 *  server also accepts a plain array on write (`coerce()` JSON.stringifies it),
 *  so callers here never hand-encode the JSON themselves. */
export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  track_refs: number[];
  updated_at: string;
}

export function listPlaylists(): Promise<Playlist[]> {
  return apiJson<Playlist[]>('/api/playlists');
}

export function createPlaylist(
  row: { name: string; description?: string; track_refs?: number[] },
): Promise<Playlist> {
  return apiJson<Playlist>('/api/playlists', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

export function updatePlaylist(
  id: number,
  patch: Partial<{ name: string; description: string; track_refs: number[] }>,
): Promise<Playlist> {
  return apiJson<Playlist>(`/api/playlists/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) });
}

export async function deletePlaylist(id: number): Promise<void> {
  await apiJson<{ ok: boolean }>(`/api/playlists/${id}`, { method: 'DELETE' });
}

// ─── Play history (17.4-style — append-only; plain authFetch, NOT offline-queued) ─
// `listHistory` powers Home's "Recently played" section (resolve `item_ref`
// against the `tracks` list, dedupe to most-recent-per-track — see
// views/Home.tsx). `createHistoryEvent` has no caller in this wave (18.3 is
// read-only library UI) — it's provided here, matching papyros's api.ts /
// usePlayerEngine.ts precedent, so 18.4's queue engine can record a listening
// stretch with a plain import instead of needing to touch this file itself
// (api.ts is 18.3's, not 18.4's, per this wave's file-ownership split).

export function listHistory(): Promise<HistoryRow[]> {
  return apiJson<HistoryRow[]>('/api/history');
}

export function createHistoryEvent(
  row: { item_ref: number; started_at: string; ms_played: number; completed: boolean },
): Promise<HistoryRow> {
  return apiJson<HistoryRow>('/api/history', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

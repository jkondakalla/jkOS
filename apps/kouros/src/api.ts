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

// ─── Browse (server-side grouping — backend/src/routes/browse.js) ─────────────
// Everything above this line derives albums and artists by pulling the WHOLE
// `tracks` catalog and grouping it in the browser. That is fine at a few hundred
// tracks and untenable at the several thousand albums this app targets: a
// multi-megabyte payload and a full re-group on every mount, on a phone. These
// call SQLite's own GROUP BY instead and return one row per record.

/** One album, summarised. `cover_id` is the id of a track on the record that
 *  actually has extracted art — `coverUrl(cover_id)` is the sleeve; null means
 *  the record has no art at all and the caller should draw a placeholder. */
export interface AlbumSummary {
  album: string;
  artist: string;
  year: number | null;
  tracks: number;
  duration: number;
  added: string;
  /** Lowest track id on the record — the "play this album from the top" handle. */
  anchor_id: number;
  cover_id: number | null;
}

export interface ArtistSummary {
  artist: string;
  tracks: number;
  albums: number;
  duration: number;
  cover_id: number | null;
}

export interface LibraryStats {
  tracks: number;
  albums: number;
  artists: number;
  duration: number;
}

export type AlbumSort = 'added' | 'title' | 'artist' | 'year';

export function listAlbums(
  opts: { q?: string; artist?: string; sort?: AlbumSort; limit?: number; offset?: number } = {},
): Promise<AlbumSummary[]> {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.artist) p.set('artist', opts.artist);
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.limit != null) p.set('limit', String(opts.limit));
  if (opts.offset != null) p.set('offset', String(opts.offset));
  return apiJson<AlbumSummary[]>(`/api/albums?${p}`);
}

export function listAlbumTracks(album: string, artist?: string): Promise<Track[]> {
  const p = new URLSearchParams({ album });
  if (artist) p.set('artist', artist);
  return apiJson<Track[]>(`/api/albums/tracks?${p}`);
}

export function listArtists(
  opts: { q?: string; sort?: 'name' | 'size'; limit?: number; offset?: number } = {},
): Promise<ArtistSummary[]> {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.limit != null) p.set('limit', String(opts.limit));
  if (opts.offset != null) p.set('offset', String(opts.offset));
  return apiJson<ArtistSummary[]>(`/api/artists?${p}`);
}

export function libraryStats(): Promise<LibraryStats> {
  return apiJson<LibraryStats>('/api/library/stats');
}

// ─── Discovery (backend/src/discover — the embedding seam) ────────────────────
// ⚠️ EVERY response here carries the BASIS of its answer, and the UI is expected
// to SHOW it. The embedder (ToDo §8) backfills over hours, so at any moment part
// of the library has a measured vector, part inherits its album's centroid, and
// part has nothing and falls back to genre/artist affinity. Rendering all three
// identically would present a genre guess as an acoustic match — and the first
// time the listener notices, the feature stops being believed. `basis` and
// `origin` exist so a row can honestly say "similar" or "same artist".

/** Where one row's vector came from: 'measured' (the embedder computed it),
 *  'inferred' (it inherited its album's centroid), 'metadata' (no vector — this
 *  row was ranked by artist/genre/era affinity alone). */
export type Basis = 'measured' | 'inferred' | 'metadata';

/** A track as the discovery routes return it — catalog scalars plus the ranking
 *  metadata. Deliberately NOT `Track`: there is no `cover_path` here (the wire
 *  sends `has_cover`), and there are extra ranking fields. */
export interface DiscoveredTrack {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  year: number | null;
  duration: number;
  genres: string[];
  has_cover: boolean;
  basis?: Basis;
  score?: number;
  /** Runs only: position in the set, and its energy percentile. */
  step?: number;
  energy?: number | null;
  /** Time-of-day rail only: how well the track matches the slot's target. */
  fit?: number;
}

export interface DiscoveryStats {
  tracks: number;
  dim: number;
  arm: string | null;
  /** Tracks the embedder actually computed a vector for. */
  measured: number;
  /** Tracks that inherited their album's centroid. */
  inferred: number;
  covered: number;
  uncovered: number;
  coverage: number;
  features: string[] | null;
}

export interface SimilarResult {
  basis: 'embedding' | 'metadata' | 'none';
  seed_origin?: Basis;
  results: DiscoveredTrack[];
}

export interface RunResult {
  /** The energy shape requested, or 'none' when no readable feature arm was
   *  loaded and the walk was cohesion-only. */
  arc: string;
  results: DiscoveredTrack[];
}

/** A Home rail's run — a sequenced set with an arc. */
export interface HomeRun {
  id: string;
  title: string;
  blurb: string;
  arc: string;
  seed: { id: number; title: string; artist: string | null };
  length: number;
  duration: number;
  tracks: DiscoveredTrack[];
}

export interface DeepInArtist {
  artist: string;
  weight: number;
  plays: number;
  library_tracks: number;
  anchor_id: number | null;
}

export interface HomePayload {
  stats: DiscoveryStats;
  time_of_day: { slot: string; label: string; basis: 'features' | 'genre'; results: DiscoveredTrack[] };
  runs: HomeRun[];
  deep_in: DeepInArtist[];
  recently_played: DiscoveredTrack[];
  fresh_albums: Array<{ album: string; artist: string; year: number | null; tracks: number; duration: number; anchor_id: number; added: string }>;
}

/** A named axis of the vibe map, discovered by correlating the projection against
 *  the readable descriptor features — `low`/`high` are the pole words to print at
 *  each end ("calm" → "intense"). Null when no feature arm was available. */
export interface MapAxis {
  feature: string;
  r: number;
  low: string;
  high: string;
}

export interface MapRegion {
  id: number;
  label: string;
  x: number;
  y: number;
  count: number;
}

export interface MapPoint {
  id: number;
  x: number;
  y: number;
  /** Region id. */
  r: number;
  /** 1 = measured, 0 = inferred from its album. */
  o: 0 | 1;
}

export interface VibeMap {
  available: boolean;
  reason?: string;
  coverage: DiscoveryStats;
  axes: { x: MapAxis | null; y: MapAxis | null };
  regions: MapRegion[];
  points: MapPoint[];
  sampled?: boolean;
  total?: number;
}

export function discoveryStats(): Promise<DiscoveryStats> {
  return apiJson<DiscoveryStats>('/api/discover/stats');
}

export function similarTracks(id: number, k = 24): Promise<SimilarResult> {
  return apiJson<SimilarResult>(`/api/discover/similar/${id}?k=${k}`);
}

export function radioFrom(seedIds: number[], k = 60): Promise<SimilarResult> {
  return apiJson<SimilarResult>(`/api/discover/radio?seed=${seedIds.join(',')}&k=${k}`);
}

export function buildRun(seedId: number, arc = 'rise', length = 14): Promise<RunResult> {
  return apiJson<RunResult>(`/api/discover/run?seed=${seedId}&arc=${arc}&length=${length}`);
}

/** The Home page in one request — five rails, assembled server-side. The local
 *  HOUR is sent from the browser on purpose: "morning" is a property of where the
 *  listener is, and the server's clock is UTC in a container. */
export function fetchHome(hour = new Date().getHours()): Promise<HomePayload> {
  return apiJson<HomePayload>(`/api/discover/home?hour=${hour}`);
}

export function fetchVibeMap(): Promise<VibeMap> {
  return apiJson<VibeMap>('/api/discover/map');
}

/** What sits under the pin. The map is a unit square: x and y are in [-1, 1]. */
export function tracksNear(x: number, y: number, k = 40): Promise<{ results: DiscoveredTrack[] }> {
  return apiJson<{ results: DiscoveredTrack[] }>(`/api/discover/near?x=${x.toFixed(4)}&y=${y.toFixed(4)}&k=${k}`);
}

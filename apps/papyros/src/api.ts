// api.ts — PapyrOS's typed API client. One module every view/component imports
// instead of hand-rolling fetch calls, so the wire contract (Documentation/ToDo.md
// §2 Wave 5.1's crib, mirrored from the backend routes below) lives in one place.
//
//   books                 → weaveClient('papyros').list('books', filters) — the task
//                           bullet names weaveClient explicitly, and 'books' is a real
//                           declared dataset (discovery.js BOOKS_DATASET); same-origin,
//                           edge-proxied, bare-array rows (the suite-wide dataset
//                           contract). Local dev's vite proxy only maps bare `/api`, not
//                           `/api/papyros`, so this path is exercised at build+preview /
//                           prod, not `pnpm dev` — matches this task's verify note.
//   everything else       → plain authFetch against this app's own unprefixed /api/*
//                           routes (src/media.js, src/routes/{books,match}.js,
//                           @jkos/weave/server's defineCollection mount for
//                           progress/bookmarks). Simpler than round-tripping through
//                           weave discovery for routes this app already owns.
import { authFetch } from '@jkos/auth-client';
import { weaveClient, type ListFilters } from '@jkos/weave';
// Deliberately './offline/writes' (not './offline') — the offline barrel re-exports
// constants.ts, which imports THIS module for its URL builders; writes.ts imports
// nothing from here at runtime (type-only), so this edge keeps the graph acyclic.
import { initOfflineWrites } from './offline/writes';

const API = (import.meta as any).env?.VITE_API_URL ?? '';

// ─── Wire types (Wave 5.1 crib — the shape every Wave-5 view/component shares) ────

/** A `books` list row — scalar catalog metadata only (see discovery.js BOOK_SHAPE).
 *  `genres` arrives as a real string[] (the server JSON-parses the TEXT column). */
export interface Book {
  id: number;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_seq: number | null;
  year: number | null;
  genres: string[];
  duration: number;   // seconds
  cover_path: string | null;
  metadata_source: 'embedded' | 'itunes' | 'manual';
  ext_ref: string | null;
  updated_at: string;
}

/** One track in a (possibly multi-file) audiobook rip. `path` is server-internal
 *  today (media.js deliberately omits it — playback is by (bookId, fileIndex) through
 *  /api/stream, never a raw path) but stays optional here in case that changes. */
export interface BookFile {
  index: number;
  path?: string;
  duration: number;
  codec: string;
  /** Level-1 (lossless remux) compat variant exists server-side — the player starts
   *  this file on the normalized container (Firefox-safe) instead of failing first. */
  compat_ready?: boolean;
}

export interface BookChapter {
  start: number;
  end: number;
  title: string;
}

/** GET /api/book/:bookId — every Book field plus the detail-only description and the
 *  per-track file/chapter manifest a player needs to build a playlist. */
export interface BookDetail extends Book {
  description: string | null;
  files: BookFile[];
  chapters: BookChapter[];
}

/** POST /api/library/rescan's response — what one walk of AUDIOBOOKS_DIR did. */
export interface RescanCounts {
  scanned: number;
  upserted: number;
  removed: number;
  skipped: number;
}

/** A row off GET /api/metadataSearch (the META iTunes connector's typed item shape). */
export interface Candidate {
  id: number;
  title: string;
  author: string;
  cover: string | null;
  description: string | null;
  year: number | null;
  genre: string | null;
}

/** POST /api/match's response — the write outcome (metadata always writes on success;
 *  a failed artwork download doesn't fail the whole match, see match.js). */
export interface MatchResult {
  updated: boolean;
  cover: 'updated' | 'failed';
}

/** GET/POST /api/progress, PATCH/DELETE /api/progress/:id — one listener's position in
 *  one book (owner-scoped server-side; @jkos/weave/server's defineCollection mount). */
export interface ProgressRow {
  id: number;
  book_ref: number;
  position: number;   // seconds
  duration: number;   // seconds
  finished: boolean;
  last_played: string;   // ISO timestamp
  updated_at: string;
}

/** GET/POST /api/bookmarks, PATCH/DELETE /api/bookmarks/:id — a saved position in a
 *  book, distinct from `progress` (many bookmarks per book, one progress cursor). */
export interface BookmarkRow {
  id: number;
  book_ref: number;
  position: number;   // seconds
  title: string | null;
  note: string | null;
}

/** GET/POST /api/history — one row per LISTENING SESSION (17.4). Append-only
 *  server-side (@jkos/weave/server's defineCollection mount with `only: ['create']`
 *  — see apps/papyros/backend/discovery.js's HISTORY); there is no PATCH/DELETE. */
export interface HistoryRow {
  id: number;
  item_ref: number;
  started_at: string;   // ISO timestamp — when this session began
  ms_played: number;    // accumulated milliseconds actually played this session
  completed: boolean;   // true when this session's playback reached the book's end
  updated_at: string;
}

/** Server-driven `books` filters (discovery.js BOOKS_DATASET.filters). `since` (the
 *  delta cursor) is omitted here — no Wave-5 view needs it yet; add it if one does.
 *  `genre` is an exact JSON-array membership match (the `tags` op — see discovery.js),
 *  driven by the library grid's genre chips (BookCard.tsx / Library.tsx). */
export interface BookFilters {
  title?: string;
  author?: string;
  series?: string;
  genre?: string;
}

// ─── Shared fetch helper ───────────────────────────────────────────────────────────

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${API}${path}`, init);
  if (!r.ok) {
    // `.status` rides along (message unchanged) so the offline write queue can
    // tell a server VERDICT (4xx → drop the queued write) from a transport
    // failure (fetch throws TypeError → keep it queued). See offline/writes.ts.
    const err = new Error(`${init?.method ?? 'GET'} ${path} failed: ${r.status}`) as Error & { status: number };
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ─── Books ──────────────────────────────────────────────────────────────────────

/** The `books` catalog, via the weave dataset contract (bare-array rows). Falls back
 *  to [] on any discovery/network miss (weaveClient's documented behaviour). */
export function listBooks(filters?: BookFilters): Promise<Book[]> {
  return weaveClient('papyros').list<Book>('books', filters as ListFilters);
}

/** Detail-JSON URL for one book. Single-source so the offline cache (Wave 7) keys its
 *  stored detail response under the exact same URL `getBook` fetches / the SW matches. */
export function bookDetailUrl(id: number): string {
  return `${API}/api/book/${id}`;
}

export function getBook(id: number): Promise<BookDetail> {
  return apiJson<BookDetail>(`/api/book/${id}`);
}

/** Cover image URL (may 404 when the book has no extracted/matched cover). Not
 *  fetched through authFetch — an <img src> needs a plain URL. */
export function coverUrl(id: number): string {
  return `${API}/api/cover/${id}`;
}

/** Range-aware audio stream URL for one file in a book. */
export function streamUrl(id: number, fileIndex: number): string {
  return `${API}/api/stream/${id}/${fileIndex}`;
}

/** Whole-book download URL (single file direct, multi-file zipped server-side). */
export function downloadUrl(id: number): string {
  return `${API}/api/download/${id}`;
}

/** The `rescanLibrary` capability — walk AUDIOBOOKS_DIR and upsert the `books` catalog.
 *  Admin-only server-side (routes/library.js gates on req.user.role), so callers should
 *  only offer it when the signed-in user is an admin; a non-admin gets a 403. */
export function rescanLibrary(): Promise<RescanCounts> {
  return apiJson<RescanCounts>('/api/library/rescan', { method: 'POST' });
}

// ─── Metadata matching (4.1/4.2 — META connector + matchBook) ───────────────────

export function searchMetadata(term: string): Promise<Candidate[]> {
  return apiJson<Candidate[]>(`/api/metadataSearch?term=${encodeURIComponent(term)}`);
}

export function matchBook(bookId: number, candidate: Candidate): Promise<MatchResult> {
  return apiJson<MatchResult>('/api/match', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ bookId, candidate }),
  });
}

/** POST /api/match/all's response — the admin enrichment sweep (matchAllMissing).
 *  `applied` auto-matched exactly; `review` needs a human (per-book "Fix metadata"). */
export interface MatchAllResult {
  examined: number;
  applied: { bookId: number; title: string; extRef: string }[];
  review: { bookId: number; title: string; candidates: Candidate[]; error?: boolean }[];
  truncated: boolean;
}

/** The `matchAllMissing` admin capability — sweep every still-`embedded` book missing
 *  author/cover/description and auto-apply exact iTunes matches. Admin-only server-side
 *  (same gate as rescanLibrary); offer it only to admins. */
export function matchAllMissing(): Promise<MatchAllResult> {
  return apiJson<MatchAllResult>('/api/match/all', { method: 'POST' });
}

// ─── Progress + Bookmarks (owner-scoped CRUD, offline-queued writes) ─────────────
// Wave 7.2 / ToDo §3 16.5: the WRITE functions below are wrapped by the offline
// write queue (offline/writes.ts → @jkos/player/services). Online they hit the
// direct authFetch path and behave exactly as before; when a write fails because
// the network is down it is queued durably (IndexedDB) and replayed on reconnect,
// reconciled against GET /api/<collection>?since= with last-write-wins on
// updated_at. Same exported names + signatures — no consumer changes.

export function listProgress(filters?: { finished?: boolean }): Promise<ProgressRow[]> {
  const qs = filters?.finished === undefined ? '' : `?finished=${filters.finished}`;
  return apiJson<ProgressRow[]>(`/api/progress${qs}`);
}

export function listBookmarks(): Promise<BookmarkRow[]> {
  return apiJson<BookmarkRow[]>('/api/bookmarks');
}

// The direct (unqueued) implementations, injected into the queue layer. The
// wrapped functions exported below replay through these on reconnect.
const offlineWrites = initOfflineWrites({
  listProgress: () => listProgress(),
  createProgress: (row) =>
    apiJson<ProgressRow>('/api/progress', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) }),
  updateProgress: (id, patch) =>
    apiJson<ProgressRow>(`/api/progress/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  deleteProgress: async (id) => { await apiJson<void>(`/api/progress/${id}`, { method: 'DELETE' }); },
  createBookmark: (row) =>
    apiJson<BookmarkRow>('/api/bookmarks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) }),
  updateBookmark: (id, patch) =>
    apiJson<BookmarkRow>(`/api/bookmarks/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  deleteBookmark: async (id) => { await apiJson<void>(`/api/bookmarks/${id}`, { method: 'DELETE' }); },
  // The reconnect reconciliation read: every defineCollection dataset declares the
  // universal `since` filter (updated_at delta cursor), owner-scoped, bare-array.
  fetchDelta: (collection, since) =>
    apiJson<Array<Record<string, unknown>>>(`/api/${collection}?since=${encodeURIComponent(since)}`),
});

export function createProgress(row: Partial<Omit<ProgressRow, 'id' | 'updated_at'>>): Promise<ProgressRow> {
  return offlineWrites.createProgress(row);
}

export function updateProgress(id: number, patch: Partial<Omit<ProgressRow, 'id' | 'updated_at'>>): Promise<ProgressRow> {
  return offlineWrites.updateProgress(id, patch);
}

export async function deleteProgress(id: number): Promise<void> {
  await offlineWrites.deleteProgress(id);
}

export function createBookmark(row: Partial<Omit<BookmarkRow, 'id'>>): Promise<BookmarkRow> {
  return offlineWrites.createBookmark(row);
}

export function updateBookmark(id: number, patch: Partial<Omit<BookmarkRow, 'id'>>): Promise<BookmarkRow> {
  return offlineWrites.updateBookmark(id, patch);
}

export async function deleteBookmark(id: number): Promise<void> {
  await offlineWrites.deleteBookmark(id);
}

// ─── Play history (17.4 — append-only; plain authFetch, NOT offline-queued) ──────
// Unlike progress/bookmarks — a resume cursor and saved spots the user would
// genuinely notice missing — a history row is best-effort telemetry: nothing reads
// it back yet, and the worst case of a dropped POST during a network blip is one
// absent "recently played" data point, not lost user-facing state. The offline
// queue's adapter (offline/writes.ts) is also purpose-built around exactly the two
// shapes it durably replays (progress's find-by-book_ref upsert, bookmarks'
// create/update/delete keyed by a temp id) — bolting on a third, differently-shaped
// (pure-append, no natural update/delete) collection would widen shared queue
// plumbing for a write that doesn't need durability. Plain apiJson/authFetch;
// see usePlayerEngine.ts's recordHistoryEvent for the fire-and-forget call site
// (a failed POST here is swallowed with a console.warn, never surfaced to the UI).
export function createHistoryEvent(
  row: { item_ref: number; started_at: string; ms_played: number; completed: boolean },
): Promise<HistoryRow> {
  return apiJson<HistoryRow>('/api/history', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

// books/api.ts — the audiobook half of KourOS's typed API client. The
// URLs are this backend's own —
//
//   /api/books                       the catalog (a declared dataset; bare-array rows)
//   /api/book/:id                    one book in full (files + chapters + description)
//   /api/books/stream|cover|download ⚠️ PREFIXED: the track routes own /api/stream etc.
//                                    (backend/src/books/media.js's header)
//   /api/progress, /api/bookmarks    owner-scoped CRUD, offline-queued (./offline)
//   /api/book_history                the append-only book ledger
//   /api/metadataSearch, /api/match  the iTunes connector + matchBook
// Deliberately './offline/writes' (not './offline') — the offline barrel re-exports
// constants.ts, which imports THIS module for its URL builders; writes.ts imports
// nothing from here at runtime (type-only), so this edge keeps the graph acyclic.
import { initOfflineWrites } from './offline/writes';
import { API, JSON_HEADERS, apiJson } from '../http';


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

/** GET/POST /api/book_history — one row per LISTENING SESSION of a book. Append-only
 *  server-side (defineCollection's `only: ['create']` — backend/discovery.js's
 *  BOOK_HISTORY); there is no PATCH/DELETE. */
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

/**
 * Normalise a `ref` stud to a number, at the one door every row comes through.
 *
 * ⚠️ `progress.book_ref` / `bookmarks.book_ref` are weave `ref` columns, and a
 * ref is stored — and therefore SERVED — as TEXT: the wire carries `"13"`, not
 * `13`. The interfaces above have always declared `book_ref: number`, so the
 * type said one thing and the payload said another, and every strict comparison
 * against a real book id was quietly false forever:
 *
 *   · BookDetail   `p.book_ref === bookId`      → Resume + the progress bar
 *                                                  could never appear, for any
 *                                                  book, ever.
 *   · usePlayerEngine  `r.book_ref === itemId`  → the engine never found an
 *                                                  existing row, so playback
 *                                                  always resumed from zero.
 *   · usePlayerEngine  `bm.book_ref === itemId` → a book's bookmarks never listed.
 *   · offline/writes   `typeof r.book_ref === 'number'` → false for every server
 *                                                  row, so the queue's dedup key
 *                                                  was never registered.
 *
 * Four bugs, one cause, and none of them threw. `discovery.js` already warns
 * about this affinity mismatch for SQL joins; nothing carried the warning across
 * to the client. Coercing HERE — rather than at each comparison — is what makes
 * the declared types true, so a fifth consumer written tomorrow is correct by
 * default instead of inheriting the trap.
 */
function withNumericRefs<T>(row: T): T {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return row;
  if (r.book_ref != null && typeof r.book_ref !== 'number') {
    const n = Number(r.book_ref);
    if (Number.isFinite(n)) r.book_ref = n;
  }
  return row;
}

/** The list form — `ref`-bearing collections are served as bare arrays. */
function refsInList<T>(rows: T[]): T[] {
  return Array.isArray(rows) ? rows.map(withNumericRefs) : rows;
}


// ─── Books ──────────────────────────────────────────────────────────────────────

/** The `books` catalog (bare-array rows). A plain read of this app's own route —
 *  never weaveClient, which would be a discovery round trip to reach a route one
 *  process away. */
export function listBooks(filters?: BookFilters): Promise<Book[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters ?? {})) if (v) qs.set(k, v);
  const q = qs.toString();
  return apiJson<Book[]>(`/api/books${q ? `?${q}` : ''}`);
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
  return `${API}/api/books/cover/${id}`;
}

/** Range-aware audio stream URL for one file in a book. */
export function streamUrl(id: number, fileIndex: number): string {
  return `${API}/api/books/stream/${id}/${fileIndex}`;
}

/** Whole-book download URL (single file direct, multi-file zipped server-side). */
export function downloadUrl(id: number): string {
  return `${API}/api/books/download/${id}`;
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
// Wave 7.2 / git history: item 16.5: the WRITE functions below are wrapped by the offline
// write queue (offline/writes.ts → @jkos/player/services). Online they hit the
// direct authFetch path and behave exactly as before; when a write fails because
// the network is down it is queued durably (IndexedDB) and replayed on reconnect,
// reconciled against GET /api/<collection>?since= with last-write-wins on
// updated_at. Same exported names + signatures — no consumer changes.

export function listProgress(filters?: { finished?: boolean }): Promise<ProgressRow[]> {
  const qs = filters?.finished === undefined ? '' : `?finished=${filters.finished}`;
  return apiJson<ProgressRow[]>(`/api/progress${qs}`).then(refsInList);
}

export function listBookmarks(): Promise<BookmarkRow[]> {
  return apiJson<BookmarkRow[]>('/api/bookmarks').then(refsInList);
}

// The direct (unqueued) implementations, injected into the queue layer. The
// wrapped functions exported below replay through these on reconnect.
const offlineWrites = initOfflineWrites({
  listProgress: () => listProgress(),
  createProgress: (row) =>
    apiJson<ProgressRow>('/api/progress', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) }).then(withNumericRefs),
  updateProgress: (id, patch) =>
    apiJson<ProgressRow>(`/api/progress/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then(withNumericRefs),
  deleteProgress: async (id) => { await apiJson<void>(`/api/progress/${id}`, { method: 'DELETE' }); },
  createBookmark: (row) =>
    apiJson<BookmarkRow>('/api/bookmarks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) }).then(withNumericRefs),
  updateBookmark: (id, patch) =>
    apiJson<BookmarkRow>(`/api/bookmarks/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then(withNumericRefs),
  deleteBookmark: async (id) => { await apiJson<void>(`/api/bookmarks/${id}`, { method: 'DELETE' }); },
  // The reconnect reconciliation read: every defineCollection dataset declares the
  // universal `since` filter (updated_at delta cursor), owner-scoped, bare-array.
  // Refs normalised here too — reconciliation compares these rows against queued
  // ones by book_ref, so a string here would re-break the dedup on reconnect.
  fetchDelta: (collection, since) =>
    apiJson<Array<Record<string, unknown>>>(`/api/${collection}?since=${encodeURIComponent(since)}`).then(refsInList),
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

// ─── The book ledger (append-only; plain authFetch, NOT offline-queued) ─────────
// One row per listening stretch of a book — `history`'s twin (discovery.js's
// BOOK_HISTORY for why it is its own table). Best-effort like the track ledger: a
// dropped POST during a network blip costs one data point, not user-facing state.
export function createBookHistoryEvent(
  row: { item_ref: number; started_at: string; ms_played: number; completed: boolean },
): Promise<HistoryRow> {
  return apiJson<HistoryRow>('/api/book_history', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

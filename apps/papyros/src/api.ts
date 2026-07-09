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

/** Server-driven `books` filters (discovery.js BOOKS_DATASET.filters). `since` (the
 *  delta cursor) is omitted here — no Wave-5 view needs it yet; add it if one does. */
export interface BookFilters {
  title?: string;
  author?: string;
  series?: string;
}

// ─── Shared fetch helper ───────────────────────────────────────────────────────────

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${r.status}`);
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

// ─── Progress (owner-scoped CRUD) ────────────────────────────────────────────────

export function listProgress(filters?: { finished?: boolean }): Promise<ProgressRow[]> {
  const qs = filters?.finished === undefined ? '' : `?finished=${filters.finished}`;
  return apiJson<ProgressRow[]>(`/api/progress${qs}`);
}

export function createProgress(row: Partial<Omit<ProgressRow, 'id' | 'updated_at'>>): Promise<ProgressRow> {
  return apiJson<ProgressRow>('/api/progress', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

export function updateProgress(id: number, patch: Partial<Omit<ProgressRow, 'id' | 'updated_at'>>): Promise<ProgressRow> {
  return apiJson<ProgressRow>(`/api/progress/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) });
}

export async function deleteProgress(id: number): Promise<void> {
  await apiJson<void>(`/api/progress/${id}`, { method: 'DELETE' });
}

// ─── Bookmarks (owner-scoped CRUD) ───────────────────────────────────────────────

export function listBookmarks(): Promise<BookmarkRow[]> {
  return apiJson<BookmarkRow[]>('/api/bookmarks');
}

export function createBookmark(row: Partial<Omit<BookmarkRow, 'id'>>): Promise<BookmarkRow> {
  return apiJson<BookmarkRow>('/api/bookmarks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(row) });
}

export function updateBookmark(id: number, patch: Partial<Omit<BookmarkRow, 'id'>>): Promise<BookmarkRow> {
  return apiJson<BookmarkRow>(`/api/bookmarks/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) });
}

export async function deleteBookmark(id: number): Promise<void> {
  await apiJson<void>(`/api/bookmarks/${id}`, { method: 'DELETE' });
}

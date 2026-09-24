// format.ts — pure helpers for the library grid (5.2): duration formatting, cover
// placeholder initials, series grouping, and client-side sort. No React/DOM here so
// these stay trivially testable in isolation if a later wave adds coverage.
import type { Book } from '../../../books/api';

// ─── Duration ───────────────────────────────────────────────────────────────────

/** `duration` (seconds) → a compact "Xh Ym" / "Ym" label. `—` for missing/zero. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Cover placeholder ──────────────────────────────────────────────────────────

/** Up to two initials for the accent-tinted placeholder tile (no cover art / 404). */
export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// ─── Series grouping ────────────────────────────────────────────────────────────

/** Sentinel bucket key for books with no `series` — kept out of the sortable
 *  namespace (a real series name can never collide with it) and always sorted last. */
export const STANDALONE_KEY = '\u0000standalone';

export interface SeriesGroup {
  key: string;
  label: string;
  books: Book[];
}

/** Buckets rows by `series` (null → the Standalone bucket), each bucket ordered by
 *  `series_seq` (missing seq sorts after numbered entries), bucket order alphabetical
 *  by series name with Standalone always last. */
export function groupBySeries(books: Book[]): SeriesGroup[] {
  const buckets = new Map<string, Book[]>();
  for (const book of books) {
    const key = book.series ?? STANDALONE_KEY;
    const list = buckets.get(key);
    if (list) list.push(book);
    else buckets.set(key, [book]);
  }
  const groups: SeriesGroup[] = [];
  for (const [key, list] of buckets) {
    list.sort((a, b) => {
      const seqDiff = (a.series_seq ?? Infinity) - (b.series_seq ?? Infinity);
      return seqDiff !== 0 ? seqDiff : a.title.localeCompare(b.title);
    });
    groups.push({ key, label: key === STANDALONE_KEY ? 'Standalone' : key, books: list });
  }
  groups.sort((a, b) => {
    if (a.key === STANDALONE_KEY) return 1;
    if (b.key === STANDALONE_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

// ─── Sort ───────────────────────────────────────────────────────────────────────

export type SortMode = 'title' | 'author' | 'year' | 'updated';

function cmpNullableStringAsc(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulls last regardless of direction
  if (b == null) return -1;
  return a.localeCompare(b);
}

function cmpNullableNumberDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulls last regardless of direction
  if (b == null) return -1;
  return b - a;
}

/** Client-side sort over the already-fetched rows (sort isn't a server filter —
 *  see the `books` dataset's `filters`, which only cover title/author/series/since).
 *  `updated` is always newest-first; `year` is newest-first too (most recent release
 *  first, matching `updated`'s recency framing); `title`/`author` are A→Z. */
export function sortBooks(books: Book[], mode: SortMode): Book[] {
  const rows = [...books];
  switch (mode) {
    case 'author':
      rows.sort((a, b) => cmpNullableStringAsc(a.author, b.author) || a.title.localeCompare(b.title));
      break;
    case 'year':
      rows.sort((a, b) => cmpNullableNumberDesc(a.year, b.year) || a.title.localeCompare(b.title));
      break;
    case 'updated':
      rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      break;
    case 'title':
    default:
      rows.sort((a, b) => a.title.localeCompare(b.title));
  }
  return rows;
}

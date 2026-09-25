// sources.ts — the seam that lets ONE player play both halves of the library.
//
// KourOS plays music and audiobooks. They are one app with one backend, but they
// are still two catalogs with two shapes:
// a `tracks` row is one file with no chapters, a `books` row is N files with chapters,
// a resume point, bookmarks and a compat ladder. What they share is a SHAPE — both
// mount the same `@jkos/weave/mediaRoutes` brick, the book half under /api/books/*
// (backend/src/books/media.js says why) — which is what keeps one player over both a
// thin thing rather than a merge.
//
// ⭐ **THE REF IS THE WHOLE TRICK.** `@jkos/player/core`'s queue is `string[]`
// already, so a queue can hold `['kouros:12', 'book:7']` with NO change to the
// package — shuffle, repeat, reorder and the cursor all work on it unmodified.
// And a bare `'12'` decodes to a TRACK, so every existing call site that passes a
// numeric track id keeps working untouched.
//
// ⚠️ And the trap the book half carries: a weave `type:'ref'` column is TEXT, so
// the wire says `book_ref: "13"` where the TypeScript says `number`. That concealed
// FOUR silent bugs for months. The coercion lives at ONE door —
// books/api.ts's `withNumericRefs()` — and every book row below arrives through it.

import {
  audiobookPlayer, createPlayer, musicPlayer,
  type PlayerComposition,
} from '@jkos/player/factory';
import { authFetch } from '@jkos/auth-client';
import type {
  BookmarkStore, CompatPolicy, CompatPrepareOutcome, CompatPrepareRequest, Id, ItemLoader, ProgressStore, Segment,
} from '@jkos/player/engine';
import { coverUrl as kourosCover, streamUrl as kourosStream } from '../api';
import { getTrack } from './api';
import type { Track } from '../api';
import {
  coverUrl as bookCover, createBookmark, createProgress, deleteBookmark, getBook, listBookmarks, listProgress,
  streamUrl as bookStream, updateProgress, type BookDetail,
} from '../books/api';

/** The catalogs a playable thing can come from. `kouros` is a track (the name
 *  predates the fold, and every persisted ref already says it); `book` an audiobook. */
export type SourceId = 'kouros' | 'book';

/** A decoded reference to one playable thing. */
export interface SourceRef {
  src: SourceId;
  id: number;
}

/** The source a bare id belongs to: a track, because every id already in a history
 *  row or a `requestPlay` call is a track id — changing what an unprefixed ref means
 *  would silently repoint them. */
const DEFAULT_SOURCE: SourceId = 'kouros';

export function encodeRef(src: SourceId, id: number): string {
  return `${src}:${id}`;
}

/** Decode a queue item / engine `Id`. Tolerates a bare number or numeric string
 *  (legacy KourOS ids) and an unknown prefix (falls back rather than throwing —
 *  a stale queue in localStorage must not brick the player). */
export function decodeRef(ref: Id): SourceRef {
  const s = String(ref);
  const colon = s.indexOf(':');
  if (colon < 0) return { src: DEFAULT_SOURCE, id: Number(s) };
  const head = s.slice(0, colon);
  const id = Number(s.slice(colon + 1));
  return { src: head === 'book' ? 'book' : DEFAULT_SOURCE, id };
}

/**
 * One playable thing, normalised across the two libraries.
 *
 * ⚠️ The normalisation is deliberately SHALLOW. It carries what a player has to
 * show — a name, a line under it, how long, where the art is — and nothing about
 * what the thing IS. Genre, series position, narrator, album artist and the rest
 * stay in the owning app's own shape, because the moment this interface starts
 * growing them it becomes a third schema that both apps have to keep in step,
 * which is exactly what the suite's declared-shape rule exists to avoid.
 */
export interface PlayableItem {
  ref: string;
  src: SourceId;
  id: number;
  kind: 'track' | 'book';
  title: string;
  /** Artist, or author + narrator — whatever reads under the title. */
  byline: string;
  /** Album, or series — the collection it belongs to, if any. */
  collection: string | null;
  /** Seconds, over the whole item (all files concatenated for a book). */
  duration: number;
  coverUrl: string | null;
  /** Chapters for a book; empty for a track. Drives the engine's nav points, and
   *  therefore the chapter dial. */
  segments: Segment[];
  /** The concatenated files. One for a track; N for a book. `compatReady` is a book
   *  file whose Firefox-safe remux already exists server-side — the compat policy
   *  below starts it there instead of discovering a decode failure first. */
  files: { index: number; duration: number; compatReady?: boolean }[];
}

/** What a source has to provide. Every seam the engine needs, plus the player
 *  SPEC — which is what makes the rune grammar retarget by kind without anything
 *  restating the music/audiobook distinction (see shell/runeBindings.ts). */
export interface PlayableSource {
  id: SourceId;
  composition: PlayerComposition;
  load(id: number): Promise<PlayableItem>;
  /** Everything this source can offer a library lane. */
  listen(): Promise<PlayableItem[]>;
}

/* ── KourOS: music ──────────────────────────────────────────────────────────── */

function trackToItem(t: Track): PlayableItem {
  return {
    ref: encodeRef('kouros', t.id),
    src: 'kouros',
    id: t.id,
    kind: 'track',
    title: t.title,
    byline: t.artist ?? 'Unknown artist',
    collection: t.album,
    duration: t.duration || 0,
    coverUrl: t.cover_path ? kourosCover(t.id) : null,
    // A `tracks` row is always exactly one file (the scanner's unit:'file'), and
    // music has no chapters — an empty segment list makes the engine's navPoints
    // fall back to one point spanning the whole track.
    segments: [],
    files: [{ index: 0, duration: t.duration || 0 }],
  };
}

const kourosSource: PlayableSource = {
  id: 'kouros',
  composition: createPlayer(musicPlayer()),
  load: async (id) => trackToItem(await getTrack(id)),
  listen: async () => [],
};

/* ── Audiobooks ──────────────────────────────────────────────────────────────── */

function bookToItem(b: BookDetail): PlayableItem {
  const files = [...b.files].sort((x, y) => x.index - y.index);
  return {
    ref: encodeRef('book', b.id),
    src: 'book',
    id: b.id,
    kind: 'book',
    title: b.title,
    byline: [b.author || 'Unknown author', b.narrator ? `read by ${b.narrator}` : null].filter(Boolean).join(' · '),
    collection: b.series,
    duration: b.duration || 0,
    coverUrl: b.cover_path ? bookCover(b.id) : null,
    // Chapters drive the engine's nav points — and therefore the chapter dial, the
    // segment-mode scrubber and the "end of chapter" sleep timer.
    segments: b.chapters.map((c) => ({ start: c.start, end: c.end, title: c.title })),
    files: files.map((f) => ({ index: f.index, duration: f.duration, compatReady: !!f.compat_ready })),
  };
}

const bookSource: PlayableSource = {
  id: 'book',
  composition: createPlayer(audiobookPlayer()),
  load: async (id) => bookToItem(await getBook(id)),
  listen: async () => [],
};

/* ── Resolution ─────────────────────────────────────────────────────────────── */

export const SOURCES: Record<SourceId, PlayableSource> = {
  kouros: kourosSource,
  book: bookSource,
};

export function sourceOf(ref: Id): PlayableSource {
  return SOURCES[decodeRef(ref).src];
}

/** Stream URL for one file of one item, dispatched on the ref. */
export function streamUrlFor(ref: Id, fileIndex = 0): string {
  const { src, id } = decodeRef(ref);
  return src === 'kouros' ? kourosStream(id, fileIndex) : bookStream(id, fileIndex);
}

/** Cover URL for an item, dispatched the same way. */
export function coverUrlFor(ref: Id): string {
  const { src, id } = decodeRef(ref);
  return src === 'kouros' ? kourosCover(id) : bookCover(id);
}

/** The player composition for whatever is loaded — `nav: 'track'` for music,
 *  `nav: 'segment'` for a book. Everything that behaves differently between the
 *  two reads THIS, rather than testing the kind itself. */
export function compositionFor(ref: Id | null): PlayerComposition | null {
  return ref == null ? null : sourceOf(ref).composition;
}

/* ── The engine's seams, dispatched ─────────────────────────────────────────── */

export const unifiedItemLoader: ItemLoader<PlayableItem> = {
  load: (itemId) => {
    const { src, id } = decodeRef(itemId);
    return SOURCES[src].load(id);
  },
  idOf: (item) => item.ref,
  sources: (item) => item.files,
  segments: (item) => item.segments,
};

export const unifiedUrls = {
  /** A compat level > 0 selects a book file's remux/re-encode variant (the brick's
   *  `?compat=N`). A track never gets one — music is direct-play only. */
  stream: (itemId: Id, sourceIndex: number, compatLevel = 0) =>
    compatLevel > 0 && decodeRef(itemId).src === 'book'
      ? `${streamUrlFor(itemId, sourceIndex)}?compat=${compatLevel}`
      : streamUrlFor(itemId, sourceIndex),
};

/** The compat ladder, for books only: some .m4b rips carry a `moov` Firefox
 *  rejects, and the server remuxes them (backend/src/books/media.js). A track
 *  prepares nothing — 'unavailable' stops the engine's ladder at once. */
async function prepareCompat(req: CompatPrepareRequest): Promise<CompatPrepareOutcome> {
  if (decodeRef(req.itemId).src !== 'book') return 'unavailable';
  try {
    const res = await authFetch(`${streamUrlFor(req.itemId, req.sourceIndex)}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: req.level }),
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      return body?.ready ? 'ready' : 'pending';
    }
    if (res.status >= 400 && res.status < 500) return 'unavailable';
    return 'pending';
  } catch {
    return 'pending';
  }
}

export const unifiedCompat: CompatPolicy<PlayableItem> = {
  maxLevel: 2,
  initialLevel: (item, sourceIndex) =>
    (item.kind === 'book' && item.files.find((f) => f.index === sourceIndex)?.compatReady ? 1 : 0),
  prepare: prepareCompat,
};

/** Whether the persisted playback rate applies: books yes, music never — one engine
 *  has one rate, and a 1.5× audiobook habit must not speed up a song. */
export const rateAppliesTo = (item: PlayableItem): boolean => item.kind === 'book';

/* The progress and bookmark stores, dispatched on the ref.
 *
 * ⚠️ Both are REAL implementations for both kinds, not `undefined`: the engine runs
 * its progress choreography unconditionally — a write scheduled every ~5 s of
 * playback, flushed on pause/hide/ended — so a missing store is a crash. A TRACK's
 * are inert on purpose: a song is not a place you come back to mid-way (Jag,
 * 2026-09-23: long-term resume is for audiobooks). A BOOK's are the load-bearing
 * thing an audiobook player does — the server-side `progress` row, one per
 * (listener, book), which every device reads, so a book paused on the phone resumes
 * on the desktop. */
export interface UnifiedProgressRow {
  itemId: Id;
  position: number;
  finished: boolean;
  /** The server row's id, for a book; null for the inert track rows. */
  rowId: number | null;
}

const isBook = (itemId: Id) => decodeRef(itemId).src === 'book';

export const unifiedProgress: ProgressStore<UnifiedProgressRow> = {
  find: async (itemId) => {
    if (!isBook(itemId)) return null;
    const { id } = decodeRef(itemId);
    const row = (await listProgress()).find((r) => r.book_ref === id);
    return row ? { itemId, position: row.position, finished: row.finished, rowId: row.id } : null;
  },
  create: async (w) => {
    if (!isBook(w.itemId)) return { itemId: w.itemId, position: w.position, finished: w.finished, rowId: null };
    const row = await createProgress({
      book_ref: decodeRef(w.itemId).id, position: w.position, duration: w.duration,
      last_played: w.playedAt, finished: w.finished,
    });
    return { itemId: w.itemId, position: row.position, finished: row.finished, rowId: row.id };
  },
  update: async (prev, w) => {
    if (!isBook(w.itemId) || prev.rowId == null) return { ...prev, position: w.position, finished: w.finished };
    const row = await updateProgress(prev.rowId, {
      book_ref: decodeRef(w.itemId).id, position: w.position, duration: w.duration,
      last_played: w.playedAt, finished: w.finished,
    });
    return { itemId: w.itemId, position: row.position, finished: row.finished, rowId: row.id };
  },
  itemIdOf: (row) => row.itemId,
};

export interface UnifiedBookmarkRow { id: Id; position: number; title: string | null }

export const unifiedBookmarks: BookmarkStore<UnifiedBookmarkRow> = {
  list: async (itemId) => {
    if (!isBook(itemId)) return [];
    const { id } = decodeRef(itemId);
    return (await listBookmarks())
      .filter((bm) => bm.book_ref === id)
      .map((bm) => ({ id: bm.id, position: bm.position, title: bm.title }));
  },
  create: async (w) => {
    if (!isBook(w.itemId)) return { id: `${w.itemId}`, position: w.position, title: w.title };
    const bm = await createBookmark({ book_ref: decodeRef(w.itemId).id, position: w.position, title: w.title });
    return { id: bm.id, position: bm.position, title: bm.title };
  },
  remove: async (id) => {
    // A track has no bookmarks to remove; a book's are numeric server ids.
    if (typeof id === 'number') await deleteBookmark(id);
  },
};

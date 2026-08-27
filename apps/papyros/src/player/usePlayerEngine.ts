// usePlayerEngine.ts — PapyrOS's THIN adapter over @jkos/player's headless engine
// (git history: Wave 15 item 15.4: PapyrOS migrates onto the primitive). All the
// position math, the compat-recovery ladder, the progress/bookmark write
// choreography, and the sleep timer that used to live in this file now live in
// @jkos/player/engine's usePlayerEngine (Layer 1) — a verbatim generalization of what
// used to be here (see packages/player/src/engine). This file now only:
//   1. Builds the PlayerEngineConfig from ../api.ts + ./controller.ts (the "recipes"
//      below) — every URL / request-body shape here is byte-identical to what this
//      file sent before the migration (see the wave-15.4 handoff report's diff).
//   2. Composes @jkos/player/services' useMediaSession next to the engine (item
//      16.3 — the wiring the engine used to own inline, plus the previously missing
//      setPositionState so the lock-screen scrubber tracks the real position).
//   3. Re-exposes the engine's generalized PlayerApi under PapyrOS's ORIGINAL names
//      (book/chapterLabel/prevChapter/nextChapter/sleepMode:'chapter') so
//      PlayerBar.tsx and every other consumer need ZERO changes.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { authFetch } from '@jkos/auth-client';
import { createHtmlMediaBackend } from '@jkos/player/backend';
import {
  usePlayerEngine as usePlayerEngineCore, RATE_PRESETS,
  type BookmarkStore, type CompatPolicy, type CompatPrepareOutcome, type CompatPrepareRequest,
  type ItemLoader, type NavPoint, type PlayerEngineConfig, type PlayerUrls, type ProgressStore,
  type SleepMode as EngineSleepMode, type Transport,
} from '@jkos/player/engine';
import { useMediaSession, type MediaSessionMetadata } from '@jkos/player/services';
import {
  coverUrl, createBookmark, createHistoryEvent, createProgress, deleteBookmark, getBook,
  listBookmarks, listProgress, streamUrl, updateProgress,
  type BookDetail, type BookmarkRow, type ProgressRow,
} from '../api';
import { onPlayRequest, publishPosition as ctrlPublishPosition, type PlayRequest } from './controller';

export { RATE_PRESETS };
export type SleepMode = 'off' | '15' | '30' | '45' | '60' | 'chapter';

const STORAGE_KEY = 'papyros.player.rate';   // papyros-namespaced (unchanged — persisted user data must survive the migration)
const VOLUME_STORAGE_KEY = 'papyros.player.volume';   // Wave 16.2 — new key; rate's key above is untouched
const SKIP_SEC = 30;   // MediaSession seek± step — mirrors the engine's ±30s skip (was the engine's own SKIP_SEC pre-16.3)

// ── 'chapter' (papyros UI copy) ⇄ 'segment' (the engine's generalized vocabulary) ──
function toEngineSleep(mode: SleepMode): EngineSleepMode {
  return mode === 'chapter' ? 'segment' : mode;
}
function fromEngineSleep(mode: EngineSleepMode): SleepMode {
  return mode === 'segment' ? 'chapter' : mode;
}

export interface PlayerApi {
  visible: boolean;
  book: BookDetail | null;
  playing: boolean;
  buffering: boolean;
  /** Human-readable playback failure (decode/network/autoplay-blocked), null when fine. */
  error: string | null;
  globalPos: number;
  total: number;
  rate: number;
  /** Wave 16.2 pass-through. PapyrOS's audiobook bar renders NO volume control
   *  (git history: PLAYER_PARITY.md, retired: volume belongs to the music preset) — exposed here only so
   *  the adapter stays a full mirror of the engine surface. */
  volume: number;
  muted: boolean;
  points: NavPoint[];
  currentIndex: number;
  chapterLabel: string | null;
  bookmarks: BookmarkRow[];
  sleepMode: SleepMode;
  sleepRemainingMs: number | null;
  toggle(): void;
  seekTo(globalSec: number): void;
  skip(deltaSec: number): void;
  prevChapter(): void;
  nextChapter(): void;
  cycleRate(): void;
  setVolume(level: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  setSleep(mode: SleepMode): void;
  addBookmarkHere(): void;
  jumpBookmark(pos: number): void;
  removeBookmark(id: number): void;
}

// ── Adapter recipes (../api.ts → the engine's seams) ────────────────────────────────
// Every field set below matches exactly what usePlayerEngine.ts sent on the wire
// before this migration — see the wave-15.4 handoff report for the diff that verifies
// byte-identity (stream/cover/prepare URLs, progress/bookmark request bodies).

const itemLoader: ItemLoader<BookDetail> = {
  load: (itemId) => getBook(itemId as number),   // papyros ids are always numbers (⊂ Id)
  idOf: (item) => item.id,
  sources: (item) => item.files,
  segments: (item) => item.chapters,
};

const progress: ProgressStore<ProgressRow> = {
  find: async (itemId) => (await listProgress()).find((r) => r.book_ref === itemId) ?? null,
  // Same field set on create AND update — matches the original doWrite's single
  // `payload` object, sent unchanged to createProgress() or updateProgress().
  create: (w) => createProgress({
    book_ref: w.itemId as number, position: w.position, duration: w.duration,
    last_played: w.playedAt, finished: w.finished,
  }),
  update: (row, w) => updateProgress(row.id, {
    book_ref: w.itemId as number, position: w.position, duration: w.duration,
    last_played: w.playedAt, finished: w.finished,
  }),
  itemIdOf: (row) => row.book_ref,
};

const bookmarks: BookmarkStore<BookmarkRow> = {
  list: async (itemId) => (await listBookmarks()).filter((bm) => bm.book_ref === itemId),
  create: (w) => createBookmark({ book_ref: w.itemId as number, position: w.position, title: w.title }),
  remove: deleteBookmark,
};

const urls: PlayerUrls = {
  stream: (itemId, sourceIndex, compatLevel) =>
    compatLevel > 0
      ? `${streamUrl(itemId as number, sourceIndex)}?compat=${compatLevel}`
      : streamUrl(itemId as number, sourceIndex),
};

const transport: Transport = {
  subscribe: (handler) => onPlayRequest((req: PlayRequest) => handler({ itemId: req.bookId, position: req.position })),
  publishPosition: (update) => ctrlPublishPosition({ bookId: update.itemId as number, globalPos: update.position }),
};

/** Single-shot POST <streamUrl>/prepare — matches attemptCompatRecovery's original
 *  per-attempt fetch exactly: res.ok+body.ready → 'ready'; res.ok+!body.ready →
 *  'pending' (engine keeps polling); a 4xx status → 'unavailable' (engine gives up
 *  this rung); anything else (5xx, a thrown fetch/parse) → 'pending'. The engine's
 *  poll loop owns the reqSeq guard, the interval sleep, and the timeout bound around
 *  this single call — this function is only the probe. */
async function prepare(req: CompatPrepareRequest): Promise<CompatPrepareOutcome> {
  try {
    const res = await authFetch(`${streamUrl(req.itemId as number, req.sourceIndex)}/prepare`, {
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

const compat: CompatPolicy<BookDetail> = {
  maxLevel: 2,
  initialLevel: (item, sourceIndex) => (item.files.find((f) => f.index === sourceIndex)?.compat_ready ? 1 : 0),
  prepare,
};

export function usePlayerEngine(): PlayerApi {
  // Stable-identity config — built once; every recipe above is a module-level pure
  // function closing only over ../api.ts / ./controller.ts, so there is nothing
  // per-render to capture (mirrors the engine's own stable-closures-over-refs design).
  const config = useMemo<PlayerEngineConfig<BookDetail, ProgressRow, BookmarkRow>>(() => ({
    // No element passed → the backend creates its own stable-identity <audio
    // preload="auto">, which is exactly what `new Audio()` did here pre-migration.
    backend: () => createHtmlMediaBackend(),
    itemLoader,
    progress,
    bookmarks,
    urls,
    transport,
    storageKey: STORAGE_KEY,
    volumeStorageKey: VOLUME_STORAGE_KEY,
    compat,
    // messages: omitted — DEFAULT_MESSAGES reproduces PapyrOS's exact user-facing
    // copy byte-for-byte (verified against this file pre-migration).
  }), []);

  const eng = usePlayerEngineCore(config);

  // ── MediaSession (item 16.3): composed from the Layer-2 service, no longer inside
  // the engine. Metadata + handlers replicate the engine's old inline block exactly
  // (title/author/series, the 512x512 JPEG cover via coverUrl, play/pause → toggle,
  // seek± → skip(∓30), prev/next → chapter nav, seekto with its type guard); the
  // position sample is the NEW piece — setPositionState fed from globalPos/total/rate
  // so the lock-screen scrubber finally tracks the whole-timeline position. Nothing
  // installs until a book is loaded, matching the old on-load wiring.
  const book = eng.item;

  // ── Play-history recording (17.4) ──────────────────────────────────────────────
  // One append-only /api/history row per LISTENING SESSION. Lives here (app code),
  // not in @jkos/player/engine — that package is under a zero-behavior-change
  // contract, so this is built entirely on the engine's PUBLIC surface (eng.playing/
  // eng.item/eng.globalPos/eng.total), independent listeners of its own, no engine
  // edit. A "session" is one continuous playing stretch: it opens when playback
  // starts (captures started_at) and closes — POSTing exactly one row with the
  // accumulated ms_played + whether the book finished — at the same boundaries the
  // engine already flushes `progress` at: pause, switching to a different book, and
  // the page going hidden/unloading. Hidden is the one CLOSE that isn't an END:
  // audio keeps playing under a locked screen / backgrounded tab (the dominant
  // audiobook mode), so the hidden handler banks a row and immediately reopens —
  // the listening splits into one row per hide, none of it lost. Debounce-safe by
  // construction: nothing here is
  // driven by 'timeupdate', only by the playing/item edges below, so a session can
  // only ever produce ONE row when it closes, never one per tick.
  interface HistorySession { bookId: number; startedAt: string; playStartedAtMs: number }
  const sessionRef = useRef<HistorySession | null>(null);
  const prevBookIdRef = useRef<number | null>(null);
  const prevPlayingRef = useRef(false);
  // Mirrored every render (cheap — no listeners) so the mount-only hidden/unload
  // effect below always reads the LATEST position/duration, not values captured
  // when it was first installed.
  const totalRef = useRef(eng.total);
  const globalPosRef = useRef(eng.globalPos);
  totalRef.current = eng.total;
  globalPosRef.current = eng.globalPos;

  // Below the MINIMUM_MS_PLAYED floor, drop the row rather than record it — an
  // instant play/pause tap (or a session boundary firing with ~0ms elapsed, e.g. two
  // triggers landing back-to-back) is noise, not a listening session.
  const MINIMUM_MS_PLAYED = 1000;
  const flushSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    const msPlayed = Math.round(Math.max(0, Date.now() - session.playStartedAtMs));
    if (msPlayed < MINIMUM_MS_PLAYED) return;
    const total = totalRef.current;
    const pos = globalPosRef.current;
    const completed = total > 0 && pos >= total - 1;
    createHistoryEvent({ item_ref: session.bookId, started_at: session.startedAt, ms_played: msPlayed, completed })
      .catch((err) => console.warn('[papyros] failed to record history event', err));
  }, []);

  // Session open/close, driven by the playing/book-id edges (never by timeupdate).
  useEffect(() => {
    const bookId = book?.id ?? null;
    const bookChanged = prevBookIdRef.current !== null && bookId !== prevBookIdRef.current;
    if (bookChanged && sessionRef.current) flushSession();   // switched books mid-session → close it

    if (eng.playing) {
      // Open a session when none is active, OR the book just changed underneath an
      // uninterrupted play (no false→true edge to key off in that case).
      if (bookId !== null && (!sessionRef.current || bookChanged)) {
        sessionRef.current = { bookId, startedAt: new Date().toISOString(), playStartedAtMs: Date.now() };
      }
    } else if (prevPlayingRef.current) {
      flushSession();   // playing → paused edge
    }

    prevBookIdRef.current = bookId;
    prevPlayingRef.current = eng.playing;
  }, [eng.playing, book?.id, flushSession]);

  // Page hidden/unload — same seam the engine's own progress flush uses (its
  // internal visibilitychange/beforeunload listeners), mirrored independently here
  // with our own listeners rather than reaching into the engine.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      flushSession();
      // Audio keeps playing while hidden, and the open edge above is paused→playing
      // — which a still-playing tab never fires again. Without this reopen, every
      // second of screen-locked listening after the first hide would go unrecorded
      // until the next manual pause/play. The row just flushed banks everything up
      // to the lock in case the tab is killed while hidden.
      if (prevPlayingRef.current && prevBookIdRef.current !== null) {
        sessionRef.current = {
          bookId: prevBookIdRef.current,
          startedAt: new Date().toISOString(),
          playStartedAtMs: Date.now(),
        };
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', flushSession);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', flushSession);
    };
  }, [flushSession]);

  const metadata = useMemo<MediaSessionMetadata | null>(() => (book ? {
    title: book.title,
    artist: book.author ?? '',
    album: book.series ?? '',
    artwork: book.cover_path ? [{ src: coverUrl(book.id), sizes: '512x512', type: 'image/jpeg' }] : [],
  } : null), [book]);
  useMediaSession({
    enabled: book != null,
    metadata,
    handlers: {
      play: eng.toggle,
      pause: eng.toggle,
      seekbackward: () => eng.skip(-SKIP_SEC),
      seekforward: () => eng.skip(SKIP_SEC),
      previoustrack: eng.prevSegment,
      nexttrack: eng.nextSegment,
      seekto: eng.seekTo,
    },
    playing: eng.playing,
    position: { position: eng.globalPos, duration: eng.total, playbackRate: eng.rate },
  });

  return {
    visible: eng.visible,
    book: eng.item,
    playing: eng.playing,
    buffering: eng.buffering,
    error: eng.error,
    globalPos: eng.globalPos,
    total: eng.total,
    rate: eng.rate,
    volume: eng.volume,
    muted: eng.muted,
    points: eng.points,
    currentIndex: eng.currentIndex,
    chapterLabel: eng.segmentLabel,
    bookmarks: eng.bookmarks,
    sleepMode: fromEngineSleep(eng.sleepMode),
    sleepRemainingMs: eng.sleepRemainingMs,
    toggle: eng.toggle,
    seekTo: eng.seekTo,
    skip: eng.skip,
    prevChapter: eng.prevSegment,
    nextChapter: eng.nextSegment,
    cycleRate: eng.cycleRate,
    setVolume: eng.setVolume,
    setMuted: eng.setMuted,
    toggleMute: eng.toggleMute,
    setSleep: (mode) => eng.setSleep(toEngineSleep(mode)),
    addBookmarkHere: eng.addBookmarkHere,
    jumpBookmark: eng.jumpBookmark,
    removeBookmark: eng.removeBookmark,
  };
}

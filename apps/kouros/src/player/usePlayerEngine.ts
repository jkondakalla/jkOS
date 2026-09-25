// player/usePlayerEngine.ts — KourOS's adapter over @jkos/player's headless engine
// (git history: Wave 18 item 18.4 — consumer #2, "the one that actually proves the
// primitive"). Its shape is a thin
// recipe layer over the package's usePlayerEngine (plus MediaSession + a history
// session recorder built on the engine's PUBLIC surface), with ONE structural
// addition a single-book player never needed: a QUEUE. The player design record's model (git
// history, PLAYER_PARITY.md, retired) is "music = N single-file Timelines + a
// cursor" — the package's engine drives exactly ONE
// Timeline; everything queue-shaped (shuffle, repeat, prev/next TRACK, reorder) is
// composed HERE, in app code, over @jkos/player/core/queue's pure reducers. See this
// wave's handoff report for the full verdict on why (short version: the engine has no
// "ended, and there is nothing more to load" callback — onEnded either advances
// within the current item's sources or goes silent — so the queue layer has to
// observe the engine's PUBLIC playing/globalPos/total surface for the natural-end
// edge, the same "observe public state, don't reach inside" technique the
// history recorder uses for its session boundaries).
//
// 18.5 layers the gaplessDual backend under the same engine: prepared boundaries swap
// backend-internally (gapless or crossfaded) and advance the queue through the SWAP
// HANDSHAKE section below; unprepared/degraded boundaries still flow through the
// playing-edge auto-advance. See the two long comments at those sites.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createGaplessDualBackend, isGaplessBackend,
  type MediaBackend, type SwapInfo,
} from '@jkos/player/backend';
import {
  usePlayerEngine as usePlayerEngineCore,
  type NavPoint, type PlayerEngineConfig, type SleepMode, type Transport,
} from '@jkos/player/engine';
import { useMediaSession, type MediaSessionMetadata } from '@jkos/player/services';
import {
  EMPTY_QUEUE, append, insertNext, next, prev, reorder, repeat as repeatQueue, shuffle as shuffleQueue,
  type Queue, type RepeatMode,
} from '@jkos/player/core';
import type { Track } from '../api';
import { createHistoryEvent, useTrackCache } from './api';
import { createBookHistoryEvent } from '../books/api';
import {
  compositionFor, decodeRef, rateAppliesTo, streamUrlFor,
  unifiedBookmarks, unifiedCompat, unifiedItemLoader, unifiedProgress, unifiedUrls,
  type PlayableItem, type SourceId, type UnifiedBookmarkRow, type UnifiedProgressRow,
} from './sources';
import type { PlayerComposition } from '@jkos/player/factory';
import { onLocalPlayRequest, publishPosition as ctrlPublishPosition, requestLocalPlay, type PlayRequest } from './controller';
import { clampCrossfadeSec, readQueuePrefs, removeAt, sameItems, writeQueuePrefs } from './queuePrefs';

/** The audiobook listening rate. ONE key for one engine — `rateAppliesTo` (sources.ts)
 *  keeps it off music, so a 1.5× book habit never speeds up a song. */
const RATE_STORAGE_KEY = 'kouros.player.rate';
/** The ±skip a book's transport and lock screen take. */
export const BOOK_SKIP_SEC = 30;
const VOLUME_STORAGE_KEY = 'kouros.player.volume';   // musicPlayer() renders a volume control — this is what persists it

export interface PlayerApi {
  visible: boolean;
  /** The current item, normalised across both libraries — what any surface that
   *  does not care whether it is a track or a book should read. */
  item: PlayableItem | null;
  /** What that item can do, from @jkos/player's factory. The rune bindings and
   *  any control list derive from this. Null when nothing is loaded. */
  composition: PlayerComposition | null;
  /** The music-shaped view of the current item — **null while a book plays**.
   *  Only the music-specific views (artist/album links, the Pulsarmap, radio)
   *  should read it; everything else wants `item`. */
  track: Track | null;
  playing: boolean;
  buffering: boolean;
  error: string | null;
  globalPos: number;
  /** The media element's own time, read at call time — for a view that moves every
   *  frame (the pulsarmap). `globalPos` is the same clock published at ~4 Hz. */
  livePosition(): number;
  total: number;
  volume: number;
  muted: boolean;
  queue: Queue;
  /** Where the queue was played FROM (player/context.ts), or null for an ad-hoc list. */
  context: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Crossfade seconds (0 = gapless) — the 18.5 knob, persisted with shuffle/repeat. */
  crossfadeSec: number;
  tracksById: ReadonlyMap<number, Track>;
  toggle(): void;
  seekTo(seconds: number): void;
  trackPrev(): void;
  trackNext(): void;
  setVolume(level: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  /** Set the repeat mode outright — what a remote's `repeat` command names. */
  setRepeat(mode: RepeatMode): void;
  setCrossfade(sec: number): void;
  /* ── Segment (chapter) nav ────────────────────────────────────────────────
     Present for BOTH kinds, and inert for music by construction rather than by
     a branch: a track carries no segments, so `points` is the engine's
     one-point-per-source fallback and every call below is a no-op. That is why
     nothing has to ask "is this a book?" before offering them — the item's own
     shape answers. */
  /** Nav points over the current item — chapters for a book, one span for a track. */
  points: NavPoint[];
  /** Index into `points` the position currently sits in. */
  segmentIndex: number;
  /** The current chapter's name, when it has one. */
  segmentLabel: string | null;
  prevSegment(): void;
  nextSegment(): void;
  /** Jump to a chapter by index — what the chapter dial turns. */
  seekSegment(index: number): void;
  /* ── The audiobook verbs ──────────────────────────────────────────────────
     Present for BOTH kinds, like segment nav: inert for music by construction
     (the rate does not apply to a track, a track has no bookmarks), so a surface
     offers them by reading `composition`, never by asking "is this a book?". */
  /** The rate the element is running at — always 1 for a track. */
  rate: number;
  cycleRate(): void;
  /** Jump by ±seconds along the item's timeline. */
  skip(deltaSec: number): void;
  bookmarks: UnifiedBookmarkRow[];
  addBookmarkHere(): void;
  jumpBookmark(pos: number): void;
  removeBookmark(id: UnifiedBookmarkRow['id']): void;
  sleepMode: SleepMode;
  sleepRemainingMs: number | null;
  setSleep(mode: SleepMode): void;
  playQueueItem(index: number): void;
  removeQueueItem(index: number): void;
  reorderQueue(from: number, to: number): void;
  /** Insert tracks to play immediately AFTER the current one. */
  playNext(ids: number[]): void;
  /** Append tracks to the end of the queue. */
  addToQueue(ids: number[]): void;
  /** Replace the queue entirely and start at `startIndex`. */
  playNow(ids: number[], startIndex?: number): void;
}

// ── Adapter recipes (./api.ts → the engine's seams) ─────────────────────────────────

/* ── The seams, dispatched ───────────────────────────────────────────────────
   The engine's itemLoader / urls / progress / bookmarks used to be four KourOS
   specific objects defined right here. They now come from player/sources.ts,
   which routes each one to the catalog that OWNS the thing being played —
   tracks or books, both on this backend.

   ⚠️ The dispatch is on the composite REF, not on a mode flag. There is no
   "audiobook mode" to be in or out of sync with: a queue may hold both kinds at
   once, and each item is resolved by the source named in its own id. A mode flag
   is the version of this that works until the first mixed queue. */

function clampIndex(i: number, n: number): number {
  if (n === 0) return -1;
  return Math.min(Math.max(i, 0), n - 1);
}

/** What only THIS tab's engine can do — the listening session drives it, no surface does. */
export interface LocalPlayerApi extends PlayerApi {
  /** Idempotent start/stop — what the session calls, because it acts on a command or
   *  an edge in the same tick the rendered `playing` has not caught up with, and a
   *  toggle guarded by a stale flag flips the wrong way (the engine's own note). */
  play(): void;
  pause(): void;
  /** Load a session's queue VERBATIM — items, cursor, shuffle order, repeat — and
   *  its current item at `position` seconds, playing or cued. A plain requestPlay
   *  would rebuild the policy from this tab's own preference and re-roll the shuffle,
   *  and a hand-off must continue the SAME walk, not start a new one. */
  adopt(a: { queue: Queue; context: string | null; position: number; autoplay: boolean }): void;
}

export interface EngineOptions {
  /** Own the lock screen / media keys. False while this tab is a REMOTE for another
   *  device: a controller has no audio to own them with, and a play pressed there
   *  would start THIS tab's copy of a session playing somewhere else. */
  mediaSession?: boolean;
}

export function usePlayerEngine(opts: EngineOptions = {}): LocalPlayerApi {
  const mediaSessionOn = opts.mediaSession !== false;
  // ── Queue state — the layer @jkos/player/engine does not have (see file header).
  // `queueRef` is the authoritative live value (read inside the stable `transport`
  // closure below, same refs-in-listeners shape the package engine itself uses);
  // `queue` (useState) is only the render mirror. Restoring persisted shuffle/repeat
  // onto an EMPTY queue at mount means the very first requestPlay() already carries
  // the user's standing preference forward — no separate "first load" special case.
  const queueRef = useRef<Queue | null>(null);
  if (!queueRef.current) {
    const prefs = readQueuePrefs();
    queueRef.current = { ...EMPTY_QUEUE, policy: { ...EMPTY_QUEUE.policy, shuffle: prefs.shuffle, repeat: prefs.repeat } };
  }
  const [queue, setQueue] = useState<Queue>(queueRef.current);
  /** Where the live queue came from — replaced with every NEW list, kept across a
   *  cursor move within the same one (a skip is still "playing the album"). The
   *  history recorder stamps it on each track listen; Home groups by it. */
  const contextRef = useRef<string | null>(null);
  const [context, setContext] = useState<string | null>(null);

  // ── Crossfade knob (18.5) — same persistence register as shuffle/repeat
  // (queuePrefs.ts); crossfadeRef mirrors the state so the stable ([]-dep) shuffle/
  // repeat callbacks below can persist the full prefs row without a stale closure.
  const [crossfadeSec, setCrossfadeState] = useState<number>(() => readQueuePrefs().crossfadeSec);
  const crossfadeRef = useRef(crossfadeSec);

  /** The ONE place a track (or a different position in the current one) is asked to
   *  start playing — always through controller.ts's requestLocalPlay, the channel a
   *  library view's request also lands on when this tab is the output. trackPrev/trackNext, a <QueuePanel> row tap, and the
   *  end-of-track auto-advance below all fund through this, so "what the queue
   *  believes is playing" and "what the engine is actually playing" can never drift:
   *  transport.subscribe (below) is the only writer of queueRef/queue, and every
   *  path that changes what's PLAYING goes through it. */
  const playIndex = useCallback((index: number, position?: number) => {
    // The queue's items are already refs (strings). Round-tripping them through
    // Number() here is what would quietly turn 'book:7' into NaN the first
    // time a book joined the queue.
    const ids = queueRef.current!.items;
    if (index < 0 || index >= ids.length) return;
    requestLocalPlay({ trackIds: ids, startIndex: index, position });
  }, []);

  // ── Transport seam — built once. Bridges controller.ts's QUEUE-shaped PlayRequest
  // ({trackIds, startIndex}) onto the engine's single-ITEM EngineRequest ({itemId}),
  // and is where a new queue gets built (or an existing one just gets a new cursor —
  // see the sameItems() branch, which is what keeps shuffleOrder STABLE across a
  // skip: core/queue's header is explicit that only a structural change should
  // resync it, never a cursor move). ─────────────────────────────────────────────
  const transport: Transport = useMemo(() => ({
    subscribe: (handler) => onLocalPlayRequest((req: PlayRequest) => {
      const ids = req.trackIds.map(String);
      const startIndex = clampIndex(req.startIndex, ids.length);
      if (startIndex < 0) return;   // an empty queue request — nothing to play

      const prevQ = queueRef.current!;
      let q: Queue;
      if (sameItems(prevQ.items, ids)) {
        // Same track list (internal nav / a queue-row tap) — keep the existing
        // policy AND shuffleOrder verbatim; only the cursor moves. The context
        // stays too, unless the request names one (the same album re-played from
        // its own page says so explicitly).
        q = { ...prevQ, cursor: startIndex };
        if (req.context !== undefined) contextRef.current = req.context || null;
      } else {
        contextRef.current = req.context || null;
        // A genuinely new list (a library view asked to play an album/playlist) —
        // rebuild, but carry the USER's standing shuffle/repeat settings forward
        // (they're a player-wide preference, not per-queue) with a fresh shuffle
        // permutation for the new item count.
        q = { items: ids, cursor: startIndex, policy: { ...prevQ.policy, shuffleOrder: [] } };
        if (prevQ.policy.shuffle) q = shuffleQueue(q, true, Date.now());
      }
      queueRef.current = q;
      setQueue(q);
      setContext(contextRef.current);
      handler({ itemId: req.trackIds[startIndex], position: req.position, autoplay: req.autoplay });
    }),
    publishPosition: (update) => {
      // ⚠️ This used to be `update.itemId as number`, and that cast became a LIE
      // the moment an item id could be a composite ref: the consumers are music
      // rows comparing `trackId === track.id`, and a string never equals a
      // number, so every "currently playing" mark would simply stop appearing —
      // no error, no warning, just a feature quietly gone. It is the same
      // TEXT-vs-number class that once hid four bugs behind a TypeScript
      // interface that declared the wrong thing (TRAPS.md § SQLite).
      const { src, id } = decodeRef(update.itemId);
      // Book 7 and track 7 are different things: each is published under its own
      // field, so a track row and a book's chapter list can never mistake one for
      // the other.
      ctrlPublishPosition(src === 'book'
        ? { trackId: null, bookId: id, position: update.position }
        : { trackId: id, bookId: null, position: update.position });
    },
  }), []);

  // ── The backend (18.5): gaplessDual instead of 15.2's htmlMedia. To the ENGINE it
  // is a plain MediaBackend (the engine's six invariants hold untouched); the gapless
  // extension (prepareNext / crossfadeSec / onSwap) is consumed only HERE, in the
  // adapter, behind isGaplessBackend feature detection — see the swap-handshake
  // section below. backendHandleRef holds the instance the engine's mount effect
  // creates (that effect runs before this component's own effects — hook order — so
  // every effect below can read it).
  const backendHandleRef = useRef<MediaBackend | null>(null);

  const config = useMemo<PlayerEngineConfig<PlayableItem, UnifiedProgressRow, UnifiedBookmarkRow>>(() => ({
    backend: () => {
      const b = createGaplessDualBackend({ crossfadeSec: readQueuePrefs().crossfadeSec });
      backendHandleRef.current = b;
      return b;
    },
    itemLoader: unifiedItemLoader,
    progress: unifiedProgress,
    bookmarks: unifiedBookmarks,
    urls: unifiedUrls,
    transport,
    storageKey: RATE_STORAGE_KEY,
    volumeStorageKey: VOLUME_STORAGE_KEY,
    // Books carry the Firefox-m4b remux ladder; a track prepares nothing and
    // the ladder stops at once (sources.ts's unifiedCompat).
    compat: unifiedCompat,
    rateApplies: rateAppliesTo,
  }), [transport]);

  const eng = usePlayerEngineCore(config);
  /** The normalised item — a track or a book, from either library. */
  const item = eng.item;
  const tracksById = useTrackCache();

  /* ⚠️ `track` is the MUSIC-SHAPED view of the current item, and it is null when
     a book is playing. The music views (Now Playing's artist/album links, the
     Pulsarmap, "start a station") are built on fields only a track has, so
     handing them a normalised item would be a lie the types would not catch.
     Narrowing here instead means each of those views gets a null it must handle
     the day the audiobook arm is fed — a visible gap to close, not a silent
     wrong render. `item` is what everything kind-agnostic should read. */
  const track: Track | null =
    item && item.src === 'kouros' ? tracksById.get(item.id) ?? null : null;

  /** What the current item CAN do — `nav: 'track'` for music, `'segment'` for a
   *  book. The rune grammar is derived from this (shell/runeBindings.ts) rather
   *  than from a second table that could drift from the player. */
  const composition: PlayerComposition | null = compositionFor(item?.ref ?? null);

  // ── Queue navigation (prev/next TRACK — walks the Queue via core/queue's pure
  // next()/prev(), never the engine's segment nav) ───────────────────────────────
  const stepQueue = useCallback((dir: 'next' | 'prev') => {
    const q0 = queueRef.current!;
    if (q0.items.length === 0) return;
    const q1 = dir === 'next' ? next(q0) : prev(q0);
    // next()/prev() no-op (cursor unchanged) at a genuine edge with repeat 'off', OR
    // whenever repeat is 'one' (its documented behavior — the reducer explicitly
    // leaves restart-in-place to the caller). A manual skip button does NOT special-
    // case repeat-one back into "restart the same track": it's queue navigation, so
    // while repeat-one is armed the transport simply won't move — turning repeat off
    // (or all) is what re-arms prev/next, exactly mirroring what the reducer itself
    // documents as its contract.
    if (q1.cursor === q0.cursor) return;
    playIndex(q1.cursor, 0);
  }, [playIndex]);
  const trackPrev = useCallback(() => stepQueue('prev'), [stepQueue]);
  const trackNext = useCallback(() => stepQueue('next'), [stepQueue]);

  /** End-of-track auto-advance — the queue-shaped analogue of the engine's own
   *  onEnded. Since 18.5 this is the advance path for NON-SWAP endings only: when the
   *  gaplessDual backend has a prepared next it swaps internally and `playing` never
   *  flips false (the swap handshake section below advances the cursor instead — the
   *  two paths are mutually exclusive by construction). This edge still owns:
   *  repeat-'one' restarts, the exhausted queue, and every degraded boundary (no
   *  prepared next, preload not ready / preload error → the backend forwards 'ended'
   *  and the advance costs a normal load). Built ENTIRELY on the engine's public
   *  surface (eng.playing/globalPos/total),
   *  because there is no callback for "the engine reached the end of the whole item
   *  and stopped" (packages/player/src/engine/usePlayerEngine.ts's onEnded either
   *  loads the item's NEXT source, or — when there is none, music's case, always —
   *  sets playing=false and globalPos=total and goes silent; nothing in
   *  PlayerEngineConfig/PlayerApi surfaces that transition as an event). The
   *  playing:true→false edge is ambiguous on its own (a user pause looks identical);
   *  globalPos having snapped to total (which onEnded does explicitly, before
   *  flipping playing) is what disambiguates "the track finished" from "someone hit
   *  pause". See this wave's report for the full verdict — this is the primitive's
   *  one real queue-composition gap. */
  const advanceOnEnded = useCallback(() => {
    const q0 = queueRef.current!;
    if (q0.items.length === 0 || q0.cursor < 0) return;
    if (q0.policy.repeat === 'one') { playIndex(q0.cursor, 0); return; }   // loop the same track
    const q1 = next(q0);
    if (q1.cursor === q0.cursor) return;   // queue exhausted (repeat off, last item) — stay put, stay paused
    playIndex(q1.cursor, 0);
  }, [playIndex]);

  const prevPlayingRef = useRef(false);
  useEffect(() => {
    const was = prevPlayingRef.current;
    prevPlayingRef.current = eng.playing;
    if (was && !eng.playing && eng.total > 0 && eng.globalPos >= eng.total - 0.25) {
      advanceOnEnded();
    }
    // Deliberately narrow: this only needs to re-run on the playing EDGE. globalPos/
    // total are read fresh off `eng` (this render's values) at the moment the edge
    // fires, which is correct because onEnded's setGlobalPos+setPlaying land in the
    // same React commit (batched) — by the time this effect runs, both are current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng.playing]);

  // ── Shuffle / repeat / reorder / remove — pure local state, no requestPlay round
  // trip (they change future queue order, never what's currently loaded) ─────────
  const setShuffle = useCallback((on: boolean) => {
    const q = shuffleQueue(queueRef.current!, on, on ? Date.now() : undefined);
    queueRef.current = q;
    setQueue(q);
    writeQueuePrefs({ shuffle: q.policy.shuffle, repeat: q.policy.repeat, crossfadeSec: crossfadeRef.current });
  }, []);

  const setRepeat = useCallback((mode: RepeatMode) => {
    const q = repeatQueue(queueRef.current!, mode);
    queueRef.current = q;
    setQueue(q);
    writeQueuePrefs({ shuffle: q.policy.shuffle, repeat: q.policy.repeat, crossfadeSec: crossfadeRef.current });
  }, []);

  const adopt = useCallback((a: { queue: Queue; context: string | null; position: number; autoplay: boolean }) => {
    const q = a.queue;
    if (q.items.length === 0 || q.cursor < 0) return;
    // Installed BEFORE the request, so the transport's sameItems() branch sees the
    // same list and keeps this policy verbatim, moving only the cursor.
    queueRef.current = { items: [...q.items], cursor: q.cursor, policy: { ...q.policy, shuffleOrder: [...q.policy.shuffleOrder] } };
    contextRef.current = a.context;
    setQueue(queueRef.current);
    setContext(a.context);
    requestLocalPlay({ trackIds: q.items, startIndex: q.cursor, position: a.position, autoplay: a.autoplay });
  }, []);

  const cycleRepeat = useCallback(() => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const modeNext = order[(order.indexOf(queueRef.current!.policy.repeat) + 1) % order.length];
    const q = repeatQueue(queueRef.current!, modeNext);
    queueRef.current = q;
    setQueue(q);
    writeQueuePrefs({ shuffle: q.policy.shuffle, repeat: q.policy.repeat, crossfadeSec: crossfadeRef.current });
  }, []);

  /** The 18.5 user knob: crossfade seconds, 0 = gapless. Applied live to the backend
   *  (affects the NEXT boundary; a ramp already running keeps its duration) and
   *  persisted in the same queuePrefs row as shuffle/repeat. */
  const setCrossfade = useCallback((sec: number) => {
    const clamped = clampCrossfadeSec(Math.round(sec));
    crossfadeRef.current = clamped;
    setCrossfadeState(clamped);
    const b = backendHandleRef.current;
    if (b && isGaplessBackend(b)) b.crossfadeSec = clamped;
    const q = queueRef.current!;
    writeQueuePrefs({ shuffle: q.policy.shuffle, repeat: q.policy.repeat, crossfadeSec: clamped });
  }, []);

  const reorderQueue = useCallback((from: number, to: number) => {
    const q = reorder(queueRef.current!, from, to);
    queueRef.current = q;
    setQueue(q);
  }, []);

  /** Removing from the queue never interrupts whatever is currently loaded/playing —
   *  it only edits future nav order (see queuePrefs.ts's removeAt doc). */
  const removeQueueItem = useCallback((index: number) => {
    const q = removeAt(queueRef.current!, index);
    queueRef.current = q;
    setQueue(q);
  }, []);

  const playQueueItem = useCallback((index: number) => playIndex(index, 0), [playIndex]);

  /* ── "Play next" and "Add to queue" ─────────────────────────────────────────
     The brief asks for these to be two SEPARATE, visible actions rather than one
     ambiguous "+", so they are two separate calls that differ only in where the
     ids land: after the cursor, or at the end.

     Both share one non-obvious case. core/queue's insertNext/append set the
     cursor to 0 when the queue was EMPTY — but a cursor is only a claim about
     what should be playing; nothing is loaded into the engine until a play
     request goes through the transport seam. So adding to an empty queue has to
     ALSO ask for playback, or the user taps "Add to queue" on a silent player and
     gets a queue that looks right and plays nothing. */
  const enqueue = useCallback((ids: number[], where: 'next' | 'end') => {
    if (!ids.length) return;
    const wasEmpty = queueRef.current!.items.length === 0;
    let q = queueRef.current!;
    if (where === 'next') {
      // Reverse, so the FIRST id given ends up nearest the cursor: inserting
      // a,b,c one at a time at cursor+1 would otherwise land them c,b,a.
      for (let i = ids.length - 1; i >= 0; i--) q = insertNext(q, String(ids[i]));
    } else {
      for (const id of ids) q = append(q, String(id));
    }
    queueRef.current = q;
    setQueue(q);
    // The items are refs already — Number() would turn a 'book:7' into NaN (playIndex's note).
    if (wasEmpty) requestLocalPlay({ trackIds: q.items, startIndex: 0 });
  }, []);

  const playNext = useCallback((ids: number[]) => enqueue(ids, 'next'), [enqueue]);
  const addToQueue = useCallback((ids: number[]) => enqueue(ids, 'end'), [enqueue]);

  /** Replace the queue outright. Goes through requestLocalPlay like every other play
   *  path, so the transport seam stays the only writer of queue state. */
  const playNow = useCallback((ids: number[], startIndex = 0) => {
    if (!ids.length) return;
    requestLocalPlay({ trackIds: ids, startIndex });
  }, []);

  // ── MediaSession — metadata + queue-driven prev/next + setPositionState ────────
  // Built from the NORMALISED item, not the track: the lock screen is the one
  // surface that is identical for both libraries, and an audiobook's author
  // belongs on it exactly as much as an artist does.
  const metadata = useMemo<MediaSessionMetadata | null>(() => (item ? {
    title: item.title,
    artist: item.byline,
    album: item.collection || '',
    artwork: item.coverUrl ? [{ src: item.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
  } : null), [item]);
  // The lock screen's arrows mean what the item's NAV means: tracks for music,
  // chapters for a book (plus ±30 s, the audiobook's own gesture) — the same
  // composition-derived retarget the rune grammar makes.
  const isBookNow = item?.kind === 'book';
  useMediaSession({
    enabled: item != null && mediaSessionOn,
    metadata,
    handlers: isBookNow ? {
      play: eng.toggle,
      pause: eng.toggle,
      seekbackward: () => eng.skip(-BOOK_SKIP_SEC),
      seekforward: () => eng.skip(BOOK_SKIP_SEC),
      previoustrack: eng.prevSegment,
      nexttrack: eng.nextSegment,
      seekto: eng.seekTo,
    } : {
      play: eng.toggle,
      pause: eng.toggle,
      previoustrack: trackPrev,
      nexttrack: trackNext,
      seekto: eng.seekTo,
    },
    playing: eng.playing,
    position: { position: eng.globalPos, duration: eng.total, playbackRate: eng.rate },
  });

  // ── Play-history recording (the 17.4 session recorder, INCLUDING the
  // screen-lock/hidden-reopen fix below). A book's session boundary is play/pause
  // edges WITHIN the book (a book can span a whole session); a TRACK CHANGE is always
  // also a session boundary (each track is its own history row) — the effect below
  // keys off the item's ref, so both fold in automatically. ──
  // ⚠️ A SESSION NAMES ITS LEDGER. A track's stretch lands in
  // `history`, a book's in `book_history` (backend/discovery.js's BOOK_HISTORY for
  // why they are two tables) — the session carries its source so the flush can
  // never write a book into the track ledger or the reverse.
  interface HistorySession { src: SourceId; id: number; context: string | null; startedAt: string; playStartedAtMs: number }
  const sessionRef = useRef<HistorySession | null>(null);
  const prevRefRef = useRef<string | null>(null);
  const prevPlayingForHistoryRef = useRef(false);
  const totalRef = useRef(eng.total);
  const globalPosRef = useRef(eng.globalPos);
  totalRef.current = eng.total;
  globalPosRef.current = eng.globalPos;

  const MINIMUM_MS_PLAYED = 1000;
  /** `forcedCompleted === true` overrides the position-derived completed check — the
   *  swap handshake below closes the outgoing track's session at a moment when a
   *  crossfade means the position refs are (or are about to be) the NEXT track's,
   *  but a swap by definition only fires when the outgoing runs to its natural end.
   *  Strict `=== true` so accidentally passing an event object (a raw listener
   *  binding) can never count as "completed". */
  const flushSession = useCallback((forcedCompleted?: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    const msPlayed = Math.round(Math.max(0, Date.now() - session.playStartedAtMs));
    if (msPlayed < MINIMUM_MS_PLAYED) return;
    const total = totalRef.current;
    const pos = globalPosRef.current;
    const completed = forcedCompleted === true || (total > 0 && pos >= total - 1);
    const row = { item_ref: session.id, started_at: session.startedAt, ms_played: msPlayed, completed };
    // A book listen IS its book; only a track carries where it was played from.
    (session.src === 'book' ? createBookHistoryEvent(row) : createHistoryEvent({ ...row, context: session.context }))
      .catch((err) => console.warn('[kouros] failed to record history event', err));
  }, []);

  const openSession = (ref: string): HistorySession => {
    const { src, id } = decodeRef(ref);
    return { src, id, context: contextRef.current, startedAt: new Date().toISOString(), playStartedAtMs: Date.now() };
  };

  useEffect(() => {
    const ref = item?.ref ?? null;
    const changed = prevRefRef.current !== null && ref !== prevRefRef.current;
    if (changed && sessionRef.current) flushSession();   // switched items mid-session → close it

    if (eng.playing) {
      if (ref !== null && (!sessionRef.current || changed)) sessionRef.current = openSession(ref);
    } else if (prevPlayingForHistoryRef.current) {
      flushSession();   // playing → paused edge
    }

    prevRefRef.current = ref;
    prevPlayingForHistoryRef.current = eng.playing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng.playing, item?.ref, flushSession]);

  // Page hidden/unload — the 17.4 fix (2026-07-15 integration
  // fix): audio keeps playing while
  // hidden/backgrounded, and the open edge above is paused→playing, which a tab that
  // stays playing under a screen lock never fires again. Flush-then-reopen banks
  // everything up to the lock (in case the tab is killed while hidden) without
  // losing the rest of a long screen-locked listen — it just splits into one row per
  // hide.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      flushSession();
      if (prevPlayingForHistoryRef.current && prevRefRef.current !== null) {
        sessionRef.current = openSession(prevRefRef.current);
      }
    };
    // Wrapped (not bound raw) so the listener's Event argument can never reach
    // flushSession's forcedCompleted parameter.
    const onUnload = () => flushSession();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [flushSession]);

  // ── THE SWAP HANDSHAKE (18.5) — how a backend-internal gapless/crossfade swap and
  // this adapter's queue stay in lock-step without a double-load. Three legs:
  //
  //   1. PREPARE (effect below): whenever the queue or the current track changes,
  //      recompute what SHOULD play next (core/queue's pure next() — shuffle/repeat
  //      aware) and hand its stream url to backend.prepareNext(). repeat-'one' and
  //      an exhausted queue prepare null — those boundaries stay engine-driven (the
  //      forwarded 'ended' → the playing-edge auto-advance above, unchanged).
  //   2. SWAP (backend-internal): at the boundary the backend starts the preloaded
  //      element itself (crossfade 0 = at the exact 'ended'; N s = N before the end,
  //      cross-ramping). The ENGINE sees an instant loadedmetadata+play — playing
  //      never flips false, so the playing-edge advance CANNOT fire (by design: the
  //      two advance paths are mutually exclusive). Instead the backend's onSwap
  //      side-channel lands here, carrying the consumed url.
  //   3. ACK (handleSwap → requestPlay → engine → backend.load): the handler verifies
  //      the url against the queue's expected next via urls.stream equality — that
  //      equality IS the proof the swap consumed OUR preparation — then advances the
  //      cursor through the ONE ordinary path (requestPlay). The engine treats it as
  //      a normal different-item request and calls backend.load() with the SAME url;
  //      the backend recognizes it (one-shot ack) and adopts the already-playing
  //      element instead of reloading — no reintroduced gap. The whole round-trip is
  //      synchronous-plus-microtasks (getTrack cache hit, noop ProgressStore), so the
  //      engine's follow-up bookkeeping seek(0) lands while the incoming is still at
  //      ~0 (and the backend's micro-seek tolerance keeps a running fade alive).
  //
  // History: a swap means the outgoing track ran to its natural end, but by the time
  // the track-change effect above would flush, a crossfade has already moved the
  // position refs onto the incoming track — so the handler closes the session HERE,
  // completed=true forced, then seeds the incoming's session (the track-change effect
  // replaces it for a normal advance; for consecutive duplicates of the SAME track —
  // where no track-change fires — the seed is the only thing that starts row #2). ──
  const handleSwap = useCallback((info: SwapInfo) => {
    const q0 = queueRef.current!;
    const q1 = next(q0);
    const advanced = q1.cursor !== q0.cursor;
    const expectedRef = advanced ? q1.items[q1.cursor] : null;
    const expectedId = expectedRef != null ? decodeRef(expectedRef).id : null;
    const expectedUrl = expectedRef != null ? streamUrlFor(expectedRef, 0) : null;

    flushSession(true);   // close the outgoing track's session as completed (see above)

    if (expectedId == null || expectedUrl !== info.url) {
      // Stale swap — the queue changed under an already-preloaded next (reorder/
      // remove in the final seconds). The backend is playing something the queue no
      // longer expects: reassert the queue's reality with a REAL load (the ack is
      // one-shot and this url won't match, so the engine's load hard-cuts to the
      // correct track). Defensive only — the prepare effect re-prepares on every
      // queue change, so this window is a race of milliseconds.
      playIndex(expectedId != null ? q1.cursor : q0.cursor, 0);
      return;
    }

    // Seed the incoming item's session (its own ledger, by its ref).
    sessionRef.current = expectedRef != null ? openSession(expectedRef) : null;
    playIndex(q1.cursor, 0);   // leg 3 — the ordinary path; ends in the backend's ack
  }, [flushSession, playIndex]);

  useEffect(() => {
    const b = backendHandleRef.current;
    if (!b || !isGaplessBackend(b)) return;   // feature-detect: a plain backend simply never swaps
    return b.onSwap(handleSwap);
  }, [handleSwap]);

  // Leg 1 — keep the backend's prepared-next in step with the queue. Deps: `queue`
  // changes identity on every reducer op (cursor moves, reorder, remove, shuffle,
  // repeat), `track` on every engine item change — exactly the moments "what plays
  // next" can change.
  useEffect(() => {
    const b = backendHandleRef.current;
    if (!b || !isGaplessBackend(b)) return;
    const q0 = queueRef.current!;
    let url: string | null = null;
    if (track && q0.items.length > 0 && q0.cursor >= 0 && q0.policy.repeat !== 'one') {
      const q1 = next(q0);
      if (q1.cursor !== q0.cursor) url = streamUrlFor(q1.items[q1.cursor], 0);
    }
    b.prepareNext(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, item?.ref]);

  /** Jump straight to a chapter. The engine walks segments one at a time
   *  (prevSegment/nextSegment); a dial hands over an INDEX, so this seeks to that
   *  nav point's own position instead of stepping there N times — the difference
   *  between a dial that lands and one that grinds through every chapter it
   *  passes, re-buffering at each. */
  const seekSegment = useCallback((index: number) => {
    const pts = eng.points;
    if (!pts.length) return;
    const i = Math.min(Math.max(index, 0), pts.length - 1);
    eng.seekTo(pts[i].start);
  }, [eng.points, eng.seekTo]);

  return {
    visible: eng.visible,
    item,
    composition,
    track,
    playing: eng.playing,
    buffering: eng.buffering,
    error: eng.error,
    globalPos: eng.globalPos,
    livePosition: eng.livePosition,
    total: eng.total,
    volume: eng.volume,
    muted: eng.muted,
    queue,
    context,
    shuffle: queue.policy.shuffle,
    repeat: queue.policy.repeat,
    crossfadeSec,
    tracksById,
    toggle: eng.toggle,
    seekTo: eng.seekTo,
    trackPrev,
    trackNext,
    setVolume: eng.setVolume,
    setMuted: eng.setMuted,
    toggleMute: eng.toggleMute,
    setShuffle,
    cycleRepeat,
    setRepeat,
    setCrossfade,
    rate: eng.rate,
    cycleRate: eng.cycleRate,
    skip: eng.skip,
    bookmarks: eng.bookmarks,
    addBookmarkHere: eng.addBookmarkHere,
    jumpBookmark: eng.jumpBookmark,
    removeBookmark: eng.removeBookmark,
    sleepMode: eng.sleepMode,
    sleepRemainingMs: eng.sleepRemainingMs,
    setSleep: eng.setSleep,
    points: eng.points,
    segmentIndex: eng.currentIndex,
    segmentLabel: eng.segmentLabel,
    prevSegment: eng.prevSegment,
    nextSegment: eng.nextSegment,
    seekSegment,
    playQueueItem,
    removeQueueItem,
    reorderQueue,
    playNext,
    addToQueue,
    playNow,
    adopt,
    play: eng.play,
    pause: eng.pause,
  };
}

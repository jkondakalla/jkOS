// packages/player/src/engine/usePlayerEngine.ts — the headless player engine (ToDo.md
// §3 Wave 15, item 15.3), generalized VERBATIM from
// apps/papyros/src/player/usePlayerEngine.ts. Every PapyrOS-specific dependency is now
// an injected seam (see ./types): the media element is a MediaBackend, the API client
// is ItemLoader/ProgressStore/BookmarkStore/PlayerUrls, the controller is a Transport,
// the compat pipeline is a CompatPolicy, the rate key is config.storageKey.
//
// One source of truth: `globalPos`, seconds across the whole timeline. The engine maps
// it to a per-source (sourceIndex, offset) via ../core/timeline on the way OUT to the
// backend, and back on every 'timeupdate' on the way IN. Everything else reasons purely
// in global seconds.
//
// SIX LOAD-BEARING INVARIANTS (each was a real production bug once) are preserved with
// their exact mechanism, marked inline with an [INVARIANT x] tag:
//   (a) stable-identity backend      — backendRef, created ONCE, never per render/load
//   (b) refs-in-listeners            — handlers read live state through refs only
//   (c) reqSeq load guard            — a stale async load can't clobber a newer one
//   (d) serialized single-flight writes — one progress write in flight, queue latest
//       (mechanism now lives in @jkos/weave/resumeCursor — extracted as item 16.4;
//       this engine is its first consumer, with zero behavior change)
//   (e) recoveringRef reentrancy     — the compat recovery can't re-enter itself
//   (f) NotAllowedError autoplay path — autoplay veto ⇒ paused-but-loaded, surfaced
//
// Design (unchanged from PapyrOS): authoritative data lives in refs (no stale closures
// inside backend event handlers); a thin useState layer mirrors only what a bar renders;
// the whole imperative API is built ONCE via a lazy ref init closing over the stable
// refs + setState, so every handler identity is stable for the mount's lifetime.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createResumeCursor, type ResumeCursor } from '@jkos/weave/resumeCursor';
import {
  buildTimeline, clamp, currentNav, EMPTY_TIMELINE, locate, navPoints, toGlobal,
  type NavPoint, type Timeline,
} from '../core/timeline';
import type { BackendError, MediaBackend } from '../backend/types';
import { readPersistedRate, persistRate, nextRate } from './rate';
import { readInitialVolume, readInitialMuted, applyVolume, applyMuted } from './volume';
import {
  DEFAULT_RECOVERABLE_KINDS, canEscalate, compatKey, effectiveStartLevel,
  isRecoverableKind, nextCompatLevel,
} from './recovery';
import type {
  BookmarkRowLike, Id, PlayerApi, PlayerEngineConfig, PlayerMessages,
  ProgressRowLike, SleepMode,
} from './types';

export { RATE_PRESETS } from './rate';
export type {
  Id, PlayerApi, PlayerEngineConfig, PlayerMessages, SleepMode,
} from './types';

const PROGRESS_DEBOUNCE_MS = 5000;
const PREV_RESTART_SEC = 3;   // >3s into a segment, "prev" restarts it (the standard idiom)
const COMPAT_POLL_INTERVAL_MS = 2000;
const COMPAT_POLL_TIMEOUT_MS = 120_000;

/** PapyrOS's exact user-facing copy, so an adapter that supplies no `messages` gets
 *  byte-identical strings (zero behavior change is the wave's bar). */
export const DEFAULT_MESSAGES: PlayerMessages = {
  autoplayBlocked: 'Autoplay blocked — press play to start.',
  srcUnsupported: 'This audio format is not supported by your browser.',
  decode: 'Could not decode this file — your browser may lack AAC/M4B support.',
  network: 'Network error while streaming — check the connection and press play.',
  aborted: 'Playback was aborted.',
  playFailed: 'Playback failed — see the browser console.',
  compatOptimizing: 'Optimizing this file for your browser…',
  compatFailed: 'Could not decode this file — your browser may lack AAC/M4B support.',
};

export function usePlayerEngine<
  TItem,
  TProgress extends ProgressRowLike,
  TBookmark extends BookmarkRowLike,
>(config: PlayerEngineConfig<TItem, TProgress, TBookmark>): PlayerApi<TItem, TBookmark> {
  const { itemLoader, progress, bookmarks: bookmarkStore, urls, transport, compat, storageKey, volumeStorageKey } = config;
  const messages: PlayerMessages = { ...DEFAULT_MESSAGES, ...config.messages };
  const recoverableKinds = compat?.recoverableKinds ?? DEFAULT_RECOVERABLE_KINDS;
  const pollInterval = compat?.pollIntervalMs ?? COMPAT_POLL_INTERVAL_MS;
  const pollTimeout = compat?.pollTimeoutMs ?? COMPAT_POLL_TIMEOUT_MS;

  // ── Rendered state (only what a bar draws) ────────────────────────────────
  const [visible, setVisible] = useState(false);
  const [item, setItem] = useState<TItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalPos, setGlobalPos] = useState(0);
  const [rate, setRate] = useState<number>(() => readPersistedRate(storageKey));
  // volumeStorageKey omitted → session-only defaults (1 / unmuted); set → restored.
  const [volume, setVolumeState] = useState<number>(() => readInitialVolume(volumeStorageKey));
  const [muted, setMutedState] = useState<boolean>(() => readInitialMuted(volumeStorageKey));
  const [bookmarks, setBookmarks] = useState<TBookmark[]>([]);
  const [sleepMode, setSleepMode] = useState<SleepMode>('off');
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);

  // ── Authoritative refs (read inside backend event handlers) — [INVARIANT b] ─
  // Every handler below reads the LIVE value through one of these refs, never through
  // a closure-captured render variable, so a handler built once at mount can never act
  // on stale state.
  const backendRef = useRef<MediaBackend | null>(null);   // [INVARIANT a] the stable backend
  const itemRef = useRef<TItem | null>(null);
  const timelineRef = useRef<Timeline>(EMPTY_TIMELINE);
  const pointsRef = useRef<NavPoint[]>([]);
  const arrayIndexRef = useRef(0);           // current playlist cursor
  const rateRef = useRef(rate);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const pendingSeekRef = useRef<number | null>(null);   // in-source offset to apply on loadedmetadata
  const wantPlayRef = useRef(false);         // autoplay intent for the loading source
  const hasLoadedRef = useRef(false);        // has load() ever been called (was `audio.src` truthiness)
  const globalPosRef = useRef(0);
  // [INVARIANT d] lives in the shared cursor (weave 16.4): debounce window, skip-
  // unchanged, serialized single-flight + queued-latest, find-or-create row tracking,
  // and the outgoing-item guard (its post-write getSnapshot() re-pull IS the old
  // `itemLoader.idOf(itemRef.current) === progress.itemIdOf(row)` check). Built ONCE —
  // the snapshot pulls live refs, so the closure can never go stale [INVARIANT b].
  const progressCursorRef = useRef<ResumeCursor<TProgress> | null>(null);
  if (!progressCursorRef.current) {
    progressCursorRef.current = createResumeCursor<Id, TProgress>(
      progress,
      () => {
        const it = itemRef.current;
        if (!it) return null;
        return { itemId: itemLoader.idOf(it), position: globalPosRef.current, duration: timelineRef.current.total };
      },
      { debounceMs: PROGRESS_DEBOUNCE_MS },
    );
  }
  const progressCursor = progressCursorRef.current;
  const reqSeqRef = useRef(0);               // [INVARIANT c] guards racing async loads
  // Session-only memory of which compat rung is active per (itemId, sourceIndex),
  // bumped by attemptCompatRecovery, read by loadFile. recoveringRef is [INVARIANT e]:
  // an error arriving mid-recovery must not spawn a second, parallel poll loop.
  const compatLevelRef = useRef<Map<string, number>>(new Map());
  const recoveringRef = useRef(false);       // [INVARIANT e]
  const sleepRef = useRef<{ mode: SleepMode; until: number | null; segmentEnd: number | null }>(
    { mode: 'off', until: null, segmentEnd: null },
  );
  const sleepTimerRef = useRef<number | null>(null);
  const lastPublishRef = useRef(0);          // Date.now() of the last publishPosition() call

  // ── The imperative engine, built exactly once (stable closures over refs) ──
  const engineRef = useRef<ReturnType<typeof buildEngine> | null>(null);
  if (!engineRef.current) engineRef.current = buildEngine();
  const eng = engineRef.current;

  function buildEngine() {
    // ---- Live position broadcast (Transport.publishPosition) ---------------
    function publishNow(g: number): void {
      const it = itemRef.current;
      if (it) transport.publishPosition({ itemId: itemLoader.idOf(it), position: g });
      lastPublishRef.current = Date.now();
    }

    // ---- Progress upsert — [INVARIANT d], delegated to the shared cursor -----------
    // Thin names kept so every call site below reads as before.
    function scheduleWrite(): void { progressCursor.schedule(); }
    function flushNow(): void { progressCursor.flush(); }

    // ---- Play rejection surfacing — [INVARIANT f] autoplay path -------------
    // A rejected play() used to be swallowed silently. Branch on the backend's ONE
    // classified error vocabulary (BackendError.kind) instead of DOMException.name:
    // 'autoplay-blocked' is the NotAllowedError path — the deferred play() outlived the
    // click's transient activation; the bar's play button is a fresh gesture that works.
    function playFailed(err: unknown): void {
      const kind = (err as BackendError | null)?.kind;
      if (kind === 'aborted') return;   // load() superseded the play() — routine (was AbortError)
      console.error('[player] play() rejected', err);
      setPlaying(false);
      if (kind === 'autoplay-blocked') {
        setError(messages.autoplayBlocked);
      } else if (kind === 'src-unsupported') {
        setError(messages.srcUnsupported);
      } else {
        setError(messages.playFailed);
      }
    }

    // ---- Loading a source into the stable backend — [INVARIANT a] ----------
    function loadFile(arrayIndex: number, offset: number, autoplay: boolean): void {
      const backend = backendRef.current;
      const it = itemRef.current;
      const timeline = timelineRef.current;
      if (!backend || !it) return;
      const source = timeline.sources[arrayIndex];
      if (!source) return;
      setError(null);
      arrayIndexRef.current = arrayIndex;
      pendingSeekRef.current = Math.max(0, offset);
      wantPlayRef.current = autoplay;
      const itemId = itemLoader.idOf(it);
      // A prior decode failure on this exact (item, source) may have bumped its compat
      // rung this session; the source may also want a starting rung (a pre-generated
      // variant). The session bump wins — replay it on every load so a re-seek/re-open
      // doesn't retry a rung that already failed. [INVARIANT a: same backend, new src.]
      const initial = compat ? compat.initialLevel(it, source.index) : 0;
      const level = effectiveStartLevel(compatLevelRef.current.get(compatKey(itemId, source.index)) ?? 0, initial);
      backend.load({ url: urls.stream(itemId, source.index, level) });
      backend.setRate(rateRef.current);   // some backends reset rate on src change; onLoaded reapplies too
      hasLoadedRef.current = true;
      const g = toGlobal(timeline, arrayIndex, offset);
      globalPosRef.current = g;
      setGlobalPos(g);                          // reflect immediately (before metadata)
      publishNow(g);
      // [INVARIANT c] Every load is a fresh "current attempt". Bumping here (not only in
      // handleRequest) is what lets attemptCompatRecovery's poll detect it was superseded
      // by ANY load — book swap, boundary seek, auto-advance, or a compat reload.
      reqSeqRef.current += 1;
    }

    // ---- Seek in GLOBAL seconds (same source → seek, else swap) ------------
    function seekTo(globalSec: number): void {
      const timeline = timelineRef.current;
      const backend = backendRef.current;
      if (!backend || !itemRef.current) return;
      const g = clamp(globalSec, 0, timeline.total);
      const { arrayIndex, offset } = locate(timeline, g);
      if (arrayIndex === arrayIndexRef.current && hasLoadedRef.current) {
        try { backend.seek(offset); } catch { /* metadata not ready yet */ }
        globalPosRef.current = g;
        setGlobalPos(g);
        publishNow(g);
      } else {
        loadFile(arrayIndex, offset, !backend.paused);   // preserve play/pause across the boundary
      }
      progressCursor.invalidateLastWritten();           // force the new position to persist next tick
      scheduleWrite();
    }

    function skip(deltaSec: number): void {
      seekTo(globalPosRef.current + deltaSec);
    }

    // ---- Segment (or source-boundary) prev/next ----------------------------
    function nextSegment(): void {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const cur = currentNav(pts, globalPosRef.current);
      if (cur + 1 < pts.length) seekTo(pts[cur + 1].start);
    }
    function prevSegment(): void {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const cur = currentNav(pts, globalPosRef.current);
      const into = globalPosRef.current - pts[cur].start;
      if (into > PREV_RESTART_SEC || cur === 0) seekTo(pts[cur].start);
      else seekTo(pts[cur - 1].start);
    }

    // ---- Transport ---------------------------------------------------------
    function toggle(): void {
      const backend = backendRef.current;
      if (!backend || !itemRef.current) return;
      if (backend.paused) { wantPlayRef.current = true; void backend.play().catch(playFailed); }
      else backend.pause();
    }

    function cycleRate(): void {
      const next = nextRate(rateRef.current);
      rateRef.current = next;
      backendRef.current?.setRate(next);
      setRate(next);
      persistRate(storageKey, next);
    }

    // ---- Volume + mute (Wave 16.2) — same ref-then-backend-then-mirror shape as
    // cycleRate; applyVolume/applyMuted own the clamp + optional-key persistence.
    function setVolume(level: number): void {
      const clamped = applyVolume(backendRef.current, level, volumeStorageKey);
      volumeRef.current = clamped;
      setVolumeState(clamped);
    }
    function setMuted(m: boolean): void {
      mutedRef.current = m;
      applyMuted(backendRef.current, m, volumeStorageKey);
      setMutedState(m);
    }
    function toggleMute(): void {
      setMuted(!mutedRef.current);
    }

    // ---- Sleep timer -------------------------------------------------------
    function clearSleepInterval(): void {
      if (sleepTimerRef.current != null) { clearInterval(sleepTimerRef.current); sleepTimerRef.current = null; }
    }
    function fireSleep(): void {
      backendRef.current?.pause();            // onPause flushes progress
      clearSleepInterval();
      sleepRef.current = { mode: 'off', until: null, segmentEnd: null };
      setSleepMode('off');
      setSleepRemainingMs(null);
    }
    function setSleep(mode: SleepMode): void {
      clearSleepInterval();
      if (mode === 'off') {
        sleepRef.current = { mode: 'off', until: null, segmentEnd: null };
        setSleepMode('off');
        setSleepRemainingMs(null);
        return;
      }
      if (mode === 'segment') {
        const pts = pointsRef.current;
        const idx = currentNav(pts, globalPosRef.current);
        sleepRef.current = { mode, until: null, segmentEnd: pts[idx]?.end ?? timelineRef.current.total };
        setSleepMode('segment');
        setSleepRemainingMs(null);   // rendered as "end of segment", not a countdown
        return;
      }
      const until = Date.now() + Number(mode) * 60_000;
      sleepRef.current = { mode, until, segmentEnd: null };
      setSleepMode(mode);
      setSleepRemainingMs(until - Date.now());
      sleepTimerRef.current = setInterval(() => {
        const rem = (sleepRef.current.until ?? 0) - Date.now();
        if (rem <= 0) fireSleep();
        else setSleepRemainingMs(rem);
      }, 1000) as unknown as number;
    }

    // ---- Bookmarks ---------------------------------------------------------
    function loadBookmarks(itemId: Id): void {
      bookmarkStore.list(itemId).then(
        (all) => setBookmarks([...all].sort((a, b) => a.position - b.position)),
        () => setBookmarks([]),
      );
    }
    function addBookmarkHere(): void {
      const it = itemRef.current;
      if (!it) return;
      const pos = globalPosRef.current;
      const pts = pointsRef.current;
      const title = pts.length ? pts[currentNav(pts, pos)]?.title ?? null : null;
      bookmarkStore.create({ itemId: itemLoader.idOf(it), position: pos, title }).then(
        (row) => setBookmarks((bs) => [...bs, row].sort((a, b2) => a.position - b2.position)),
        () => {},
      );
    }
    function jumpBookmark(pos: number): void {
      seekTo(pos);
      wantPlayRef.current = true;
      void backendRef.current?.play().catch(playFailed);
    }
    function removeBookmark(id: Id): void {
      bookmarkStore.remove(id).then(
        () => setBookmarks((bs) => bs.filter((bm) => bm.id !== id)),
        () => {},
      );
    }

    // ---- Decode-failure auto-recovery (compat ladder) — [INVARIANT e] ------
    // Escalate a rung, ask the app to build it (CompatPolicy.prepare), poll until ready
    // (bounded), then reload the SAME source at the position playback failed at —
    // derived from globalPosRef via locate(), per the timeline's mapping. The engine
    // owns the loop, guards, and seek-restore; only the single prepare probe is injected.
    async function attemptCompatRecovery(): Promise<void> {
      if (recoveringRef.current) return;   // [INVARIANT e] reentrancy guard
      if (!compat) return;
      const it = itemRef.current;
      const source = timelineRef.current.sources[arrayIndexRef.current];
      if (!it || !source) return;
      const itemId = itemLoader.idOf(it);
      const key = compatKey(itemId, source.index);
      const level = compatLevelRef.current.get(key) ?? 0;
      if (!canEscalate(level, compat.maxLevel)) return;   // ladder exhausted this session

      recoveringRef.current = true;
      const seq = reqSeqRef.current;   // [INVARIANT c] any load bumps this
      const target = nextCompatLevel(level);
      compatLevelRef.current.set(key, target);
      const wantPlay = wantPlayRef.current;
      setError(messages.compatOptimizing);

      try {
        let ready = false;
        const deadline = Date.now() + pollTimeout;
        while (Date.now() < deadline) {
          if (seq !== reqSeqRef.current) return;   // superseded — bail without touching error state
          let outcome: 'ready' | 'pending' | 'unavailable';
          try {
            outcome = await compat.prepare({ itemId, sourceIndex: source.index, level: target });
          } catch {
            outcome = 'pending';   // treat a thrown probe as a transient hiccup — keep polling
          }
          if (seq !== reqSeqRef.current) return;
          if (outcome === 'ready') { ready = true; break; }
          if (outcome === 'unavailable') break;   // this rung won't build — stop polling
          await new Promise((r) => setTimeout(r, pollInterval));
        }
        if (seq !== reqSeqRef.current) return;
        if (!ready) {
          // Final failure for this rung: timed out or unavailable. Leave the REAL error
          // (what onError would have shown without recovery), not the transient one.
          setError(messages.compatFailed);
          return;
        }
        const { arrayIndex, offset } = locate(timelineRef.current, globalPosRef.current);
        loadFile(arrayIndex, offset, wantPlay);
      } finally {
        recoveringRef.current = false;
      }
    }

    // ---- Backend event handlers — [INVARIANT b] all read refs, never closures --
    function onLoaded(): void {
      const backend = backendRef.current;
      if (!backend) return;
      if (pendingSeekRef.current != null) {
        const dur = Number.isFinite(backend.duration) ? backend.duration : pendingSeekRef.current;
        try { backend.seek(Math.min(pendingSeekRef.current, dur)); } catch { /* ignore */ }
        pendingSeekRef.current = null;
      }
      backend.setRate(rateRef.current);
      backend.setVolume(volumeRef.current);   // some backends reset volume/muted on src change, like rate
      backend.setMuted(mutedRef.current);
      if (wantPlayRef.current) void backend.play().catch(playFailed);
    }
    function onTime(): void {
      const backend = backendRef.current;
      if (!backend) return;
      const g = toGlobal(timelineRef.current, arrayIndexRef.current, backend.currentTime);
      globalPosRef.current = g;
      setGlobalPos(g);
      if (Date.now() - lastPublishRef.current >= 1000) publishNow(g);
      if (!backend.paused) scheduleWrite();
      const sl = sleepRef.current;
      if (sl.mode === 'segment' && sl.segmentEnd != null && g >= sl.segmentEnd - 0.25) fireSleep();
    }
    function onPlay(): void { setPlaying(true); setBuffering(false); setError(null); }
    function onPause(): void { setPlaying(false); flushNow(); }
    function onWaiting(): void { setBuffering(true); }
    function onPlaying(): void { setBuffering(false); setPlaying(true); }
    function onError(err: BackendError): void {
      // A recoverable-kind error on a source that hasn't exhausted the ladder this
      // session → try the compat pipeline instead of surfacing the raw error.
      // recoveringRef guards a stray error mid-recovery [INVARIANT e]; attemptCompat
      // re-checks the level itself too.
      if (compat && isRecoverableKind(err.kind, recoverableKinds) && !recoveringRef.current) {
        const it = itemRef.current;
        const source = timelineRef.current.sources[arrayIndexRef.current];
        const level = it && source ? (compatLevelRef.current.get(compatKey(itemLoader.idOf(it), source.index)) ?? 0) : compat.maxLevel;
        if (it && source && canEscalate(level, compat.maxLevel)) {
          console.error('[player] media error, attempting compat recovery', { kind: err.kind, code: err.code, level });
          setBuffering(false);
          setPlaying(false);
          void attemptCompatRecovery();
          return;
        }
      }
      const msg =
        err.kind === 'decode' ? messages.decode :
        err.kind === 'src-unsupported' ? messages.srcUnsupported :
        err.kind === 'network' ? messages.network :
        messages.aborted;   // 'aborted'/'unknown' → the generic "aborted" copy (matches code 1/other)
      console.error('[player] media error', { kind: err.kind, code: err.code, message: err.message });
      setBuffering(false);
      setPlaying(false);
      setError(msg);
    }
    function onEnded(): void {
      const next = arrayIndexRef.current + 1;
      if (next < timelineRef.current.sources.length) {
        loadFile(next, 0, true);          // auto-advance, offset 0
      } else {
        globalPosRef.current = timelineRef.current.total;
        setGlobalPos(timelineRef.current.total);
        publishNow(timelineRef.current.total);
        wantPlayRef.current = false;
        setPlaying(false);
        progressCursor.flush(true);        // mark finished at true end
      }
    }

    // ---- The one dispatcher wired to backend.on() --------------------------
    function dispatch(event: import('../backend/types').BackendEvent): void {
      switch (event.type) {
        case 'loadedmetadata': onLoaded(); break;
        case 'timeupdate': onTime(); break;
        case 'play': onPlay(); break;
        case 'pause': onPause(); break;
        case 'waiting': onWaiting(); break;
        case 'playing': onPlaying(); break;
        case 'ended': onEnded(); break;
        case 'error': onError(event.error); break;
      }
    }

    // ---- The play request from a view (Transport.subscribe) ----------------
    async function handleRequest(req: import('./types').EngineRequest): Promise<void> {
      setVisible(true);
      const backend = backendRef.current;
      // Same item already loaded → seek (never reload); a bare request just plays.
      if (itemRef.current && itemLoader.idOf(itemRef.current) === req.itemId && timelineRef.current.total > 0) {
        if (req.position != null) seekTo(req.position);
        wantPlayRef.current = true;
        if (backend && backend.paused) void backend.play().catch(playFailed);
        return;
      }
      // Different item → flush the outgoing item, then swap everything. [INVARIANT c]
      const seq = ++reqSeqRef.current;
      flushNow();
      let loaded: TItem;
      try { loaded = await itemLoader.load(req.itemId); } catch { return; }
      if (seq !== reqSeqRef.current) return;   // superseded by a newer request

      const timeline = buildTimeline(itemLoader.sources(loaded));
      itemRef.current = loaded;
      timelineRef.current = timeline;
      pointsRef.current = navPoints(timeline, itemLoader.segments(loaded));
      progressCursor.resetItem();

      // Resolve the start position: explicit ?? saved (unfinished) ?? 0.
      let existing: TProgress | null = null;
      try { existing = await progress.find(itemLoader.idOf(loaded)); } catch { /* start from 0 */ }
      if (seq !== reqSeqRef.current) return;
      progressCursor.setRow(existing);
      let start: number;
      if (req.position != null) start = req.position;
      else if (existing && !existing.finished) start = existing.position;
      else start = 0;
      start = clamp(start, 0, timeline.total);

      loadBookmarks(itemLoader.idOf(loaded));
      setItem(loaded);
      setSleep('off');                          // a fresh item cancels any armed timer
      const { arrayIndex, offset } = locate(timeline, start);
      loadFile(arrayIndex, offset, true);
    }

    return {
      dispatch, handleRequest, flushNow,
      controls: {
        toggle, seekTo, skip, prevSegment, nextSegment, cycleRate,
        setVolume, setMuted, toggleMute,
        setSleep, addBookmarkHere, jumpBookmark, removeBookmark,
      },
    };
  }

  // ── Wire the stable backend + global listeners (once) — [INVARIANT a] ─────
  useEffect(() => {
    const backend = typeof config.backend === 'function' ? config.backend() : config.backend;
    backend.setRate(rateRef.current);
    backend.setVolume(volumeRef.current);   // apply the persisted (or default) volume/mute once at mount
    backend.setMuted(mutedRef.current);
    backendRef.current = backend;
    const unsub = backend.on(eng.dispatch);

    const unsubReq = transport.subscribe(eng.handleRequest);
    const onVis = () => { if (document.visibilityState === 'hidden') eng.flushNow(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', eng.flushNow);

    return () => {
      unsubReq();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', eng.flushNow);
      unsub();
      progressCursor.dispose();            // cancel any pending debounce without writing
      if (sleepTimerRef.current != null) clearInterval(sleepTimerRef.current);
      backend.dispose();          // pauses + clears the source (mirrors audio.pause(); src='')
      backendRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng]);

  // ── Derived-for-render (must match what handlers set on the refs) ─────────
  const rtl = useMemo(() => (item ? buildTimeline(itemLoader.sources(item)) : EMPTY_TIMELINE), [item]);
  const points = useMemo(() => (item ? navPoints(rtl, itemLoader.segments(item)) : []), [item, rtl]);
  const currentIndex = points.length ? currentNav(points, globalPos) : -1;
  const segmentLabel = currentIndex >= 0 ? points[currentIndex]?.title ?? null : null;

  return {
    visible, item, playing, buffering, error, globalPos, total: rtl.total, rate,
    volume, muted,
    points, currentIndex, segmentLabel, bookmarks, sleepMode, sleepRemainingMs,
    ...eng.controls,
  };
}

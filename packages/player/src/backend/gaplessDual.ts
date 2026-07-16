// packages/player/src/backend/gaplessDual.ts — the SECOND MediaBackend implementation
// (ToDo.md §3 Wave 18, item 18.5): two internal media elements whose active/standby
// roles swap at track boundaries, buying the one thing a single element structurally
// cannot do — gapless playback and 0–12 s crossfades (the whole reason the seam in
// 15.2 exists; Documentation/PLAYER_PARITY.md §3 "Layer 0/Layer 1 boundary").
//
// THE CONTRACT WITH THE ENGINE (usePlayerEngine.ts) IS UNCHANGED: this backend
// satisfies plain `MediaBackend` byte-for-byte in behavior when nobody calls the
// extension surface — load/seek/play/pause/rate/volume/muted drive the ACTIVE element
// exactly like htmlMedia drives its one element, and `ended` forwards normally when no
// next source was prepared. Everything gapless is an ADDITIVE, OPTIONAL extension
// (`GaplessBackend`, feature-detected via `isGaplessBackend`) that a consumer opts
// into by calling `prepareNext()`:
//
//   1. prepareNext(url) — the app names what SHOULD play after the current source.
//      While the active element plays, once remaining time <= `preloadWindowSec`
//      (default 15 s), the standby element starts preloading that url.
//   2. The boundary, two modes:
//        crossfade 0 (gapless)  — the active element's 'ended' DOM event triggers the
//          swap: the standby element (already decoded) starts at that exact event,
//          roles flip. No silence beyond the browser's play() latency on a
//          fully-preloaded element (~0).
//        crossfade N ∈ (0,12]  — the swap happens N seconds BEFORE the end: the
//          standby starts at volume 0, roles flip immediately (currentTime/duration
//          report the incoming from here on), and a timer linearly cross-ramps the two
//          element volumes over N seconds of the incoming's playback (user volume is
//          the ceiling: incoming = user·p, outgoing = user·(1−p)). When p reaches 1 —
//          or the outgoing ends/errors first — the outgoing is paused and cleared.
//   3. What the ENGINE sees at a swap is ONE coherent stream: no 'ended', just an
//      instant 'loadedmetadata' (the incoming's metadata is already known) followed by
//      the incoming element's own organic 'play'/'playing'/'timeupdate' events —
//      exactly the shape of an instant load()+autoplay of the next source. The
//      getters report the ACTIVE (incoming) element from the flip onward.
//   4. The QUEUE HANDSHAKE (the hard part — see apps/kouros/src/player/
//      usePlayerEngine.ts's "swap handshake" comment for the consumer half): the swap
//      also notifies `onSwap` listeners with the consumed url. The consuming adapter
//      verifies the url against its queue's expected next (`urls.stream(...)`
//      equality), advances its cursor, and fires its normal play request — the
//      engine's ensuing `backend.load(sameUrl)` is recognized here as the
//      ACKNOWLEDGMENT of the swap (one-shot `ackUrl` match): the element is NOT
//      reloaded (no double-load, no gap); the backend just re-answers with an async
//      'loadedmetadata' so the engine's load choreography (pending-seek/rate/volume
//      reapply) completes against the already-playing element.
//
// EDGE-CASE SEMANTICS (each covered in test/gaplessDual.test.mjs):
//   - pause() mid-crossfade — hard-cut to the active-by-cursor (incoming) element:
//     the ramp is cancelled, the outgoing is paused + cleared, the incoming's volume
//     is restored to the user ceiling, THEN the incoming pauses. Resuming plays only
//     the incoming at full volume.
//   - seek() mid-crossfade — a REAL jump (|target − currentTime| >= 0.5 s) hard-cuts
//     exactly like pause (ramp cancelled, outgoing silenced) and then seeks the
//     incoming. A MICRO-seek (< 0.5 s delta) adjusts position without cancelling the
//     ramp — this deliberate tolerance is also what absorbs the engine's own
//     bookkeeping seek(0) when its post-swap load choreography lands microtasks after
//     a fade begins (the incoming is still within epsilon of 0).
//   - load() with a non-ack url (prev/track-change/compat reload mid-fade) — a real
//     load: ramp cancelled, outgoing silenced, preload state reset (the adapter
//     re-prepares from its queue), the ACTIVE element re-pointed. htmlMedia behavior.
//   - a preload failure (standby 'error' while inactive) is NEVER forwarded — the
//     active track is still playing fine; the preload is discarded and the boundary
//     degrades to the engine-driven advance (forwarded 'ended', normal load, a gap).
//   - prepareNext(differentUrl | null) discards a stale preload; prepareNext during a
//     fade defers (the standby element is busy being the outgoing) until the fade
//     settles and the next timeupdate re-arms the preload.
//   - setVolume mid-fade re-scales BOTH ramp legs under the new ceiling (no jump to
//     full); setMuted applies to BOTH elements always (mute is a binary gate across
//     the whole backend, the ramp lives in the volume domain); setRate applies to
//     both (the preloaded next must start at the user's rate).
//   - crossfadeSec is clamped to [0, 12]; changing it mid-fade affects the NEXT fade
//     (the running ramp keeps the duration it started with).
//
// Like htmlMedia.ts: no React, no core imports, no `document`/`window` outside the
// opt-in create-default-elements path — a pair of scripted fake elements can drive
// this in plain Node (see test/gaplessDual.test.mjs). All imports are type-only, so
// the house transpile-one-file test pattern works unchanged.
import type {
  BackendError,
  BackendErrorKind,
  BackendEvent,
  BackendEventListener,
  MediaBackend,
  MediaSourceDescriptor,
} from './types';
import type { MediaElementLike } from './htmlMedia';

/** Upper bound on the crossfade, per ToDo.md §3 18.5 ("Crossfade 0–12 s"). */
export const MAX_CROSSFADE_SEC = 12;

/** How far out the standby element starts preloading the prepared next url. */
const DEFAULT_PRELOAD_WINDOW_SEC = 15;

/** Ramp resolution. 50 ms ≈ 20 volume steps/s — smooth to the ear, cheap to run. */
const FADE_TICK_MS = 50;

/** seek() deltas below this keep a running fade (see the header's seek semantics). */
const FADE_SEEK_KEEP_EPSILON_SEC = 0.5;

export interface SwapInfo {
  /** The prepared url the swap consumed — the adapter matches this against its own
   *  `urls.stream(...)` for the queue's expected next item (the handshake's key). */
  url: string;
}

/** The additive, optional extension a queue-owning consumer feature-detects (via
 *  `isGaplessBackend`) on top of the plain seam. A consumer holding only
 *  `MediaBackend` never sees any of this — and never triggers a swap. */
export interface GaplessBackend extends MediaBackend {
  /** Name the url that should play after the current source (null = nothing —
   *  clears any pending preparation). Idempotent for an unchanged url. */
  prepareNext(url: string | null): void;
  /** Crossfade duration in seconds; 0 = gapless swap at the 'ended' boundary.
   *  Clamped to [0, MAX_CROSSFADE_SEC]. */
  crossfadeSec: number;
  /** Subscribe to swap notifications (fired AFTER the engine-facing swap events, so
   *  the adapter reacts to a settled backend). Returns the unsubscribe function. */
  onSwap(listener: (info: SwapInfo) => void): () => void;
}

/** Feature detection for the extension — the adapter's guard, and the proof the
 *  plain-MediaBackend seam is untouched (a consumer that never calls this treats the
 *  backend exactly like htmlMedia). */
export function isGaplessBackend(backend: MediaBackend): backend is GaplessBackend {
  return typeof (backend as Partial<GaplessBackend>).prepareNext === 'function';
}

export interface GaplessDualTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface GaplessDualOptions {
  /** The two elements (caller-owned, stable identity — same rule as htmlMedia).
   *  Omit to create two default <audio preload="auto"> elements (requires
   *  `document`). */
  elements?: [MediaElementLike, MediaElementLike];
  /** Initial crossfade seconds (clamped to [0, MAX_CROSSFADE_SEC]); default 0. */
  crossfadeSec?: number;
  /** Preload lead time in seconds; default 15. */
  preloadWindowSec?: number;
  /** Injectable interval seam so the ramp is testable without wall-clock time;
   *  defaults to the global setInterval/clearInterval. */
  timers?: GaplessDualTimers;
}

// ── Error classification — duplicated from htmlMedia.ts (module-private there; this
// file must stay import-free beyond types for the transpile-one-file test pattern).
// Same MediaError.code and DOMException.name → BackendErrorKind vocabulary.
function classifyMediaErrorCode(code: number): BackendErrorKind {
  switch (code) {
    case 1: return 'aborted';
    case 2: return 'network';
    case 3: return 'decode';
    case 4: return 'src-unsupported';
    default: return 'unknown';
  }
}

function classifyPlayRejection(err: unknown): BackendErrorKind {
  const name = err && typeof err === 'object' && 'name' in err
    ? (err as { name?: unknown }).name
    : undefined;
  if (name === 'AbortError') return 'aborted';
  if (name === 'NotAllowedError') return 'autoplay-blocked';
  if (name === 'NotSupportedError') return 'src-unsupported';
  return 'unknown';
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

function toBackendError(kind: BackendErrorKind, err: unknown): BackendError {
  return { kind, code: null, message: messageOf(err) };
}

function clampCrossfade(sec: number): number {
  if (!Number.isFinite(sec)) return 0;
  return Math.min(MAX_CROSSFADE_SEC, Math.max(0, sec));
}

function createDefaultElement(): MediaElementLike {
  if (typeof document === 'undefined') {
    throw new Error(
      'createGaplessDualBackend(): no elements were provided and there is no ' +
      '`document` to create defaults — pass a pair of HTMLMediaElements.',
    );
  }
  const el = document.createElement('audio');
  el.preload = 'auto';
  return el as unknown as MediaElementLike;
}

const DEFAULT_TIMERS: GaplessDualTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

/** Two elements, preload-and-swap. See the file header for the full behavior spec. */
export function createGaplessDualBackend(opts: GaplessDualOptions = {}): GaplessBackend {
  const elA = opts.elements?.[0] ?? createDefaultElement();
  const elB = opts.elements?.[1] ?? createDefaultElement();
  const timers = opts.timers ?? DEFAULT_TIMERS;
  const preloadWindowSec = opts.preloadWindowSec ?? DEFAULT_PRELOAD_WINDOW_SEC;

  let active: MediaElementLike = elA;      // the element the seam's getters/commands target
  let crossfadeSecVal = clampCrossfade(opts.crossfadeSec ?? 0);
  let userVolume = 1;                      // the ceiling — element volumes never exceed it
  let mutedFlag = false;
  let rateVal = 1;

  let pendingNextUrl: string | null = null;   // what prepareNext most recently named
  let preloadedUrl: string | null = null;     // what the standby element is actually loading
  let standbyReady = false;                   // standby fired loadedmetadata for preloadedUrl
  let ackUrl: string | null = null;           // one-shot: the url the next load() may adopt
  let fade: { outgoing: MediaElementLike; handle: unknown } | null = null;
  let disposed = false;

  const listeners = new Set<BackendEventListener>();
  const swapListeners = new Set<(info: SwapInfo) => void>();

  function standby(): MediaElementLike { return active === elA ? elB : elA; }

  function emit(event: BackendEvent): void {
    for (const listener of listeners) listener(event);
  }

  // ---- Fade lifecycle -------------------------------------------------------------
  // endFade() serves BOTH the natural completion (p reached 1, or the outgoing
  // ended/errored) and the hard-cut (pause/real-seek/real-load mid-fade): in every
  // case the outgoing is silenced + cleared and the incoming gets the user ceiling.
  function endFade(): void {
    if (!fade) return;
    const { outgoing, handle } = fade;
    fade = null;
    timers.clearInterval(handle);
    try { outgoing.pause(); } catch { /* already gone */ }
    outgoing.volume = userVolume;   // restore for its next life as the incoming
    outgoing.src = '';
    active.volume = userVolume;
  }

  function applyFadeVolumes(p: number): void {
    if (!fade) return;
    active.volume = userVolume * p;
    fade.outgoing.volume = userVolume * (1 - p);
  }

  function currentFadeProgress(sec: number): number {
    // The incoming starts at 0, so its own currentTime IS the elapsed fade time —
    // rate-aware for free (both elements share playbackRate), and pausing pauses it.
    return Math.min(1, Math.max(0, sec > 0 ? active.currentTime / sec : 1));
  }

  function startFade(outgoing: MediaElementLike): void {
    const sec = crossfadeSecVal;   // captured — a mid-fade knob change affects the NEXT fade
    const state: { outgoing: MediaElementLike; handle: unknown } = { outgoing, handle: null };
    fade = state;
    applyFadeVolumes(0);
    state.handle = timers.setInterval(() => {
      if (fade !== state) return;   // superseded/cancelled between scheduling and firing
      const p = currentFadeProgress(sec);
      applyFadeVolumes(p);
      if (p >= 1) endFade();
    }, FADE_TICK_MS);
  }

  // ---- The swap -------------------------------------------------------------------
  function commitSwap(withFade: boolean): void {
    const url = preloadedUrl as string;   // callers guard standbyReady && preloadedUrl
    const outgoing = active;
    const incoming = standby();

    // Consume the preparation + flip roles: getters report the incoming from here on.
    active = incoming;
    preloadedUrl = null;
    standbyReady = false;
    if (pendingNextUrl === url) pendingNextUrl = null;
    ackUrl = url;   // one-shot — the engine's next load() of this exact url adopts, not reloads

    incoming.playbackRate = rateVal;
    incoming.muted = mutedFlag;
    if (withFade) {
      startFade(outgoing);   // registers fade state FIRST — the engine's synchronous
      //                        setVolume reaction to 'loadedmetadata' below must hit
      //                        the fading branch (re-scale), never slam full volume
    } else {
      incoming.volume = userVolume;
      try { outgoing.pause(); } catch { /* already ended */ }
      outgoing.src = '';
    }

    // Start the incoming BEFORE telling anyone — the boundary is NOW.
    let playResult: Promise<void> | void;
    try {
      playResult = incoming.play();
    } catch (err) {
      emit({ type: 'error', error: toBackendError(classifyPlayRejection(err), err) });
      playResult = undefined;
    }
    if (playResult) {
      Promise.resolve(playResult).then(undefined, (err) => {
        if (disposed) return;
        emit({ type: 'error', error: toBackendError(classifyPlayRejection(err), err) });
      });
    }

    // The engine-facing swap: ONE synthesized 'loadedmetadata' (the incoming's real
    // one fired during preload, swallowed as non-active); 'play'/'playing'/'timeupdate'
    // then arrive organically from the incoming, which forwards now that it IS active.
    emit({ type: 'loadedmetadata' });

    // The handshake side-channel, after the engine-facing events (settled backend).
    for (const l of swapListeners) l({ url });
  }

  // ---- Preload + fade arming (driven off the ACTIVE element's timeupdate) ---------
  function maybeStartPreload(): void {
    if (fade || disposed) return;
    if (!pendingNextUrl || preloadedUrl === pendingNextUrl) return;
    const dur = active.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (dur - active.currentTime > preloadWindowSec) return;
    preloadedUrl = pendingNextUrl;
    standbyReady = false;
    const sb = standby();
    sb.src = preloadedUrl;
    sb.load();
  }

  function maybeBeginCrossfade(): void {
    if (fade || disposed) return;
    if (crossfadeSecVal <= 0 || !standbyReady || preloadedUrl === null) return;
    const dur = active.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const remaining = dur - active.currentTime;
    if (remaining <= 0 || remaining > crossfadeSecVal) return;
    commitSwap(true);
  }

  // ---- Per-element event dispatch (role-aware) ------------------------------------
  // ACTIVE element events forward to the engine (plus drive the preload/fade arming);
  // NON-ACTIVE element events are internal only: the standby's loadedmetadata marks
  // the preload ready, its error discards the preload (never surfaced — the active
  // track is fine), and a fading outgoing's ended/error settles the fade early.
  function handleElementEvent(el: MediaElementLike, type: string): void {
    if (el === active) {
      switch (type) {
        case 'loadedmetadata': emit({ type: 'loadedmetadata' }); break;
        case 'timeupdate':
          maybeStartPreload();
          maybeBeginCrossfade();
          // maybeBeginCrossfade may have committed a swap, demoting this element —
          // its final timeupdate must not leak after the swap's 'loadedmetadata'.
          if (el === active) emit({ type: 'timeupdate' });
          break;
        case 'play': emit({ type: 'play' }); break;
        case 'pause': emit({ type: 'pause' }); break;
        case 'waiting': emit({ type: 'waiting' }); break;
        case 'playing': emit({ type: 'playing' }); break;
        case 'ended':
          // A ready next → swap INSTEAD of ending (crossfade 0's boundary; also the
          // fallback when a fade never got to arm — e.g. a seek jumped the window).
          if (standbyReady && preloadedUrl !== null) { commitSwap(false); return; }
          emit({ type: 'ended' });
          break;
        case 'error': {
          const mediaError = el.error;
          if (!mediaError) return;
          emit({
            type: 'error',
            error: {
              kind: classifyMediaErrorCode(mediaError.code),
              code: mediaError.code,
              message: mediaError.message || `media error (code ${mediaError.code})`,
            },
          });
          break;
        }
      }
      return;
    }
    // Non-active element:
    if (fade && el === fade.outgoing) {
      if (type === 'ended' || type === 'error') endFade();   // outgoing finished/died mid-ramp
      return;   // everything else from a fading outgoing is swallowed
    }
    if (type === 'loadedmetadata') {
      // Guarded on preloadedUrl (not el.src equality — browsers absolutize .src):
      // we only ever point the standby at preloadedUrl, and a src change aborts the
      // old load, so a loadedmetadata here IS the pending preload becoming ready.
      if (preloadedUrl !== null) standbyReady = true;
      return;
    }
    if (type === 'error') {
      if (preloadedUrl !== null) {   // preload failed — discard silently, degrade to engine-driven advance
        preloadedUrl = null;
        standbyReady = false;
        el.src = '';
      }
      return;
    }
    // 'timeupdate'/'play'/'pause'/'waiting'/'playing'/'ended' from an idle standby: swallow.
  }

  const EVENT_TYPES = ['loadedmetadata', 'timeupdate', 'play', 'pause', 'waiting', 'playing', 'ended', 'error'] as const;

  // Same paired-wiring discipline as htmlMedia: add/remove loop over ONE array per
  // element, so cleanup can never drift from wiring.
  const wiring: Array<[MediaElementLike, string, (ev?: unknown) => void]> = [];
  for (const el of [elA, elB]) {
    for (const type of EVENT_TYPES) {
      const handler = (): void => handleElementEvent(el, type);
      wiring.push([el, type, handler]);
      el.addEventListener(type, handler);
    }
  }

  const backend: GaplessBackend = {
    load(source: MediaSourceDescriptor): void {
      // The handshake acknowledgment: the engine (round-tripped through the adapter's
      // queue advance) re-requests the EXACT url a swap just consumed. Adopt the
      // already-playing element — reloading it would reintroduce the gap the swap
      // closed. One-shot: matched or not, ackUrl is spent after the first load().
      if (ackUrl !== null && source.url === ackUrl) {
        ackUrl = null;
        // Honor the seam contract (load() fires nothing synchronously; loadedmetadata
        // "follows") without touching the element — its metadata is already known.
        queueMicrotask(() => { if (!disposed) emit({ type: 'loadedmetadata' }); });
        return;
      }
      ackUrl = null;
      // A real load: hard-cut any fade, reset preparation (the adapter re-prepares
      // from its queue after the change that caused this), point the ACTIVE element.
      endFade();
      if (preloadedUrl !== null) {
        preloadedUrl = null;
        standbyReady = false;
        const sb = standby();
        try { sb.pause(); } catch { /* idle */ }
        sb.src = '';
      }
      pendingNextUrl = null;
      active.src = source.url;
      active.load();
    },

    play(): Promise<void> {
      let result: Promise<void> | void;
      try {
        result = active.play();
      } catch (err) {
        return Promise.reject(toBackendError(classifyPlayRejection(err), err));
      }
      return Promise.resolve(result).then(
        () => undefined,
        (err) => { throw toBackendError(classifyPlayRejection(err), err); },
      );
    },

    pause(): void {
      endFade();   // mid-fade pause hard-cuts to the incoming (see header semantics)
      active.pause();
    },

    seek(seconds: number): void {
      // Micro-seeks keep a running fade (absorbs the engine's post-adoption seek(0));
      // a real jump hard-cuts it — cross-ramping two now-unrelated positions is noise.
      if (fade && Math.abs(seconds - active.currentTime) >= FADE_SEEK_KEEP_EPSILON_SEC) {
        endFade();
      }
      active.currentTime = seconds;
    },

    setRate(rate: number): void {
      rateVal = rate;
      elA.playbackRate = rate;
      elB.playbackRate = rate;
    },

    setVolume(level: number): void {
      userVolume = level;
      if (fade) applyFadeVolumes(currentFadeProgress(crossfadeSecVal));   // re-scale under the new ceiling
      else active.volume = level;
    },

    setMuted(muted: boolean): void {
      mutedFlag = muted;
      elA.muted = muted;
      elB.muted = muted;
    },

    get currentTime(): number { return active.currentTime; },
    get duration(): number { return active.duration; },
    get paused(): boolean { return active.paused; },
    get rate(): number { return rateVal; },
    /** The USER ceiling, not the (possibly mid-ramp) element volume — what the
     *  engine's volume axis persists and re-applies must round-trip stably. */
    get volume(): number { return userVolume; },
    get muted(): boolean { return mutedFlag; },

    on(listener: BackendEventListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    prepareNext(url: string | null): void {
      if (disposed || url === pendingNextUrl) return;
      pendingNextUrl = url;
      if (preloadedUrl !== null && preloadedUrl !== url) {
        // A stale preload for a next that no longer follows — discard it. (Never
        // reachable mid-fade: the swap nulls preloadedUrl before any fade starts.)
        preloadedUrl = null;
        standbyReady = false;
        const sb = standby();
        try { sb.pause(); } catch { /* idle */ }
        sb.src = '';
      }
      // The preload itself (re-)arms on the next active timeupdate inside the window.
    },

    get crossfadeSec(): number { return crossfadeSecVal; },
    set crossfadeSec(sec: number) { crossfadeSecVal = clampCrossfade(sec); },

    onSwap(listener: (info: SwapInfo) => void): () => void {
      swapListeners.add(listener);
      return () => { swapListeners.delete(listener); };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      endFade();
      for (const [el, type, handler] of wiring) el.removeEventListener(type, handler);
      listeners.clear();
      swapListeners.clear();
      for (const el of [elA, elB]) {
        try { el.pause(); } catch { /* already gone / not applicable */ }
        el.src = '';
      }
    },
  };

  return backend;
}

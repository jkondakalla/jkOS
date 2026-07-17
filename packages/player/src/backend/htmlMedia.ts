// packages/player/src/backend/htmlMedia.ts — the ONE MediaBackend implementation
// that serves both <audio> and <video> (ToDo.md §3 Wave 15, item 15.2).
//
// HTMLMediaElement's API is identical for <audio> and <video> (play/pause/seek/
// currentTime/duration/error/events) — that's the whole reason a video player costs
// almost nothing once this seam exists (Documentation/PLAYER_PARITY.md §3).
//
// Load-bearing invariant carried over from usePlayerEngine.ts (§3 "Load-bearing
// details to preserve in the extraction"): the caller owns a STABLE-IDENTITY element
// across the whole mount lifetime; createHtmlMediaBackend() never replaces it —
// load() just points the same element at a new source. Passing an existing element
// is therefore the primary path; creating a default <audio> is only a convenience for
// callers that don't need to own one (or for tests running outside a DOM, which never
// hit that path at all).
//
// No React, no papyros imports, no `packages/player/src/core` imports. Depends ONLY
// on the element's interface (MediaElementLike below) — never on `document`/`window`
// — except inside the opt-in create-default-element path, so a scripted fake element
// can drive this in plain Node (see test/backend.test.mjs).
import type {
  BackendError,
  BackendErrorKind,
  BackendEvent,
  BackendEventListener,
  MediaBackend,
  MediaSourceDescriptor,
} from './types';

/** The minimal HTMLMediaElement surface this backend needs — deliberately narrow so
 *  a plain scripted object (no DOM) can satisfy it in tests. `currentSrc` is
 *  optional because the fake test element doesn't need to distinguish it from `src`;
 *  real HTMLMediaElement has both. */
export interface MediaElementLike {
  src: string;
  currentSrc?: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  volume: number;
  muted: boolean;
  error: { code: number; message?: string } | null;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  addEventListener(type: string, listener: (ev?: unknown) => void): void;
  removeEventListener(type: string, listener: (ev?: unknown) => void): void;
}

// MediaError.code (1 aborted · 2 network · 3 decode · 4 src-not-supported) — same
// mapping usePlayerEngine.ts's onError used inline; centralized here so it feeds
// BOTH error channels (see classifyPlayRejection below).
function classifyMediaErrorCode(code: number): BackendErrorKind {
  switch (code) {
    case 1: return 'aborted';
    case 2: return 'network';
    case 3: return 'decode';
    case 4: return 'src-unsupported';
    default: return 'unknown';
  }
}

// A rejected play() promise's DOMException.name — same three names
// usePlayerEngine.ts's playFailed() branched on (AbortError / NotAllowedError /
// NotSupportedError), mapped onto the SAME BackendErrorKind vocabulary the DOM
// 'error' event uses so the engine's recovery policy has one vocabulary, not two.
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

function createDefaultElement(): MediaElementLike {
  if (typeof document === 'undefined') {
    throw new Error(
      'createHtmlMediaBackend(): no element was provided and there is no `document` ' +
      'to create a default one — pass an existing HTMLMediaElement.',
    );
  }
  const el = document.createElement('audio');
  el.preload = 'auto';
  return el as unknown as MediaElementLike;
}

/** One MediaBackend impl for both <audio> and <video> — pass the element you already
 *  own (its stable identity is load-bearing, see the file header), or omit it to get
 *  a default <audio> element (requires `document`). */
export function createHtmlMediaBackend(el?: MediaElementLike): MediaBackend {
  const element: MediaElementLike = el ?? createDefaultElement();
  const listeners = new Set<BackendEventListener>();
  let disposed = false;

  function emit(event: BackendEvent): void {
    for (const listener of listeners) listener(event);
  }

  // ---- DOM event → BackendEvent forwarding --------------------------------------
  function onLoadedMetadata(): void { emit({ type: 'loadedmetadata' }); }
  function onTimeUpdate(): void { emit({ type: 'timeupdate' }); }
  function onPlay(): void { emit({ type: 'play' }); }
  function onPause(): void { emit({ type: 'pause' }); }
  function onWaiting(): void { emit({ type: 'waiting' }); }
  function onPlaying(): void { emit({ type: 'playing' }); }
  function onEnded(): void { emit({ type: 'ended' }); }
  function onDomError(): void {
    const mediaError = element.error;
    if (!mediaError) return;   // a stray 'error' with no MediaError attached — nothing to report
    emit({
      type: 'error',
      error: {
        kind: classifyMediaErrorCode(mediaError.code),
        code: mediaError.code,
        message: mediaError.message || `media error (code ${mediaError.code})`,
      },
    });
  }

  // Paired [type, handler] list — add/remove loop over the SAME array so cleanup can
  // never drift from wiring (a mismatched add/remove pair was a real bug class the
  // engine's manual 8-line add block / 8-line remove block risked; see
  // usePlayerEngine.ts:609-616 vs 627-634).
  const wiring: Array<[string, (ev?: unknown) => void]> = [
    ['loadedmetadata', onLoadedMetadata],
    ['timeupdate', onTimeUpdate],
    ['play', onPlay],
    ['pause', onPause],
    ['waiting', onWaiting],
    ['playing', onPlaying],
    ['ended', onEnded],
    ['error', onDomError],
  ];
  for (const [type, handler] of wiring) element.addEventListener(type, handler);

  const backend: MediaBackend = {
    load(source: MediaSourceDescriptor): void {
      element.src = source.url;
      element.load();
    },

    play(): Promise<void> {
      let result: Promise<void> | void;
      try {
        result = element.play();
      } catch (err) {
        return Promise.reject(toBackendError(classifyPlayRejection(err), err));
      }
      return Promise.resolve(result).then(
        () => undefined,
        (err) => { throw toBackendError(classifyPlayRejection(err), err); },
      );
    },

    pause(): void { element.pause(); },
    seek(seconds: number): void { element.currentTime = seconds; },
    setRate(rate: number): void { element.playbackRate = rate; },
    setVolume(level: number): void { element.volume = level; },
    setMuted(muted: boolean): void { element.muted = muted; },

    get currentTime(): number { return element.currentTime; },
    get duration(): number { return element.duration; },
    get paused(): boolean { return element.paused; },
    get rate(): number { return element.playbackRate; },
    get volume(): number { return element.volume; },
    get muted(): boolean { return element.muted; },

    on(listener: BackendEventListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [type, handler] of wiring) element.removeEventListener(type, handler);
      listeners.clear();
      try { element.pause(); } catch { /* already gone / not applicable */ }
      element.src = '';
    },
  };

  return backend;
}

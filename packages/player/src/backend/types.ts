// packages/player/src/backend/types.ts — the MediaBackend seam (ToDo.md §3 Wave 15,
// item 15.2).
//
// Extracted from apps/papyros/src/player/usePlayerEngine.ts, which today drives a
// single HTMLAudioElement directly. Everything the engine touches on that element —
// commands, transport state, and its two error channels (a rejected `play()` promise,
// and the element's `error` DOM event) — is expressed here, DOM-vocabulary-neutral
// where that's cheap: the event names below ARE the DOM event names the engine
// already listens for; nothing invented beyond what usePlayerEngine.ts uses.
//
// Two backends are meant to satisfy this interface without the engine changing:
// `htmlMedia` (this wave — wraps one HTMLMediaElement, audio OR video, see
// htmlMedia.ts) and a future `gaplessDual` (two elements, preload-and-swap — Wave 18,
// see Documentation/PLAYER_PARITY.md §3, Layer 0/Layer 1 boundary). Neither this file
// nor htmlMedia.ts imports from apps/papyros or packages/player/src/core — the seam
// is self-contained.
//
// What deliberately STAYS OUT of this seam (app / engine policy, not backend policy):
//  - The Firefox compat-rung recovery LADDER (which rung, when to give up, the
//    `?compat=<n>` URL shape, the /prepare poll loop) — usePlayerEngine.ts's
//    attemptCompatRecovery. The backend only needs to hand the policy a
//    rich-enough 'error' event (decode vs network vs src-unsupported vs
//    autoplay-blocked) to decide what to do, plus load()/seek() to act with.
//  - Global-timeline math (multi-file position mapping) — position.ts. seek() here
//    is local to whatever source is currently loaded.
//  - Autoplay INTENT (`wantPlayRef`), pending-seek-on-load, rate-reapply-after-load —
//    all engine-side bookkeeping driven off the event stream below.

/** What to load. `mime`/`kind` are optional hints for backends that need them (a
 *  future HLS/gaplessDual backend); `htmlMedia` only uses `url`. */
export interface MediaSourceDescriptor {
  url: string;
  mime?: string;
  kind?: 'audio' | 'video';
}

/** Every failure mode the engine's recovery policy and autoplay path branch on today,
 *  collapsed into one vocabulary shared by BOTH error channels (see BackendError
 *  below):
 *   - 'decode' / 'network' / 'src-unsupported' / 'aborted' come from the element's
 *     `error` DOM event (MediaError.code 3 / 2 / 4 / 1).
 *   - 'autoplay-blocked' / 'src-unsupported' / 'aborted' can also come from a
 *     rejected play() promise (DOMException.name NotAllowedError /
 *     NotSupportedError / AbortError) — 'aborted' there means "superseded by a
 *     newer load, not a real failure" (usePlayerEngine.ts's `playFailed` treats
 *     AbortError as routine and returns early), matching what MediaError code 1
 *     means.
 *   - 'unknown' is anything else (rare; the engine doesn't distinguish further
 *     today — its message map has a single generic "Playback failed" fallback).
 */
export type BackendErrorKind =
  | 'decode'
  | 'network'
  | 'src-unsupported'
  | 'aborted'
  | 'autoplay-blocked'
  | 'unknown';

export interface BackendError {
  kind: BackendErrorKind;
  /** Raw MediaError.code (1-4) when this came from the element's `error` DOM event;
   *  null when it came from a rejected play() promise (no MediaError exists there). */
  code: number | null;
  /** Low-level diagnostic text (MediaError.message, or the play() rejection's
   *  message) — for logging, NOT user-facing copy. User-facing phrasing per `kind`
   *  is app policy (today: usePlayerEngine.ts's playFailed / onError message maps,
   *  e.g. "Could not decode this file — your browser may lack AAC/M4B support."). */
  message: string;
}

/** The event stream. Payload-free except 'error' (which must carry the
 *  classification — that's the whole point of the seam). Exactly the DOM events
 *  usePlayerEngine.ts listens for today:
 *   - loadedmetadata — duration/seekable ready: apply a pending seek, reapply rate,
 *     honor autoplay intent.
 *   - timeupdate — read the position getters (currentTime) off the backend.
 *   - play / pause / waiting / playing — drive `playing` / `buffering` state.
 *   - ended — advance the queue (or mark finished).
 *   - error — see BackendError.
 *  No durationchange / canplay / ratechange / volumechange: the engine doesn't
 *  listen for them today, so they are not part of the seam yet (no speculative
 *  extras — add them when a real consumer needs them). */
export type BackendEvent =
  | { type: 'loadedmetadata' }
  | { type: 'timeupdate' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'waiting' }
  | { type: 'playing' }
  | { type: 'ended' }
  | { type: 'error'; error: BackendError };

export type BackendEventListener = (event: BackendEvent) => void;

/** The seam. One backend instance is bound to one playable "slot" for its whole
 *  lifetime (an htmlMedia backend owns one stable-identity element — see
 *  htmlMedia.ts's load-bearing invariant); load() swaps what's playing in that slot
 *  without recreating the backend. Nothing here is stateful the engine must poll to
 *  find out whether a command "worked" — state flows via the event stream (what
 *  changed) plus these getters (what it is now); load() itself returns nothing
 *  stateful. */
export interface MediaBackend {
  /** Start loading `source` into the slot. Fires no event synchronously;
   *  'loadedmetadata' follows once the backend can report `duration` and accept a
   *  seek. Calling load() again — a book swap, a file-boundary advance, or a
   *  compat-rung reload with a different (`?compat=<n>`) URL — IS how "reload" is
   *  expressed; there is no separate reload primitive. */
  load(source: MediaSourceDescriptor): void;

  /** Mirrors HTMLMediaElement.play(): resolves once playback starts, rejects with a
   *  BackendError (already classified — see BackendErrorKind) on failure, most
   *  notably 'autoplay-blocked' when the browser's autoplay policy vetoed a play()
   *  that outlived the user gesture that triggered it. */
  play(): Promise<void>;
  pause(): void;
  /** Seek within the CURRENTLY LOADED source, in seconds. Cross-source seeking (e.g.
   *  papyros's global-timeline seek across file boundaries) is engine policy: call
   *  load() on the target source, then seek() once 'loadedmetadata' fires. */
  seek(seconds: number): void;
  setRate(rate: number): void;
  setVolume(level: number): void;
  setMuted(muted: boolean): void;

  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly volume: number;
  readonly muted: boolean;

  /** Subscribe to the event stream. Returns an unsubscribe function. */
  on(listener: BackendEventListener): () => void;

  /** Release everything this backend attached (its event listeners) and quiesce the
   *  slot (htmlMedia: pause + clear `src`, mirroring the engine's old unmount path).
   *  Ownership of a caller-owned element stays with the caller — dispose() silences
   *  it but never destroys it. Idempotent. */
  dispose(): void;
}

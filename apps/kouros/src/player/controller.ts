// player/controller.ts — the ONE seam between views and the player (ToDo.md §3 Wave
// 18, item 18.4; mirrors apps/papyros/src/player/controller.ts's precedent). The
// library UI (18.3) requests playback here; PlayerBar (this wave) subscribes and owns
// all actual <audio> + queue state. Views never import PlayerBar and PlayerBar never
// imports views, so 18.3 and 18.4 can land in either order without touching each
// other's files. No buffering: PlayerBar is mounted persistently, so a listener is
// always registered by the time any view can emit.
//
// Unlike papyros's single-item PlayRequest ({ bookId, position }), KourOS plays a
// QUEUE — `trackIds` is the whole list (an album, a playlist, a search result page,
// …) and `startIndex` is where playback begins within it. Every request — an initial
// "play this album", a <QueuePanel> row tap, next/prev track, or the engine's own
// end-of-track auto-advance — goes through this ONE function (see usePlayerEngine.ts's
// playIndex()), so the queue the bar renders and the queue the engine is actually
// playing can never drift apart.

export interface PlayRequest {
  trackIds: number[];
  /** Index into `trackIds` playback begins at. */
  startIndex: number;
  /** Seconds into that track to start at; omit to start from 0 (KourOS has no
   *  server-side resume — see usePlayerEngine.ts's ProgressStore note). */
  position?: number;
}

type Listener = (req: PlayRequest) => void;
const listeners = new Set<Listener>();

/** Ask the player to play a queue (optionally starting mid-track). */
export function requestPlay(req: PlayRequest): void {
  for (const l of listeners) l(req);
}

/** Subscribe to play requests (PlayerBar). Returns the unsubscribe function. */
export function onPlayRequest(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ─── Live position broadcast ────────────────────────────────────────────────────
// The other direction across the same seam: the engine adapter pushes its live
// position out so views (a track row's progress fill, a "currently playing" badge)
// can render it without a second usePlayerEngine() instance — PlayerBar owns the only
// <audio>. Throttled to ~1/s from 'timeupdate' by the underlying @jkos/player/engine
// (same mechanism as papyros), published immediately on seeks/track loads/queue
// advances so nav still feels instant.

export interface PositionUpdate {
  trackId: number;
  /** Position in seconds within the CURRENT track (music timelines are one file —
   *  there is no cross-file global offset to reconcile here, unlike papyros). */
  position: number;
}

type PositionListener = (pos: PositionUpdate) => void;
const positionListeners = new Set<PositionListener>();
let lastPosition: PositionUpdate | null = null;

/** Publish the player's current position (PlayerBar/usePlayerEngine only). */
export function publishPosition(pos: PositionUpdate): void {
  lastPosition = pos;
  for (const l of positionListeners) l(pos);
}

/** Subscribe to live position broadcasts. Returns the unsubscribe function. */
export function onPosition(l: PositionListener): () => void {
  positionListeners.add(l);
  return () => { positionListeners.delete(l); };
}

/** The most recent broadcast, if any — lets a view that mounts mid-playback read the
 *  live position immediately instead of waiting up to ~1s for the next tick. */
export function getLastPosition(): PositionUpdate | null {
  return lastPosition;
}

// ─── Queue edits across the same seam ───────────────────────────────────────────
// "Play next" and "Add to queue" are actions a LIBRARY view offers (a row's menu,
// an album header), but only PlayerBar holds the engine — a view calling
// usePlayerEngine() itself would mount a second <audio> and a second queue. So the
// same publish/subscribe seam that carries play requests carries queue edits:
// views emit, PlayerBar subscribes and applies them to the one real queue.
//
// `where` is deliberately an explicit enum rather than a boolean. The brief calls
// for "Play next" and "Add to queue" to read as two distinct, visible actions, and
// a parameter named `next: boolean` is exactly how those two actions quietly
// collapse back into one control with a modifier.

export interface EnqueueRequest {
  trackIds: number[];
  where: 'next' | 'end';
}

type EnqueueListener = (req: EnqueueRequest) => void;
const enqueueListeners = new Set<EnqueueListener>();

/** Ask the player to insert tracks after the current one, or append them. */
export function requestEnqueue(req: EnqueueRequest): void {
  for (const l of enqueueListeners) l(req);
}

/** Subscribe to queue edits (PlayerBar only). Returns the unsubscribe function. */
export function onEnqueueRequest(l: EnqueueListener): () => void {
  enqueueListeners.add(l);
  return () => { enqueueListeners.delete(l); };
}

// ─── The now-playing broadcast ─────────────────────────────────────────────────
// Which track is loaded, and whether it is playing — so a library row can mark
// itself as the current one without a second engine. Position is already carried
// by the position broadcast above; this is the coarser "what and whether" signal
// that a track list needs to render its playing state.

export interface NowPlayingState {
  trackId: number | null;
  playing: boolean;
}

type NowListener = (state: NowPlayingState) => void;
const nowListeners = new Set<NowListener>();
let lastNow: NowPlayingState = { trackId: null, playing: false };

export function publishNowPlaying(state: NowPlayingState): void {
  if (state.trackId === lastNow.trackId && state.playing === lastNow.playing) return;
  lastNow = state;
  for (const l of nowListeners) l(state);
}

export function onNowPlaying(l: NowListener): () => void {
  nowListeners.add(l);
  return () => { nowListeners.delete(l); };
}

export function getNowPlaying(): NowPlayingState {
  return lastNow;
}

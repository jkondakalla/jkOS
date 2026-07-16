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

// player/controller.ts — the ONE seam between the views and the player. Library (5.2)
// and BookDetail (5.3) request playback here; PlayerBar (5.4) subscribes and owns all
// actual <audio> state. Views never import PlayerBar and PlayerBar never imports views,
// so the Wave-5 tasks that own each side can land in either order without touching the
// other's files. No buffering: PlayerBar is mounted persistently in App.tsx, so a
// listener is always registered by the time any view can emit.

export interface PlayRequest {
  bookId: number;
  /** Global position in seconds across the WHOLE book (files concatenated in
   *  files[].index order — the player maps this to (fileIndex, offset) via the
   *  per-file durations). Omit to resume from saved progress, or start at 0. */
  position?: number;
}

type Listener = (req: PlayRequest) => void;
const listeners = new Set<Listener>();

/** Ask the player to play a book (optionally from a global position). */
export function requestPlay(req: PlayRequest): void {
  for (const l of listeners) l(req);
}

/** Subscribe to play requests (PlayerBar). Returns the unsubscribe function. */
export function onPlayRequest(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ─── Live position broadcast ────────────────────────────────────────────────────
// The other direction across the same seam: usePlayerEngine pushes its `globalPos`
// out so views (5.3's chapter-fill progress bar) can render it LIVE without a second
// usePlayerEngine() instance — PlayerBar owns the only <audio>. The engine throttles
// this to ~1/s from `timeupdate` (which fires ~4x/s) and publishes immediately on
// seeks/chapter loads/book switches so nav still feels instant; consumers compare
// `bookId` against the book they're showing and fall back to saved progress on a
// mismatch (a different book playing, or nothing playing at all).

export interface PositionUpdate {
  bookId: number;
  /** Global position in seconds — same axis as PlayRequest.position. */
  globalPos: number;
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

/** The most recent broadcast, if any — lets a view that mounts mid-playback (e.g.
 *  opening a book's detail page while it's already playing) read the live position
 *  immediately instead of waiting up to ~1s for the next tick. */
export function getLastPosition(): PositionUpdate | null {
  return lastPosition;
}

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

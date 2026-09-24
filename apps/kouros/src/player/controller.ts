// player/controller.ts — the ONE seam between views and the player (git history Wave
// 18, item 18.4). The
// library UI (18.3) requests playback here; PlayerBar (this wave) subscribes and owns
// all actual <audio> + queue state. Views never import PlayerBar and PlayerBar never
// imports views, so 18.3 and 18.4 can land in either order without touching each
// other's files. No buffering: PlayerBar is mounted persistently, so a listener is
// always registered by the time any view can emit.
//
// Not a single-item request ({ bookId, position }): KourOS plays a
// QUEUE — `trackIds` is the whole list (an album, a playlist, a search result page,
// …) and `startIndex` is where playback begins within it. Every request — an initial
// "play this album", a <QueuePanel> row tap, next/prev track, or the engine's own
// end-of-track auto-advance — goes through this ONE function (see usePlayerEngine.ts's
// playIndex()), so the queue the bar renders and the queue the engine is actually
// playing can never drift apart.

/** One playable thing, as views name it.
 *
 *  A bare NUMBER is a KourOS track id — every existing caller passes those and
 *  keeps working. A STRING is a composite `<source>:<id>` ref
 *  (player/sources.ts), which is how an audiobook enters the same queue. The
 *  widening is the whole cost of supporting two libraries here: `@jkos/player`'s
 *  queue is `string[]` already, so nothing in the package changes. */
export type PlayableRef = number | string;

export interface PlayRequest {
  trackIds: PlayableRef[];
  /** Index into `trackIds` playback begins at. */
  startIndex: number;
  /** Seconds into that item to start at. Omitted: a track starts at 0, a book
   *  resumes from its saved progress (sources.ts's progress store). */
  position?: number;
  /** Where this list was played FROM — an album, playlist, artist, station or
   *  book route (player/context.ts). Omitted for an ad-hoc list (search results,
   *  a map region), which is not a place "Recently played" can send you back to. */
  context?: string;
  /** `false` CUES the queue — loaded and positioned, left paused. Only the
   *  listening session uses it (a device opening on the session's item). */
  autoplay?: boolean;
}

// ─── The router — WHERE a view's request plays (2026-09-24) ──────────────────────
// Since the listening session, "play this album" does not always mean THIS tab's
// audio: with another device as the output, it plays THERE (Spotify's routing — Jag,
// 2026-09-23). So a view's request goes through a router the session installs
// (session/usePlayerSession.ts), and the router decides: this tab's engine, or a
// command to the output. Every call site stays `requestPlay(...)` and knows none of
// it.
//
// ⚠️ THE ENGINE'S OWN NAVIGATION NEVER GOES THROUGH THE ROUTER. Next track, a queue
// row, the end-of-track advance, a gapless swap's ack — those are the local engine
// moving its own queue, and routing them would send the output's auto-advance back
// to itself as a command. They use `requestLocalPlay`, which is the channel the
// engine's transport listens on. Without a router installed (no session: an old
// backend, a guest), a request simply plays here — exactly the pre-session app.

type Listener = (req: PlayRequest) => void;
const listeners = new Set<Listener>();

export interface PlayRouter {
  play(req: PlayRequest): void;
  enqueue(req: EnqueueRequest): void;
}
let router: PlayRouter | null = null;

/** Install the session's router. Returns the uninstall function. */
export function setPlayRouter(r: PlayRouter): () => void {
  router = r;
  return () => { if (router === r) router = null; };
}

/** A VIEW asks for a queue to play (optionally mid-track) — wherever the output is. */
export function requestPlay(req: PlayRequest): void {
  if (router) router.play(req);
  else requestLocalPlay(req);
}

/** THIS tab's engine plays a queue. The engine's own nav, and the router's local arm. */
export function requestLocalPlay(req: PlayRequest): void {
  for (const l of listeners) l(req);
}

/** The engine's transport subscribes here. Returns the unsubscribe function. */
export function onLocalPlayRequest(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ─── Live position broadcast ────────────────────────────────────────────────────
// The other direction across the same seam: the engine adapter pushes its live
// position out so views (a track row's progress fill, a "currently playing" badge)
// can render it without a second usePlayerEngine() instance — PlayerBar owns the only
// <audio>. Throttled to ~1/s from 'timeupdate' by the underlying @jkos/player/engine,
// published immediately on seeks/track loads/queue
// advances so nav still feels instant.

export interface PositionUpdate {
  /** The track playing, or null while a book plays. */
  trackId: number | null;
  /** The audiobook playing, or null while a track plays. Two fields rather than one
   *  `id`, because track 7 and book 7 are different things and a view comparing a
   *  bare number would mark the wrong one (sources.ts's ref note). */
  bookId: number | null;
  /** Seconds along the item's WHOLE timeline — a track is one file; a book's files
   *  are concatenated, so this is the book-global position a chapter list reads. */
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

/** A VIEW asks for tracks after the current one, or at the end — routed like
 *  requestPlay: to this tab's queue, or to the output's. */
export function requestEnqueue(req: EnqueueRequest): void {
  if (router) router.enqueue(req);
  else requestLocalEnqueue(req);
}

/** THIS tab's queue takes the edit. */
export function requestLocalEnqueue(req: EnqueueRequest): void {
  for (const l of enqueueListeners) l(req);
}

/** Subscribe to local queue edits (PlayerProvider only). Returns the unsubscribe function. */
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

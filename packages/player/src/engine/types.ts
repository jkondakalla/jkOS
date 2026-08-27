// packages/player/src/engine/types.ts — the seam contracts for the headless engine
// (git history: Wave 15 item 15.3).
//
// Every PapyrOS-specific dependency usePlayerEngine.ts hardcoded today becomes an
// injected seam declared here, so ONE headless engine drives audiobooks, music, and
// video (git history: PLAYER_PARITY.md, retired — "Layer 1 — engine"). Nothing here imports
// from apps/* — the engine speaks a vocabulary-neutral surface that thin per-app
// adapters (item 15.4 migrates PapyrOS by writing ONLY those adapters) map onto their
// own API client + row shapes.
//
// The one required generalization the task calls out explicitly: the sleep timer's
// end-of-'chapter' mode is 'segment' here (a PapyrOS wrapper may relabel it 'chapter'
// for its own UI copy).
import type { MediaBackend, BackendErrorKind } from '../backend/types';
import type { MediaSource, Segment, NavPoint } from '../core/timeline';

/** Item and row ids. PapyrOS uses numbers (⊂ this union) unchanged; a music/video app
 *  is free to key on strings. The engine only ever compares ids with `===` and
 *  interpolates them into a compat cache key, both of which are value-type agnostic. */
export type Id = string | number;

/** Sleep-timer modes. `'segment'` is the generalized end-of-'chapter' mode (the task's
 *  one mandated rename); a PapyrOS wrapper can re-expose it as `'chapter'` for its UI. */
export type SleepMode = 'off' | '15' | '30' | '45' | '60' | 'segment';

// ── Transport seam — was apps/papyros/src/player/controller.ts ──────────────────────
// The engine can't import PapyrOS's module-singleton controller, so its two directions
// (a view asks the engine to play; the engine broadcasts its live position back out)
// become an injected pub/sub seam. Vocabulary-neutral `itemId`/`position`; PapyrOS's
// adapter maps them onto controller.ts's `{ bookId, globalPos }` in ~2 lines each.

export interface EngineRequest {
  itemId: Id;
  /** Global seconds across the whole timeline; omit to resume from saved progress. */
  position?: number;
}

export interface PositionBroadcast {
  itemId: Id;
  /** Global seconds across the whole timeline (same axis as EngineRequest.position). */
  position: number;
}

export interface Transport {
  /** Subscribe to play requests. Returns the unsubscribe fn. (papyros: onPlayRequest) */
  subscribe(handler: (req: EngineRequest) => void): () => void;
  /** Broadcast the engine's live position. (papyros: publishPosition) */
  publishPosition(update: PositionBroadcast): void;
}

// ── ItemLoader seam — was ../api getBook + BookDetail field reads ───────────────────
// TItem stays fully OPAQUE to the engine (no structural constraint): everything the
// engine derives from an item flows through these four accessors, so a book, a track,
// or a film satisfy the seam without sharing a single field name.

export interface ItemLoader<TItem> {
  /** Load one item's detail. (papyros: getBook) */
  load(itemId: Id): Promise<TItem>;
  /** The item's id — the axis progress/bookmarks/urls/compat all key on. (papyros: item.id) */
  idOf(item: TItem): Id;
  /** The concatenated playback sources, in any order (buildTimeline sorts by .index).
   *  Only `.index`/`.duration` are read; richer objects pass through. (papyros: item.files) */
  sources(item: TItem): MediaSource[];
  /** The named spans over the global timeline (chapters, markers, …). (papyros: item.chapters) */
  segments(item: TItem): Segment[];
}

// ── ProgressStore seam — was ../api listProgress/createProgress/updateProgress ──────
// The engine reads only `position`/`finished` off a row (generic playback concepts);
// every app-specific field name (papyros's `book_ref`, `last_played`, the row `id`)
// stays inside the adapter, which owns create/update and the id readers.

/** The two fields the engine reads off a saved row to resume. */
export interface ProgressRowLike {
  position: number;
  finished: boolean;
}

/** A neutral write the adapter maps onto its own column names. */
export interface ProgressWrite {
  itemId: Id;
  position: number;
  duration: number;
  finished: boolean;
  /** ISO timestamp of this write. (papyros column: last_played) */
  playedAt: string;
}

export interface ProgressStore<TProgress extends ProgressRowLike> {
  /** This listener's saved row for the item, or null. (papyros: listProgress().find(book_ref)) */
  find(itemId: Id): Promise<TProgress | null>;
  create(write: ProgressWrite): Promise<TProgress>;
  /** Update the given row. The adapter owns the row's own id. (papyros: updateProgress(row.id, …)) */
  update(row: TProgress, write: ProgressWrite): Promise<TProgress>;
  /** The item a returned row belongs to — the serialized-write late-write guard
   *  compares this against the live item. (papyros: row.book_ref) */
  itemIdOf(row: TProgress): Id;
}

// ── BookmarkStore seam — was ../api listBookmarks/createBookmark/deleteBookmark ─────

/** The two fields the engine reads off a bookmark (sort key + delete key). */
export interface BookmarkRowLike {
  id: Id;
  position: number;
}

export interface BookmarkWrite {
  itemId: Id;
  position: number;
  title: string | null;
}

export interface BookmarkStore<TBookmark extends BookmarkRowLike> {
  /** Bookmarks for one item (adapter filters). (papyros: listBookmarks().filter(book_ref)) */
  list(itemId: Id): Promise<TBookmark[]>;
  create(write: BookmarkWrite): Promise<TBookmark>;
  remove(id: Id): Promise<void>;
}

// ── URL seam — was ../api streamUrl (incl. the ?compat=<n> shape) ───────────────────
// (An artwork `cover` URL lived here while the engine owned MediaSession; item 16.3
// moved MediaSession — metadata, handlers, playbackState, + the new setPositionState —
// into the composable services/useMediaSession hook, and apps now build their own
// artwork URLs for it, so the engine only ever resolves stream URLs.)

export interface PlayerUrls {
  /** Stream URL for one source at a compat level. Level 0 is the plain URL; a higher
   *  level selects a compat variant (papyros appends `?compat=<n>`). Called on EVERY
   *  load, so the compat-level parameter lives here, not only in the recovery ladder. */
  stream(itemId: Id, sourceIndex: number, compatLevel: number): string;
}

// ── Compat-recovery seam — was usePlayerEngine.ts's attemptCompatRecovery glue ──────
// The recovery LADDER (escalate a rung → prepare → poll → reload+seek-restore, with
// the reqSeq/reentrancy guards) stays in the engine as generic policy. Only the two
// app-specific pieces are injected: which starting rung a source wants, and the
// single-shot "build this rung, is it ready?" probe the engine's poll loop calls.

export type CompatPrepareOutcome =
  | 'ready'        // the rung is built — reload the source at this level now
  | 'pending'      // not ready yet — keep polling until the deadline
  | 'unavailable'; // this rung can't/won't be built — stop polling, give up

export interface CompatPrepareRequest {
  itemId: Id;
  sourceIndex: number;
  /** The rung to build (the escalated level). */
  level: number;
}

export interface CompatPolicy<TItem> {
  /** The highest rung. Recovery stops escalating at (>=) this. (papyros: 2) */
  maxLevel: number;
  /** The rung a source should START on, before any failure — lets an app open a
   *  pre-generated variant directly. (papyros: files[idx].compat_ready ? 1 : 0) */
  initialLevel(item: TItem, sourceIndex: number): number;
  /** Build the requested rung and report readiness — called once per poll tick by the
   *  engine's bounded, reqSeq-guarded loop. (papyros: POST <streamUrl>/prepare → {ready}) */
  prepare(req: CompatPrepareRequest): Promise<CompatPrepareOutcome>;
  /** Backend error kinds that trigger the ladder. Default: decode + src-unsupported. */
  recoverableKinds?: readonly BackendErrorKind[];
  /** Poll cadence / bound. Defaults: 2000ms / 120000ms (papyros's constants). */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

// ── User-facing copy (defaults reproduce PapyrOS's exact strings) ───────────────────

export interface PlayerMessages {
  autoplayBlocked: string;
  srcUnsupported: string;
  decode: string;
  network: string;
  aborted: string;
  playFailed: string;
  compatOptimizing: string;
  compatFailed: string;
}

// ── The hook config ─────────────────────────────────────────────────────────────────

export interface PlayerEngineConfig<
  TItem,
  TProgress extends ProgressRowLike,
  TBookmark extends BookmarkRowLike,
> {
  /** The media element wrapper. An instance, or a factory the engine calls ONCE (the
   *  stable-identity invariant — mirrors today's single persistent `new Audio()`). A
   *  factory is preferred so a StrictMode remount can rebuild it after dispose(). */
  backend: MediaBackend | (() => MediaBackend);
  itemLoader: ItemLoader<TItem>;
  progress: ProgressStore<TProgress>;
  bookmarks: BookmarkStore<TBookmark>;
  urls: PlayerUrls;
  transport: Transport;
  /** localStorage key for the persisted playback rate. (papyros: 'papyros.player.rate') */
  storageKey: string;
  /** localStorage key for the persisted volume + mute (muted stores under
   *  `<key>.muted` — see ./volume). OPTIONAL, unlike the rate key: omit it and
   *  volume/mute are session-only (tracked + applied, never written to storage).
   *  (papyros: 'papyros.player.volume') */
  volumeStorageKey?: string;
  /** Compat-recovery policy. Omit for apps without a server-side compat pipeline. */
  compat?: CompatPolicy<TItem>;
  /** Copy overrides; unset keys fall back to DEFAULT_MESSAGES. */
  messages?: Partial<PlayerMessages>;
}

// ── The returned surface ────────────────────────────────────────────────────────────
// Field-for-field what PapyrOS's PlayerApi exposed, generalized: `item` (was `book`),
// `segmentLabel` (was `chapterLabel`), `prevSegment`/`nextSegment` (were prev/next
// Chapter), and `sleepMode` speaks 'segment'. A PapyrOS wrapper re-maps these names so
// PlayerBar.tsx renders unchanged.

export interface PlayerApi<TItem, TBookmark> {
  visible: boolean;
  item: TItem | null;
  playing: boolean;
  buffering: boolean;
  /** Human-readable playback failure, null when fine. Cleared on the next successful
   *  play or load. Without it a MediaError / rejected play() is invisible. */
  error: string | null;
  globalPos: number;
  total: number;
  rate: number;
  /** 0..1, HTMLMediaElement.volume's axis. Persisted iff volumeStorageKey is set. */
  volume: number;
  muted: boolean;
  points: NavPoint[];
  currentIndex: number;
  segmentLabel: string | null;
  bookmarks: TBookmark[];
  sleepMode: SleepMode;
  sleepRemainingMs: number | null;
  toggle(): void;
  seekTo(globalSec: number): void;
  skip(deltaSec: number): void;
  prevSegment(): void;
  nextSegment(): void;
  cycleRate(): void;
  /** Set the volume (clamped to 0..1). Wave 16.2 — genuinely new surface: no preset
   *  cycle like rate; a music bar renders a slider, an audiobook bar may omit it. */
  setVolume(level: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  setSleep(mode: SleepMode): void;
  addBookmarkHere(): void;
  jumpBookmark(pos: number): void;
  removeBookmark(id: Id): void;
}

export type { MediaBackend, BackendError, BackendErrorKind } from '../backend/types';
export type { MediaSource, Segment, NavPoint } from '../core/timeline';

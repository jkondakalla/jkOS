// packages/player/src/services/index.ts — Layer 2 services barrel (ToDo.md §3 Wave 16;
// Documentation/PLAYER_PARITY.md §3 "Layer 2 — services"). Built once, all three player
// modes inherit. Each service is its own module; this barrel is the package's
// `@jkos/player/services` surface.

/* ── Offline write queue (item 16.5 / PapyrOS §2 7.2) ──────────────────────────
   Queue progress/bookmark writes while offline, replay on reconnect, reconcile
   via the collections' ?since= delta cursor, last-write-wins on updated_at.
     Pure policies (unit-tested, no DOM):    ./writeQueue.ts
     Durable persistence (IndexedDB/memory): ./queueStorage.ts
     Runtime (listeners + serialized flush): ./createWriteQueue.ts
   Apps consume createWriteQueue(config) with their own WriteQueueAdapter — see
   apps/papyros/src/offline/writes.ts (consumer #1). */

export {
  type WriteOp, type WriteIntent, type QueuedWrite, type ReplayDecision,
  type CoalesceResult,
  coalesceWrite, clearKey, removeIfUnchanged, planReplay,
  oldestQueuedAt, resolveWrite, nextSeq,
  parseServerTimestamp, toSqliteUtc,
} from './writeQueue';

export {
  type QueueStorage,
  queuePersistenceSupported, memoryQueueStorage, idbQueueStorage,
} from './queueStorage';

export {
  type WriteQueueAdapter, type WriteQueueConfig, type WriteQueue,
  createWriteQueue, permanentWriteError, isOfflineFetchError,
} from './createWriteQueue';

/* ── MediaSession (item 16.3) ──────────────────────────────────────────────────
   The engine's old inline setMediaSession/setMediaPlayback block, lifted into a
   composable hook + the previously missing setPositionState (lock-screen scrubber).
     Pure mapping/validation (unit-tested, no DOM): ./mediaSessionState.ts
     The hook (guarded navigator wiring):           ./useMediaSession.ts
   Apps compose useMediaSession(...) next to the engine — see
   apps/papyros/src/player/usePlayerEngine.ts (consumer #1). */

export {
  type MediaSessionArtwork, type MediaSessionMetadata, type MediaSessionPosition,
  type MediaSessionAction, type MediaMetadataInit, type PositionStateInit,
  MEDIA_SESSION_ACTIONS, toMetadataInit, toPositionState,
} from './mediaSessionState';

export {
  type MediaSessionHandlers, type UseMediaSessionConfig,
  useMediaSession,
} from './useMediaSession';

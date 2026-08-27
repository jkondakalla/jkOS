// @jkos/player/engine — Layer 1: the headless player engine (a React hook) + its seam
// contracts. Drives a MediaBackend (../backend) over the timeline math (../core) via
// per-app injected seams. See git history: PLAYER_PARITY.md, retired — "Layer 1 — engine".
export { usePlayerEngine, DEFAULT_MESSAGES, RATE_PRESETS } from './usePlayerEngine';
export {
  readPersistedRate, persistRate, nextRate, type StorageLike,
} from './rate';
export {
  DEFAULT_VOLUME, DEFAULT_MUTED, clampVolume,
  readPersistedVolume, persistVolume, readPersistedMuted, persistMuted,
  readInitialVolume, readInitialMuted, applyVolume, applyMuted,
} from './volume';
export {
  DEFAULT_RECOVERABLE_KINDS, compatKey, isRecoverableKind, canEscalate,
  nextCompatLevel, effectiveStartLevel,
} from './recovery';
export type {
  Id, SleepMode,
  EngineRequest, PositionBroadcast, Transport,
  ItemLoader,
  ProgressRowLike, ProgressWrite, ProgressStore,
  BookmarkRowLike, BookmarkWrite, BookmarkStore,
  PlayerUrls,
  CompatPrepareOutcome, CompatPrepareRequest, CompatPolicy,
  PlayerMessages,
  PlayerEngineConfig, PlayerApi,
  MediaBackend, BackendError, BackendErrorKind,
  MediaSource, Segment, NavPoint,
} from './types';

// @jkos/player/backend — the MediaBackend seam (git history: Wave 15 item 15.2) and
// the one HTMLMediaElement implementation that serves both <audio> and <video>.
//
// Published as its own subpath (rather than folded into ./engine) because the two are
// independently useful: an app picks a backend, the engine consumes whatever it gets.
// See git history: PLAYER_PARITY.md, retired — "Layer 0/Layer 1 boundary".
export { createHtmlMediaBackend, type MediaElementLike } from './htmlMedia';
export {
  createGaplessDualBackend, isGaplessBackend, MAX_CROSSFADE_SEC,
  type GaplessBackend, type GaplessDualOptions, type GaplessDualTimers, type SwapInfo,
} from './gaplessDual';
export type {
  MediaBackend,
  MediaSourceDescriptor,
  BackendError,
  BackendErrorKind,
  BackendEvent,
  BackendEventListener,
} from './types';

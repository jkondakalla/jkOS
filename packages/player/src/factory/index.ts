// @jkos/player/factory — Layer 3's createPlayer(spec) factory + presets (git history
// §3 Wave 16, item 16.7; git history: PLAYER_PARITY.md, retired — "Layer 3 — UI kit").
// Kept as its own export subpath, separate from @jkos/player/ui (that barrel is
// "deliberately factory-free" — see its header comment): this module has zero
// runtime imports (no React, no @jkos/ui, no @jkos/design), so it composes the
// REAL @jkos/player/ui parts only in the sense of naming which ones a spec wants
// (see createPlayer.ts's header) — an app wires the actual components.
export {
  type PlayerKind, type NavCapability, type ScrubberMode, type MobileTransportMode,
  type PlayerCapabilities, type DerivedAccent, type DeriveAccent,
  type PlayerSpecInput, type PlayerSpec, type ControlId, type PlayerComposition,
  resolveSpec, createPlayer,
  audiobookPlayer, musicPlayer, videoPlayer,
} from './createPlayer';

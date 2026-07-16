// services/mediaSessionState.ts — the PURE half of the MediaSession service (ToDo.md
// §3 Wave 16, item 16.3; PLAYER_PARITY.md §3 "Layer 2 — services"). Mirrors the
// engine's rate.ts/volume.ts split: everything here is a pure function over plain
// data — no DOM, no React — so the two decisions the hook makes before touching
// navigator.mediaSession (how an app's metadata maps onto a MediaMetadata init, and
// whether/how a position sample is safe to hand to setPositionState) are unit-testable
// in Node (test/mediaSession.test.mjs), the same house pattern as test/engine.test.mjs.
// The impure half — the React hook that owns the navigator/window guards and the
// effect wiring — is ./useMediaSession.ts.

/** One artwork entry, MediaImage-shaped (papyros: the 512x512 JPEG cover). */
export interface MediaSessionArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

/** What an app declares about the loaded item. Replaces the engine's NowPlayingMeta
 *  seam (which resolved artwork through the engine's PlayerUrls.cover): the app now
 *  builds its own artwork URLs, so this shape carries the finished artwork array
 *  instead of a hasArtwork flag. */
export interface MediaSessionMetadata {
  title: string;
  artist?: string;
  album?: string;
  artwork?: MediaSessionArtwork[];
}

/** A live position sample for setPositionState (papyros: globalPos / total / rate —
 *  the whole-timeline axis, NOT the currently loaded file's). */
export interface MediaSessionPosition {
  position: number;
  duration: number;
  playbackRate: number;
}

/** Exactly the action set the engine's old inline block installed — nothing added. */
export const MEDIA_SESSION_ACTIONS = [
  'play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto',
] as const;
export type MediaSessionAction = (typeof MEDIA_SESSION_ACTIONS)[number];

/** The object handed to `new MediaMetadata(...)` — same defaults as the engine's old
 *  inline block (artist/album fall back to '', artwork to []). */
export interface MediaMetadataInit {
  title: string;
  artist: string;
  album: string;
  artwork: MediaSessionArtwork[];
}

export function toMetadataInit(meta: MediaSessionMetadata): MediaMetadataInit {
  return {
    title: meta.title,
    artist: meta.artist ?? '',
    album: meta.album ?? '',
    artwork: meta.artwork ?? [],
  };
}

/** The object handed to setPositionState, post-validation. */
export interface PositionStateInit {
  duration: number;
  position: number;
  playbackRate: number;
}

/** Validate/clamp a position sample into what setPositionState accepts, or null when
 *  nothing should be pushed. The spec THROWS on a NaN/infinite/negative duration, a
 *  position outside [0, duration], and a playbackRate of exactly 0 — so an unusable
 *  duration rejects the whole sample (there is nothing sane to show), a stray position
 *  (a timeupdate racing a source swap) clamps into [0, duration], and a degenerate
 *  rate (0 / non-finite) falls back to 1, the neutral rate (rate is cosmetic here; a
 *  negative NON-zero rate is spec-legal and passes through). The hook still wraps the
 *  actual call in try/catch — this makes the throw paths unreachable, not merely
 *  handled. */
export function toPositionState(pos: MediaSessionPosition | null | undefined): PositionStateInit | null {
  if (!pos) return null;
  const { duration } = pos;
  if (!Number.isFinite(duration) || duration < 0) return null;
  const raw = Number.isFinite(pos.position) ? pos.position : 0;
  const position = Math.min(duration, Math.max(0, raw));
  const playbackRate = Number.isFinite(pos.playbackRate) && pos.playbackRate !== 0 ? pos.playbackRate : 1;
  return { duration, position, playbackRate };
}

// services/useMediaSession.ts — the MediaSession service (ToDo.md §3 Wave 16, item
// 16.3; PLAYER_PARITY.md §3 "Layer 2 — services"). Lifts the engine's inline
// setMediaSession/setMediaPlayback block out of usePlayerEngine.ts as a standalone
// hook any consumer composes NEXT TO (not inside) the engine, and adds the one
// capability the block never had: navigator.mediaSession.setPositionState — the
// lock-screen scrubber finally tracks the real position (PLAYER_PARITY.md §2 called
// this out as the single missing MediaSession piece).
//
// Semantics preserved from the inline block, byte-for-byte for papyros:
//   - nothing installs until `enabled` (papyros: an item is loaded — the block only
//     ever ran as setMediaSession(loaded) inside handleRequest);
//   - the action set is exactly the seven the block installed (MEDIA_SESSION_ACTIONS),
//     with the block's `details.seekTime` type guard owned here;
//   - metadata feature-detects window.MediaMetadata and re-applies per item — the
//     metadata effect keys on the `metadata` reference, so pass a per-item-stable
//     object (papyros: useMemo'd on the loaded book);
//   - playbackState is pushed only on a `playing` TRANSITION (the block set it inside
//     the play/pause/ended handlers, never at load), so a fresh mount/enable writes
//     nothing until playback actually starts or stops;
//   - every navigator touch is guarded: 'mediaSession' in navigator, try/catch around
//     partial implementations, setPositionState additionally feature-detected (Safari
//     shipped mediaSession without it for years), and everything no-ops server-side.
// The ONE sanctioned hygiene addition beyond setPositionState: handlers are cleared
// (set to null) on disable/unmount — the inline block leaked them.
//
// The pure halves (metadata mapping, position-state validation/clamping) live in
// ./mediaSessionState.ts so they're unit-testable without a DOM.
import { useEffect, useRef } from 'react';
import {
  toMetadataInit, toPositionState,
  type MediaSessionAction, type MediaSessionMetadata, type MediaSessionPosition,
} from './mediaSessionState';

/** The seven supported actions. Omit a key and that action is never installed (so the
 *  browser hides/disables its control); the key SET is read when `enabled` turns on —
 *  keep it stable while enabled. Handler IDENTITIES are free to change per render:
 *  the installed wrappers read the live handlers through a ref (the engine's
 *  refs-in-listeners invariant, applied here). `seekto` receives the already-unwrapped
 *  seekTime. */
export interface MediaSessionHandlers {
  play?: () => void;
  pause?: () => void;
  seekbackward?: () => void;
  seekforward?: () => void;
  previoustrack?: () => void;
  nexttrack?: () => void;
  seekto?: (seekTime: number) => void;
}

export interface UseMediaSessionConfig {
  /** Gate: nothing installs until true (papyros: an item is loaded). */
  enabled: boolean;
  /** Now-playing metadata, or null to leave ms.metadata untouched (the engine's old
   *  nowPlaying-omitted path: action handlers still wire, metadata is skipped). */
  metadata: MediaSessionMetadata | null;
  handlers: MediaSessionHandlers;
  /** Drives ms.playbackState ('playing'/'paused') on transitions. */
  playing: boolean;
  /** Live position sample for setPositionState; omit/null to never push one. */
  position?: MediaSessionPosition | null;
}

/** The guarded navigator.mediaSession, or null (feature missing / server-side). Typed
 *  `any` deliberately — same defensive stance as the engine's old inline block (the
 *  runtime object on older browsers doesn't match lib.dom's full MediaSession). */
function sessionOf(): any {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  return (navigator as any).mediaSession;
}

export function useMediaSession(config: UseMediaSessionConfig): void {
  const { enabled, metadata, playing, position } = config;

  // Wrappers installed once per enable read the LIVE handlers through this ref, so an
  // inline `handlers: {...}` object never causes reinstall churn.
  const handlersRef = useRef(config.handlers);
  handlersRef.current = config.handlers;
  const prevPlayingRef = useRef<boolean | null>(null);

  // ── Action handlers: install on enable, clear (null) on disable/unmount ──────────
  useEffect(() => {
    if (!enabled) return;
    const ms = sessionOf();
    if (!ms) return;
    const installed: MediaSessionAction[] = [];
    // ONE try/catch around the whole sequence, exactly like the inline block: a
    // partial implementation that throws mid-way leaves the rest uninstalled.
    try {
      const has = handlersRef.current;
      const install = (action: MediaSessionAction, wrapper: (details?: unknown) => void): void => {
        ms.setActionHandler(action, wrapper);
        installed.push(action);
      };
      if (has.play) install('play', () => handlersRef.current.play?.());
      if (has.pause) install('pause', () => handlersRef.current.pause?.());
      if (has.seekbackward) install('seekbackward', () => handlersRef.current.seekbackward?.());
      if (has.seekforward) install('seekforward', () => handlersRef.current.seekforward?.());
      if (has.previoustrack) install('previoustrack', () => handlersRef.current.previoustrack?.());
      if (has.nexttrack) install('nexttrack', () => handlersRef.current.nexttrack?.());
      if (has.seekto) install('seekto', (d: any) => {
        const h = handlersRef.current.seekto;
        if (h && d && typeof d.seekTime === 'number') h(d.seekTime);
      });
    } catch { /* older/partial implementations */ }
    return () => {
      const live = sessionOf();
      if (!live) return;
      for (const action of installed) {
        try { live.setActionHandler(action, null); } catch { /* ignore */ }
      }
    };
  }, [enabled]);

  // ── Metadata: re-applied per item (the block ran once per handleRequest load) ────
  useEffect(() => {
    if (!enabled || !metadata) return;
    const ms = sessionOf();
    if (!ms) return;
    try {
      const MM = (window as any).MediaMetadata;
      if (MM) ms.metadata = new MM(toMetadataInit(metadata));
    } catch { /* older/partial implementations */ }
  }, [enabled, metadata]);

  // ── playbackState: transitions only — a mount/enable with playing=false writes
  // nothing, exactly like the block (which only wrote inside play/pause/ended) ──────
  useEffect(() => {
    const prev = prevPlayingRef.current;
    prevPlayingRef.current = playing;
    if (!enabled || prev === null || prev === playing) return;
    const ms = sessionOf();
    if (!ms) return;
    try { ms.playbackState = playing ? 'playing' : 'paused'; } catch { /* ignore */ }
  }, [enabled, playing]);

  // ── Position state: the NEW capability (the lock-screen scrubber's data). Pushed
  // whenever the sample changes; toPositionState makes the spec's throw paths
  // unreachable (finite ≥0 duration, position clamped into [0, duration], nonzero
  // finite rate), and the method itself is feature-detected on top of the session ───
  useEffect(() => {
    if (!enabled) return;
    const ms = sessionOf();
    if (!ms || typeof ms.setPositionState !== 'function') return;
    const state = toPositionState(position);
    if (!state) return;
    try { ms.setPositionState(state); } catch { /* partial implementations */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, position?.position, position?.duration, position?.playbackRate]);
}

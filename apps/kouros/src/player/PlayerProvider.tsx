import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { PlayerApi } from './usePlayerEngine';
import { onEnqueueRequest, publishNowPlaying } from './controller';
import { deriveAccentFromArt } from './accent';
import { useSessionPlayer, type PlayerSessionInfo } from '../session/usePlayerSession';

/**
 * The ONE player instance, lifted to context.
 *
 * Before this, PlayerBar called usePlayerEngine() and was therefore the only
 * component that could see playback state. That was fine when the player was a
 * single bar. It stops being fine the moment Now Playing and the Queue editor are
 * their own full-screen routes: each would have to call usePlayerEngine() itself,
 * and each call mounts its own <audio> element and its own queue reducer. Two
 * engines means two sources of truth that disagree within one track.
 *
 * So the engine is created exactly once, here, and the mini bar / Now Playing /
 * Queue are all consumers. The controller seam (controller.ts) still exists and is
 * still the only way a LIBRARY view talks to the player — context is for the
 * player's own surfaces, the seam is for everything else.
 */
const PlayerContext = createContext<PlayerApi | null>(null);
const SessionContext = createContext<PlayerSessionInfo | null>(null);

export function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext);
  if (!api) throw new Error('usePlayer() outside <PlayerProvider>');
  return api;
}

/** Where the music is: this tab, or another device (the listening session) — for the
 *  device picker and the "Playing on …" strip. Every other surface reads usePlayer(),
 *  which is the same PlayerApi wherever the audio is. */
export function usePlayerSession(): PlayerSessionInfo {
  const info = useContext(SessionContext);
  if (!info) throw new Error('usePlayerSession() outside <PlayerProvider>');
  return info;
}

/** The current item's cover URL, or undefined. Used for the ambient bloom and
 *  the art-derived accent, both of which need it and neither of which should
 *  re-derive the rule.
 *
 *  Reads `item`, not `track`: a book's jacket drives the bloom exactly as a
 *  sleeve does, and the URL it needs is on the peer's origin. sources.ts already
 *  resolved which. */
export function nowPlayingArt(api: PlayerApi): string | undefined {
  return api.item?.coverUrl ?? undefined;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  /* Since the listening session (2026-09-24) the ONE engine lives inside
     useSessionPlayer, which hands back the PlayerApi every surface reads: this
     engine while this tab is the output (or nothing plays anywhere), or the other
     device's session — with every verb a command to it — while it is. */
  const { api, local, info } = useSessionPlayer();

  // ── Queue edits arriving from library views over the controller seam ─────────
  // Subscribed here rather than in a UI component so a queue edit lands whether or
  // not the mini bar happens to be rendered (it renders nothing before the first
  // play request, and "Add to queue" on a silent player must still work). This is
  // the LOCAL channel — the session's router has already sent a remote output's
  // edits to it as commands — so it is always this tab's engine.
  useEffect(() => onEnqueueRequest(({ trackIds, where }) => {
    if (where === 'next') local.playNext(trackIds);
    else local.addToQueue(trackIds);
  }), [local.playNext, local.addToQueue]);

  // ── Broadcast what is playing, for library rows to mark themselves ───────────
  useEffect(() => {
    // Still the numeric KourOS id: the library rows that consume this are music
    // rows keyed on a track id. A book has no row to mark yet.
    publishNowPlaying({ trackId: api.track?.id ?? null, playing: api.playing });
  }, [api.track?.id, api.playing]);

  // ── The art-derived accent ───────────────────────────────────────────────────
  // musicPlayer()'s accentFromArt is a declarative flag; the pixel extraction is
  // this app's job (player/accent.ts).
  //
  // ⚠️ THE SCOPE IS THE WHOLE APP, DELIBERATELY. This wrapper contains the routed
  // content as well as the player, so setting --accent here recolours every
  // surface that reads it — the tab bar's lit dot, an album's Play button, the
  // playing row, the map's pin — not just the transport. That is the intent: the
  // brief asks for the app to take its colour from the record, and a player that
  // recoloured only itself would read as a mismatched widget sitting on a
  // differently-coloured page.
  //
  // It is still NOT set on documentElement. The distinction matters: the settings
  // drawer, the auth veil and anything else the shell renders OUTSIDE this
  // wrapper keep the user's own configured accent, so the app's identity survives
  // whatever a sleeve happens to be. Everything derived from --accent is a
  // mid-tone by construction (accent.ts clamps saturation and lightness), so
  // contrast holds on both faces whatever the art does.
  const scopeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const art = nowPlayingArt(api);
    if (!art) {
      el.style.removeProperty('--accent');
      el.style.removeProperty('--accent-secondary');
      return;
    }
    let cancelled = false;
    deriveAccentFromArt(art).then((accent) => {
      if (cancelled) return;
      if (accent.primary) el.style.setProperty('--accent', accent.primary);
      else el.style.removeProperty('--accent');
      if (accent.secondary) el.style.setProperty('--accent-secondary', accent.secondary);
      else el.style.removeProperty('--accent-secondary');
    });
    return () => { cancelled = true; };
  }, [api.item?.ref, api.item?.coverUrl]);

  return (
    <PlayerContext.Provider value={api}>
      <SessionContext.Provider value={info}>
        {/* `display: contents` — the wrapper carries custom properties only and must
            not introduce a box of its own into the app's layout. */}
        <div ref={scopeRef} className="kr-player-scope">{children}</div>
      </SessionContext.Provider>
    </PlayerContext.Provider>
  );
}

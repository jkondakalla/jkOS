// PlayerBar.tsx — KourOS's persistent playback bar (ToDo.md §3 Wave 18, item 18.4).
// Mounted once (wherever 18.3 wires it in App.tsx — this file doesn't assume where);
// renders NOTHING until the first requestPlay() lands on ./controller's seam (the
// papyros pattern, verbatim). Layout + the shared stock controls (play/pause, the
// popover/scrim framework, <Scrubber>, <NowPlaying>/<CoverArt>, <QueuePanel>) come
// from @jkos/player/ui; the six music-only controls musicPlayer()'s factory
// composition calls for but the kit doesn't stock (shuffle, track prev/next, repeat,
// volume, the queue opener) are ./controls.tsx — see this wave's report for why.
import { useEffect, useRef, useState } from 'react';
import { useBreakpoint } from '@jkos/ui';
import { musicPlayer, createPlayer, type ControlId } from '@jkos/player/factory';
import {
  PlayerBar as PlayerBarShell, Transport, PlayerScrim,
  PlayPauseButton, Scrubber, NowPlaying, CoverArt,
} from '@jkos/player/ui';
import { coverUrl } from './api';
import { usePlayerEngine } from './usePlayerEngine';
import { deriveAccentFromArt } from './accent';
import { QueueMenu, RepeatButton, ShuffleButton, TrackNavButton, VolumeControl } from './controls';
import './player.css';

// The music preset's composition — pure data (ToDo.md §3 16.7): which controls, in
// what order. `unbuilt` never applies to musicPlayer() (only videoPlayer() sets it),
// so createPlayer() never throws here.
const COMPOSITION = createPlayer(musicPlayer());

export default function PlayerBar() {
  const p = usePlayerEngine();
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const [queueOpen, setQueueOpen] = useState(false);

  // Reserve bottom space for the fixed bar. Scoped to <body> (not an app-owned class
  // like papyros's `.app-main` — this app's layout isn't this file's to assume) so
  // adding it can never depend on 18.3's markup landing first or last.
  useEffect(() => {
    document.body.classList.toggle('kouros-player-open', p.visible);
    return () => document.body.classList.remove('kouros-player-open');
  }, [p.visible]);

  // A different track resets which popover makes sense.
  useEffect(() => { setQueueOpen(false); }, [p.track?.id]);

  // ── Art-derived accent (musicPlayer()'s accentFromArt — PLAYER_PARITY.md §3: a
  // declarative flag only, the pixel extraction is THIS app's job). Sets --accent/
  // --accent-secondary on the bar's own wrapping element ONLY — never
  // document.documentElement — so the recolor is scoped to the now-playing surface
  // and every @jkos/player/ui rule already keyed on var(--accent) picks it up for
  // free via CSS custom-property inheritance, with zero kit changes. Degrades
  // silently (accent.ts swallows CORS/canvas failures and returns {}): the scope
  // element's inline overrides are simply cleared, falling back to the app's normal
  // --accent token. ──────────────────────────────────────────────────────────────
  const scopeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    if (!p.track || !p.track.cover_path) {
      el.style.removeProperty('--accent');
      el.style.removeProperty('--accent-secondary');
      return;
    }
    let cancelled = false;
    deriveAccentFromArt(coverUrl(p.track.id)).then((accent) => {
      if (cancelled) return;
      if (accent.primary) el.style.setProperty('--accent', accent.primary);
      else el.style.removeProperty('--accent');
      if (accent.secondary) el.style.setProperty('--accent-secondary', accent.secondary);
      else el.style.removeProperty('--accent-secondary');
    });
    return () => { cancelled = true; };
  }, [p.track?.id, p.track?.cover_path]);

  if (!p.visible || !p.track) return null;
  const track = p.track;
  const total = Math.max(0, p.total);

  const renderControl = (id: ControlId) => {
    switch (id) {
      case 'shuffle':
        return <ShuffleButton key={id} active={p.shuffle} onToggle={p.setShuffle} />;
      case 'trackPrev':
        return <TrackNavButton key={id} dir="prev" onClick={p.trackPrev} />;
      case 'playPause':
        return <PlayPauseButton key={id} api={p} />;
      case 'trackNext':
        return <TrackNavButton key={id} dir="next" onClick={p.trackNext} />;
      case 'repeat':
        return <RepeatButton key={id} mode={p.repeat} onCycle={p.cycleRepeat} />;
      case 'volume':
        return (
          <VolumeControl
            key={id}
            volume={p.volume}
            muted={p.muted}
            onChange={p.setVolume}
            onToggleMute={p.toggleMute}
          />
        );
      case 'queue':
        return (
          <QueueMenu
            key={id}
            queue={p.queue}
            tracksById={p.tracksById}
            open={queueOpen}
            onOpenChange={setQueueOpen}
            onPlayItem={p.playQueueItem}
            onRemove={p.removeQueueItem}
            onReorder={p.reorderQueue}
            mobile={mobile}
            crossfadeSec={p.crossfadeSec}
            onCrossfadeChange={p.setCrossfade}
          />
        );
      default:
        return null;   // segment/rate/sleep/bookmarks — audiobook-only ids, never in musicPlayer()'s composition
    }
  };

  const transport = (
    <Transport>
      {COMPOSITION.transportControls.map(renderControl)}
    </Transport>
  );
  const actions = <>{COMPOSITION.actionControls.map(renderControl)}</>;

  const scrubber = (
    <Scrubber
      position={p.globalPos}
      total={total}
      onSeek={p.seekTo}
      mode="timeline"
      ariaLabel="Seek position in track"
    />
  );

  const subtitle = [track.artist || 'Unknown artist', track.album].filter(Boolean).join(' · ');
  const meta = (
    <NowPlaying
      art={<CoverArt src={track.cover_path ? coverUrl(track.id) : undefined} alt={`Cover of ${track.title}`} />}
      title={track.title}
      subtitle={subtitle}
    />
  );

  return (
    <div ref={scopeRef} className="kouros-player-scope">
      {queueOpen && <PlayerScrim onDismiss={() => setQueueOpen(false)} />}
      <PlayerBarShell
        error={p.error}
        meta={meta}
        transport={transport}
        scrubber={scrubber}
        actions={actions}
      />
    </div>
  );
}

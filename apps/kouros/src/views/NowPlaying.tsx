import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPause, IconPlay, IconSpinner, Scrubber } from '@jkos/player/ui';
import Cover from '../components/Cover';
import { IconChevronDown, IconRadio } from '../components/icons';
import { albumHref, artistHref, closeOverlay, queueHref } from '../hooks/useHashRoute';
import { usePlayer, nowPlayingArt } from '../player/PlayerProvider';
import { IconNext, IconPrev } from '@jkos/player/ui';
import { IconRepeat, IconRepeatOne, IconShuffle } from '../player/icons';
import { radioFrom } from '../api';
import { requestPlay } from '../player/controller';

/**
 * Now Playing — the hero screen.
 *
 * This is where the glass earns its keep. The sleeve is the only opaque thing on
 * the page; everything else is a translucent layer over a blown-up, blurred copy
 * of that same sleeve, so the entire screen takes its colour from the record
 * being played without a single hard-coded palette.
 *
 * The PARALLAX is deliberately tiny (a few pixels, art against backdrop, driven by
 * pointer position on desktop only). Large parallax on a screen the user is
 * looking at rather than scrolling reads as drift, and on a phone it fights the
 * accelerometer. It exists to give the glass somewhere to sit, not to be noticed.
 */
export default function NowPlaying() {
  const p = usePlayer();
  const [radioBusy, setRadioBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Pointer parallax, desktop only and pointer-fine only — `--kr-par` is read by
  // .kr-par in glass.css as a translate, a compositor-only transform.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.setProperty('--kr-par', String(Math.max(-6, Math.min(6, dy * -8))));
    };
    const onLeave = () => el.style.setProperty('--kr-par', '0');
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // The next few tracks, resolved from the queue for the "up next" peek.
  const upNext = useMemo(() => {
    const items = p.queue.items;
    const out: Array<{ id: number; title: string; artist: string | null }> = [];
    for (let i = p.queue.cursor + 1; i < items.length && out.length < 3; i++) {
      const id = Number(items[i]);
      const t = p.tracksById.get(id);
      out.push({ id, title: t?.title ?? '…', artist: t?.artist ?? null });
    }
    return out;
  }, [p.queue, p.tracksById]);

  if (!p.track) {
    return (
      <section className="kr-now kr-now-empty">
        <button type="button" className="kr-ghost kr-now-close" onClick={closeOverlay} aria-label="Close">
          <IconChevronDown />
        </button>
        <p className="kr-mono">Nothing playing</p>
      </section>
    );
  }

  const track = p.track;
  const art = nowPlayingArt(p);
  const artist = track.artist || track.albumartist || 'Unknown artist';

  /** Build a station from what is playing and hand it straight to the player —
   *  the whole point is that it starts, not that it opens a page about starting. */
  async function startRadio() {
    setRadioBusy(true);
    try {
      const r = await radioFrom([track.id], 60);
      const ids = r.results.map((t) => t.id);
      if (ids.length) requestPlay({ trackIds: [track.id, ...ids], startIndex: 0 });
    } catch {
      /* non-fatal: the transport keeps playing whatever it already had */
    } finally {
      setRadioBusy(false);
    }
  }

  return (
    <section className="kr-now" ref={stageRef}>
      {/* The room light — the whole screen's backdrop, not a panel's. */}
      <div
        className="kr-ambient kr-now-ambient"
        style={art ? { ['--kr-art' as string]: `url("${art}")` } : undefined}
      />

      <header className="kr-now-head">
        <button type="button" className="kr-ghost" onClick={closeOverlay} aria-label="Close now playing">
          <IconChevronDown />
        </button>
        <p className="kr-now-eyebrow">
          {p.queue.items.length > 1
            ? `${p.queue.cursor + 1} of ${p.queue.items.length}`
            : 'Now playing'}
        </p>
        <a className="kr-ghost" href={queueHref()} aria-label="Open queue">
          <span className="kr-now-queue-label">Queue</span>
        </a>
      </header>

      <div className="kr-now-stage">
        <div className="kr-now-art kr-par">
          <Cover id={track.id} has={!!track.cover_path} alt={`${track.album ?? track.title} cover`} name={track.album || track.title} eager />
        </div>
      </div>

      <div className="kr-now-meta">
        <h1 className="kr-now-title">{track.title}</h1>
        <p className="kr-now-artist">
          <a href={artistHref(track.albumartist || artist)}>{artist}</a>
          {track.album && (
            <>
              {' · '}
              <a href={albumHref(track.albumartist || artist, track.album)}>{track.album}</a>
            </>
          )}
        </p>
      </div>

      <div className="kr-now-scrub">
        <Scrubber
          position={p.globalPos}
          total={Math.max(0, p.total)}
          onSeek={p.seekTo}
          mode="timeline"
          ariaLabel="Seek position in track"
        />
      </div>

      <div className="kr-now-transport">
        <button
          type="button"
          className={`kr-ghost${p.shuffle ? ' is-on' : ''}`}
          aria-pressed={p.shuffle}
          onClick={() => p.setShuffle(!p.shuffle)}
          aria-label="Shuffle"
        >
          <IconShuffle />
        </button>

        <button type="button" className="kr-ghost kr-now-skip" onClick={p.trackPrev} aria-label="Previous track">
          <IconPrev />
        </button>

        <button
          type="button"
          className="kr-orb kr-orb-lg"
          onClick={p.toggle}
          aria-label={p.playing ? 'Pause' : 'Play'}
        >
          {p.buffering ? <IconSpinner /> : p.playing ? <IconPause /> : <IconPlay />}
        </button>

        <button type="button" className="kr-ghost kr-now-skip" onClick={p.trackNext} aria-label="Next track">
          <IconNext />
        </button>

        <button
          type="button"
          className={`kr-ghost${p.repeat !== 'off' ? ' is-on' : ''}`}
          onClick={p.cycleRepeat}
          aria-label={`Repeat: ${p.repeat}`}
        >
          {p.repeat === 'one' ? <IconRepeatOne /> : <IconRepeat />}
        </button>
      </div>

      <div className="kr-now-extra">
        <button type="button" className="kr-ghost kr-now-radio" onClick={startRadio} disabled={radioBusy}>
          <IconRadio />
          <span>{radioBusy ? 'Building station…' : 'Start a station from this'}</span>
        </button>
      </div>

      {upNext.length > 0 && (
        <a className="kr-now-next kr-glass kr-glass-thin" href={queueHref()}>
          <span className="kr-now-next-label">Up next</span>
          <span className="kr-now-next-list">
            {upNext.map((t) => (
              <span key={t.id} className="kr-now-next-item">
                {t.title}
                {t.artist && <span className="kr-now-next-artist"> — {t.artist}</span>}
              </span>
            ))}
          </span>
        </a>
      )}
    </section>
  );
}

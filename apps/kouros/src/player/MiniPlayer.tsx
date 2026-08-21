import { IconNext, IconPause, IconPlay, IconSpinner } from '@jkos/player/ui';
import Cover from '../components/Cover';
import { IconChevron } from '../components/icons';
import { nowHref } from '../hooks/useHashRoute';
import { usePlayer, nowPlayingArt } from './PlayerProvider';

/**
 * The persistent mini bar: glass, docked above the tab bar, tap to expand.
 *
 * Two details carry the whole interaction:
 *
 *  1. The bar is a LINK to #/now, with the transport buttons as siblings layered
 *     above it — not a click handler on a div with buttons inside. Nesting
 *     interactive elements is invalid, and in practice it means every play tap
 *     also expands the sheet.
 *
 *  2. The progress line is the bar's own bottom edge rather than a separate
 *     element. On a 64px-tall surface a real scrubber is unusable with a thumb —
 *     the full-size one lives in Now Playing, one tap away — but a hairline of
 *     progress along the edge answers "how far in am I" without spending height.
 */
export default function MiniPlayer() {
  const p = usePlayer();
  if (!p.visible || !p.track) return null;

  const track = p.track;
  const art = nowPlayingArt(p);
  const pct = p.total > 0 ? Math.min(100, (p.globalPos / p.total) * 100) : 0;

  return (
    <div className="kr-mini kr-glass kr-gloss">
      {/* The ambient bloom: a blown-up, blurred copy of the sleeve behind the
          glass, so the bar refracts the record it is playing. */}
      <div className="kr-ambient" style={art ? { ['--kr-art' as string]: `url("${art}")` } : undefined} />

      <a className="kr-mini-open" href={nowHref()} aria-label={`Open ${track.title}`}>
        <span className="kr-mini-art">
          <Cover id={track.id} has={!!track.cover_path} alt="" name={track.album || track.title} />
        </span>
        <span className="kr-mini-body">
          <span className="kr-mini-title">{track.title}</span>
          <span className="kr-mini-sub">{track.artist || track.albumartist || 'Unknown artist'}</span>
        </span>
        <span className="kr-mini-chev" aria-hidden="true"><IconChevron dir="up" size={18} /></span>
      </a>

      <div className="kr-mini-controls">
        <button
          type="button"
          className="kr-orb kr-orb-md"
          onClick={p.toggle}
          aria-label={p.playing ? 'Pause' : 'Play'}
        >
          {p.buffering ? <IconSpinner /> : p.playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="kr-ghost kr-mini-next" onClick={p.trackNext} aria-label="Next track">
          <IconNext />
        </button>
      </div>

      <div className="kr-mini-progress" style={{ width: `${pct}%` }} aria-hidden="true" />
      {p.error && <p className="kr-mini-error">{p.error}</p>}
    </div>
  );
}

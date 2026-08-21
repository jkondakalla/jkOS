import Cover from './Cover';
import { IconMore } from './icons';
import { formatDuration } from '../views/library/format';
import type { ActionTarget } from './ActionSheet';

export interface RowTrack {
  id: number;
  title: string;
  artist?: string | null;
  album?: string | null;
  albumartist?: string | null;
  track_no?: number | null;
  duration: number;
  /** Catalog rows carry `cover_path`; discovery rows carry `has_cover`. */
  cover_path?: string | null;
  has_cover?: boolean;
  /** Discovery rows only — how this row was ranked. */
  basis?: 'measured' | 'inferred' | 'metadata';
}

interface TrackRowProps {
  track: RowTrack;
  onPlay(): void;
  onMenu?(target: ActionTarget): void;
  /** Show the track number instead of the sleeve — album pages. */
  numbered?: boolean;
  /** Show the sleeve. Off for album pages, on everywhere else. */
  art?: boolean;
  showAlbum?: boolean;
  playing?: boolean;
  /** Right-hand slot replacing the duration — the queue's drag handle uses it. */
  trailing?: React.ReactNode;
  /** Leading slot replacing the number/art — the queue's grab handle uses it. */
  leading?: React.ReactNode;
}

/** One track, everywhere it appears: albums, search, queue, radio, runs.
 *
 *  The whole row is the play target and the ⋯ button is a sibling, not a nested
 *  button — a button inside a button is invalid HTML and, in practice, a menu tap
 *  that also starts playback. */
export default function TrackRow({
  track, onPlay, onMenu, numbered, art = true, showAlbum, playing, trailing, leading,
}: TrackRowProps) {
  const artist = track.artist || track.albumartist || 'Unknown artist';
  const sub = showAlbum && track.album ? `${artist} · ${track.album}` : artist;
  const hasCover = track.has_cover ?? track.cover_path != null;

  return (
    <li className={`kr-track-host${playing ? ' is-current' : ''}`}>
      <button
        type="button"
        className={`kr-track${playing ? ' is-playing' : ''}`}
        onClick={onPlay}
        aria-current={playing ? 'true' : undefined}
      >
        {leading}
        {!leading && numbered && (
          <span className="kr-track-no">{track.track_no ?? '·'}</span>
        )}
        {!leading && !numbered && art && (
          <span className="kr-track-art">
            <Cover id={track.id} has={hasCover} alt="" name={track.album || track.title} />
          </span>
        )}

        <span className="kr-track-body">
          <span className="kr-track-title">{track.title}</span>
          <span className="kr-track-sub">
            {sub}
            {/* The honesty marker. A row ranked by genre/artist affinity says so,
                so a metadata guess is never mistaken for an acoustic match. */}
            {track.basis === 'metadata' && <span className="kr-basis"> · similar tags</span>}
            {track.basis === 'inferred' && <span className="kr-basis"> · album match</span>}
          </span>
        </span>

        {trailing ?? <span className="kr-track-time">{formatDuration(track.duration)}</span>}
      </button>

      {onMenu && (
        <button
          type="button"
          className="kr-ghost kr-track-menu"
          aria-label={`More actions for ${track.title}`}
          onClick={() => onMenu({
            trackIds: [track.id],
            title: track.title,
            subtitle: artist,
            artist: track.albumartist || track.artist || null,
            album: track.album || null,
          })}
        >
          <IconMore />
        </button>
      )}
    </li>
  );
}

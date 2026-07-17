import type { Track } from '../../api';
import { formatClock, trackArtist, trackAlbum } from './format';
import AddToPlaylistMenu from '../playlists/AddToPlaylistMenu';

interface TrackRowProps {
  track: Track;
  /** Fires this row's play request (the caller resolves list + startIndex —
   *  same division of responsibility as TrackTile). */
  onPlay: () => void;
  /** Album.tsx passes the track's own disc/track position label (e.g. "1.03");
   *  omit (Search.tsx) to show nothing in that column. */
  positionLabel?: string;
  /** Search's results span multiple artists/albums, so it shows both; Album.tsx
   *  (every row already the same artist+album) shows neither. */
  showArtist?: boolean;
  showAlbum?: boolean;
}

/** One track list row — Album.tsx's disc/track listing and Search.tsx's result
 *  rows. A real `<button>` (keyboard-activatable, matches hub.css's tap-floor
 *  selector) — the whole row is the play target, mirroring papyros's
 *  BookDetail chapter-row idiom (no per-track detail page to link to instead).
 *  `AddToPlaylistMenu` (18.6) renders as a SIBLING of that button inside the
 *  same `<li>`, never nested inside it — a `<button>` can't contain another
 *  `<button>`, and the "+" needs its own independent click target anyway. */
export default function TrackRow({ track, onPlay, positionLabel, showArtist, showAlbum }: TrackRowProps) {
  return (
    <li className="kr-track-li">
      <button type="button" className="kr-track-row" onClick={onPlay}>
        <span className="kr-track-pos">{positionLabel ?? ''}</span>
        <span className="kr-track-info">
          <span className="kr-track-title">{track.title}</span>
          {(showArtist || showAlbum) && (
            <span className="kr-track-context">
              {showArtist ? trackArtist(track) : null}
              {showArtist && showAlbum ? ' — ' : null}
              {showAlbum ? trackAlbum(track) : null}
            </span>
          )}
        </span>
        <span className="kr-track-time">{formatClock(track.duration)}</span>
      </button>
      <AddToPlaylistMenu trackId={track.id} />
    </li>
  );
}

import { CoverArt, Sheet } from '@jkos/ui';
import { coverUrl, type Track } from '../../api';
import { formatClock, initials, trackArtist } from './format';

interface TrackTileProps {
  track: Track;
  /** Fires the play request for THIS tile. Computed by the caller (Home.tsx),
   *  which knows the containing section's full track list + this track's index
   *  in it — 18.4's requestPlay wants `{ trackIds, startIndex }`, not a single
   *  id, so the "what list is this from" decision belongs to the section, not
   *  this presentational tile. */
  onPlay: () => void;
}

/** A single-track grid tile — Home's "Recently added"/"Recently played" sections.
 *  Unlike ArtistTile/AlbumTile (which navigate), this tile PLAYS on click — a
 *  `<button>`, not a `Sheet as="a">`, since there is no per-track detail page in
 *  this app (mirrors 18.4's seam note: "a track click plays the containing list
 *  from that track's index"). */
export default function TrackTile({ track, onPlay }: TrackTileProps) {
  return (
    <Sheet as="button" type="button" className="kr-tile kr-tile-play" onClick={onPlay}>
      <CoverArt
        src={track.cover_path ? coverUrl(track.id) : undefined}
        alt=""
        fallback={<span className="jk-press-lg">{initials(track.title)}</span>}
      />
      <div className="kr-tile-body">
        <p className="kr-tile-title">{track.title}</p>
        <p className="kr-tile-sub">{trackArtist(track)}</p>
        <p className="kr-tile-meta">{formatClock(track.duration)}</p>
      </div>
    </Sheet>
  );
}

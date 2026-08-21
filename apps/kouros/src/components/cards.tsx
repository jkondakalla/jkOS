import Cover from './Cover';
import { albumHref, artistHref } from '../hooks/useHashRoute';
import { formatCount, formatSpan } from '../views/library/format';
import type { AlbumSummary, ArtistSummary } from '../api';

/** An album sleeve in a grid or a rail. A link, not a button: an album has a URL,
 *  so it should be openable in a new tab and reachable by the back gesture. */
export function AlbumCard({ album }: { album: AlbumSummary }) {
  return (
    <a className="kr-card" href={albumHref(album.artist, album.album)}>
      <Cover id={album.cover_id} has={album.cover_id != null} alt={`${album.album} by ${album.artist}`} name={album.album} />
      <p className="kr-card-title">{album.album}</p>
      <p className="kr-card-sub">{album.artist}</p>
      <p className="kr-card-meta">
        {album.year ? `${album.year} · ` : ''}{formatCount(album.tracks, 'track')}
      </p>
    </a>
  );
}

/** An artist. Round art, because a circle is how every music app in the world
 *  distinguishes "a person" from "a record" at a glance, and breaking that
 *  convention costs more than the consistency gains. */
export function ArtistCard({ artist }: { artist: ArtistSummary }) {
  return (
    <a className="kr-card kr-card-round" href={artistHref(artist.artist)}>
      <Cover id={artist.cover_id} has={artist.cover_id != null} alt={artist.artist} name={artist.artist} />
      <p className="kr-card-title">{artist.artist}</p>
      <p className="kr-card-meta">
        {formatCount(artist.albums, 'album')} · {formatSpan(artist.duration)}
      </p>
    </a>
  );
}

/** A single track presented as a card — the shape the discovery rails use, where
 *  the unit is a track rather than a record. */
export function TrackCard({
  id, title, artist, album, hasCover, onPlay, playing,
}: {
  id: number;
  title: string;
  artist?: string | null;
  album?: string | null;
  hasCover?: boolean;
  onPlay(): void;
  playing?: boolean;
}) {
  return (
    <button type="button" className={`kr-card kr-card-btn${playing ? ' is-playing' : ''}`} onClick={onPlay}>
      <Cover id={id} has={hasCover ?? true} alt={`${title} cover`} name={album || title} />
      <p className="kr-card-title">{title}</p>
      <p className="kr-card-sub">{artist || 'Unknown artist'}</p>
    </button>
  );
}

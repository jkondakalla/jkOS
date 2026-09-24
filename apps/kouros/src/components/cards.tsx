import Cover from './Cover';
import { albumHref, artistHref } from '../hooks/useHashRoute';
import { formatCount, formatSpan } from '../views/library/format';
import type { AlbumSummary, ArtistSummary, ContinueBook, RecentContext } from '../api';
import { coverUrl as bookCoverUrl } from '../books/api';
import { encodeRef } from '../player/sources';
import { bookContext } from '../player/context';
import { requestPlay } from '../player/controller';
import { startStation } from '../player/station';

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

/** One "Recently played" tile — a PLACE you played from (backend/src/discover/recent.js).
 *  A link to that place, because every context but a station has a page: `route` is
 *  the context AND the hash path. A station has no page, so its tile replays it. An
 *  artist is round, like every artist card; a book shows its jacket. */
export function RecentCard({ item }: { item: RecentContext }) {
  const art = item.cover == null
    ? <Cover src={null} alt="" name={item.title} />
    : item.cover.kind === 'book'
      ? <Cover src={bookCoverUrl(item.cover.id)} alt="" name={item.title} />
      : <Cover id={item.cover.id} alt="" name={item.title} />;
  const body = (
    <>
      {art}
      <p className="kr-card-title">{item.title}</p>
      <p className="kr-card-sub">{item.subtitle}</p>
    </>
  );
  if (item.kind === 'station' && item.seed != null) {
    const seed = item.seed;
    return (
      <button type="button" className="kr-card kr-card-btn" onClick={() => { void startStation(seed); }}>
        {body}
      </button>
    );
  }
  return (
    <a className={`kr-card${item.kind === 'artist' ? ' kr-card-round' : ''}`} href={`#/${item.route}`}>
      {body}
    </a>
  );
}

/** An unfinished audiobook — "Continue listening". Tapping resumes at the saved
 *  position (the same row every device reads), so the book picks up where it was
 *  left on whichever device left it. */
export function ContinueBookCard({ book }: { book: ContinueBook }) {
  const pct = book.duration > 0 ? Math.min(100, (book.position / book.duration) * 100) : 0;
  const left = Math.max(0, book.duration - book.position);
  return (
    <button
      type="button"
      className="kr-card kr-card-btn kr-card-book"
      onClick={() => requestPlay({
        trackIds: [encodeRef('book', book.id)], startIndex: 0, position: book.position, context: bookContext(book.id),
      })}
    >
      <Cover src={book.has_cover ? bookCoverUrl(book.id) : null} alt={`${book.title} cover`} name={book.title} />
      <span className="kr-card-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <p className="kr-card-title">{book.title}</p>
      <p className="kr-card-sub">{book.author || 'Unknown author'}</p>
      <p className="kr-card-meta">{formatSpan(left)} left</p>
    </button>
  );
}

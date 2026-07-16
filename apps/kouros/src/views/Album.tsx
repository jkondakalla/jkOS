import { useMemo } from 'react';
import { AsyncView, CoverArt, Lab, TButton } from '@jkos/ui';
import { coverUrl } from '../api';
import { artistHref } from '../hooks/useHashRoute';
import { useTracks } from '../hooks/useTracks';
import { requestPlay } from '../player/controller';
import TrackRow from './library/TrackRow';
import { formatTotalDuration, initials, sortAlbumTracks, trackAlbum, trackArtist } from './library/format';
import './detail.css';

interface AlbumProps {
  artist: string;
  album: string;
}

/** Position label for a track row — "disc.track" once the album has more than
 *  one disc, else the bare track number; "—" when the tag is missing entirely
 *  (never invents a number the file didn't carry). */
function positionLabel(discNo: number | null, trackNo: number | null, multiDisc: boolean): string {
  const t = trackNo != null ? String(trackNo) : '—';
  if (!multiDisc) return t;
  return `${discNo ?? 1}.${t.padStart(2, '0')}`;
}

/** Album page (task 18.3): "track list — disc/track order, durations, per-track
 *  play". Filters the whole `tracks` catalog to this exact (artist, album) pair
 *  client-side, same reasoning as Artist.tsx (no exact-match filter server-side). */
export default function Album({ artist, album }: AlbumProps) {
  const { tracks: allTracks, loading, error } = useTracks();

  const tracks = useMemo(
    () => sortAlbumTracks(allTracks.filter((t) => trackArtist(t) === artist && trackAlbum(t) === album)),
    [allTracks, artist, album],
  );
  const multiDisc = useMemo(() => tracks.some((t) => (t.disc_no ?? 1) > 1), [tracks]);
  const cover = tracks.find((t) => t.cover_path) ?? null;
  const year = tracks.find((t) => t.year != null)?.year ?? null;

  function playAll() {
    requestPlay({ trackIds: tracks.map((t) => t.id), startIndex: 0 });
  }

  function playFrom(index: number) {
    requestPlay({ trackIds: tracks.map((t) => t.id), startIndex: index });
  }

  return (
    <section className="view-detail">
      <TButton as="a" href={artistHref(artist)} quiet className="back-link">&larr; {artist}</TButton>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load this album. Try again shortly."
        empty={!loading && !error && tracks.length === 0}
        emptyText="No tracks found for this album."
      >
        <div className="detail-hero">
          <CoverArt
            src={cover?.cover_path ? coverUrl(cover.id) : undefined}
            alt=""
            fallback={<span className="jk-press-lg">{initials(album)}</span>}
            className="detail-cover"
          />
          <div className="detail-hero-info">
            <Lab size="sm">Album</Lab>
            <h2 className="detail-title">{album}</h2>
            <p className="detail-byline">
              <a href={artistHref(artist)} className="detail-artist-link">{artist}</a>
            </p>
            <p className="muted detail-meta-row">
              {year != null ? <span>{year}</span> : null}
              <span>{tracks.length} track{tracks.length === 1 ? '' : 's'}</span>
              <span>{formatTotalDuration(tracks)}</span>
            </p>
            <TButton className="play-button" onClick={playAll} disabled={tracks.length === 0}>
              ▶ Play
            </TButton>
          </div>
        </div>

        <ol className="detail-track-list">
          {tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              onPlay={() => playFrom(i)}
              positionLabel={positionLabel(t.disc_no, t.track_no, multiDisc)}
            />
          ))}
        </ol>
      </AsyncView>
    </section>
  );
}

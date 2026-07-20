import { useMemo } from 'react';
import { AsyncView, Lab, MediaGrid, TButton, useBreakpoint } from '@jkos/ui';
import { useTracks } from '../hooks/useTracks';
import { requestPlay } from '../player/controller';
import AlbumTile from './library/AlbumTile';
import { formatTotalDuration, groupTracksByAlbum, sortAlbumTracks, trackArtist } from './library/format';
import './detail.css';

interface ArtistProps {
  artist: string;
}

/** Artist page (task 18.3): "albums as MediaGrid with CoverArt". Filters the
 *  whole `tracks` catalog down to this artist client-side (see format.ts's
 *  trackArtist() header — the server's `artist` filter is a PREFIX match, the
 *  wrong tool for an exact page like this one), then groups by album. */
export default function Artist({ artist }: ArtistProps) {
  const bp = useBreakpoint();
  const { tracks: allTracks, loading, error } = useTracks();

  const tracks = useMemo(
    () => allTracks.filter((t) => trackArtist(t) === artist),
    [allTracks, artist],
  );
  const albums = useMemo(() => groupTracksByAlbum(tracks), [tracks]);
  const density = bp === 'mobile' ? 'compact' : bp === 'tablet' ? 'cozy' : 'comfortable';

  function playAll() {
    // Flatten every album (already tile-sorted newest-year-first) in its own
    // disc/track order, so "Play all" is a stable, sensible listening order —
    // not the raw catalog fetch order.
    const ordered = sortAlbumTracks(albums.flatMap((a) => a.tracks));
    requestPlay({ trackIds: ordered.map((t) => t.id), startIndex: 0 });
  }

  return (
    <section className="view-detail">
      <TButton as="a" href="#/artists" quiet className="back-link">&larr; Artists</TButton>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load this artist. Try again shortly."
        empty={!loading && !error && tracks.length === 0}
        emptyText="No tracks found for this artist."
      >
        <div className="detail-hero detail-hero-simple">
          <h2 className="detail-title">{artist}</h2>
          <p className="detail-meta-row">
            {albums.length} album{albums.length === 1 ? '' : 's'} &middot; {tracks.length} track{tracks.length === 1 ? '' : 's'} &middot; {formatTotalDuration(tracks)}
          </p>
          <TButton className="play-button" onClick={playAll} disabled={tracks.length === 0}>
            ▶ Play all
          </TButton>
        </div>

        <div className="detail-albums">
          <Lab size="sm">Albums</Lab>
          <MediaGrid density={density} className="kr-grid">
            {albums.map((a) => <AlbumTile key={a.album} artist={artist} data={a} />)}
          </MediaGrid>
        </div>
      </AsyncView>
    </section>
  );
}

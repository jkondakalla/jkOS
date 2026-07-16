import { useMemo } from 'react';
import { AsyncView, Lab, MediaGrid, useBreakpoint } from '@jkos/ui';
import { useTracks } from '../hooks/useTracks';
import ArtistTile from './library/ArtistTile';
import { groupTracksByArtist } from './library/format';
import './library.css';

/** Artists (task 18.3): a MediaGrid of artist tiles, derived client-side from
 *  the whole `tracks` catalog — there is no `artists` table server-side. */
export default function Artists() {
  const bp = useBreakpoint();
  const { tracks, loading, error } = useTracks();

  const artists = useMemo(() => groupTracksByArtist(tracks), [tracks]);
  const density = bp === 'mobile' ? 'compact' : bp === 'tablet' ? 'cozy' : 'comfortable';

  return (
    <section className="view-artists">
      <div className="kr-heading">
        <Lab size="sm">Artists</Lab>
        {!loading && !error && (
          <span className="kr-count">{artists.length} artist{artists.length === 1 ? '' : 's'}</span>
        )}
      </div>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load artists. Try again shortly."
        empty={artists.length === 0}
        emptyText="No artists yet — the library is empty."
      >
        <MediaGrid density={density} className="kr-grid">
          {artists.map((a) => <ArtistTile key={a.artist} data={a} />)}
        </MediaGrid>
      </AsyncView>
    </section>
  );
}

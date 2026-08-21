import { useEffect, useState } from 'react';
import { AsyncView } from '@jkos/ui';
import { AlbumCard, ArtistCard } from '../components/cards';
import TrackRow from '../components/TrackRow';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { requestPlay } from '../player/controller';
import {
  listAlbums, listArtists, listTracks, radioFrom,
  type AlbumSummary, type ArtistSummary, type Track,
} from '../api';

const DEBOUNCE_MS = 220;

interface SearchProps {
  initialQuery: string;
}

/**
 * Search across all three shapes at once — artists, albums, tracks.
 *
 * The previous version searched tracks only, in two passes (title prefix, artist
 * prefix), which meant typing an artist's name returned a wall of their
 * individual songs and no way to reach the artist or a record. Someone searching
 * "Deftones" almost always wants the artist page or an album, not track 7.
 *
 * All three requests go out together and each section renders as it can. Track
 * search stays a server-side PREFIX filter on the `tracks` dataset; albums and
 * artists use the browse endpoint's substring match, which is what people expect
 * of a search box and is one grouped scan server-side.
 */
export default function Search({ initialQuery }: SearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [term, setTerm] = useState(initialQuery.trim());
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  const now = useNowPlaying();

  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    if (!term) {
      setTracks([]); setAlbums([]); setArtists([]);
      setLoading(false); setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    Promise.all([
      listTracks({ title: term }).catch(() => [] as Track[]),
      listAlbums({ q: term, limit: 12 }).catch(() => [] as AlbumSummary[]),
      listArtists({ q: term, limit: 12 }).catch(() => [] as ArtistSummary[]),
    ]).then(
      ([t, al, ar]) => {
        if (!alive) return;
        setTracks(t.slice(0, 30));
        setAlbums(al);
        setArtists(ar);
        setLoading(false);
      },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [term]);

  async function startRadio(seedId: number) {
    try {
      const r = await radioFrom([seedId], 60);
      const ids = r.results.map((x) => x.id);
      if (ids.length) requestPlay({ trackIds: [seedId, ...ids], startIndex: 0 });
    } catch { /* non-fatal */ }
  }

  const total = tracks.length + albums.length + artists.length;

  return (
    <section className="view-search">
      <div className="kr-searchbox kr-glass kr-glass-thin">
        <input
          type="search"
          className="kr-searchinput"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artists, albums, tracks…"
          aria-label="Search the library"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="kr-ghost" onClick={() => setQuery('')} aria-label="Clear search">
            &times;
          </button>
        )}
      </div>

      {!term ? (
        <p className="kr-mono kr-hint">Search your library by artist, album or track.</p>
      ) : (
        <AsyncView
          loading={loading}
          error={error}
          errorText="Search failed. Try again shortly."
          empty={!loading && !error && total === 0}
          emptyText={`Nothing matches “${term}”.`}
        >
          {artists.length > 0 && (
            <section className="kr-section">
              <div className="kr-section-head"><h2 className="kr-section-title">Artists</h2></div>
              <div className="kr-rail jk-scroll-none">
                {artists.map((a) => <ArtistCard key={a.artist} artist={a} />)}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section className="kr-section">
              <div className="kr-section-head"><h2 className="kr-section-title">Albums</h2></div>
              <div className="kr-rail jk-scroll-none">
                {albums.map((a) => <AlbumCard key={`${a.artist}-${a.album}`} album={a} />)}
              </div>
            </section>
          )}

          {tracks.length > 0 && (
            <section className="kr-section">
              <div className="kr-section-head"><h2 className="kr-section-title">Tracks</h2></div>
              <ol className="kr-tracks">
                {tracks.map((t, i) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    showAlbum
                    playing={now.trackId === t.id}
                    onPlay={() => requestPlay({ trackIds: tracks.map((x) => x.id), startIndex: i })}
                    onMenu={setMenu}
                  />
                ))}
              </ol>
            </section>
          )}
        </AsyncView>
      )}

      <ActionSheet target={menu} onClose={() => setMenu(null)} onRadio={startRadio} />
    </section>
  );
}

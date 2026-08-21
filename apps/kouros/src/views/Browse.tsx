import { useEffect, useState } from 'react';
import { AsyncView, Chip } from '@jkos/ui';
import { AlbumCard, ArtistCard } from '../components/cards';
import { playlistsHref } from '../hooks/useHashRoute';
import {
  listAlbums, listArtists, libraryStats,
  type AlbumSort, type AlbumSummary, type ArtistSummary, type LibraryStats,
} from '../api';
import { formatCount } from './library/format';

type Tab = 'albums' | 'artists';

const SORTS: Array<{ id: AlbumSort; label: string }> = [
  { id: 'added', label: 'Recent' },
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'year', label: 'Year' },
];

/** One page of albums. The catalog is several thousand records; fetching them all
 *  to scroll them is the thing this view exists to avoid. */
const PAGE = 120;

/**
 * Browse — the library itself.
 *
 * Everything here is paged and grouped SERVER-side (backend/src/routes/browse.js).
 * The previous implementation pulled the whole `tracks` catalog and grouped it in
 * the browser, which is a multi-megabyte payload and a full re-group on every
 * mount once the library is at the scale this app targets.
 */
export default function Browse() {
  const [tab, setTab] = useState<Tab>('albums');
  const [sort, setSort] = useState<AlbumSort>('added');
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => { libraryStats().then(setStats, () => {}); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setExhausted(false);
    const req = tab === 'albums'
      ? listAlbums({ sort, limit: PAGE }).then((rows) => { if (alive) { setAlbums(rows); setExhausted(rows.length < PAGE); } })
      : listArtists({ sort: 'name', limit: 400 }).then((rows) => { if (alive) { setArtists(rows); setExhausted(true); } });
    req.then(
      () => { if (alive) setLoading(false); },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [tab, sort]);

  async function loadMore() {
    if (loadingMore || exhausted || tab !== 'albums') return;
    setLoadingMore(true);
    try {
      const rows = await listAlbums({ sort, limit: PAGE, offset: albums.length });
      setAlbums((cur) => [...cur, ...rows]);
      if (rows.length < PAGE) setExhausted(true);
    } catch {
      setExhausted(true);   // stop retrying a failing page on every scroll
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="view-browse">
      <header className="kr-pagehead">
        <div>
          <h1 className="kr-pagehead-title">Library</h1>
          <p className="kr-pagehead-sub kr-mono">
            {stats
              ? `${formatCount(stats.albums, 'album')} · ${formatCount(stats.artists, 'artist')}`
              : ' '}
          </p>
        </div>
        <a className="kr-text-link" href={playlistsHref()}>Playlists</a>
      </header>

      <div className="kr-browse-controls">
        <div className="kr-segment" role="tablist" aria-label="Browse by">
          {(['albums', 'artists'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`kr-segment-btn${tab === t ? ' is-on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'albums' ? 'Albums' : 'Artists'}
            </button>
          ))}
        </div>

        {tab === 'albums' && (
          <div className="kr-wrap kr-scroll-x jk-scroll-none kr-browse-sorts">
            {SORTS.map((s) => (
              <Chip
                key={s.id}
                as="button"
                type="button"
                className={sort === s.id ? undefined : 'jk-chip-off'}
                onClick={() => setSort(s.id)}
                aria-pressed={sort === s.id}
              >
                {s.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load the library. Try again shortly."
        empty={!loading && !error && (tab === 'albums' ? albums.length === 0 : artists.length === 0)}
        emptyText="Nothing here yet — the library is still being scanned."
      >
        {tab === 'albums' ? (
          <>
            <div className="kr-grid">
              {albums.map((a) => <AlbumCard key={`${a.artist}-${a.album}`} album={a} />)}
            </div>
            {!exhausted && (
              <button type="button" className="kr-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        ) : (
          <div className="kr-grid">
            {artists.map((a) => <ArtistCard key={a.artist} artist={a} />)}
          </div>
        )}
      </AsyncView>
    </section>
  );
}

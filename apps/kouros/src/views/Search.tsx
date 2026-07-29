import { useEffect, useState } from 'react';
import { AsyncView, Lab } from '@jkos/ui';
import { listTracks, type Track } from '../api';
import { requestPlay } from '../player/controller';
import TrackRow from './library/TrackRow';
import './detail.css';

const SEARCH_DEBOUNCE_MS = 300;

interface SearchProps {
  /** The `?q=` param off the hash route, if the link arrived pre-filled
   *  (a shared/bookmarked search URL). */
  initialQuery: string;
}

/** Search (task 18.3): "one box querying title-prefix + artist-prefix filters,
 *  merged sections". Both are real server-side filters on the `tracks` dataset
 *  (discovery.js TRACKS_DATASET — `title`/`artist` are both PREFIX matches),
 *  run in parallel per keystroke (debounced). "Merged" here means one page, two
 *  labeled sections, no duplicate row: a track that matches BOTH prefixes is
 *  shown once, under "Titles matching" only. */
export default function Search({ initialQuery }: SearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [titleMatches, setTitleMatches] = useState<Track[]>([]);
  const [artistMatches, setArtistMatches] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    const term = debounced.trim();
    if (!term) {
      setTitleMatches([]);
      setArtistMatches([]);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    Promise.all([
      listTracks({ title: term }),
      listTracks({ artist: term }),
    ]).then(
      ([byTitle, byArtist]) => {
        if (!alive) return;
        const titleIds = new Set(byTitle.map((t) => t.id));
        setTitleMatches(byTitle);
        setArtistMatches(byArtist.filter((t) => !titleIds.has(t.id)));
        setLoading(false);
      },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [debounced]);

  function playFrom(list: Track[], index: number) {
    requestPlay({ trackIds: list.map((t) => t.id), startIndex: index });
  }

  const term = debounced.trim();
  const hasQuery = term.length > 0;
  const totalResults = titleMatches.length + artistMatches.length;

  return (
    <section className="view-detail view-search">
      <div className="kr-heading">
        <Lab size="sm">Search</Lab>
      </div>

      <div className="kr-search">
        <input
          type="search"
          className="kr-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tracks or artists…"
          aria-label="Search tracks or artists"
          autoFocus
        />
        {query.length > 0 && (
          <button type="button" className="kr-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            &times;
          </button>
        )}
      </div>

      {!hasQuery ? (
        <p className="kr-note">Start typing to search titles and artists.</p>
      ) : (
        <AsyncView
          loading={loading}
          error={error}
          errorText="Search failed. Try again shortly."
          empty={!loading && !error && totalResults === 0}
          emptyText={`No tracks match "${term}".`}
        >
          {titleMatches.length > 0 && (
            <div className="detail-albums">
              <Lab size="sm">Titles matching &ldquo;{term}&rdquo;</Lab>
              <ol className="detail-track-list">
                {titleMatches.map((t, i) => (
                  <TrackRow key={t.id} track={t} onPlay={() => playFrom(titleMatches, i)} showArtist showAlbum />
                ))}
              </ol>
            </div>
          )}
          {artistMatches.length > 0 && (
            <div className="detail-albums">
              <Lab size="sm">By artist</Lab>
              <ol className="detail-track-list">
                {artistMatches.map((t, i) => (
                  <TrackRow key={t.id} track={t} onPlay={() => playFrom(artistMatches, i)} showArtist showAlbum />
                ))}
              </ol>
            </div>
          )}
        </AsyncView>
      )}
    </section>
  );
}

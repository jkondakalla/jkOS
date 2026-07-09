import { useEffect, useMemo, useState } from 'react';
import { Lab, useBreakpoint } from '@jkos/ui';
import { listBooks, type Book, type BookFilters } from '../api';
import BookCard from './library/BookCard';
import LibraryToolbar, { type GroupMode, type SearchField } from './library/LibraryToolbar';
import { groupBySeries, sortBooks, STANDALONE_KEY, type SortMode } from './library/format';
import './library.css';

const SEARCH_DEBOUNCE_MS = 300;

// The real library browser (task 5.2): cover grid, server-driven search/filter over
// the `books` dataset's title/author/series filters (discovery.js BOOKS_DATASET —
// title/author are PREFIX matches, series is exact), series grouping, and a
// client-side sort. Replaces the Wave-5.1 flat title list.
export default function Library() {
  const bp = useBreakpoint();

  const [field, setField] = useState<SearchField>('title');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('title');

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Debounce the free-text query before it drives a server refetch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Server-driven fetch — filters go straight to `listBooks` (the `books` dataset's
  // declared filters), never a client-side substring pass over an already-fetched list.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    const filters: BookFilters = {};
    const q = debouncedQuery.trim();
    if (q) filters[field] = q;
    if (seriesFilter) filters.series = seriesFilter;

    listBooks(filters).then(
      (rows) => {
        if (!alive) return;
        setBooks(rows);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      },
    );
    return () => { alive = false; };
  }, [field, debouncedQuery, seriesFilter]);

  const sorted = useMemo(() => sortBooks(books, sortMode), [books, sortMode]);
  const groups = useMemo(() => groupBySeries(sorted), [sorted]);

  // Once a series is pinned via the exact-match filter there's only one series left
  // in the result set — grouping has nothing left to do, so the grid always renders
  // flat while a series filter is active, regardless of the toggle's last position.
  const showGrouped = groupMode === 'series' && !seriesFilter;

  const density = bp === 'mobile' ? 'compact' : bp === 'tablet' ? 'cozy' : 'comfortable';
  const hasActiveFilter = debouncedQuery.trim().length > 0 || seriesFilter != null;

  function pickSeries(series: string) {
    setSeriesFilter(series);
  }

  return (
    <section className="view-library">
      <div className="lib-heading">
        <Lab size="sm">Library</Lab>
        {!loading && !error && <span className="lib-count">{sorted.length} book{sorted.length === 1 ? '' : 's'}</span>}
      </div>

      <LibraryToolbar
        field={field}
        onFieldChange={setField}
        query={query}
        onQueryChange={setQuery}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        seriesFilter={seriesFilter}
        onClearSeriesFilter={() => setSeriesFilter(null)}
        bp={bp}
      />

      {loading ? (
        <p className="muted">Loading books…</p>
      ) : error ? (
        <p className="muted">Could not load the library. Try again shortly.</p>
      ) : sorted.length === 0 ? (
        <p className="muted">
          {hasActiveFilter
            ? 'No books match this search.'
            : 'No books yet — rescan the library to populate the catalog.'}
        </p>
      ) : showGrouped ? (
        <div className="lib-groups">
          {groups.map((group) => (
            <section key={group.key} className="lib-group">
              <header className="lib-group-header">
                {group.key === STANDALONE_KEY ? (
                  <Lab as="span" size="sm">{group.label} &middot; {group.books.length}</Lab>
                ) : (
                  <button type="button" className="lib-group-title" onClick={() => pickSeries(group.label)}>
                    <Lab as="span" size="sm">{group.label} &middot; {group.books.length}</Lab>
                  </button>
                )}
              </header>
              <div className="lib-grid" data-density={density}>
                {group.books.map((book) => <BookCard key={book.id} book={book} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="lib-grid" data-density={density}>
          {sorted.map((book) => <BookCard key={book.id} book={book} />)}
        </div>
      )}
    </section>
  );
}

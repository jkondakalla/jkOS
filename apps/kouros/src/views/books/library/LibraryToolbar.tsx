import type { ReactNode } from 'react';
import { Lab, cx } from '@jkos/ui';
import type { SortMode } from './format';

export type SearchField = 'title' | 'author';
export type GroupMode = 'all' | 'series';

interface LibraryToolbarProps {
  field: SearchField;
  onFieldChange: (field: SearchField) => void;
  query: string;
  onQueryChange: (query: string) => void;
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  seriesFilter: string | null;
  onClearSeriesFilter: () => void;
  genreFilter: string | null;
  onClearGenreFilter: () => void;
  bp: 'mobile' | 'tablet' | 'desktop';
}

/** A two-state accent toggle button (struck primary when active, flat secondary
 *  when not) — the house idiom for a segmented control (jk-bubble's documented
 *  primary/secondary split), reused for the field picker and the grouping toggle. */
function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx('jk-bubble', active ? 'jk-bubble-primary' : 'jk-bubble-secondary')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Search/filter/group/sort controls. Search is server-driven (the `books` dataset's
 *  title/author PREFIX filters — Library.tsx debounces + refetches, this component
 *  only owns the controlled inputs) per the task bullet; sort stays client-side
 *  (not one of the dataset's filters). Mobile stacks the row full-width so every
 *  control clears the 44px tap floor without crowding a narrow viewport. */
export default function LibraryToolbar({
  field, onFieldChange, query, onQueryChange,
  groupMode, onGroupModeChange, sortMode, onSortModeChange,
  seriesFilter, onClearSeriesFilter, genreFilter, onClearGenreFilter, bp,
}: LibraryToolbarProps) {
  return (
    <div className="lib-toolbar" data-bp={bp}>
      <div className="lib-search">
        <input
          type="search"
          className="lib-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={field === 'title' ? 'Search titles…' : 'Search authors…'}
          aria-label={field === 'title' ? 'Search by title' : 'Search by author'}
        />
        {query.length > 0 && (
          <button type="button" className="lib-clear" aria-label="Clear search" onClick={() => onQueryChange('')}>
            &times;
          </button>
        )}
      </div>

      <div className="lib-seg" role="group" aria-label="Search field">
        <SegButton active={field === 'title'} onClick={() => onFieldChange('title')}>Title</SegButton>
        <SegButton active={field === 'author'} onClick={() => onFieldChange('author')}>Author</SegButton>
      </div>

      <div className="lib-seg" role="group" aria-label="Grouping">
        <SegButton active={groupMode === 'all'} onClick={() => onGroupModeChange('all')}>All</SegButton>
        <SegButton active={groupMode === 'series'} onClick={() => onGroupModeChange('series')}>By series</SegButton>
      </div>

      <label className="lib-sort">
        <Lab as="span" size="xs">Sort</Lab>
        <select
          className="lib-select"
          value={sortMode}
          onChange={(e) => onSortModeChange(e.target.value as SortMode)}
        >
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="year">Year</option>
          <option value="updated">Recently updated</option>
        </select>
      </label>

      {seriesFilter && (
        <button type="button" className={cx('jk-bubble', 'jk-bubble-secondary', 'lib-chip')} onClick={onClearSeriesFilter}>
          Series: {seriesFilter} &times;
        </button>
      )}

      {/* Genre's own clear-pill, mirroring seriesFilter's exactly (task: "clear
          affordance to remove the filter" — this is the documented one; re-tapping
          the active chip on a card is a second, card-local shortcut to the same
          state, see BookCard.tsx / Library.tsx's pickGenre). */}
      {genreFilter && (
        <button type="button" className={cx('jk-bubble', 'jk-bubble-secondary', 'lib-chip')} onClick={onClearGenreFilter}>
          Genre: {genreFilter} &times;
        </button>
      )}
    </div>
  );
}

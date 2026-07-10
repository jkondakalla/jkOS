import { cx } from '@jkos/ui';
import type { Book } from '../../api';
import CoverArt from './CoverArt';
import { OfflineBadge } from '../../offline';
import { formatDuration } from './format';

interface BookCardProps {
  book: Book;
  /** The library's current genre filter (Library.tsx `genreFilter`), if any — struck
   *  (`jk-bubble-primary`) when a chip on THIS card matches it, so the active filter
   *  is visible right on the tile it came from, not just the toolbar's clear-pill. */
  activeGenre?: string | null;
  /** Fires when a genre chip is tapped. Owned by Library.tsx (`pickGenre` — sets/
   *  toggles `genreFilter`, which flows back into `listBooks`' server-side filter). */
  onGenreClick?: (genre: string) => void;
}

/** One cover-grid tile. A plain `<a>` (not the `Sheet` primitive's `as` prop — Sheet's
 *  prop type is a bare HTMLAttributes, which doesn't carry `href`; every other view in
 *  this app reaches for a plain tagged element + `cx()` when it needs an anchor/button
 *  with a primitive's look, see BookDetail's `back-link`) so the WHOLE card is one tap
 *  target into `#/book/<id>`, styled with the `jk-sheet` card surface.
 *
 *  Genre chips (task: filter-by-genre) live INSIDE that same anchor, so each chip is a
 *  real `<button>` — nested interactive content is invalid HTML5, but it's the pragmatic
 *  choice here: a real `<button>` gets free keyboard activation (Enter/Space, no manual
 *  onKeyDown) AND matches hub.css's tap-floor selector (`button.jk-bubble` — 44px on
 *  touch tiers, 0 on desktop), which a `<span role="button">` would silently miss. Each
 *  chip's onClick calls BOTH `preventDefault()` (stops the anchor's own navigation —
 *  `stopPropagation()` alone does NOT cancel a native `<a>`'s default action) AND
 *  `stopPropagation()` (defensive, in case a future ancestor gains its own handler);
 *  this is exactly the tap-vs-navigate split the task flagged, and it holds on touch
 *  the same as mouse — a tap synthesizes the same `click` event either way. */
export default function BookCard({ book, activeGenre = null, onGenreClick }: BookCardProps) {
  return (
    <a href={`#/book/${book.id}`} className={cx('jk-sheet', 'lib-card')}>
      <OfflineBadge bookId={book.id} />
      <CoverArt book={book} />
      <div className="lib-card-body">
        <p className="lib-card-title">{book.title}</p>
        {book.author && <p className="lib-card-author">{book.author}</p>}
        {book.genres.length > 0 && (
          <div className="lib-card-genres">
            {book.genres.map((genre) => (
              <button
                key={genre}
                type="button"
                className={cx(
                  'jk-bubble',
                  genre === activeGenre ? 'jk-bubble-primary' : 'jk-bubble-secondary',
                  'lib-genre-chip',
                )}
                aria-pressed={genre === activeGenre}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onGenreClick?.(genre);
                }}
              >
                {genre}
              </button>
            ))}
          </div>
        )}
        <div className="lib-card-meta">
          {book.series && (
            <span className={cx('jk-bubble', 'jk-bubble-secondary', 'lib-card-series')}>
              {book.series}
              {book.series_seq != null ? ` #${book.series_seq}` : ''}
            </span>
          )}
          <span className="lib-card-duration">{formatDuration(book.duration)}</span>
        </div>
      </div>
    </a>
  );
}

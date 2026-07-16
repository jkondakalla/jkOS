import { CoverArt, Sheet, cx } from '@jkos/ui';
import { coverUrl, type Book } from '../../api';
import { OfflineBadge } from '../../offline';
import { formatDuration, initials } from './format';

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

/** One cover-grid tile — `Sheet as="a"` so the WHOLE card is one tap target into
 *  `#/book/<id>`, styled with the `jk-sheet` card surface.
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
    <Sheet as="a" href={`#/book/${book.id}`} className="lib-card">
      <OfflineBadge bookId={book.id} />
      {/* `cover_path === null` means the scanner never extracted/matched artwork —
          `coverUrl` 404s for those rows, so pass no `src` and skip the round-trip
          entirely (CoverArt's own `onError` still catches the rarer case: an
          extracted cover missing/unreadable on disk). */}
      <CoverArt
        src={book.cover_path ? coverUrl(book.id) : undefined}
        alt=""
        fallback={<span className="jk-press-lg">{initials(book.title)}</span>}
      />
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
        {/* Genres are the card's ONLY pills (Jag, 2026-07-10) — the old series pill
            mostly echoed the title (standalone rips tag album == title; the backend
            now nulls those, and real series still group via the toolbar). */}
        <div className="lib-card-meta">
          <span className="lib-card-duration">{formatDuration(book.duration)}</span>
        </div>
      </div>
    </Sheet>
  );
}

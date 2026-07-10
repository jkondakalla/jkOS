import { cx } from '@jkos/ui';
import type { Book } from '../../api';
import CoverArt from './CoverArt';
import { OfflineBadge } from '../../offline';
import { formatDuration } from './format';

/** One cover-grid tile. A plain `<a>` (not the `Sheet` primitive's `as` prop — Sheet's
 *  prop type is a bare HTMLAttributes, which doesn't carry `href`; every other view in
 *  this app reaches for a plain tagged element + `cx()` when it needs an anchor/button
 *  with a primitive's look, see BookDetail's `back-link`) so the WHOLE card is one tap
 *  target into `#/book/<id>`, styled with the `jk-sheet` card surface. */
export default function BookCard({ book }: { book: Book }) {
  return (
    <a href={`#/book/${book.id}`} className={cx('jk-sheet', 'lib-card')}>
      <OfflineBadge bookId={book.id} />
      <CoverArt book={book} />
      <div className="lib-card-body">
        <p className="lib-card-title">{book.title}</p>
        {book.author && <p className="lib-card-author">{book.author}</p>}
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

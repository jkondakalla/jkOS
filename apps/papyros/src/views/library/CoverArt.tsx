import { useState } from 'react';
import { cx } from '@jkos/ui';
import { coverUrl, type Book } from '../../api';
import { initials } from './format';

/** Cover art for one book card. `cover_path === null` means the scanner never
 *  extracted/matched artwork — `coverUrl` 404s for those rows, so we skip the
 *  network round-trip entirely and render the placeholder tile straight away;
 *  `onError` catches the rarer case (extracted cover missing/unreadable on disk).
 *  The placeholder reuses `jk-well` (the suite's inset accent-tinted container) +
 *  `jk-press-lg` (struck primary text, same treatment as the app wordmark) instead
 *  of inventing a new tinted-box look. */
export default function CoverArt({ book }: { book: Book }) {
  const [broken, setBroken] = useState(false);

  if (!book.cover_path || broken) {
    return (
      <div className={cx('jk-well', 'lib-cover', 'lib-cover-placeholder')} aria-hidden="true">
        <span className="jk-press-lg">{initials(book.title)}</span>
      </div>
    );
  }

  return (
    <img
      className="lib-cover"
      src={coverUrl(book.id)}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

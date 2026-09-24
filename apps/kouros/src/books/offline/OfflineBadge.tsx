import { cx } from '@jkos/ui';
import { useOfflineStatus } from './store';
import './offline.css';

/** A small "available offline" indicator, driven by the shared offline store (one DB read
 *  for the whole grid, see store.ts). Renders nothing unless the book is fully cached OR a
 *  download is in flight. Used on the library BookCard (icon-only) and the BookDetail hero
 *  (`label`). Follows the app's raw-element + cx idiom rather than a UI primitive that
 *  can't carry the classes/title it needs. */
export default function OfflineBadge({ bookId, label = false }: { bookId: number; label?: boolean }) {
  const status = useOfflineStatus(bookId);

  if (status.phase === 'available') {
    return (
      <span
        className={cx('jk-bubble', 'offline-badge', 'is-available')}
        title="Available offline"
      >
        <IconOffline />
        {label && <span className="offline-badge-text">Offline</span>}
      </span>
    );
  }

  if (status.phase === 'downloading') {
    const pct = status.filesTotal > 0 ? Math.round((status.filesDone / status.filesTotal) * 100) : 0;
    return (
      <span
        className={cx('jk-bubble', 'offline-badge', 'is-downloading')}
        title={`Downloading — ${status.filesDone}/${status.filesTotal} files`}
      >
        <IconOffline />
        {label && <span className="offline-badge-text">{pct}%</span>}
      </span>
    );
  }

  return null;
}

/** Down-arrow-into-tray glyph. currentColor so the badge's own color drives it. */
function IconOffline() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2v6.4M8 8.6 5.4 6M8 8.6 10.6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 10.6v1.7c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-1.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

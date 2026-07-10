import { cx } from '@jkos/ui';
import type { BookDetail } from '../api';
import { useOfflineStatus, downloadBook, cancelDownload, removeDownload } from './store';
import { offlineSupported } from './db';
import { formatBytes } from './format';
import './offline.css';

// The per-book offline control for BookDetail — sits in `.book-actions` beside the
// server-zip DownloadButton (a different feature: that saves a file to disk; this makes
// the book playable in-app with no network, which 7.3's SW then serves). Raw <button> +
// cx('jk-tbtn'), matching DownloadButton and the app's TButton-can't-take-disabled idiom.
export default function OfflineButton({ book }: { book: BookDetail }) {
  const status = useOfflineStatus(book.id);

  // Nothing to offer where the browser can't persist media (SSR/insecure/private-mode).
  if (!offlineSupported()) return null;

  if (status.phase === 'downloading') {
    const total = status.filesTotal || book.files.length;
    const pct = total > 0 ? Math.min(100, Math.round((status.filesDone / total) * 100)) : 0;
    return (
      <div className="offline-ctl">
        <button
          type="button"
          className={cx('jk-tbtn', 'jk-tbtn-quiet', 'offline-ctl-btn')}
          onClick={() => cancelDownload(book.id)}
          title="Cancel and discard the partial download"
        >
          Cancel
        </button>
        <div className="offline-ctl-status">
          <div className="offline-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="offline-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="offline-ctl-hint">
            Downloading {status.filesDone}/{total} · {formatBytes(status.bytes)}
          </span>
        </div>
      </div>
    );
  }

  if (status.phase === 'available') {
    return (
      <div className="offline-ctl">
        <button
          type="button"
          className={cx('jk-tbtn', 'jk-tbtn-quiet', 'offline-ctl-btn', 'is-available')}
          onClick={() => { void removeDownload(book.id); }}
          title="Remove this download to free up space"
        >
          Remove download
        </button>
        <span className="offline-ctl-hint">
          Saved offline · {formatBytes(status.record?.bytes ?? status.bytes)}
        </span>
      </div>
    );
  }

  // none | error
  const isError = status.phase === 'error';
  return (
    <div className="offline-ctl">
      <button
        type="button"
        className={cx('jk-tbtn', 'jk-tbtn-quiet', 'offline-ctl-btn')}
        onClick={() => { void downloadBook(book); }}
        title="Download this book to play it with no network"
      >
        {isError ? 'Retry download' : 'Save offline'}
      </button>
      {isError && <span className={cx('offline-ctl-hint', 'is-error')}>Download failed — retry</span>}
    </div>
  );
}

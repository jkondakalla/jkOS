import { useState } from 'react';
import { Lab, cx } from '@jkos/ui';
import type { BookDetail } from '../api';
import { downloadUrl } from '../api';
import './download-button.css';

// Owned by task 5.5 — the real download flow.
//
// The route (backend/src/media.js, task 3.3) sits behind the identity gate but the
// `jkos_token` COOKIE satisfies it same-origin, so a plain <a download> navigation
// downloads correctly without an Authorization header. Deliberately NOT a fetch+Blob:
// a multi-file book streams as a server-side zip that can run multiple gigabytes, and
// pulling that through JS memory instead of the browser's native download path would
// defeat the whole point of the streaming implementation on the other end.
export default function DownloadButton({ book }: { book: BookDetail }) {
  const [starting, setStarting] = useState(false);

  const multi = book.files.length > 1;
  const hint = multi
    ? `${book.files.length} files · zip`
    : (book.files[0]?.codec ?? 'audio');

  return (
    <div className="download-btn">
      <a
        href={downloadUrl(book.id)}
        download
        aria-disabled={starting || undefined}
        className={cx('jk-tbtn', 'download-btn-link', starting && 'is-starting')}
        title={`Download "${book.title}" (${hint})`}
        onClick={() => {
          setStarting(true);
          window.setTimeout(() => setStarting(false), 1500);
        }}
      >
        {starting ? 'Starting…' : 'Download'}
      </a>
      <Lab as="span" size="xs" className="download-btn-hint">{hint}</Lab>
    </div>
  );
}

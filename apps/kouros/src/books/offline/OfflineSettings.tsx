import { useEffect, useState } from 'react';
import { AsyncView, SettingsSection } from '@jkos/ui';
import { useOfflineLibrary, removeDownload, estimateStorage, type StorageEstimate } from './store';
import { offlineSupported } from './db';
import { formatBytes } from './format';
import './offline.css';

// The "Downloads" section for the shared SettingsDrawer's `extra` slot (App.tsx mounts it
// there, same seam ORDECK uses for weather). A storage estimate up top, then every
// downloaded book with its size and a remove affordance — the eviction UI. Reads the same
// shared offline store as the badges, so removing here updates every badge at once.
export default function OfflineSettings() {
  const books = useOfflineLibrary();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);

  // Refresh the browser storage estimate on mount and whenever the downloaded set changes
  // (a download completing or a removal moves usage). `books.length` is a cheap proxy for
  // "membership changed" without re-running on every in-flight progress tick.
  useEffect(() => {
    let alive = true;
    estimateStorage().then((e) => { if (alive) setEstimate(e); });
    return () => { alive = false; };
  }, [books.length]);

  if (!offlineSupported()) return null;

  const totalBytes = books.reduce((sum, b) => sum + b.bytes, 0);

  return (
    <SettingsSection label="Downloads">
      {estimate && (
        <div className="offline-estimate">
          <div className="offline-estimate-bar">
            <div className="offline-estimate-fill" style={{ width: `${Math.min(100, Math.round(estimate.ratio * 100))}%` }} />
          </div>
          <span className="offline-estimate-text">
            {formatBytes(estimate.usage)} used{estimate.quota > 0 ? ` of ${formatBytes(estimate.quota)}` : ''}
          </span>
        </div>
      )}

      <AsyncView
        empty={books.length === 0}
        emptyText="No books downloaded yet. Open a book and choose “Save offline”."
      >
        <p className="offline-summary">
          {books.length} book{books.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
        </p>
        <ul className="offline-list">
          {books.map((b) => (
            <li key={b.bookId} className="offline-list-row">
              <div className="offline-list-info">
                <span className="offline-list-title" title={b.title}>{b.title}</span>
                <span className="offline-list-meta">
                  {b.author ? `${b.author} · ` : ''}{formatBytes(b.bytes)}
                </span>
              </div>
              <button
                type="button"
                className="offline-list-remove"
                onClick={() => { void removeDownload(b.bookId); }}
                title={`Remove “${b.title}”`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </AsyncView>
    </SettingsSection>
  );
}

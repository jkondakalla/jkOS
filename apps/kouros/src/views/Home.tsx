import { useEffect, useMemo, useState } from 'react';
import { AsyncView, Lab, MediaGrid, TButton, useBreakpoint } from '@jkos/ui';
import { listHistory, rescanLibrary, type HistoryRow, type Track } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useTracks } from '../hooks/useTracks';
import { requestPlay } from '../player/controller';
import TrackTile from './library/TrackTile';
import './library.css';

const RECENT_LIMIT = 18;

/** Home (task 18.3): the two recency rails.
 *   - "Recently added" — `tracks` sorted by `updated_at` desc, the only recency
 *     stamp the `tracks` dataset exposes (discovery.js's TRACK_SHAPE has no
 *     separate `added_at`; the scanner stamps `updated_at` on insert too, so
 *     for a track nothing has re-touched since, it IS the add time).
 *   - "Recently played" — the owner-scoped `history` dataset, `item_ref`s
 *     resolved against the just-fetched `tracks` list, deduped to the most
 *     recent play per track (see the `recentlyPlayed` memo below for how). */
export default function Home() {
  const bp = useBreakpoint();
  const { state } = useAuth();
  const isAdmin = state.status === 'authenticated' && state.user.role === 'admin';

  const [reloadKey, setReloadKey] = useState(0);
  const { tracks, loading, error } = useTracks(reloadKey);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  useEffect(() => {
    let alive = true;
    // Best-effort — a failed history fetch just means an empty "Recently played"
    // rail, never blocks the rest of Home (mirrors papyros's BookDetail.tsx
    // listProgress() call: "non-fatal if it fails, Play still works").
    listHistory().then((rows) => { if (alive) setHistory(rows); }, () => {});
    return () => { alive = false; };
  }, [reloadKey]);

  const [rescanning, setRescanning] = useState(false);
  const [rescanNote, setRescanNote] = useState<string | null>(null);

  // Admin-only rescanLibrary trigger (routes/library.js gates on req.user.role) —
  // same precedent as papyros's Library.tsx. Bumps reloadKey so both the tracks
  // and history effects above refetch once the walk finishes.
  async function handleRescan() {
    setRescanning(true);
    setRescanNote(null);
    try {
      const counts = await rescanLibrary();
      setRescanNote(`Scanned ${counts.scanned} · ${counts.upserted} updated · ${counts.removed} removed`);
      setReloadKey((k) => k + 1);
    } catch {
      setRescanNote('Rescan failed.');
    } finally {
      setRescanning(false);
    }
  }

  const density = bp === 'mobile' ? 'compact' : bp === 'tablet' ? 'cozy' : 'comfortable';

  const recentlyAdded = useMemo(
    () => [...tracks]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, RECENT_LIMIT),
    [tracks],
  );

  const recentlyPlayed = useMemo(() => {
    if (tracks.length === 0 || history.length === 0) return [];
    const byId = new Map(tracks.map((t) => [t.id, t] as const));
    const seen = new Set<number>();
    const rows: Track[] = [];
    // `history` arrives newest-first (the generic defineCollection list route:
    // `ORDER BY id DESC`, an append-only table so insertion order == recency) —
    // so the first occurrence of an item_ref walking forward IS its most recent
    // play; a plain Set dedupe is enough, no extra sort needed.
    for (const h of history) {
      if (seen.has(h.item_ref)) continue;
      seen.add(h.item_ref);
      const t = byId.get(h.item_ref);
      if (t) rows.push(t);   // skip refs whose track was removed by a later rescan
      if (rows.length >= RECENT_LIMIT) break;
    }
    return rows;
  }, [tracks, history]);

  function playFrom(list: Track[], index: number) {
    requestPlay({ trackIds: list.map((t) => t.id), startIndex: index });
  }

  return (
    <section className="view-home">
      <div className="kr-heading">
        <Lab size="sm">Home</Lab>
        {isAdmin && (
          <TButton quiet disabled={rescanning} onClick={handleRescan}>
            {rescanning ? 'Rescanning…' : 'Rescan library'}
          </TButton>
        )}
      </div>
      {rescanNote && <p className="kr-note">{rescanNote}</p>}

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load the library. Try again shortly."
        empty={!loading && !error && tracks.length === 0}
        emptyText={
          isAdmin
            ? 'No tracks yet — use Rescan above to walk the music library folder.'
            : 'No tracks yet — an admin needs to rescan the library.'
        }
      >
        {recentlyPlayed.length > 0 && (
          <section className="kr-section">
            <Lab size="sm">Recently played</Lab>
            <MediaGrid density={density} className="kr-grid">
              {recentlyPlayed.map((t, i) => (
                <TrackTile key={t.id} track={t} onPlay={() => playFrom(recentlyPlayed, i)} />
              ))}
            </MediaGrid>
          </section>
        )}

        <section className="kr-section">
          <Lab size="sm">Recently added</Lab>
          <MediaGrid density={density} className="kr-grid">
            {recentlyAdded.map((t, i) => (
              <TrackTile key={t.id} track={t} onPlay={() => playFrom(recentlyAdded, i)} />
            ))}
          </MediaGrid>
        </section>
      </AsyncView>
    </section>
  );
}

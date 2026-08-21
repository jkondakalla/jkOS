import { useEffect, useMemo, useState } from 'react';
import { AsyncView } from '@jkos/ui';
import Cover from '../components/Cover';
import { AlbumCard } from '../components/cards';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { IconPlay } from '@jkos/player/ui';
import { IconShuffle } from '../player/icons';
import { requestPlay } from '../player/controller';
import { listAlbums, listAlbumTracks, radioFrom, type AlbumSummary } from '../api';
import { formatCount, formatSpan } from './library/format';

/** One artist: their records, newest first, with a play-everything header. */
export default function Artist({ artist }: { artist: string }) {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    listAlbums({ artist, sort: 'year', limit: 200 }).then(
      (rows) => { if (alive) { setAlbums(rows); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [artist]);

  const totals = useMemo(() => albums.reduce(
    (acc, a) => ({ tracks: acc.tracks + a.tracks, duration: acc.duration + a.duration }),
    { tracks: 0, duration: 0 },
  ), [albums]);

  /** Play everything by this artist. The track ids are not held here — the browse
   *  endpoint returns album SUMMARIES — so they are fetched per record on demand.
   *  Requested in parallel and reassembled in album order, because awaiting them
   *  one at a time makes "Play" take a visible second on a deep discography. */
  async function playAll(shuffled: boolean) {
    if (busy || !albums.length) return;
    setBusy(true);
    try {
      const lists = await Promise.all(albums.map((a) => listAlbumTracks(a.album, a.artist).catch(() => [])));
      const ids = lists.flat().map((t) => t.id);
      if (!ids.length) return;
      if (shuffled) {
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j]!, ids[i]!];
        }
      }
      requestPlay({ trackIds: ids, startIndex: 0 });
    } finally {
      setBusy(false);
    }
  }

  async function startRadio(seedId: number) {
    try {
      const r = await radioFrom([seedId], 60);
      const ids = r.results.map((t) => t.id);
      if (ids.length) requestPlay({ trackIds: [seedId, ...ids], startIndex: 0 });
    } catch { /* non-fatal */ }
  }

  const coverId = albums.find((a) => a.cover_id != null)?.cover_id ?? null;

  return (
    <section className="view-detail">
      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load this artist."
        empty={!loading && !error && albums.length === 0}
        emptyText="No albums for this artist."
      >
        <header className="kr-detail-head kr-detail-artist">
          <div className="kr-detail-art kr-detail-art-round">
            <Cover id={coverId} has={coverId != null} alt={artist} name={artist} eager />
          </div>
          <div className="kr-detail-meta">
            <p className="kr-detail-kind kr-mono">Artist</p>
            <h1 className="kr-detail-title">{artist}</h1>
            <p className="kr-detail-facts kr-mono">
              {formatCount(albums.length, 'album')} · {formatCount(totals.tracks, 'track')} · {formatSpan(totals.duration)}
            </p>
            <div className="kr-detail-actions">
              <button type="button" className="kr-primary" onClick={() => playAll(false)} disabled={busy}>
                <IconPlay /> {busy ? 'Loading…' : 'Play'}
              </button>
              <button type="button" className="kr-ghost" onClick={() => playAll(true)} disabled={busy} aria-label="Shuffle everything">
                <IconShuffle />
              </button>
            </div>
          </div>
        </header>

        <section className="kr-section">
          <div className="kr-section-head">
            <h2 className="kr-section-title">Albums</h2>
          </div>
          <div className="kr-grid">
            {albums.map((a) => <AlbumCard key={`${a.artist}-${a.album}`} album={a} />)}
          </div>
        </section>
      </AsyncView>

      <ActionSheet target={menu} onClose={() => setMenu(null)} onRadio={startRadio} />
    </section>
  );
}

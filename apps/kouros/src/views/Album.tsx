import { useEffect, useMemo, useState } from 'react';
import { AsyncView } from '@jkos/ui';
import Cover from '../components/Cover';
import TrackRow from '../components/TrackRow';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { IconRadio } from '../components/icons';
import { IconPlay } from '@jkos/player/ui';
import { IconShuffle } from '../player/icons';
import { artistHref } from '../hooks/useHashRoute';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { requestPlay } from '../player/controller';
import { listAlbumTracks, radioFrom, similarTracks, type SimilarResult, type Track } from '../api';
import { formatCount, formatSpan } from './library/format';

interface AlbumProps {
  artist: string;
  album: string;
}

/** One record: sleeve, track list, and — where the embedder has reached it — what
 *  else in the library sounds like it. */
export default function Album({ artist, album }: AlbumProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  const [similar, setSimilar] = useState<SimilarResult | null>(null);
  const now = useNowPlaying();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setSimilar(null);
    listAlbumTracks(album, artist).then(
      (rows) => { if (alive) { setTracks(rows); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [artist, album]);

  // "More like this" is seeded from the record's OWN longest track rather than its
  // first: an intro/interlude is a poor representative of what an album sounds
  // like, and on a lot of records track 1 is exactly that.
  useEffect(() => {
    if (!tracks.length) return;
    let alive = true;
    const seed = tracks.reduce((a, b) => (b.duration > a.duration ? b : a));
    similarTracks(seed.id, 12).then(
      (r) => { if (alive) setSimilar(r); },
      () => {},
    );
    return () => { alive = false; };
  }, [tracks]);

  const ids = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const total = useMemo(() => tracks.reduce((s, t) => s + (t.duration || 0), 0), [tracks]);
  const year = useMemo(() => tracks.find((t) => t.year)?.year ?? null, [tracks]);
  const coverId = useMemo(() => tracks.find((t) => t.cover_path)?.id ?? null, [tracks]);

  function shufflePlay() {
    // A local Fisher–Yates rather than toggling the player's shuffle policy: the
    // user asked to hear THIS record in a random order once, not to change a
    // standing preference that then applies to everything they play next.
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    requestPlay({ trackIds: order, startIndex: 0 });
  }

  async function startRadio(seedId: number) {
    try {
      const r = await radioFrom([seedId], 60);
      const more = r.results.map((t) => t.id);
      if (more.length) requestPlay({ trackIds: [seedId, ...more], startIndex: 0 });
    } catch { /* non-fatal */ }
  }

  return (
    <section className="view-detail">
      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load this album."
        empty={!loading && !error && tracks.length === 0}
        emptyText="This album has no tracks."
      >
        <header className="kr-detail-head">
          <div className="kr-detail-art">
            <Cover id={coverId} has={coverId != null} alt={`${album} cover`} name={album} eager />
          </div>
          <div className="kr-detail-meta">
            <p className="kr-detail-kind kr-mono">Album</p>
            <h1 className="kr-detail-title">{album}</h1>
            <p className="kr-detail-sub">
              <a href={artistHref(artist)}>{artist}</a>
            </p>
            <p className="kr-detail-facts kr-mono">
              {year ? `${year} · ` : ''}{formatCount(tracks.length, 'track')} · {formatSpan(total)}
            </p>
            <div className="kr-detail-actions">
              <button
                type="button"
                className="kr-primary"
                onClick={() => requestPlay({ trackIds: ids, startIndex: 0 })}
              >
                <IconPlay /> Play
              </button>
              <button type="button" className="kr-ghost" onClick={shufflePlay} aria-label="Shuffle album">
                <IconShuffle />
              </button>
              <button
                type="button"
                className="kr-ghost"
                onClick={() => setMenu({
                  trackIds: ids,
                  title: album,
                  subtitle: artist,
                  artist,
                  album,
                  seedId: ids[0],
                })}
                aria-label="More actions"
              >
                &hellip;
              </button>
            </div>
          </div>
        </header>

        <ol className="kr-tracks">
          {tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              numbered
              art={false}
              playing={now.trackId === t.id}
              onPlay={() => requestPlay({ trackIds: ids, startIndex: i })}
              onMenu={setMenu}
            />
          ))}
        </ol>

        {similar && similar.results.length > 0 && (
          <section className="kr-section">
            <div className="kr-section-head">
              <h2 className="kr-section-title">
                <IconRadio size={16} /> If you like this
              </h2>
              <span className="kr-section-note">
                {similar.basis === 'embedding' ? 'matched by sound' : 'matched by tags'}
              </span>
            </div>
            <ol className="kr-tracks">
              {similar.results.slice(0, 8).map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  showAlbum
                  playing={now.trackId === t.id}
                  onPlay={() => requestPlay({
                    trackIds: similar.results.map((x) => x.id),
                    startIndex: i,
                  })}
                  onMenu={setMenu}
                />
              ))}
            </ol>
          </section>
        )}
      </AsyncView>

      <ActionSheet target={menu} onClose={() => setMenu(null)} onRadio={startRadio} />
    </section>
  );
}

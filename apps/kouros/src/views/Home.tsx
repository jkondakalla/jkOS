import { useEffect, useState } from 'react';
import { AsyncView } from '@jkos/ui';
import { AlbumCard, TrackCard } from '../components/cards';
import Cover from '../components/Cover';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { IconArc, IconChevron, IconClock } from '../components/icons';
import { artistHref, browseHref, mapHref } from '../hooks/useHashRoute';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { requestPlay } from '../player/controller';
import { fetchHome, radioFrom, type AlbumSummary, type HomePayload, type HomeRun } from '../api';
import { formatCount, formatSpan } from './library/format';

/**
 * Home — five rails, one request.
 *
 * The brief's complaint about Plexamp's home page is that it is a list of
 * folders, and Spotify's is not. So the organising question for every rail here
 * is "what does someone opening a music app actually want", never "what tables do
 * we have":
 *
 *   Runs        a set that goes somewhere      (embeddings + an energy arc)
 *   Time of day something that fits right now  (the readable descriptor axes)
 *   Deep in     more of the current obsession  (recency-weighted play history)
 *   Picked up   the thing I was just playing   (history)
 *   New         what arrived in here           (catalog recency, by ALBUM)
 *
 * Rails that have no data are ABSENT rather than empty. An empty shelf with a
 * heading is worse than no shelf: it reads as breakage, and on a phone it costs a
 * screenful of scrolling to discover it is just unused.
 */
export default function Home() {
  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  const now = useNowPlaying();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    // The LOCAL hour, not the server's: "morning" is a property of where the
    // listener is, and the backend runs UTC in a container.
    fetchHome(new Date().getHours()).then(
      (payload) => { if (alive) { setData(payload); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, []);

  async function startRadio(seedId: number) {
    try {
      const r = await radioFrom([seedId], 60);
      const ids = r.results.map((t) => t.id);
      if (ids.length) requestPlay({ trackIds: [seedId, ...ids], startIndex: 0 });
    } catch { /* non-fatal */ }
  }

  const stats = data?.stats;

  return (
    <section className="view-home">
      {/* Contextual, not a second wordmark — the suite header above already
          carries the app's name. This says what this SCREEN is right now. */}
      <header className="kr-pagehead">
        <h1 className="kr-pagehead-title">{greeting(data?.time_of_day.slot)}</h1>
        <p className="kr-pagehead-sub kr-mono">
          {stats ? `${stats.tracks.toLocaleString()} tracks in the library` : ''}
        </p>
      </header>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load your home page. Try again shortly."
        empty={!loading && !error && !!data && data.stats.tracks === 0}
        emptyText="The library is empty — point MUSIC_DIR at your music and rescan."
      >
        {data && (
          <>
            {/* ── Runs ─────────────────────────────────────────────────────── */}
            {data.runs.length > 0 && (
              <section className="kr-section">
                <div className="kr-section-head">
                  <h2 className="kr-section-title">Runs</h2>
                  <span className="kr-section-note">built from the sound</span>
                </div>
                <div className="kr-rail kr-rail-wide jk-scroll-none">
                  {data.runs.map((run) => (
                    <RunCard key={run.id} run={run} onMenu={setMenu} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Time of day ──────────────────────────────────────────────── */}
            {data.time_of_day.results.length > 0 && (
              <section className="kr-section">
                <div className="kr-section-head">
                  <h2 className="kr-section-title">
                    <IconClock size={16} /> {data.time_of_day.label} picks
                  </h2>
                  {/* The basis is shown, always. 'genre' means no embeddings were
                      available and this is a tag heuristic — saying so costs one
                      word and keeps the feature believable. */}
                  <span className="kr-section-note">
                    {data.time_of_day.basis === 'features' ? 'matched by sound' : 'matched by genre'}
                  </span>
                </div>
                <div className="kr-rail jk-scroll-none">
                  {data.time_of_day.results.map((t, i) => (
                    <TrackCard
                      key={t.id}
                      id={t.id}
                      title={t.title}
                      artist={t.artist}
                      album={t.album}
                      hasCover={t.has_cover}
                      playing={now.trackId === t.id}
                      onPlay={() => requestPlay({
                        trackIds: data.time_of_day.results.map((x) => x.id),
                        startIndex: i,
                      })}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Deep in ──────────────────────────────────────────────────── */}
            {data.deep_in.length > 0 && (
              <section className="kr-section">
                <div className="kr-section-head">
                  <h2 className="kr-section-title">You&rsquo;re deep in</h2>
                  <span className="kr-section-note">lately</span>
                </div>
                <div className="kr-rail jk-scroll-none">
                  {data.deep_in.map((a) => (
                    <a key={a.artist} className="kr-card kr-card-round" href={artistHref(a.artist)}>
                      <Cover id={a.anchor_id} has={a.anchor_id != null} alt={a.artist} name={a.artist} />
                      <p className="kr-card-title">{a.artist}</p>
                      <p className="kr-card-meta">{formatCount(a.plays, 'play')} · {a.library_tracks} in library</p>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* ── Recently played ──────────────────────────────────────────── */}
            {data.recently_played.length > 0 && (
              <section className="kr-section">
                <div className="kr-section-head">
                  <h2 className="kr-section-title">Pick up where you left off</h2>
                </div>
                <div className="kr-rail jk-scroll-none">
                  {data.recently_played.map((t, i) => (
                    <TrackCard
                      key={t.id}
                      id={t.id}
                      title={t.title}
                      artist={t.artist}
                      album={t.album}
                      hasCover={t.has_cover}
                      playing={now.trackId === t.id}
                      onPlay={() => requestPlay({
                        trackIds: data.recently_played.map((x) => x.id),
                        startIndex: i,
                      })}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Fresh albums ─────────────────────────────────────────────── */}
            {data.fresh_albums.length > 0 && (
              <section className="kr-section">
                <div className="kr-section-head">
                  <h2 className="kr-section-title">New in the library</h2>
                  <a className="kr-section-note kr-section-more" href={browseHref()}>
                    All <IconChevron size={14} />
                  </a>
                </div>
                <div className="kr-rail jk-scroll-none">
                  {data.fresh_albums.map((a) => (
                    <AlbumCard
                      key={`${a.artist}-${a.album}`}
                      album={{
                        album: a.album,
                        artist: a.artist,
                        year: a.year,
                        tracks: a.tracks,
                        duration: a.duration,
                        added: a.added,
                        anchor_id: a.anchor_id,
                        cover_id: a.anchor_id,
                      } as AlbumSummary}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── The coverage footer ───────────────────────────────────────
                Not a debug readout — it is the answer to "why are there no
                Runs today". The embedder backfills over hours, and a listener
                who can see 4% of their library is analysed understands a thin
                Runs rail instead of concluding the feature is broken. */}
            {stats && stats.dim > 0 && (
              <footer className="kr-coverage">
                <a href={mapHref()} className="kr-coverage-link">
                  <span className="kr-mono">
                    {stats.measured.toLocaleString()} of {stats.tracks.toLocaleString()} tracks analysed
                    {stats.inferred > 0 && ` · ${stats.inferred.toLocaleString()} matched by album`}
                  </span>
                  <span className="kr-coverage-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(stats.coverage * 100)}%` }} />
                  </span>
                </a>
              </footer>
            )}
          </>
        )}
      </AsyncView>

      <ActionSheet target={menu} onClose={() => setMenu(null)} onRadio={startRadio} />
    </section>
  );
}

/** The page's own heading. Deliberately NOT the time-of-day rail's label — those
 *  sat one above the other reading "Evening / Evening", which looks like a bug. */
function greeting(slot?: string): string {
  switch (slot) {
    case 'morning': return 'Good morning';
    case 'working': return 'Good afternoon';
    case 'evening': return 'Good evening';
    case 'late':    return 'Still up';
    default:        return 'Home';
  }
}

/** One Run: the arc drawn as a glyph, the seed named, the whole set one tap away. */
function RunCard({ run, onMenu }: { run: HomeRun; onMenu(t: ActionTarget): void }) {
  const ids = run.tracks.map((t) => t.id);
  return (
    <article className="kr-run kr-glass kr-gloss">
      <div className="kr-run-art">
        {run.tracks.slice(0, 4).map((t) => (
          <Cover key={t.id} id={t.id} has={t.has_cover} alt="" name={t.album || t.title} />
        ))}
      </div>
      <div className="kr-run-body">
        <p className="kr-run-title">
          <IconArc arc={run.arc} size={16} /> {run.title}
        </p>
        <p className="kr-run-blurb">{run.blurb}</p>
        <p className="kr-run-meta kr-mono">
          {run.length} tracks · {formatSpan(run.duration)}
        </p>
        <div className="kr-run-actions">
          <button
            type="button"
            className="kr-run-play"
            onClick={() => requestPlay({ trackIds: ids, startIndex: 0 })}
          >
            Play
          </button>
          <button
            type="button"
            className="kr-ghost"
            onClick={() => onMenu({
              trackIds: ids,
              title: run.title,
              subtitle: `from ${run.seed.title}`,
              seedId: run.seed.id,
            })}
          >
            &hellip;
          </button>
        </div>
      </div>
    </article>
  );
}

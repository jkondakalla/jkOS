import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AsyncView } from '@jkos/ui';
import TrackRow from '../components/TrackRow';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { IconPlay } from '@jkos/player/ui';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { requestPlay } from '../player/controller';
import { fetchVibeMap, tracksNear, type DiscoveredTrack, type VibeMap as VibeMapData } from '../api';

/** How long the pin must be still before the neighbour list is refetched. The pin
 *  updates at pointer rate; the QUERY must not. */
const SETTLE_MS = 160;

/**
 * The vibe map: the library as a place, with a pin you drag to steer playback.
 *
 * ── What the coordinates are ─────────────────────────────────────────────────
 * The two axes are the first two principal components of the CLAP embedding
 * space, computed server-side. They are not arbitrary: the backend correlates
 * each one against the readable descriptor features and names it after its
 * strongest correlate, so the map arrives already labelled ("calm → intense",
 * "clean → fuzzy"). Those labels are printed at the edges, because an unlabelled
 * scatter plot is not a map — it is a chart, and nobody navigates a chart.
 *
 * ── Why the pin does not play as it moves ────────────────────────────────────
 * The tempting behaviour is to start playing whatever is under the pin
 * continuously. It is unusable: dragging across a dense region restarts playback
 * dozens of times a second. So dragging only ever UPDATES THE LIST, settling
 * ~160ms after the finger stops, and playing is an explicit act.
 */
export default function VibeMap() {
  const [data, setData] = useState<VibeMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pin, setPin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [near, setNear] = useState<DiscoveredTrack[]>([]);
  const [nearBusy, setNearBusy] = useState(false);
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  const now = useNowPlaying();

  const fieldRef = useRef<HTMLDivElement | null>(null);
  const settleRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVibeMap().then(
      (m) => { if (alive) { setData(m); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, []);

  /** Refetch the neighbours under the pin, debounced. */
  const settle = useCallback((x: number, y: number) => {
    if (settleRef.current) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      setNearBusy(true);
      tracksNear(x, y, 40).then(
        (r) => { setNear(r.results); setNearBusy(false); },
        () => { setNearBusy(false); },
      );
    }, SETTLE_MS);
  }, []);

  // Seed the list once the map is available, so the page is never a bare field.
  useEffect(() => {
    if (data?.available) settle(0, 0);
  }, [data?.available, settle]);

  useEffect(() => () => { if (settleRef.current) window.clearTimeout(settleRef.current); }, []);

  /** Convert a client point to map coordinates in [-1, 1]. */
  const toMap = useCallback((clientX: number, clientY: number) => {
    const el = fieldRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    // Screen y grows downward; the map's y grows upward, so it is inverted here
    // rather than in the projection — the server's coordinates stay mathematical.
    const y = -(((clientY - r.top) / r.height) * 2 - 1);
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }, []);

  const onPointer = useCallback((e: React.PointerEvent) => {
    // `setPointerCapture` keeps the drag alive when the finger leaves the field —
    // without it, dragging to the very edge (which is exactly where the extremes
    // are) drops the gesture.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toMap(e.clientX, e.clientY);
    setPin(p);
    settle(p.x, p.y);
  }, [toMap, settle]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    const p = toMap(e.clientX, e.clientY);
    setPin(p);
    settle(p.x, p.y);
  }, [toMap, settle]);

  /** The region the pin currently sits in — named, so the pin always reports where
   *  it is rather than leaving the user to infer it from the dots. */
  const region = useMemo(() => {
    if (!data?.regions.length) return null;
    let best = data.regions[0]!;
    let bd = Infinity;
    for (const r of data.regions) {
      const d = (r.x - pin.x) ** 2 + (r.y - pin.y) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }, [data, pin]);

  const axes = data?.axes;

  return (
    <section className="view-map">
      <header className="kr-pagehead">
        <h1 className="kr-pagehead-title">Map</h1>
        <p className="kr-pagehead-sub kr-mono">
          {data?.available ? `${(data.total ?? 0).toLocaleString()} tracks placed` : 'Vibe map'}
        </p>
      </header>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load the map."
        empty={!loading && !error && !!data && !data.available}
        emptyText={
          data && !data.available
            ? `${data.reason ?? 'The map is not ready'} — ${data.coverage.measured} of ${data.coverage.tracks} tracks analysed so far.`
            : 'The map is not ready yet.'
        }
      >
        {data?.available && (
          <>
            <div className="kr-map-wrap">
              <div
                className="kr-map-field"
                ref={fieldRef}
                onPointerDown={onPointer}
                onPointerMove={onPointerMove}
                role="application"
                aria-label="Vibe map — drag the pin to steer playback"
              >
                {/* The cloud. Rendered as one SVG rather than N elements: at a few
                    thousand points, one <circle> per track is thousands of DOM
                    nodes and a scroll that stutters on a phone. */}
                <svg className="kr-map-svg" viewBox="-1.05 -1.05 2.1 2.1" preserveAspectRatio="none" aria-hidden="true">
                  {data.points.map((pt) => (
                    <circle
                      key={pt.id}
                      cx={pt.x}
                      cy={-pt.y}
                      r={pt.o ? 0.012 : 0.008}
                      className={`kr-map-dot kr-map-dot-${pt.r % 8}${pt.o ? '' : ' is-inferred'}`}
                    />
                  ))}
                </svg>

                {/* Region labels, positioned at their centroids. */}
                {data.regions.map((r) => (
                  <span
                    key={r.id}
                    className="kr-map-region"
                    style={{ left: `${((r.x + 1) / 2) * 100}%`, top: `${((-r.y + 1) / 2) * 100}%` }}
                  >
                    {r.label}
                  </span>
                ))}

                {/* The pin. */}
                <span
                  className="kr-map-pin"
                  style={{ left: `${((pin.x + 1) / 2) * 100}%`, top: `${((-pin.y + 1) / 2) * 100}%` }}
                  aria-hidden="true"
                />

                {/* Axis labels at the four edges. */}
                {axes?.x && (
                  <>
                    <span className="kr-map-axis kr-map-axis-w">{axes.x.low}</span>
                    <span className="kr-map-axis kr-map-axis-e">{axes.x.high}</span>
                  </>
                )}
                {axes?.y && (
                  <>
                    <span className="kr-map-axis kr-map-axis-s">{axes.y.low}</span>
                    <span className="kr-map-axis kr-map-axis-n">{axes.y.high}</span>
                  </>
                )}
              </div>
            </div>

            <div className="kr-map-readout kr-glass kr-glass-thin">
              <div>
                <p className="kr-map-region-name">{region?.label ?? 'Somewhere'}</p>
                <p className="kr-mono">
                  {nearBusy ? 'Reading…' : `${near.length} tracks near the pin`}
                </p>
              </div>
              <button
                type="button"
                className="kr-primary"
                disabled={!near.length}
                onClick={() => requestPlay({ trackIds: near.map((t) => t.id), startIndex: 0 })}
              >
                <IconPlay /> Play from here
              </button>
            </div>

            {data.sampled && (
              <p className="kr-mono kr-hint">
                Showing a sample of {data.points.length.toLocaleString()} of {(data.total ?? 0).toLocaleString()} placed tracks.
              </p>
            )}

            <ol className="kr-tracks">
              {near.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  showAlbum
                  playing={now.trackId === t.id}
                  onPlay={() => requestPlay({ trackIds: near.map((x) => x.id), startIndex: i })}
                  onMenu={setMenu}
                />
              ))}
            </ol>
          </>
        )}
      </AsyncView>

      <ActionSheet target={menu} onClose={() => setMenu(null)} />
    </section>
  );
}

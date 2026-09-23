import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AsyncView } from '@jkos/ui';
import TrackRow from '../components/TrackRow';
import ActionSheet, { type ActionTarget } from '../components/ActionSheet';
import { IconPlay } from '@jkos/player/ui';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { requestPlay } from '../player/controller';
import {
  fetchVibeMap, tracksNear, type DiscoveredTrack, type MapRegion, type VibeMap as VibeMapData,
  type VibePoint,
} from '../api';
import VibeSpace from '../components/vibespace/VibeSpace';
import { decodeMap, energyWord, type DecodedMap } from '../components/vibespace/geometry';
import { hasWebGL2 } from '@jkos/scene/gl';

/** How long the pin must be still before the neighbour list is refetched. */
const SETTLE_MS = 160;

/**
 * The Map view: the vibe space, and what sits where you pinned it.
 *
 * ── What the coordinates are ─────────────────────────────────────────────────
 * Four numbers per track, fitted offline by `music/mapbasis.py`: ENERGY (calm →
 * intense), which you swipe through, and three spatial axes that carry everything
 * about the sound EXCEPT energy, which make the cloud. The server projects; this view
 * only draws, pins and asks what is near.
 *
 * ── Why the pin does not play as it moves ────────────────────────────────────
 * Playing whatever is under a moving pin restarts playback dozens of times a second.
 * So a pin only ever UPDATES THE LIST, settling ~160 ms after it stops, and playing is
 * an explicit act.
 *
 * ── Without WebGL2 ───────────────────────────────────────────────────────────
 * The cloud cannot draw, and the view says so — but the regions are still a list you
 * can pin from, and the near list and "Play from here" still work. That list is also
 * the accessible path through the whole feature.
 */
export default function VibeMap() {
  const [data, setData] = useState<VibeMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pin, setPin] = useState<VibePoint | null>(null);
  const [energy, setEnergy] = useState(0.5);
  const [near, setNear] = useState<DiscoveredTrack[]>([]);
  const [nearBusy, setNearBusy] = useState(false);
  const [menu, setMenu] = useState<ActionTarget | null>(null);
  const [gl, setGl] = useState(() => hasWebGL2());
  const now = useNowPlaying();
  const settleRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVibeMap().then(
      (m) => { if (alive) { setData(m); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, []);

  const decoded = useMemo<DecodedMap | null>(() => {
    if (!data?.available || !data.packed) return null;
    try {
      return decodeMap(data.packed);
    } catch (err) {
      console.error(`[kouros map] ${(err as Error).message}`);
      return null;
    }
  }, [data]);

  const regions = data?.regions ?? [];
  const stops = data?.stops ?? [0.1, 0.3, 0.5, 0.7, 0.9];

  const settle = useCallback((p: VibePoint) => {
    if (settleRef.current) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      setNearBusy(true);
      tracksNear(p, 40).then(
        (r) => { setNear(r.results); setNearBusy(false); },
        () => { setNearBusy(false); },
      );
    }, SETTLE_MS);
  }, []);

  const pinAt = useCallback((p: VibePoint) => { setPin(p); settle(p); }, [settle]);

  // Seed a pin at the largest region, so the page opens on a real place.
  useEffect(() => {
    if (!decoded || pin || !regions.length) return;
    const biggest = [...regions].sort((a, b) => b.count - a.count)[0]!;
    setEnergy(biggest.w);
    pinAt({ x: biggest.x, y: biggest.y, z: biggest.z, w: biggest.w });
  }, [decoded, regions, pin, pinAt]);

  useEffect(() => () => { if (settleRef.current) window.clearTimeout(settleRef.current); }, []);

  /** The region nearest the pin, in the map's own display space. */
  const region = useMemo<MapRegion | null>(() => {
    if (!pin || !regions.length) return null;
    let best = regions[0]!, bd = Infinity;
    for (const r of regions) {
      const d = (r.x - pin.x) ** 2 + (r.y - pin.y) ** 2 + (r.z - pin.z) ** 2 + 4 * (r.w - pin.w) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }, [pin, regions]);

  const play = useCallback(() => {
    if (near.length) requestPlay({ trackIds: near.map((t) => t.id), startIndex: 0 });
  }, [near]);

  const unavailableText = data && !data.available
    ? data.held
      ? `The vibe space is held — ${data.reason ?? 'the analysis did not pass its gate'}.`
      : `${data.reason ?? 'The map is not ready'} — ${data.coverage.measured} of ${data.coverage.tracks} tracks analysed so far.`
    : 'The map is not ready yet.';

  const readout = `Energy: ${energyWord(pin?.w ?? energy)} · ${region?.label ?? 'Somewhere'} · ${near.length} tracks`;

  return (
    <section className="view-map">
      <header className="kr-pagehead">
        <h1 className="kr-pagehead-title">Map</h1>
        <p className="kr-pagehead-sub kr-mono">
          {data?.available ? `${(data.total ?? 0).toLocaleString()} tracks placed` : 'Vibe space'}
        </p>
      </header>

      <AsyncView
        loading={loading}
        error={error || (!!data?.available && !decoded)}
        errorText="Could not load the map."
        empty={!loading && !error && !!data && !data.available}
        emptyText={unavailableText}
      >
        {decoded && data?.available && (
          <>
            {gl ? (
              <VibeSpace
                map={decoded}
                regions={regions}
                stops={stops}
                anchor={{ low: data.anchor?.low ?? 'calm', high: data.anchor?.high ?? 'intense' }}
                colour={{ low: data.colour?.low ?? 'dark', high: data.colour?.high ?? 'bright',
                          available: !!data.colour?.available }}
                nowPlayingId={now.trackId ?? null}
                pin={pin}
                onPin={pinAt}
                onEnergy={setEnergy}
                onPlay={play}
                onUnsupported={() => setGl(false)}
              />
            ) : (
              <div className="kr-vs-fallback">
                <p className="kr-mono kr-hint">
                  This browser cannot draw the cloud (it needs WebGL2). Every region is still here to pin.
                </p>
                <ul className="kr-vs-region-list">
                  {[...regions].sort((a, b) => a.w - b.w).map((r) => (
                    <li key={r.id}>
                      <button type="button" className="kr-ghost" onClick={() => pinAt({ x: r.x, y: r.y, z: r.z, w: r.w })}>
                        <span className="kr-map-region-name">{r.label}</span>
                        <span className="kr-mono">{energyWord(r.w)} · {r.count} tracks</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="kr-map-readout kr-glass kr-glass-thin">
              <div>
                <p className="kr-map-region-name">{region?.label ?? 'Somewhere'}</p>
                <p className="kr-mono">
                  {nearBusy ? 'Reading…' : `${energyWord(pin?.w ?? energy)} · ${near.length} tracks near the pin`}
                </p>
              </div>
              <button type="button" className="kr-primary" disabled={!near.length} onClick={play}>
                <IconPlay /> Play from here
              </button>
            </div>
            <p className="kr-vs-sr" aria-live="polite">{nearBusy ? '' : readout}</p>

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

/**
 * widgets/kinds.tsx — the kinds only KourOS draws (its manifest molecules, HostKindsOf).
 *
 * Each is novel code no composition of the vocabulary could be — a WebGL cloud, a canvas
 * of ridgelines — and reads KourOS's engine or the data its node binds. Typed to exactly
 * the molecules the manifest gives KourOS, so a new one is drawn here or tsc says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolve, useWidgetActions, type HostKindComponent, type HostKindsOf, type NodeOf, type Scope } from '@jkos/widget-render';
import { hasWebGL2 } from '@jkos/scene/gl';
import Pulsarmap from '../components/Pulsarmap';
import VibeSpace from '../components/vibespace/VibeSpace';
import { decodeMap, energyWord, type DecodedMap } from '../components/vibespace/geometry';
import { usePlayer } from '../player/PlayerProvider';
import type { MapRegion, VibeMap, VibePoint } from '../api';

/** The pulsarmap reads the engine itself: it positions every FRAME from the media
 *  element's own clock (livePosition), which no slice — data — could carry. */
function PulsarmapKind() {
  const p = usePlayer();
  if (!p.track) return null;
  return <Pulsarmap trackId={p.track.id} position={p.globalPos} livePosition={p.livePosition} playing={p.playing} />;
}

/** The labelled region nearest a point, in the map's own display space. */
function nearestRegion(p: VibePoint, regions: readonly MapRegion[]): MapRegion | null {
  let best: MapRegion | null = null;
  let bd = Infinity;
  for (const r of regions) {
    const d = (r.x - p.x) ** 2 + (r.y - p.y) ** 2 + (r.z - p.z) ** 2 + 4 * (r.w - p.w) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

const isPoint = (v: unknown): v is VibePoint =>
  v != null && typeof v === 'object' && ['x', 'y', 'z', 'w'].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

/**
 * The vibe space (ALGORITHMS.md §9, M6): the cloud, drawn by components/vibespace — or,
 * without WebGL2, every region as a list to pin from (the accessible path through the
 * feature, too). A pin fires `on.pin` with `$pin` — the point, the region nearest it and
 * the energy as a word — so the page keeps it in its own state; with no pin yet, the
 * densest region is pinned on the first draw, so the page opens on a real place.
 */
function VibespaceKind({ node, scope }: { node: NodeOf<'vibespace'>; scope: Scope }) {
  const data = resolve(node.map, scope) as VibeMap | null;
  const rawPin = node.pin != null ? resolve(node.pin, scope) : null;
  const pin = isPoint(rawPin) ? rawPin : null;
  const playing = node.playing != null ? Number(resolve(node.playing, scope)) : NaN;
  const { fire } = useWidgetActions();
  const [gl, setGl] = useState(() => hasWebGL2());

  const decoded = useMemo<DecodedMap | null>(() => {
    if (!data?.available || !data.packed) return null;
    try { return decodeMap(data.packed); } catch (err) {
      console.error(`[kouros map] ${(err as Error).message}`);
      return null;
    }
  }, [data]);
  const regions = useMemo(() => data?.regions ?? [], [data]);

  // The events read the scope they fire in, at the moment they fire.
  const live = useRef({ node, scope, fire, regions });
  live.current = { node, scope, fire, regions };
  const pinAt = useCallback((p: VibePoint) => {
    const { node: n, scope: s, fire: f, regions: rs } = live.current;
    if (!n.on?.pin) return;
    const point = { x: p.x, y: p.y, z: p.z, w: p.w };
    void f(n.on.pin, { ...s, $pin: { ...point, region: nearestRegion(point, rs)?.label ?? 'Somewhere', mood: energyWord(point.w) } });
  }, []);
  const play = useCallback(() => {
    const { node: n, scope: s, fire: f } = live.current;
    if (n.on?.play) void f(n.on.play, s);
  }, []);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !decoded || pin || !regions.length) return;
    seeded.current = true;
    const biggest = [...regions].sort((a, b) => b.count - a.count)[0]!;
    pinAt({ x: biggest.x, y: biggest.y, z: biggest.z, w: biggest.w });
  }, [decoded, pin, regions, pinAt]);

  if (!data?.available) return null;
  if (!decoded) return <p className="kr-mono kr-hint">Could not load the map.</p>;
  // What a screen reader hears when the pin moves (the near list says the rest).
  const said = pin ? `Pinned: ${nearestRegion(pin, regions)?.label ?? 'somewhere'}, ${energyWord(pin.w)}` : '';
  if (gl) {
    return (
      <>
      <p className="kr-vs-sr" aria-live="polite">{said}</p>
      <VibeSpace
        map={decoded}
        regions={regions}
        stops={data.stops ?? [0.1, 0.3, 0.5, 0.7, 0.9]}
        anchor={{ low: data.anchor?.low ?? 'calm', high: data.anchor?.high ?? 'intense' }}
        axes={data.axes ?? []}
        nowPlayingId={Number.isFinite(playing) ? playing : null}
        pin={pin}
        onPin={pinAt}
        onPlay={play}
        onUnsupported={() => setGl(false)}
      />
      </>
    );
  }
  return (
    <div className="kr-vs-fallback">
      <p className="kr-vs-sr" aria-live="polite">{said}</p>
      <p className="kr-mono kr-hint">This browser cannot draw the cloud (it needs WebGL2). Every region is still here to pin.</p>
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
  );
}

export const KINDS: { readonly [K in HostKindsOf['kouros']]: HostKindComponent<K> } = {
  pulsarmap: PulsarmapKind,
  vibespace: VibespaceKind,
};

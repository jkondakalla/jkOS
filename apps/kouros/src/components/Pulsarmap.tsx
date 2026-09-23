import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPulsarmap, type Pulsarmap as PulsarmapData } from '../api';
import RidgeStage from './ridges3d/RidgeStage';
import { hasWebGL2 } from '@jkos/scene/gl';
import {
  decodeMesh, rowPitch, rowPoints, scrollRow, stripBaseline, stripWindow, toRows,
} from './pulsarmap';

/**
 * The pulsarmap (ALGORITHMS.md §9) — a track's mel spectrogram as a stack of
 * ridgelines that FLOWS as the song plays: one line per ~93 ms slice (~10.8 a
 * second), frequency across the line, energy as elevation, each new line arriving IN
 * FRONT of the ones before it. The Joy Division *Unknown Pleasures* form as a
 * visualizer — from the music's own analysis, fetched whole per track, never a
 * spectrum computed in the browser.
 *
 * ⚠️ **A LINE EVERY ~93 ms, NOT EVERY 2 s (Jag, 2026-09-23).** Two-second rows came
 * "every second or two … way too sparse to be anything useful". The mesh is built at
 * 0.093 s now (music/mesh.py), so a kick drum is its own line, and the stack moves
 * continuously: its scroll is `scrollRow(currentTime)`, read from the media element
 * EVERY FRAME through `livePosition` while the track plays.
 *
 * ⚠️ **NEW ROWS ARRIVE IN FRONT.** Each row is an opaque filled path that occludes
 * the rows behind it — painter's algorithm, back to front — which is what makes the
 * stack read as depth.
 *
 * ⚠️ **THE COLOURS COME FROM THE DESIGN FACTORY, READ AT RUNTIME.** A canvas
 * cannot take a CSS custom property, so the tokens are resolved off the element
 * with `getComputedStyle` rather than copied here as hex. That is what keeps this
 * theme-aware for free and stops a fifth palette existing in the suite.
 *
 * All the arithmetic lives in `./pulsarmap.ts`, pure and gated
 * (`pnpm check:pulsarmap`), because every failure mode in it is silent.
 *
 * ⚠️ **3-D FIRST, 2-D AS THE FALLBACK (Jag, 2026-09-16).** With WebGL2 the same mesh
 * is drawn as real geometry by `./ridges3d/RidgeStage`, flowing past a camera that a
 * drag orbits. The Canvas 2D path below draws when WebGL2 is absent or its context
 * cannot be made — the same flow, a window of rows redrawn each frame.
 */

/** Excursion, in px, of a full-scale (255) value above its own row's baseline.
 *  Larger than the pitch on purpose: lines MUST overlap, or there is nothing for
 *  the hidden-line removal to remove and the stack reads as a bar chart. */
const AMPLITUDE = 30;
/** At the legibility floor: at ~10.8 rows a second the strip scrolls ~97 px/s and
 *  holds the last ~1.4 s of music. */
const PITCH = rowPitch(9);
/** Where the newest row sits in the viewport — near the bottom, with just enough
 *  room below for its own excursion. */
const ANCHOR_FRACTION = 0.82;

interface Ready {
  /** The whole mesh, row-major — what the 3-D renderer uploads as one texture. */
  bytes: Uint8Array;
  rows: Uint8Array[];
  count: number;
  bands: number;
  rowSeconds: number;
}

function tokens(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const read = (name: string, fallback: string) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    surface: read('--kr-pulsar-surface', '#11100d'),
    line: read('--kr-pulsar-line', '#efe6c9'),
    far: read('--kr-pulsar-far', '#5e4a26'),
  };
}

/** Interpolate between two hex colours — the row ramp, one step per row.
 *
 *  ⚠️ THE RAMP ENCODES POSITION IN THE TRACK, NOT DEPTH IN THE STACK — as it
 *  always has (it was forced by the old append-only draw, and the 3-D renderer keeps
 *  it and carries depth with fog), so both renderers colour a row the same way.
 *
 *  It is also the right analogue rather than a consolation. `music/ridge.py` ramps
 *  its lines across FREQUENCY because there a line is a band; here a line is a
 *  moment, so the ordinal dimension is time. Depth is carried by the hidden-line
 *  occlusion — which is what carries it in the original *Unknown Pleasures* plate
 *  too, in one ink.
 *
 *  Falls back to `b` for anything that is not a plain hex. The three tokens this
 *  is given resolve to hex on both faces today, and a token that later became a
 *  `color-mix()` should make the ramp flat rather than make every stroke
 *  `rgb(NaN, NaN, NaN)` — which paints nothing at all, silently. */
function mix(a: string, b: string, t: number): string {
  const hex = (h: string): number[] | null => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
    if (!m) return null;
    const full = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const from = hex(a);
  const to = hex(b);
  if (!from || !to) return b;
  const c = (x: number, y: number) => Math.round(x + (y - x) * Math.max(0, Math.min(1, t)));
  return `rgb(${c(from[0], to[0])}, ${c(from[1], to[1])}, ${c(from[2], to[2])})`;
}

export default function Pulsarmap({
  trackId, position, livePosition, playing, className,
}: {
  trackId: number | null;
  /** Seconds into the track, from the player engine — which reads it off the
   *  media element on `timeupdate` (~4 Hz). ⚠️ **NEVER A TIMER.** A `setInterval`
   *  counting seconds desynchronises on buffering, on seek, and on a playback-rate
   *  change, and `@jkos/player` has a rate module, so the last one is real here. */
  position: number;
  /** The same clock read NOW (`@jkos/player`'s `livePosition()`) — what positions
   *  every frame of a playing track, so ~10.8 rows a second flow rather than jump. */
  livePosition?: () => number;
  playing?: boolean;
  className?: string;
}) {
  const [data, setData] = useState<PulsarmapData | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef({ position, livePosition, playing });
  liveRef.current = { position, livePosition, playing };
  // Decided once per mount; a renderer that fails later (no context, a shader the
  // driver refuses) flips this and the 2-D path takes over for good.
  const [use3d, setUse3d] = useState(() => hasWebGL2());
  const frameRef = useRef<number | null>(null);

  // ── The fetch. One request per track, aborted when the track changes ─────────
  useEffect(() => {
    if (trackId == null) { setData(null); return; }
    let live = true;
    setData(null);
    fetchPulsarmap(trackId)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setData({ state: 'failed', track_id: trackId }); });
    // A late response for the PREVIOUS track must not become this track's
    // picture — it would render without complaint and be a spectrogram of the
    // wrong song, which is the whole class of failure this feature is prone to.
    return () => { live = false; };
  }, [trackId]);

  const ready = useMemo<Ready | null>(() => {
    if (!data || data.state !== 'ok' || !data.data || !data.rows || !data.bands) return null;
    try {
      const bytes = decodeMesh(data.data);
      return {
        bytes,
        rows: toRows(bytes, data.rows, data.bands),
        count: data.rows,
        bands: data.bands,
        // ⚠️ FROM THE MESH, never a constant. The builder derives it from the
        // analysis hop (0.09288 s at the baseline, not the 0.1 s target) and the
        // 7 ms difference is a whole row of drift every ~1.4 s.
        rowSeconds: data.row_seconds || 0,
      };
    } catch {
      return null;                     // toRows refuses a wrong-length buffer
    }
  }, [data]);

  // ── The 2-D draw: a window of rows, redrawn each frame while the track plays ──
  useEffect(() => {
    const host = hostRef.current;
    const view = viewRef.current;
    if (use3d || !host || !view || !ready) return;
    const palette = tokens(host);

    function paint() {
      frameRef.current = null;
      if (!view || !ready) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = view.clientWidth || 320;
      const height = view.clientHeight || 136;
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (view.width !== w) view.width = w;
      if (view.height !== h) view.height = h;
      const ctx = view.getContext('2d');
      if (!ctx) return;

      const live = liveRef.current;
      const t = live.livePosition ? live.livePosition() : live.position;
      const scroll = scrollRow(t, ready.rowSeconds, ready.count);
      const anchor = height * ANCHOR_FRACTION;
      const win = stripWindow(scroll, PITCH, anchor);

      // Clear in DEVICE pixels under the identity transform, then scale for the
      // drawing: `clearRect` under the dpr transform would be measuring the
      // canvas's device dimensions in CSS units.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let r = win.from; r < win.to; r++) {
        const baseline = stripBaseline(r, scroll, PITCH, anchor);
        const pts = rowPoints(ready.rows[r], baseline, width, AMPLITUDE);
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        // ⚠️ FILL FIRST, in the surface colour. This is the hidden-line removal:
        // an opaque body under each line is what lets a row occlude the rows
        // behind it, and without it the stack is a transparent tangle rather than
        // a depth cue.
        ctx.lineTo(width, baseline + PITCH);
        ctx.lineTo(0, baseline + PITCH);
        ctx.closePath();
        ctx.fillStyle = palette.surface;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.strokeStyle = mix(palette.far, palette.line, ready.count > 1 ? r / (ready.count - 1) : 1);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // A playing track flows every frame; paused, one frame is the picture.
      if (live.playing && live.livePosition) frameRef.current = requestAnimationFrame(paint);
    }

    // rAF rather than painting inside the React commit: the draw touches a canvas,
    // and doing that in the commit phase interleaves it with layout.
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(paint);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    // ⚠️ `use3d` too: when the 3-D stage gives up, the 2-D canvas mounts with the same
    // mesh, position and track — and on a paused track nothing else would ever
    // re-run this draw, leaving the fallback blank.
  }, [ready, position, playing, trackId, use3d]);

  if (trackId == null) return null;

  // ⚠️ FOUR STATES, REPORTED. 'pending' is the steady state during a fill and is
  // deliberately quiet; 'unavailable' means there is no store at all and must not
  // read as "coming soon".
  if (!data) return <div ref={hostRef} className={`kr-pulsar is-idle${className ? ' ' + className : ''}`} />;
  if (data.state === 'unavailable') return null;
  if (data.state !== 'ok' || !ready) {
    return (
      <div ref={hostRef} className={`kr-pulsar is-idle${className ? ' ' + className : ''}`}>
        <p className="kr-pulsar-note">
          {data.state === 'failed' ? 'No pulsarmap for this track.' : 'Pulsarmap not built yet.'}
        </p>
      </div>
    );
  }

  if (use3d && trackId != null) {
    return (
      <div ref={hostRef} className={`kr-pulsar is-3d${className ? ' ' + className : ''}`}>
        <RidgeStage
          trackId={trackId}
          bytes={ready.bytes}
          rows={ready.count}
          bands={ready.bands}
          rowSeconds={ready.rowSeconds}
          position={position}
          livePosition={livePosition}
          playing={playing}
          onUnsupported={() => setUse3d(false)}
        />
      </div>
    );
  }

  return (
    <div ref={hostRef} className={`kr-pulsar${className ? ' ' + className : ''}`}>
      <canvas
        ref={viewRef}
        className="kr-pulsar-canvas"
        role="img"
        aria-label={`Spectrogram of this track, flowing as it plays — ${ready.count} slices of ` +
                    `${Math.round(ready.rowSeconds * 1000)} ms each`}
      />
    </div>
  );
}

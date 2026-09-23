import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPulsarmap, type Pulsarmap as PulsarmapData } from '../api';
import RidgeStage from './ridges3d/RidgeStage';
import { hasWebGL2 } from '@jkos/scene/gl';
import {
  canvasHeight, decodeMesh, emptyReveal, panOffset, planReveal, rowBaseline,
  rowPitch, rowPoints, toRows, type RevealState,
} from './pulsarmap';

/**
 * The pulsarmap (ALGORITHMS.md §9) — a track's mel spectrogram as a stack of
 * ridgelines that ACCUMULATES as the song plays. One line per ~2 s slice,
 * frequency across the line, energy as elevation, new lines arriving IN FRONT of
 * the ones already drawn. The Joy Division *Unknown Pleasures* form, revealed in
 * time rather than printed at once.
 *
 * ⚠️ **NEW ROWS ARRIVE IN FRONT, AND THAT IS NOT A LOOK.** Each row is an opaque
 * filled path that occludes the rows behind it — painter's algorithm, back to
 * front — which is what makes the stack read as depth. Combined with "in front",
 * it makes the canvas APPEND-ONLY: a reveal is one polyline drawn onto a canvas
 * that never has to be repainted, so the steady-state cost is one path every two
 * seconds rather than a full redraw at 60 Hz. Reverse the direction and a new row
 * has to be drawn BEHIND everything, which means repainting all of it every time.
 *
 * ⚠️ **IT PANS, IT DOES NOT SQUASH.** M2 measured that below ~9 px of row pitch
 * every line's excursion crosses two neighbours and the stack collapses into a
 * uniform hatch — a picture that reads as "the transform is broken" when the
 * transform is fine and the picture is merely too small. A 20-minute track is
 * ~600 rows, which at a legible pitch is 5,471 px and fits nothing. So the whole
 * track is drawn onto an offscreen canvas at a constant pitch and a window of it
 * is blitted, positioned so the newest row sits at a fixed place. Constant reveal
 * rate, constant legibility, the whole map still there to scroll back through.
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
 * is drawn as real geometry by `./ridges3d/RidgeStage` — a camera that follows the
 * playhead and orbits on a drag. The Canvas 2D path below is what draws when WebGL2
 * is absent or its context cannot be made, and it is kept whole rather than
 * approximated: the fallback is the feature as it shipped, not a degraded sketch.
 */

/** Excursion, in px, of a full-scale (255) value above its own row's baseline.
 *  Larger than the pitch on purpose: lines MUST overlap, or there is nothing for
 *  the hidden-line removal to remove and the stack reads as a bar chart. */
const AMPLITUDE = 34;
const PITCH = rowPitch(11);
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
 *  ⚠️ THE RAMP ENCODES POSITION IN THE TRACK, NOT DEPTH IN THE STACK, and that is
 *  forced by the append-only draw: a row is painted ONCE and never repainted, so
 *  its colour cannot depend on how old it has since become. "Recede as newer rows
 *  arrive" would mean repainting the whole stack every two seconds, which is the
 *  one cost this renderer is built to avoid.
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
  trackId, position, className,
}: {
  trackId: number | null;
  /** Seconds into the track, from the player engine — which reads it off the
   *  media element. ⚠️ **NEVER A TIMER.** A `setInterval` counting seconds
   *  desynchronises on buffering, on seek, and on a playback-rate change, and
   *  `@jkos/player` has a rate module, so the last one is real here. */
  position: number;
  className?: string;
}) {
  const [data, setData] = useState<PulsarmapData | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<RevealState>(emptyReveal());
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
        // analysis hop (1.9969 s at the baseline, not the 2.0 s target) and the
        // 3 ms difference is a whole row of drift by minute ten.
        rowSeconds: data.row_seconds || 0,
      };
    } catch {
      return null;                     // toRows refuses a wrong-length buffer
    }
  }, [data]);

  // ── The draw ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    const view = viewRef.current;
    if (!host || !view || !ready) { stateRef.current = emptyReveal(); return; }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = view.clientWidth || 320;
    const height = view.clientHeight || 240;
    const palette = tokens(host);

    // The offscreen canvas is the WHOLE TRACK — it is what makes the reveal
    // append-only. Rebuilt only when the mesh or the width changes.
    let off = offRef.current;
    const fullHeight = canvasHeight(ready.count, PITCH, AMPLITUDE);
    if (!off || off.width !== Math.round(width * dpr) || off.height !== Math.round(fullHeight * dpr)) {
      off = document.createElement('canvas');
      off.width = Math.round(width * dpr);
      off.height = Math.round(fullHeight * dpr);
      offRef.current = off;
      stateRef.current = emptyReveal();      // a resized canvas has painted nothing
    }
    view.width = Math.round(width * dpr);
    view.height = Math.round(height * dpr);

    const octx = off.getContext('2d');
    const vctx = view.getContext('2d');
    if (!octx || !vctx) return;

    function paint() {
      frameRef.current = null;
      const o = offRef.current;
      if (!o || !octx || !vctx || !ready) return;

      const plan = planReveal(stateRef.current, {
        trackId, currentTime: position, rowSeconds: ready.rowSeconds, rows: ready.count,
      });
      stateRef.current = plan.next;

      // Clear in DEVICE pixels under the identity transform, then scale for the
      // drawing: `clearRect` under the dpr transform would be measuring the
      // canvas's device dimensions in CSS units.
      if (plan.clear) {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, o.width, o.height);
      }
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let r = plan.from; r < plan.to; r++) {
        const baseline = rowBaseline(r, PITCH, AMPLITUDE);
        const pts = rowPoints(ready.rows[r], baseline, width, AMPLITUDE);
        octx.beginPath();
        octx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) octx.lineTo(pts[i], pts[i + 1]);
        // ⚠️ FILL FIRST, in the surface colour. This is the hidden-line removal:
        // an opaque body under each line is what lets a row occlude the rows
        // behind it, and without it the stack is a transparent tangle rather than
        // a depth cue.
        octx.lineTo(width, baseline + PITCH);
        octx.lineTo(0, baseline + PITCH);
        octx.closePath();
        octx.fillStyle = palette.surface;
        octx.fill();
        octx.beginPath();
        octx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) octx.lineTo(pts[i], pts[i + 1]);
        octx.strokeStyle = mix(palette.far, palette.line, ready.count > 1 ? r / (ready.count - 1) : 1);
        octx.lineWidth = 1;
        octx.stroke();
      }

      // Blit the window. The newest row sits at a fixed place, so the picture
      // steps up by one pitch every ~2 s rather than rescaling to fit.
      const anchor = height * ANCHOR_FRACTION;
      const offsetY = panOffset(plan.next.painted, ready.count, PITCH, AMPLITUDE, height, anchor);
      vctx.setTransform(1, 0, 0, 1, 0, 0);
      vctx.clearRect(0, 0, view.width, view.height);
      vctx.drawImage(o, 0, Math.round(offsetY * dpr), view.width, view.height,
                     0, 0, view.width, view.height);
    }

    // rAF rather than painting inside the React commit: the draw touches a canvas
    // and a blit, and doing that in the commit phase interleaves it with layout.
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(paint);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    // ⚠️ `use3d` too: when the 3-D stage gives up, the 2-D canvas mounts with the same
    // mesh, position and track — and on a paused track nothing else would ever
    // re-run this draw, leaving the fallback blank.
  }, [ready, position, trackId, use3d]);

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
        aria-label={`Spectrogram of this track, revealed as it plays — ${ready.count} slices of about two seconds`}
      />
    </div>
  );
}

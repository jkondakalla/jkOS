import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX } from '@jkos/ui';
import { prefersReducedMotion, tokenColor } from '@jkos/scene/gl';
import {
  DEG, classifyTap, createRig, cutRig, lockAxis, pickNearest, rigView, screenRay, settle, stepRig, thinLabels,
  toScreen, velocityOf, type RGB, type Sample, type Spring, type Tap,
} from '@jkos/scene/math';
import { useScene } from '@jkos/scene/react';
import {
  CAMERA, LENS, W_OMEGA, frameDistance, glint, indexOfId, labelAlpha, nextStop, pickDensest,
  projectedStop, scrubTo, sliceMix, styleCss, styleLut, voxelOf, type DecodedMap, type Face,
} from './geometry';
import { VibeRenderer, type SliceSource } from './gl';

/**
 * The vibe space (ALGORITHMS.md §9, M6): the library as a volumetric cloud you move
 * through a 4th dimension. Drag UP/DOWN to move through energy — calm → intense — and
 * SIDEWAYS to spin; release and energy settles on a stop; tap to pin a place; double-tap
 * to fly in. Every place has its own colour (geometry.ts `styleColour`): the hue wheel
 * lies in the plane a spin turns, so the colours sweep round as the cloud does, and
 * neighbours — similar-sounding tracks — are always near in colour.
 *
 * ⚠️ **ONE POINTER, ONE ENGINE.** Every gesture here is `usePointerDrag` (check:drag),
 * and a drag LOCKS to an axis after 8 px, so a slightly diagonal scrub never spins.
 *
 * ⚠️ **A SWIPE IS A UNIFORM, NOT A RENDER.** The animation loop lives in refs (@jkos/scene's
 * `useScene`); React renders when the map, the pin or the now-playing track changes,
 * never per frame. Labels and the rail thumb are moved by writing styles on elements the
 * loop holds.
 *
 * ⚠️ **NOTHING HERE IS THE MUSIC.** The idle drift, the springs and the fly-in are
 * presentation. A particle's position, a pin, and every "near" answer come from the
 * server's coordinates and nothing else, and all motion stops under reduced motion.
 */

export interface VibePoint { x: number; y: number; z: number; w: number }

export interface VibeRegionLabel { id: number; label: string; x: number; y: number; z: number; w: number; count: number }

/** What a spatial axis means, from the fit (map.js `axes`); null where no readable
 *  feature explains it. */
export interface VibeAxis { low: string; high: string }

export interface VibeSpaceProps {
  map: DecodedMap;
  regions: VibeRegionLabel[];
  stops: number[];
  anchor: { low: string; high: string };
  /** The x, y and z axes. The colour key names x and z — the two the colour follows. */
  axes: Array<VibeAxis | null>;
  nowPlayingId: number | null;
  pin: VibePoint | null;
  onPin: (p: VibePoint) => void;
  /** The energy the view has SETTLED on — for the readout, not per frame. */
  onEnergy?: (w: number) => void;
  onPlay?: () => void;
  onUnsupported: () => void;
}

const LABEL_POOL = 8;
const IDLE_FPS_MS = 1000 / 30;
/** A tap that hits no glint picks the densest voxel along its ray — but only a voxel at
 *  least this opaque (of 255). Below it the tap was on empty space: nothing is pinned,
 *  and a double-tap there flies OUT. Without the floor every ray through the faintest
 *  haze pinned something and "double-tap empty space" could never happen. */
const PICK_ALPHA_FLOOR = 18;
/** The energy and cloud springs arrive within this; the camera rig uses it too. */
const EPS = 1e-5;

interface Palette { surface: RGB; ringInk: RGB; face: Face; style: Uint8Array }

/** The face's surface and ring, and the place colours. ⚠️ No accent: a place keeps its
 *  colour whatever sleeve is playing (geometry.ts STYLE). */
function readPalette(el: HTMLElement): Palette {
  const face = document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'paper';
  return {
    face,
    surface: tokenColor(el, '--kr-vs-surface', face === 'dark' ? [0.067, 0.063, 0.051] : [0.93, 0.886, 0.784]),
    ringInk: tokenColor(el, '--kr-vs-ring', face === 'dark' ? [0.94, 0.9, 0.79] : [0.11, 0.08, 0.03]),
    style: styleLut(face),
  };
}

/** A key bar: the colour along one axis through the middle, as a CSS gradient. */
function keyRamp(axis: 'x' | 'z', face: Face): string {
  const stops = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1]
    .map((t) => `${axis === 'x' ? styleCss(t, 0, face) : styleCss(0, t, face)} ${((t + 1) * 50).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export default function VibeSpace({
  map, regions, stops, anchor, axes, nowPlayingId, pin, onPin, onEnergy, onPlay, onUnsupported,
}: VibeSpaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<SliceSource | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const [face, setFace] = useState<Face | null>(null);
  const [flown, setFlown] = useState(false);

  // Each region's colour, for the dot its label carries — the name of a colour.
  const dots = useMemo(() => new Map(face ? regions.map((r) => [r.id, styleCss(r.x, r.z, face)]) : []),
                       [regions, face]);

  const live = useRef({ map, regions, dots, stops, pin, nowPlayingId, onPin, onEnergy, onPlay });
  live.current = { map, regions, dots, stops, pin, nowPlayingId, onPin, onEnergy, onPlay };

  // The camera: a free yaw that coasts after a spin, a target and a distance that fly.
  // Pitch never moves. The distance is framed on the first frame, when the aspect is
  // known.
  const rig = useRef(createRig(
    { target: [0, 0, 0], yaw: 0.55, pitch: CAMERA.pitch, distance: 0 },
    {
      omega: { target: CAMERA.omega, yaw: CAMERA.omega, pitch: CAMERA.omega, distance: CAMERA.omega },
      friction: CAMERA.spinFriction, eps: EPS, freeYaw: true,
    },
  )).current;

  const st = useRef({
    w: { x: 0.5, v: 0 } as Spring,
    wGoal: 0.5,
    flown: false,
    cloud: { x: 0, v: 0 } as Spring,
    cloudGoal: 0,
    time: 0,
    lastDraw: 0,
    mode: null as 'spin' | 'scrub' | null,
    startW: 0.5,
    startYaw: 0,
    samples: [] as Sample[],
    tap: null as Tap | null,
    sentW: -1,
    renderScale: 0.5,
    ema: 16,
    scaleCheckedAt: 0,
    first: true,
  });

  const scene = useScene<VibeRenderer>({
    name: 'kouros vibespace',
    attributes: { antialias: false, alpha: false, depth: false, premultipliedAlpha: true },
    create: (gl) => {
      const r = new VibeRenderer(gl);
      r.setPoints(live.current.map);
      if (paletteRef.current) r.setStyle(paletteRef.current.style);
      if (fieldRef.current) r.setField(fieldRef.current);
      return r;
    },
    onTheme: (el) => {
      const p = readPalette(el);
      paletteRef.current = p;
      scene.renderer()?.setStyle(p.style);
      setFace(p.face);
    },
    onUnsupported,
    frame: ({ renderer, canvas, now, dt, reduced, aspect, dpr }) => {
      const palette = paletteRef.current;
      if (!palette) return false;
      const s = st.current;
      const fit = frameDistance(aspect);
      rig.distanceGoal = s.flown ? CAMERA.flyDistance : fit;
      if (s.first) { cutRig(rig, 'distance'); s.first = false; }

      // Energy: the finger owns it while scrubbing; a spring owns it after. Spin: the
      // finger holds the rig's yaw, then a coast or a spring to an aimed yaw.
      if (s.mode !== 'scrub') s.w = settle(s.w, s.wGoal, W_OMEGA, dt, { reduced, eps: EPS });
      rig.held = s.mode === 'spin';
      const camera = stepRig(rig, dt, reduced);
      s.cloud = settle(s.cloud, s.cloudGoal, 5, dt, { reduced, eps: EPS });

      const moving = s.mode != null || camera || s.w.x !== s.wGoal || s.cloud.x !== s.cloudGoal;
      const warp = reduced ? 0 : 1;
      if (!moving && warp && now - s.lastDraw < IDLE_FPS_MS) return true;
      if (warp) s.time = now / 1000;

      // Adapt the volume's render scale to the frame time, never under reduced motion
      // (a fixed scale is what makes a still frame reproducible).
      if (!reduced && moving && dt > 0) {
        s.ema = s.ema * 0.9 + dt * 1000 * 0.1;
        if (now - s.scaleCheckedAt > 1000) {
          s.scaleCheckedAt = now;
          if (s.ema > 22) s.renderScale = Math.max(0.35, s.renderScale - 0.05);
          else if (s.ema < 14) s.renderScale = Math.min(0.6, s.renderScale + 0.05);
        }
      }

      const view = rigView(rig, aspect, LENS);
      const L = live.current;
      const markers: Array<{ xyz: [number, number, number]; w: number }> = [];
      if (L.pin) markers.push({ xyz: [L.pin.x, L.pin.y, L.pin.z], w: L.pin.w });
      const playing = L.nowPlayingId != null ? indexOfId(L.map.ids, L.nowPlayingId) : -1;
      if (playing >= 0) {
        markers.push({ xyz: [L.map.xyz[playing * 3], L.map.xyz[playing * 3 + 1], L.map.xyz[playing * 3 + 2]],
                       w: L.map.w[playing] });
      }
      renderer.draw({
        viewProj: view.viewProj, inverse: view.inverse ?? view.viewProj, w0: s.w.x,
        width: canvas.width, height: canvas.height, dpr,
        renderScale: reduced ? 0.5 : s.renderScale, time: s.time, warp, cloud: s.cloud.x,
        surface: palette.surface, ringInk: palette.ringInk, face: palette.face, markers,
      });
      s.lastDraw = now;

      // Labels: projected, faded through energy, thinned where they would collide.
      const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
      const boxes = [];
      const at = new Map<number, { x: number; y: number; alpha: number; label: string; dot: string }>();
      for (const r of L.regions) {
        const p = toScreen(view.viewProj, [r.x, r.y, r.z], cssW, cssH);
        if (!p) continue;
        const alpha = labelAlpha(r.w - s.w.x);
        at.set(r.id, { x: p.x, y: p.y, alpha, label: r.label, dot: L.dots.get(r.id) ?? '' });
        boxes.push({ id: r.id, x: p.x, y: p.y, width: r.label.length * 6.6 + 16, height: 22, alpha });
      }
      const keep = thinLabels(boxes, LABEL_POOL);
      for (let i = 0; i < LABEL_POOL; i++) {
        const el = labelRefs.current[i];
        if (!el) continue;
        const info = i < keep.length ? at.get(keep[i]) : undefined;
        if (!info) { el.style.opacity = '0'; continue; }
        if (el.textContent !== info.label) el.textContent = info.label;
        if (el.style.getPropertyValue('--vs-dot') !== info.dot) el.style.setProperty('--vs-dot', info.dot);
        el.style.transform = `translate(${info.x.toFixed(1)}px, ${info.y.toFixed(1)}px) translate(-50%, -50%)`;
        el.style.opacity = info.alpha.toFixed(3);
      }
      if (thumbRef.current) thumbRef.current.style.setProperty('--vs-w', s.w.x.toFixed(4));

      if (s.mode == null && s.w.x === s.wGoal && Math.abs(s.w.x - s.sentW) > 1e-4) {
        s.sentW = s.w.x;
        L.onEnergy?.(s.w.x);
      }
      return moving || !!warp;
    },
  });
  const { kick } = scene;

  // ── a new map: re-upload the points, rebuild the field off the main thread ───
  const firstMap = useRef(true);
  useEffect(() => {
    if (!firstMap.current) scene.renderer()?.setPoints(map);
    firstMap.current = false;
    fieldRef.current = null;
    scene.renderer()?.setField(null);
    st.current.cloud = { x: 0, v: 0 };
    st.current.cloudGoal = 0;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./density.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      console.warn(`[kouros vibespace] density worker unavailable: ${(err as Error).message}`);
    }
    if (worker) {
      const token = Date.now();
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.token !== token) return;
        if (msg.error) { console.warn(`[kouros vibespace] density failed: ${msg.error}`); return; }
        const source: SliceSource = { grid: msg.grid, slices: msg.slices, textures: msg.textures };
        fieldRef.current = source;
        scene.renderer()?.setField(source);
        st.current.cloudGoal = 1;
        kick();
      };
      worker.postMessage({ token, map });
    }
    kick();
    return () => worker?.terminate();
  }, [map, kick, scene]);

  useEffect(() => { kick(); }, [pin, nowPlayingId, regions, dots, kick]);

  // The view seeds a pin before anyone has touched the cloud; open the swipe at that
  // pin's energy, so the first readout and the first picture describe the same place.
  // Once a person has moved the rail, a pin never moves it.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !pin) return;
    touched.current = true;
    st.current.w = { x: pin.w, v: 0 };
    st.current.wGoal = pin.w;
    kick();
  }, [pin, kick]);

  // ── picking ─────────────────────────────────────────────────────────────────
  const pickAt = useCallback((x: number, y: number): VibePoint | null => {
    const canvas = scene.canvasRef.current;
    if (!canvas) return null;
    const s = st.current;
    const { map: m } = live.current;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const view = rigView(rig, canvas.width / Math.max(1, canvas.height), LENS);
    const screen = new Float32Array(m.n * 2).fill(NaN);
    const glints = new Float32Array(m.n);
    for (let i = 0; i < m.n; i++) {
      const g = glint(m.w[i] - s.w.x);
      if (g < 0.5) continue;
      const p = toScreen(view.viewProj, [m.xyz[i * 3], m.xyz[i * 3 + 1], m.xyz[i * 3 + 2]], W, H);
      if (!p) continue;
      screen[i * 2] = p.x; screen[i * 2 + 1] = p.y; glints[i] = g;
    }
    const idx = pickNearest(screen, glints, x, y);
    if (idx >= 0) return { x: m.xyz[idx * 3], y: m.xyz[idx * 3 + 1], z: m.xyz[idx * 3 + 2], w: m.w[idx] };
    const field = fieldRef.current;
    if (!field || !view.inverse) return null;
    const { origin, dir } = screenRay(view.inverse, x, y, W, H);
    const { lo, hi, f } = sliceMix(s.w.x, field.slices);
    const p = pickDensest(origin, dir, (q) => {
      const v = voxelOf(q, field.grid);
      const a = field.textures[lo][v] * (1 - f) + field.textures[hi][v] * f;
      return a >= PICK_ALPHA_FLOOR ? a : 0;
    });
    return p && field ? { x: p[0], y: p[1], z: p[2], w: s.w.x } : null;
  }, [rig, scene]);

  const flyTo = useCallback((p: VibePoint | null) => {
    const s = st.current;
    if (p) { rig.targetGoal = [p.x, p.y, p.z]; s.flown = true; } else { rig.targetGoal = [0, 0, 0]; s.flown = false; }
    setFlown(!!p);
    kick();
  }, [rig, kick]);

  // ── gestures ────────────────────────────────────────────────────────────────
  const drag = usePointerDrag();
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    touched.current = true;
    const s = st.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const height = rect.height;
    rig.yaw = { x: rig.yaw.x, v: 0 };
    rig.yawGoal = null;
    drag.begin(e, {
      activation: { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onMove: (ctx) => {
        if (s.mode == null) {
          const axis = lockAxis(ctx.dx, ctx.dy);
          if (!axis) return;
          // Sideways SPINS the cloud; up/down SCRUBS energy.
          s.mode = axis === 'x' ? 'spin' : 'scrub';
          s.startW = s.w.x;
          s.startYaw = rig.yaw.x;
          s.samples = [];
        }
        const t = performance.now();
        if (s.mode === 'scrub') {
          s.w = { x: scrubTo(s.startW, ctx.dy, height), v: 0 };
          s.wGoal = s.w.x;
          s.samples.push({ t, v: s.w.x });
        } else {
          rig.yaw = { x: s.startYaw - ctx.dx * CAMERA.spinPerPx, v: 0 };
          s.samples.push({ t, v: rig.yaw.x });
        }
        if (s.samples.length > 32) s.samples.splice(0, s.samples.length - 32);
        kick();
      },
      onEnd: (ctx, activated) => {
        const reduced = prefersReducedMotion();
        if (!activated || s.mode == null) {
          s.mode = null;
          const x = ctx.x - rect.left, y = ctx.y - rect.top;
          const picked = pickAt(x, y);
          const { double, last } = classifyTap(s.tap, { t: performance.now(), x, y });
          s.tap = last;
          if (picked) live.current.onPin(picked);
          if (double) flyTo(picked);
          kick();
          return;
        }
        const v = velocityOf(s.samples);
        if (s.mode === 'scrub') {
          s.wGoal = reduced ? projectedStop(s.w.x, 0, live.current.stops) : projectedStop(s.w.x, v, live.current.stops);
          s.w = { x: s.w.x, v: reduced ? 0 : v };
        } else {
          rig.yaw = { x: rig.yaw.x, v: reduced ? 0 : v };
        }
        s.mode = null;
        kick();
      },
      onCancel: () => { s.mode = null; kick(); },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    touched.current = true;
    const s = st.current;
    const L = live.current;
    const aim = (by: number) => {
      rig.yaw = { x: rig.yaw.x, v: 0 };
      rig.yawGoal = (rig.yawGoal ?? rig.yaw.x) + by;
    };
    switch (e.key) {
      case 'ArrowUp': s.wGoal = nextStop(s.wGoal, L.stops, 1); break;
      case 'ArrowDown': s.wGoal = nextStop(s.wGoal, L.stops, -1); break;
      case 'ArrowLeft': aim(15 * DEG); break;
      case 'ArrowRight': aim(-15 * DEG); break;
      case '+': case '=': flyTo(L.pin ?? { x: 0, y: 0, z: 0, w: s.w.x }); break;
      case '-': case '_': flyTo(null); break;
      case 'Enter': L.onPlay?.(); break;
      default: return;
    }
    e.preventDefault();
    kick();
  };

  const playingIndex = useMemo(() => (nowPlayingId != null ? indexOfId(map.ids, nowPlayingId) : -1), [map, nowPlayingId]);

  const findPlaying = () => {
    if (playingIndex < 0) return;
    const s = st.current;
    const i = playingIndex;
    const p = { x: map.xyz[i * 3], y: map.xyz[i * 3 + 1], z: map.xyz[i * 3 + 2], w: map.w[i] };
    s.wGoal = p.w;
    rig.yaw = { x: rig.yaw.x, v: 0 };
    rig.yawGoal = Math.atan2(p.x, p.z);
    onPin(p);
    kick();
  };

  return (
    <div
      ref={hostRef}
      className="kr-vs"
      tabIndex={0}
      role="application"
      aria-roledescription="vibe space"
      aria-label={`The library as a cloud. Drag up for more ${anchor.high}, down for more ${anchor.low}; ` +
                  'drag sideways to spin; tap to pin a place; double-tap to fly in. Arrow keys step energy ' +
                  'and spin, plus and minus fly in and out, and Enter plays from the pin.'}
      onKeyDown={onKeyDown}
    >
      <canvas ref={scene.canvasRef} className="kr-vs-canvas" onPointerDown={onPointerDown} />
      <div className="kr-vs-labels" aria-hidden="true">
        {Array.from({ length: LABEL_POOL }, (_, i) => (
          <span key={i} ref={(el) => { labelRefs.current[i] = el; }} className="kr-vs-label" style={{ opacity: 0 }} />
        ))}
      </div>
      <div className="kr-vs-rail" aria-hidden="true">
        <span className="kr-vs-rail-cap">{anchor.high}</span>
        <span className="kr-vs-rail-track">
          {stops.map((w) => <span key={w} className="kr-vs-rail-stop" style={{ ['--vs-at' as string]: String(w) }} />)}
          {playingIndex >= 0 && (
            <span className="kr-vs-rail-playing" style={{ ['--vs-at' as string]: String(map.w[playingIndex]) }} />
          )}
          <span ref={thumbRef} className="kr-vs-rail-thumb" />
        </span>
        <span className="kr-vs-rail-cap">{anchor.low}</span>
      </div>
      {face && (axes[0] || axes[2]) && (
        <div className="kr-vs-legend" aria-hidden="true">
          {([['x', axes[0]], ['z', axes[2]]] as const).map(([axis, a]) => a && (
            <span key={axis} className="kr-vs-legend-row">
              <span>{a.low}</span>
              <span className="kr-vs-legend-ramp" style={{ backgroundImage: keyRamp(axis, face) }} />
              <span>{a.high}</span>
            </span>
          ))}
        </div>
      )}
      <div className="kr-vs-chips">
        {playingIndex >= 0 && (
          <button type="button" className="kr-vs-chip" onClick={findPlaying}>Find now playing</button>
        )}
        {flown && (
          <button type="button" className="kr-vs-chip" onClick={() => flyTo(null)}>Back out</button>
        )}
      </div>
    </div>
  );
}

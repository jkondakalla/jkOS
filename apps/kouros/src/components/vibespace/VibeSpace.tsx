import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX } from '@jkos/ui';
import {
  devicePixelRatioCapped, prefersReducedMotion, sizeCanvas, tokenColor, watchContext,
  watchVisibility, type RGB,
} from '../webgl/context';
import {
  DEG, angleDelta, clamp, screenRay, springSettled, springStep, toScreen, type Spring, type Vec3,
} from '../webgl/motion';
import {
  CAMERA, W_OMEGA, brightnessRamp, classifyTap, coast, fitDistance, glint, indexOfId, labelAlpha,
  lockAxis, nextStop, pickDensest, pickParticle, projectedStop, scrubTo, sliceMix, spaceView,
  thinLabels, velocityOf, voxelOf, type DecodedMap, type Sample, type Tap,
} from './geometry';
import { VibeRenderer, type SliceSource } from './gl';

/**
 * The vibe space (ALGORITHMS.md §9, M6): the library as a volumetric cloud you move
 * through a 4th dimension. Drag UP/DOWN to move through energy — calm → intense — and
 * SIDEWAYS to spin; release and energy settles on a stop; tap to pin a place; double-tap
 * to fly in.
 *
 * ⚠️ **ONE POINTER, ONE ENGINE.** Every gesture here is `usePointerDrag` (check:drag),
 * and a drag LOCKS to an axis after 8 px, so a slightly diagonal scrub never spins.
 *
 * ⚠️ **A SWIPE IS A UNIFORM, NOT A RENDER.** The animation loop lives in refs; React
 * renders when the map, the pin or the now-playing track changes, never per frame.
 * Labels and the rail thumb are moved by writing styles on elements the loop holds.
 *
 * ⚠️ **NOTHING HERE IS THE MUSIC.** The idle drift, the springs and the fly-in are
 * presentation. A particle's position, a pin, and every "near" answer come from the
 * server's coordinates and nothing else, and all motion stops under reduced motion.
 */

export interface VibePoint { x: number; y: number; z: number; w: number }

export interface VibeRegionLabel { id: number; label: string; x: number; y: number; z: number; w: number; count: number }

export interface VibeSpaceProps {
  map: DecodedMap;
  regions: VibeRegionLabel[];
  stops: number[];
  anchor: { low: string; high: string };
  colour: { low: string; high: string; available: boolean };
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

interface Palette { surface: RGB; ringInk: RGB; face: 'dark' | 'paper'; ramp: Uint8Array }

function readPalette(el: HTMLElement): Palette {
  const face = document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'paper';
  const accent = tokenColor(el, '--accent', [1, 0.69, 0]);
  return {
    face,
    surface: tokenColor(el, '--kr-vs-surface', face === 'dark' ? [0.067, 0.063, 0.051] : [0.93, 0.886, 0.784]),
    ringInk: tokenColor(el, '--kr-vs-ring', face === 'dark' ? [0.94, 0.9, 0.79] : [0.11, 0.08, 0.03]),
    ramp: brightnessRamp(accent, face),
  };
}

export default function VibeSpace({
  map, regions, stops, anchor, colour, nowPlayingId, pin, onPin, onEnergy, onPlay, onUnsupported,
}: VibeSpaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<VibeRenderer | null>(null);
  const fieldRef = useRef<SliceSource | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const frameRef = useRef<number | null>(null);
  const visibleRef = useRef(true);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const [legend, setLegend] = useState<string>('');
  const [flown, setFlown] = useState(false);

  const live = useRef({ map, regions, stops, pin, nowPlayingId, onPin, onEnergy, onPlay });
  live.current = { map, regions, stops, pin, nowPlayingId, onPin, onEnergy, onPlay };

  const st = useRef({
    w: { x: 0.5, v: 0 } as Spring,
    wGoal: 0.5,
    yaw: 0.55,
    vyaw: 0,
    yawGoal: null as number | null,
    tx: { x: 0, v: 0 } as Spring, ty: { x: 0, v: 0 } as Spring, tz: { x: 0, v: 0 } as Spring,
    goal: [0, 0, 0] as Vec3,
    dist: { x: 0, v: 0 } as Spring,
    flown: false,
    cloud: { x: 0, v: 0 } as Spring,
    cloudGoal: 0,
    time: 0,
    last: null as number | null,
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

  const frame = useCallback((now: number) => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    const palette = paletteRef.current;
    if (!canvas || !renderer || !palette || !visibleRef.current) { st.current.last = null; return; }
    const s = st.current;
    const reduced = prefersReducedMotion();
    const dt = s.last == null ? 0 : clamp((now - s.last) / 1000, 0, 0.1);
    s.last = now;
    sizeCanvas(canvas);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const fit = fitDistance(aspect);
    if (s.first) { s.dist = { x: fit, v: 0 }; s.first = false; }

    const settle = (sp: Spring, to: number, omega: number): Spring => {
      if (reduced) return { x: to, v: 0 };
      const next = springStep(sp, to, omega, dt);
      return springSettled(next, to, 1e-5) ? { x: to, v: 0 } : next;
    };

    // Energy: the finger owns it while scrubbing; a spring owns it after.
    if (s.mode !== 'scrub') s.w = settle(s.w, s.wGoal, W_OMEGA);
    // Spin: the finger, a coast, or a spring to an aimed yaw.
    let spinning = false;
    if (s.mode !== 'spin') {
      if (s.yawGoal != null) {
        const d = angleDelta(s.yaw, s.yawGoal);
        const sp = settle({ x: -d, v: s.vyaw }, 0, CAMERA.omega);
        s.yaw = s.yawGoal + sp.x;
        s.vyaw = sp.v;
        if (sp.x === 0 && sp.v === 0) { s.yaw = s.yawGoal; s.yawGoal = null; } else spinning = true;
      } else if (!reduced && Math.abs(s.vyaw) > 1e-3) {
        s.yaw += s.vyaw * dt;
        s.vyaw = coast(s.vyaw, CAMERA.spinFriction, dt);
        spinning = true;
      } else {
        s.vyaw = 0;
      }
    }
    s.tx = settle(s.tx, s.goal[0], CAMERA.omega);
    s.ty = settle(s.ty, s.goal[1], CAMERA.omega);
    s.tz = settle(s.tz, s.goal[2], CAMERA.omega);
    s.dist = settle(s.dist, s.flown ? CAMERA.flyDistance : fit, CAMERA.omega);
    s.cloud = settle(s.cloud, s.cloudGoal, 5);

    const moving = s.mode != null || spinning
      || s.w.x !== s.wGoal || s.tx.x !== s.goal[0] || s.ty.x !== s.goal[1] || s.tz.x !== s.goal[2]
      || s.dist.x !== (s.flown ? CAMERA.flyDistance : fit) || s.cloud.x !== s.cloudGoal;
    const warp = reduced ? 0 : 1;
    if (!moving && warp && now - s.lastDraw < IDLE_FPS_MS) {
      frameRef.current = requestAnimationFrame(frame);
      return;
    }
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

    const target: Vec3 = [s.tx.x, s.ty.x, s.tz.x];
    const view = spaceView(s.yaw, target, s.dist.x, aspect);
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
      width: canvas.width, height: canvas.height, dpr: devicePixelRatioCapped(),
      renderScale: reduced ? 0.5 : s.renderScale, time: s.time, warp, cloud: s.cloud.x,
      surface: palette.surface, ringInk: palette.ringInk, face: palette.face, markers,
    });
    s.lastDraw = now;

    // Labels: projected, faded through energy, thinned where they would collide.
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const boxes = [];
    const at = new Map<number, { x: number; y: number; alpha: number; label: string }>();
    for (const r of L.regions) {
      const p = toScreen(view.viewProj, [r.x, r.y, r.z], cssW, cssH);
      if (!p) continue;
      const alpha = labelAlpha(r.w - s.w.x);
      at.set(r.id, { x: p.x, y: p.y, alpha, label: r.label });
      boxes.push({ id: r.id, x: p.x, y: p.y, width: r.label.length * 6.6 + 16, height: 22, alpha });
    }
    const keep = thinLabels(boxes, LABEL_POOL);
    for (let i = 0; i < LABEL_POOL; i++) {
      const el = labelRefs.current[i];
      if (!el) continue;
      const info = i < keep.length ? at.get(keep[i]) : undefined;
      if (!info) { el.style.opacity = '0'; continue; }
      if (el.textContent !== info.label) el.textContent = info.label;
      el.style.transform = `translate(${info.x.toFixed(1)}px, ${info.y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.opacity = info.alpha.toFixed(3);
    }
    if (thumbRef.current) thumbRef.current.style.setProperty('--vs-w', s.w.x.toFixed(4));

    if (s.mode == null && s.w.x === s.wGoal && Math.abs(s.w.x - s.sentW) > 1e-4) {
      s.sentW = s.w.x;
      L.onEnergy?.(s.w.x);
    }
    if (moving || warp) frameRef.current = requestAnimationFrame(frame);
    else s.last = null;
  }, []);

  const kick = useCallback(() => {
    if (frameRef.current == null && visibleRef.current) frameRef.current = requestAnimationFrame(frame);
  }, [frame]);

  // ── the context, the points, the palette ────────────────────────────────────
  const build = useCallback((): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, premultipliedAlpha: true });
    if (!gl) return false;
    try {
      const r = new VibeRenderer(gl);
      r.setPoints(live.current.map);
      if (paletteRef.current) r.setRamp(paletteRef.current.ramp);
      if (fieldRef.current) r.setField(fieldRef.current);
      rendererRef.current = r;
      return true;
    } catch (err) {
      console.warn(`[kouros vibespace] renderer unavailable: ${(err as Error).message}`);
      return false;
    }
  }, []);

  const repaint = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const p = readPalette(el);
    paletteRef.current = p;
    rendererRef.current?.setRamp(p.ramp);
    const stop = (t: number) => {
      const i = Math.round(t * 255) * 3;
      return `rgb(${p.ramp[i]}, ${p.ramp[i + 1]}, ${p.ramp[i + 2]})`;
    };
    setLegend(`linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(stop).join(', ')})`);
    kick();
  }, [kick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paletteRef.current = readPalette(canvas);
    if (!build()) { onUnsupported(); return; }
    repaint();
    const unwatch = watchContext(canvas, () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      rendererRef.current = null;
    }, () => { if (build()) kick(); else onUnsupported(); });
    const unvisible = watchVisibility(canvas, (v) => { visibleRef.current = v; if (v) kick(); });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => kick()) : null;
    ro?.observe(canvas);
    const mo = new MutationObserver(() => repaint());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'class', 'style'] });
    return () => {
      unwatch(); unvisible(); ro?.disconnect(); mo.disconnect();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── a new map: re-upload the points, rebuild the field off the main thread ───
  const firstMap = useRef(true);
  useEffect(() => {
    if (!firstMap.current) rendererRef.current?.setPoints(map);
    firstMap.current = false;
    fieldRef.current = null;
    rendererRef.current?.setField(null);
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
        rendererRef.current?.setField(source);
        st.current.cloudGoal = 1;
        kick();
      };
      worker.postMessage({ token, map });
    }
    kick();
    return () => worker?.terminate();
  }, [map, kick]);

  useEffect(() => { kick(); }, [pin, nowPlayingId, regions, kick]);

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
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const s = st.current;
    const { map: m } = live.current;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const view = spaceView(s.yaw, [s.tx.x, s.ty.x, s.tz.x], s.dist.x, canvas.width / Math.max(1, canvas.height));
    const screen = new Float32Array(m.n * 2).fill(NaN);
    const glints = new Float32Array(m.n);
    for (let i = 0; i < m.n; i++) {
      const g = glint(m.w[i] - s.w.x);
      if (g < 0.5) continue;
      const p = toScreen(view.viewProj, [m.xyz[i * 3], m.xyz[i * 3 + 1], m.xyz[i * 3 + 2]], W, H);
      if (!p) continue;
      screen[i * 2] = p.x; screen[i * 2 + 1] = p.y; glints[i] = g;
    }
    const idx = pickParticle(screen, glints, x, y);
    if (idx >= 0) return { x: m.xyz[idx * 3], y: m.xyz[idx * 3 + 1], z: m.xyz[idx * 3 + 2], w: m.w[idx] };
    const field = fieldRef.current;
    if (!field || !view.inverse) return null;
    const { origin, dir } = screenRay(view.inverse, x, y, W, H);
    const { lo, hi, f } = sliceMix(s.w.x, field.slices);
    const p = pickDensest(origin, dir, (q) => {
      const v = voxelOf(q, field.grid) * 2;
      const a = field.textures[lo][v] * (1 - f) + field.textures[hi][v] * f;
      return a >= PICK_ALPHA_FLOOR ? a : 0;
    });
    return p && field ? { x: p[0], y: p[1], z: p[2], w: s.w.x } : null;
  }, []);

  const flyTo = useCallback((p: VibePoint | null) => {
    const s = st.current;
    if (p) { s.goal = [p.x, p.y, p.z]; s.flown = true; } else { s.goal = [0, 0, 0]; s.flown = false; }
    setFlown(!!p);
    kick();
  }, [kick]);

  // ── gestures ────────────────────────────────────────────────────────────────
  const drag = usePointerDrag();
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    touched.current = true;
    const s = st.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const height = rect.height;
    s.vyaw = 0;
    s.yawGoal = null;
    drag.begin(e, {
      activation: { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onMove: (ctx) => {
        if (s.mode == null) {
          const lock = lockAxis(ctx.dx, ctx.dy);
          if (!lock) return;
          s.mode = lock;
          s.startW = s.w.x;
          s.startYaw = s.yaw;
          s.samples = [];
        }
        const t = performance.now();
        if (s.mode === 'scrub') {
          s.w = { x: scrubTo(s.startW, ctx.dy, height), v: 0 };
          s.wGoal = s.w.x;
          s.samples.push({ t, v: s.w.x });
        } else {
          s.yaw = s.startYaw - ctx.dx * CAMERA.spinPerPx;
          s.samples.push({ t, v: s.yaw });
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
          s.vyaw = reduced ? 0 : v;
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
    switch (e.key) {
      case 'ArrowUp': s.wGoal = nextStop(s.wGoal, L.stops, 1); break;
      case 'ArrowDown': s.wGoal = nextStop(s.wGoal, L.stops, -1); break;
      case 'ArrowLeft': s.vyaw = 0; s.yawGoal = (s.yawGoal ?? s.yaw) + 15 * DEG; break;
      case 'ArrowRight': s.vyaw = 0; s.yawGoal = (s.yawGoal ?? s.yaw) - 15 * DEG; break;
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
    s.vyaw = 0;
    s.yawGoal = Math.atan2(p.x, p.z);
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
      <canvas ref={canvasRef} className="kr-vs-canvas" onPointerDown={onPointerDown} />
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
      {colour.available && (
        <div className="kr-vs-legend" aria-hidden="true">
          <span>{colour.low}</span>
          <span className="kr-vs-legend-ramp" style={{ background: legend }} />
          <span>{colour.high}</span>
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

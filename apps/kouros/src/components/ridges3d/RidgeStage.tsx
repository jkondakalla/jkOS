import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX } from '@jkos/ui';
import {
  devicePixelRatioCapped, prefersReducedMotion, sizeCanvas, tokenColor, watchContext,
  watchVisibility,
} from '../webgl/context';
import {
  DEG, clamp, lookAt, multiply, orbitEye, perspective, springSettled, springStep, type Spring,
} from '../webgl/motion';
import { RidgeRenderer, type RidgeColors } from './gl';
import {
  FOLLOW_DISTANCE, FOLLOW_OMEGA, FOLLOW_PITCH, FOV, LOOK_BEHIND, MAX_PITCH, MAX_YAW, MIN_PITCH,
  RETURN_OMEGA, TARGET_Y, followPose, orbitFromDrag, shouldCut, visibleWindow,
} from './stage';

/**
 * The pulsarmap in 3-D (ALGORITHMS.md §9, TODO.md §2): the same ridgelines, stood up
 * in space, with a camera that FOLLOWS THE PLAYHEAD — the newest row rises in front
 * and glides the stack back — and that a drag orbits and a release springs home.
 *
 * ⚠️ **THE REVEAL IS STILL `currentTime`, NEVER A TIMER.** `position` is the media
 * element's own time, published by the player. The only clock in this file is
 * rAF's, and it drives the CAMERA's springs — presentation, never which rows exist.
 * A paused track does not move `position`, so nothing new is revealed and, once the
 * springs settle, no frame is drawn at all.
 *
 * ⚠️ **IT OWNS ITS POINTER.** `data-owns-pointer` tells Now Playing's rune layer that
 * a stroke starting here is an orbit, not a transport gesture — the same guard the
 * scrubber relies on, for the same reason: two engines armed on one pointer fight
 * over one drag, and the symptom looks like a bug in whichever one loses.
 *
 * All geometry and camera math is in `./stage.ts`, pure and gated.
 */

const COLOR_FALLBACK: RidgeColors = {
  surface: [0.067, 0.063, 0.051],
  line: [0.937, 0.902, 0.788],
  far: [0.369, 0.29, 0.149],
};

export interface RidgeStageProps {
  trackId: number;
  bytes: Uint8Array;
  rows: number;
  bands: number;
  /** From the mesh, never a constant — see pulsarmap.ts `revealIndex`. */
  rowSeconds: number;
  position: number;
  /** WebGL2 is not available, or the context could not be made: draw in 2-D. */
  onUnsupported: () => void;
}

export default function RidgeStage({
  trackId, bytes, rows, bands, rowSeconds, position, onUnsupported,
}: RidgeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const rendererRef = useRef<RidgeRenderer | null>(null);
  const colorsRef = useRef<RidgeColors>(COLOR_FALLBACK);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const visibleRef = useRef(true);

  // What the loop reads — refs, so a new position is one assignment, not a re-render
  // of anything but this component's props.
  const liveRef = useRef({ position, rowSeconds, rows, trackId });
  liveRef.current = { position, rowSeconds, rows, trackId };

  const cam = useRef({
    focus: null as Spring | null,
    yaw: { x: 0, v: 0 } as Spring,
    pitch: { x: FOLLOW_PITCH, v: 0 } as Spring,
    dragging: false,
    held: false,                          // orbited from the keyboard: stays until Escape
    dragStart: { yaw: 0, pitch: FOLLOW_PITCH },
  });

  const frame = useCallback((now: number) => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !visibleRef.current) { lastRef.current = null; return; }
    const dt = lastRef.current == null ? 0 : clamp((now - lastRef.current) / 1000, 0, 0.1);
    lastRef.current = now;
    sizeCanvas(canvas);

    const live = liveRef.current;
    const c = cam.current;
    const reduced = prefersReducedMotion();
    const win = visibleWindow(live.position, live.rowSeconds, live.rows);
    const pose = followPose(win);

    // ⚠️ A SETTLED SPRING IS SNAPPED ONTO ITS TARGET, not left 1e-4 short of it. The
    // residue is sub-pixel but it moves antialiased edges, so a view that came to
    // rest after an orbit differed from the same view drawn directly by ~460 px —
    // and a resting picture that depends on how it got there cannot be verified.
    const settle = (s: Spring, to: number, omega: number): Spring => {
      const next = springStep(s, to, omega, dt);
      return springSettled(next, to) ? { x: to, v: 0 } : next;
    };
    if (!c.focus || reduced || shouldCut(c.focus.x, pose.focusZ)) c.focus = { x: pose.focusZ, v: 0 };
    else c.focus = settle(c.focus, pose.focusZ, FOLLOW_OMEGA);
    if (!c.dragging && !c.held) {
      if (reduced) {
        c.yaw = { x: 0, v: 0 };
        c.pitch = { x: FOLLOW_PITCH, v: 0 };
      } else {
        c.yaw = settle(c.yaw, 0, RETURN_OMEGA);
        c.pitch = settle(c.pitch, FOLLOW_PITCH, RETURN_OMEGA);
      }
    }

    const target: [number, number, number] = [0, TARGET_Y, c.focus.x - LOOK_BEHIND];
    const eye = orbitEye(target, c.yaw.x, c.pitch.x, FOLLOW_DISTANCE);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const viewProj = multiply(perspective(FOV, aspect, 0.05, 30), lookAt(eye, target, [0, 1, 0]));
    renderer.draw({ viewProj, window: win, focusZ: c.focus.x, width: canvas.width, height: canvas.height,
                    dpr: devicePixelRatioCapped() }, colorsRef.current);

    const settled = c.focus.x === pose.focusZ
      && (c.dragging || c.held || (c.yaw.x === 0 && c.pitch.x === FOLLOW_PITCH));
    if (!settled) frameRef.current = requestAnimationFrame(frame);
    else lastRef.current = null;
  }, []);

  const kick = useCallback(() => {
    if (frameRef.current == null && visibleRef.current) frameRef.current = requestAnimationFrame(frame);
  }, [frame]);

  const readColors = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    colorsRef.current = {
      surface: tokenColor(el, '--kr-pulsar-surface', COLOR_FALLBACK.surface),
      line: tokenColor(el, '--kr-pulsar-line', COLOR_FALLBACK.line),
      far: tokenColor(el, '--kr-pulsar-far', COLOR_FALLBACK.far),
    };
  }, []);

  // ── The context: made once, remade after a loss ───────────────────────────────
  const meshRef = useRef({ bytes, rows, bands });
  meshRef.current = { bytes, rows, bands };

  const build = useCallback((): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true,
                                             powerPreference: 'low-power' });
    if (!gl) return false;
    glRef.current = gl;
    try {
      rendererRef.current = new RidgeRenderer(gl);
      const m = meshRef.current;
      rendererRef.current.setMesh(m.bytes, m.rows, m.bands);
    } catch (err) {
      console.warn(`[kouros pulsarmap] 3-D renderer unavailable: ${(err as Error).message}`);
      rendererRef.current = null;
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    readColors();
    if (!build()) { onUnsupported(); return; }
    kick();

    const unwatchContext = watchContext(canvas, () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      rendererRef.current = null;
    }, () => {
      if (build()) kick(); else onUnsupported();
    });
    const unwatchVisible = watchVisibility(canvas, (visible) => {
      visibleRef.current = visible;
      if (visible) kick();
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => kick()) : null;
    ro?.observe(canvas);
    // A face change (paper ↔ tube, or a sleeve accent) re-resolves the tokens.
    const mo = new MutationObserver(() => { readColors(); kick(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-mode', 'data-theme', 'style'] });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => { readColors(); kick(); };
    scheme?.addEventListener?.('change', onScheme);

    return () => {
      unwatchContext();
      unwatchVisible();
      ro?.disconnect();
      mo.disconnect();
      scheme?.removeEventListener?.('change', onScheme);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // Mount-only: the mesh and the position arrive through refs and the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── A new track: one texture upload, and the camera CUTS to it ────────────────
  const firstMesh = useRef(true);
  useEffect(() => {
    if (firstMesh.current) { firstMesh.current = false; return; }
    const renderer = rendererRef.current;
    if (!renderer) return;
    try {
      renderer.setMesh(bytes, rows, bands);
    } catch (err) {
      console.warn(`[kouros pulsarmap] mesh refused: ${(err as Error).message}`);
    }
    cam.current.focus = null;
    kick();
  }, [bytes, rows, bands, kick]);

  // ── Time moved (or paused, which moves nothing and draws nothing) ────────────
  useEffect(() => { kick(); }, [position, rowSeconds, trackId, kick]);

  // ── Orbit ─────────────────────────────────────────────────────────────────────
  const drag = usePointerDrag();
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.begin(e, {
      activation: { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onActivate: () => {
        const c = cam.current;
        c.dragging = true;
        c.held = false;
        c.dragStart = { yaw: c.yaw.x, pitch: c.pitch.x };
        kick();
      },
      onMove: (ctx) => {
        const c = cam.current;
        const o = orbitFromDrag(c.dragStart, ctx.dx, ctx.dy);
        c.yaw = { x: o.yaw, v: 0 };
        c.pitch = { x: o.pitch, v: 0 };
        kick();
      },
      onEnd: () => { cam.current.dragging = false; kick(); },
      onCancel: () => { cam.current.dragging = false; kick(); },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const c = cam.current;
    const step = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key];
    if (step) {
      e.preventDefault();
      c.held = true;
      c.yaw = { x: clamp(c.yaw.x + step[0] * DEG, -MAX_YAW, MAX_YAW), v: 0 };
      c.pitch = { x: clamp(c.pitch.x + step[1] * DEG, MIN_PITCH, MAX_PITCH), v: 0 };
      kick();
    } else if (e.key === 'Escape' && c.held) {
      e.preventDefault();
      c.held = false;
      kick();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="kr-pulsar-canvas kr-pulsar-3d"
      data-owns-pointer=""
      tabIndex={0}
      role="application"
      aria-roledescription="3-D spectrogram"
      aria-label={`Spectrogram of this track, revealed as it plays — ${rows} slices of about two seconds. ` +
                  'Drag, or use the arrow keys, to look around; Escape returns to following the music.'}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

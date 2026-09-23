import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  claimCanvas, devicePixelRatioCapped, prefersReducedMotion, releaseContextSoon, sizeCanvas, watchContext,
  watchVisibility,
} from '../gl/context';

/**
 * useScene — the life of one WebGL2 canvas, so a view writes only its draw.
 *
 *   const scene = useScene({
 *     name: 'kouros pulsarmap',
 *     attributes: { antialias: true, depth: true, alpha: false },
 *     create: (gl) => new MyRenderer(gl),          // throws → onUnsupported
 *     frame: ({ renderer, dt, reduced, aspect }) => { …draw…; return stillMoving; },
 *     onTheme: (canvas) => readTokens(canvas),     // on mount and every face change
 *     onUnsupported: () => setFallback(true),
 *   });
 *   return <canvas ref={scene.canvasRef} />;       // then scene.kick() when something changed
 *
 * What it owns, each of which a view once had to get right on its own:
 *
 * ⚠️ **THE FRAME LOOP RUNS ONLY WHILE SOMETHING MOVES.** `frame` returns whether to be
 * called again; a view at rest draws nothing until `kick()`. `dt` is seconds since the
 * last frame drawn, clamped to [0, 0.1] — so a tab left for a minute does not fling a
 * spring across the scene on its return — and 0 on the first frame after rest. It is
 * rAF's clock: presentation only, never what the scene SHOWS (a view whose content is
 * driven by time takes that time as a prop — the pulsarmap's is the media element's).
 *
 * ⚠️ **A LOST CONTEXT IS REBUILT, NOT A CRASH.** On loss the renderer is dropped (its
 * GL objects are already gone); on restore `create` runs again, so `create` is where
 * a view uploads what it holds — from its own refs, never from the lost renderer.
 *
 * ⚠️ **THE CONTEXT IS GIVEN BACK ON UNMOUNT, ONE TICK LATE.** Browsers cap live
 * contexts (Chromium ~16, iOS Safari fewer) and deleting programs does not release
 * one; an immediate release breaks React StrictMode's remount of the same canvas.
 * See `releaseContextSoon` in ../gl/context.ts.
 *
 * ⚠️ **NOTHING DRAWS WHILE NOBODY CAN SEE IT** — scrolled out of view, or the page
 * hidden. Two views mounted at once (an overlay over a page) never both draw.
 *
 * Options are read through a ref, so `frame`, `create` and `onTheme` are free to close
 * over the latest props; the lifecycle itself is mount-only.
 */

export interface SceneRenderer {
  dispose(): void;
}

export interface SceneFrame<R> {
  gl: WebGL2RenderingContext;
  renderer: R;
  canvas: HTMLCanvasElement;
  /** rAF's timestamp, ms. */
  now: number;
  /** Seconds since the last frame, clamped to [0, 0.1]; 0 on the first after rest. */
  dt: number;
  /** `prefers-reduced-motion` or the suite's `data-motion="static"`: cut, never glide. */
  reduced: boolean;
  /** Drawing-buffer width / height. */
  aspect: number;
  /** Device pixels per CSS pixel, capped at 2 — the drawing buffer's scale. */
  dpr: number;
}

export interface SceneOptions<R extends SceneRenderer> {
  /** Names the view in console warnings, e.g. 'kouros vibespace'. */
  name: string;
  attributes?: WebGLContextAttributes;
  /** Build the renderer — programs, buffers, and every upload the view holds. Throw
   *  when it cannot be built; that is `onUnsupported`, not a crash. */
  create: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => R;
  /** Draw one frame. Return true to be called again next frame. */
  frame: (f: SceneFrame<R>) => boolean;
  /** Re-read whatever the view takes from design tokens. Called before the first
   *  `create`, and on every face change (paper ↔ tube, a sleeve accent, the OS scheme). */
  onTheme?: (canvas: HTMLCanvasElement) => void;
  /** No WebGL2, or the renderer would not build: draw the view's fallback instead. */
  onUnsupported: () => void;
}

/** Stable for the component's life — safe in an effect's dependency list. */
export interface SceneHandle<R> {
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Ask for a frame. Free when one is already coming or the view is not visible. */
  kick: () => void;
  /** The live renderer, or null before `create`, after a loss, or once unmounted. */
  renderer: () => R | null;
}

/** Attribute changes on <html> that mean the face changed. */
const THEME_ATTRIBUTES = ['class', 'data-mode', 'data-theme', 'style'];

export function useScene<R extends SceneRenderer>(options: SceneOptions<R>): SceneHandle<R> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const rendererRef = useRef<R | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const visibleRef = useRef(true);
  const opts = useRef(options);
  opts.current = options;

  const loop = useCallback((now: number) => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    const gl = glRef.current;
    if (!canvas || !renderer || !gl || !visibleRef.current) { lastRef.current = null; return; }
    const dt = lastRef.current == null ? 0 : Math.min(0.1, Math.max(0, (now - lastRef.current) / 1000));
    lastRef.current = now;
    sizeCanvas(canvas);
    const again = opts.current.frame({
      gl, renderer, canvas, now, dt, reduced: prefersReducedMotion(),
      aspect: canvas.width / Math.max(1, canvas.height), dpr: devicePixelRatioCapped(),
    });
    if (again) frameRef.current = requestAnimationFrame(loop);
    else lastRef.current = null;
  }, []);

  const kick = useCallback(() => {
    if (frameRef.current == null && visibleRef.current) frameRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const renderer = useCallback(() => rendererRef.current, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const build = (): boolean => {
      claimCanvas(canvas);
      const gl = canvas.getContext('webgl2', opts.current.attributes);
      if (!gl) return false;
      glRef.current = gl;
      try {
        rendererRef.current = opts.current.create(gl, canvas);
        return true;
      } catch (err) {
        console.warn(`[${opts.current.name}] 3-D renderer unavailable: ${(err as Error).message}`);
        rendererRef.current = null;
        return false;
      }
    };
    const stop = () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };

    opts.current.onTheme?.(canvas);
    if (!build()) { opts.current.onUnsupported(); return; }
    kick();

    const unwatchContext = watchContext(canvas, () => {
      stop();
      rendererRef.current = null;
    }, () => {
      if (build()) kick(); else opts.current.onUnsupported();
    });
    const unwatchVisible = watchVisibility(canvas, (visible) => {
      visibleRef.current = visible;
      if (visible) kick();
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => kick()) : null;
    ro?.observe(canvas);
    const onTheme = () => { opts.current.onTheme?.(canvas); kick(); };
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener?.('change', onTheme);

    return () => {
      unwatchContext();
      unwatchVisible();
      ro?.disconnect();
      mo.disconnect();
      scheme?.removeEventListener?.('change', onTheme);
      stop();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      releaseContextSoon(canvas, glRef.current);
      glRef.current = null;
    };
  }, [kick]);

  // One handle for the component's life, so it can sit in an effect's dependencies.
  return useMemo(() => ({ canvasRef, kick, renderer }), [kick, renderer]);
}

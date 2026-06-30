/**
 * usePointerDrag — the ONE gesture engine for the suite.
 *
 * A small, domain-free Pointer-Events recognizer: down → arm → activate (on a
 * distance threshold, a press-and-hold, or immediately) → track → release, with
 * pointer capture and post-drag click suppression baked in. It knows nothing
 * about calendars, time fractions, or grid cells — consumers layer their own
 * drop resolution on top via the callbacks.
 *
 * It replaces two hand-rolled engines that re-derived this on incompatible
 * event models: BeigeBoard's mouse-only `DragProvider` (4px threshold, document
 * listeners, trailing-click swallow) and ORDECK's `HudGrid` press-ref (500ms
 * hold + 5px cancel, setPointerCapture, `justDragged` swallow). Because it speaks
 * Pointer Events, the same gesture works for mouse, pen, AND touch — which is
 * what makes the calendar mobile-ready.
 *
 *   const { begin } = usePointerDrag();
 *   <div onPointerDown={(e) => begin(e, {
 *     activation: { kind: 'hold', delay: 500, cancelDistance: 5 },
 *     onActivate: (c) => pickUp(c),
 *     onMove:     (c) => track(c),
 *     onEnd:      (c, dragged) => dragged ? commit(c) : tap(c),
 *   })} />
 */
import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Calendar mouse/pen threshold — a press must travel this far to count as a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Press-and-hold duration (ORDECK pick-up; calendar touch pick-up). */
export const HOLD_MS = 500;
/** Movement during a hold that re-reads the gesture as a scroll/tap and abandons it. */
export const HOLD_CANCEL_PX = 5;

/** How an armed press promotes to an active drag. */
export type DragActivation =
  /** Activate on pointerdown (ORDECK edit-mode: cards lift instantly). */
  | { kind: 'immediate' }
  /** Activate once the pointer travels `threshold` px (calendar with mouse/pen). */
  | { kind: 'distance'; threshold: number }
  /** Activate after `delay` ms of a still finger; moving `cancelDistance` px first
   *  abandons it as a scroll/tap (ORDECK; calendar on touch). */
  | { kind: 'hold'; delay: number; cancelDistance: number };

/** Live gesture snapshot handed to every callback. */
export interface DragCtx {
  x: number; y: number;        // current client coords
  startX: number; startY: number;
  dx: number; dy: number;      // travel since pointerdown
  pointerId: number;
  pointerType: string;         // 'mouse' | 'pen' | 'touch'
  target: HTMLElement;         // the element pointerdown landed on (capture target)
}

export interface DragGestureConfig {
  activation: DragActivation;
  /** The press crossed its activation policy — the drag is now live. */
  onActivate?: (ctx: DragCtx) => void;
  /** Pointer moved while active (never fires before activation). */
  onMove?: (ctx: DragCtx) => void;
  /** Pointer released. `activated` is false when it was a tap/click (never armed
   *  to a real drag), so consumers can branch select-vs-reschedule. */
  onEnd?: (ctx: DragCtx, activated: boolean) => void;
  /** Gesture abandoned (hold cancelled by movement, or pointercancel). */
  onCancel?: (ctx: DragCtx) => void;
  /** Swallow the synthetic click that trails a real drag (default true) so a
   *  reschedule/rearrange doesn't also select/activate the underlying element. */
  suppressClick?: boolean;
}

interface Gesture {
  pointerId: number;
  pointerType: string;
  target: HTMLElement;
  startX: number; startY: number;
  x: number; y: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  cleanup: () => void;
}

export interface PointerDragHandle {
  /** Arm a gesture from a pointerdown event (React or native). */
  begin: (e: ReactPointerEvent | PointerEvent, cfg: DragGestureConfig) => void;
}

export function usePointerDrag(): PointerDragHandle {
  const gestureRef = useRef<Gesture | null>(null);
  // Set when a real drag ends; the next document-level click is swallowed, then
  // it self-clears. A fresh pointerdown also clears it so a drag that ended
  // without a trailing click (released over a non-clickable area) can't eat the
  // user's NEXT genuine click.
  const suppressClickRef = useRef(false);

  // One document-level capture-phase click swallow for the hook's lifetime.
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, []);

  const begin = useCallback((e: ReactPointerEvent | PointerEvent, cfg: DragGestureConfig) => {
    if (e.button !== 0) return;                 // primary button / touch contact only
    gestureRef.current?.cleanup();              // tear down any half-finished gesture
    suppressClickRef.current = false;           // fresh deliberate press — drop stale swallow

    const target = (e.currentTarget ?? e.target) as HTMLElement;
    const g: Gesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      target,
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,
      active: false,
      timer: null,
      cleanup: () => {},
    };

    const ctx = (): DragCtx => ({
      x: g.x, y: g.y, startX: g.startX, startY: g.startY,
      dx: g.x - g.startX, dy: g.y - g.startY,
      pointerId: g.pointerId, pointerType: g.pointerType, target: g.target,
    });

    const activate = () => {
      if (g.active) return;
      g.active = true;
      if (g.timer) { clearTimeout(g.timer); g.timer = null; }
      // Capture only now — before this, native scroll / tap-cancel must stay
      // possible (so a hold that turns into a scroll is left alone).
      try { g.target.setPointerCapture(g.pointerId); } catch { /* already released */ }
      cfg.onActivate?.(ctx());
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      g.x = ev.clientX; g.y = ev.clientY;
      if (!g.active) {
        const dist = Math.hypot(g.x - g.startX, g.y - g.startY);
        const a = cfg.activation;
        if (a.kind === 'distance') {
          if (dist >= a.threshold) activate();
        } else if (a.kind === 'hold') {
          if (dist > a.cancelDistance) { cleanup(); cfg.onCancel?.(ctx()); }  // scroll/tap → abandon
        }
        if (!g.active) return;
      }
      ev.preventDefault();   // claim the gesture (stops scroll once active)
      cfg.onMove?.(ctx());
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      g.x = ev.clientX; g.y = ev.clientY;
      const wasActive = g.active;
      cleanup();
      if (wasActive && cfg.suppressClick !== false) suppressClickRef.current = true;
      cfg.onEnd?.(ctx(), wasActive);
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      cleanup();
      cfg.onCancel?.(ctx());
    };

    function cleanup() {
      if (g.timer) { clearTimeout(g.timer); g.timer = null; }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      try { g.target.releasePointerCapture(g.pointerId); } catch { /* never captured */ }
      if (gestureRef.current === g) gestureRef.current = null;
    }
    g.cleanup = cleanup;

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    gestureRef.current = g;

    const a = cfg.activation;
    if (a.kind === 'immediate') activate();
    else if (a.kind === 'hold') g.timer = setTimeout(activate, a.delay);
    // 'distance' waits for onMove to cross the threshold.
  }, []);

  return { begin };
}

// useRune.ts — the pointer plumbing under the rune layer.
//
// This file deliberately holds NO grammar. It collects points and hands them to
// `classify` (rune.ts), which is the only thing that decides what a stroke means.
// The split is what lets the recognizer be a pure function with a gate on it: a
// hook cannot be replayed from a fixture, and everything interesting about a
// stroke is in its shape rather than in its plumbing.
//
// ⚠️ **IT DOES NOT LISTEN TO POINTER EVENTS ITSELF.** `usePointerDrag` from
// @jkos/ui is the ONE gesture engine for the suite (`pnpm check:drag`), and it
// already solves the three things a hand-rolled recognizer always gets wrong:
// pointer capture, so a stroke that leaves the element still tracks; the
// trailing synthetic click, which would otherwise activate whatever the stroke
// happened to lift over; and mouse/pen/touch through one event model, which is
// the difference between working on a phone and only looking like it does.
//
// ⚠️ **ACTIVATION IS `distance`, NOT `immediate`, AND THAT IS NOT A DETAIL.**
// `usePointerDrag` swallows the synthetic click that trails an ACTIVE gesture, so
// immediate activation would mark every touch — including every tap on a link or
// a button — as a drag and eat its click. The whole surface would go dead, with
// nothing thrown and nothing logged. Activating on DRAG_THRESHOLD_PX means a tap
// never activates, its click passes through, and only a real stroke suppresses
// one. The few pixels of travel lost before activation cost nothing: the
// recognizer needs DIRECTION_PX (32) before a stroke has a direction at all, and
// the buffer is seeded with the pointerdown point so the start is never missed.
//
// ⚠️ **A LIVE RUNE SURFACE CANNOT ALSO SCROLL.** Once active, `usePointerDrag`
// calls `preventDefault()` to claim the gesture, so a downward stroke is a rune
// and not a scroll — those two readings of the same motion cannot coexist on one
// surface. So this hook is mounted on surfaces that do not scroll (Now Playing),
// and the beacon carries navigation everywhere else. Extending runes over a
// scrolling list needs a real decision about which motions the list keeps, not a
// wider mount.

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX } from '@jkos/ui';
import { classify, type Pt, type Rune } from './rune';

/** Ceiling on one stroke's buffer.
 *
 *  ⚠️ When it is reached the buffer stops GROWING — it does not start dropping
 *  the oldest points. `classify` measures everything from the stroke's start and
 *  its pivot, so discarding the head would silently re-read a dial as a flick in
 *  a different direction. A stroke long enough to reach this has already turned
 *  many times, and the value it is dialling is bounded anyway. */
export const MAX_POINTS = 1500;

export interface RuneGestureConfig {
  /** What the stroke means SO FAR — fires on every move once the stroke has a
   *  direction, for the live preview and the open dial. The same `classify` that
   *  produces the commit, so the label can never disagree with what fires. */
  onPreview?: (rune: Rune, points: readonly Pt[]) => void;
  /** The stroke lifted. This is the only place a command is fired: see rune.ts's
   *  header on why nothing commits earlier. A `cancel` rune is delivered here
   *  too — released-on-nothing is an outcome, not an absence. */
  onCommit?: (rune: Rune, points: readonly Pt[]) => void;
  /** The gesture was taken away (pointercancel — a call, the app backgrounding,
   *  the system claiming the touch). Distinct from a `cancel` rune: nothing was
   *  decided, so nothing should be shown as having been decided. */
  onAbort?: () => void;
}

export interface RuneGestureHandle {
  /** Arm a stroke from a pointerdown. */
  begin: (e: ReactPointerEvent | PointerEvent) => void;
}

export function useRuneGesture(config: RuneGestureConfig): RuneGestureHandle {
  const { begin: beginDrag } = usePointerDrag();
  const points = useRef<Pt[]>([]);

  // ⚠️ The config is read through a ref, never captured. `begin` is handed to a
  // JSX prop, so a version of it that closed over the first render's callbacks
  // would keep firing commands at a stale player — and the symptom would be a
  // rune that works once and then quietly operates on the previous track.
  const cfg = useRef(config);
  useEffect(() => { cfg.current = config; });

  const begin = useCallback((e: ReactPointerEvent | PointerEvent) => {
    points.current = [{ x: e.clientX, y: e.clientY }];
    beginDrag(e, {
      activation: { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onMove: (ctx) => {
        if (points.current.length < MAX_POINTS) points.current.push({ x: ctx.x, y: ctx.y });
        cfg.current.onPreview?.(classify(points.current), points.current);
      },
      onEnd: (ctx, activated) => {
        const stroke = points.current;
        points.current = [];
        // A tap never activated, so it was never a stroke. Returning here rather
        // than committing a `cancel` keeps the two outcomes distinct: the caller
        // hears nothing, and the tap's click reaches whatever it was aimed at.
        if (!activated) return;
        if (stroke.length < MAX_POINTS) stroke.push({ x: ctx.x, y: ctx.y });
        cfg.current.onCommit?.(classify(stroke), stroke);
      },
      onCancel: () => {
        points.current = [];
        cfg.current.onAbort?.();
      },
    });
  }, [beginDrag]);

  return { begin };
}

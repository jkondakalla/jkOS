// gesture.ts — what a pointer's path MEANS to a 3-D view, PURE. The pointer events
// themselves belong to @jkos/ui's `usePointerDrag` (the suite's one gesture engine,
// check:drag); this is only the arithmetic a view does with what it reports. Every
// timestamp is the caller's (`event.timeStamp` / `performance.now()`): this module
// holds no clock.

export const LOCK_PX = 8;

/** Which axis a drag is on, once it has travelled far enough to say — then locked for
 *  the rest of the drag, so a slightly diagonal swipe never does both things. */
export function lockAxis(dx: number, dy: number, threshold = LOCK_PX): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < threshold) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

export interface Sample { t: number; v: number }

/** Velocity (units / s) over the last `windowMs` of timestamped samples — a
 *  least-squares slope, so one jittery sample cannot throw the coast. */
export function velocityOf(samples: readonly Sample[], windowMs = 90): number {
  if (samples.length < 2) return 0;
  const end = samples[samples.length - 1].t;
  const recent = samples.filter((s) => end - s.t <= windowMs);
  if (recent.length < 2) return 0;
  const mt = recent.reduce((a, s) => a + s.t, 0) / recent.length;
  const mv = recent.reduce((a, s) => a + s.v, 0) / recent.length;
  let num = 0, den = 0;
  for (const s of recent) { num += (s.t - mt) * (s.v - mv); den += (s.t - mt) ** 2; }
  return den > 0 ? (num / den) * 1000 : 0;
}

export interface Tap { t: number; x: number; y: number }

/** Every tap acts at once; a second tap within `maxMs` and `maxPx` is ALSO a
 *  double-tap. The first is never delayed to wait and see — a tap that answers
 *  300 ms late reads as a slow app. A double-tap consumes the pair. */
export function classifyTap(prev: Tap | null, next: Tap, maxMs = 300, maxPx = 12):
  { double: boolean; last: Tap | null } {
  const double = !!prev && next.t - prev.t <= maxMs && Math.hypot(next.x - prev.x, next.y - prev.y) <= maxPx;
  return { double, last: double ? null : next };
}

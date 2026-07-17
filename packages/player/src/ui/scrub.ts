// scrub.ts — the PURE math under the UI kit (ToDo.md §3 Wave 16, item 16.6). No DOM,
// no React, no runtime imports (type-only NavPoint) — so test/ui.test.mjs can
// transpile this one file in isolation, the same house pattern core.test.mjs uses.
//
// Two generalizations lifted from real papyros code, algorithm unchanged:
//   • segmentFraction — BookDetail.tsx's `chapterFraction` verbatim (the chapter-row
//     loading-bar fill). <SegmentList> uses it per row; any caller can.
//   • segmentWindow — PlayerBar.tsx's chapter-bracketing math (chStart/chLen/chPos,
//     the "scrubber is the CURRENT CHAPTER's timeline" decision, Jag 2026-07-09)
//     promoted to a function: given the nav points + current index it returns the
//     window <Scrubber> renders, falling back to the whole [0, total] timeline when
//     there is no current segment — which is also exactly the 'timeline' mode.
import type { NavPoint } from '../core/timeline';

/** Fraction [0, 1] of a [start, end) segment already behind `position` — 0 ahead of
 *  it, 1 for segments fully finished, fractional for the one it's inside. Lifted
 *  VERBATIM from BookDetail.tsx's chapterFraction (zero-length segments can never
 *  hit the division: position is always <= start or >= end first). */
export function segmentFraction(start: number, end: number, position: number): number {
  if (position <= start) return 0;
  if (position >= end) return 1;
  return (position - start) / (end - start);
}

/** The span a segment-aware scrubber renders: the current segment's window when
 *  `currentIndex` brackets a real point, else the whole [0, total] timeline. */
export interface ScrubWindow {
  /** Global second the window begins at (add to a window-local value to get the
   *  global seconds `seekTo` speaks). */
  start: number;
  /** Window length in seconds — the range input's max. */
  length: number;
  /** `position` clamped into the window, window-local — the range input's value. */
  pos: number;
}

/** PlayerBar.tsx's chapter-window math, verbatim: `points` is gap-free over
 *  [0, total] (see core/navPoints), so the current point always brackets the
 *  position; crossing segments is prev/next's job, and while playback rolls over a
 *  boundary the caller's currentIndex advances and the window re-brackets itself. */
export function segmentWindow(
  points: readonly NavPoint[],
  currentIndex: number,
  total: number,
  position: number,
): ScrubWindow {
  const seg = currentIndex >= 0 && currentIndex < points.length ? points[currentIndex] : null;
  const start = seg ? seg.start : 0;
  const length = Math.max(0, (seg ? seg.end : total) - start);
  const pos = Math.max(0, Math.min(position - start, length));
  return { start, length, pos };
}

/** '1×' / '1.25×' — the rate button's face, verbatim from papyros's formatRate. */
export function formatRate(r: number): string {
  return `${Number.isInteger(r) ? r : r.toString()}×`;
}

/** One row's vertical span, list order — what <QueuePanel> measures on drag start. */
export interface RowSpan {
  top: number;
  bottom: number;
}

/** Insertion slot (0..n) for a pointer at `y` over the measured rows: the index of
 *  the first row whose midpoint is still below the pointer. Above every midpoint →
 *  0; below them all → n (append). Strict `<` so dead-on-midpoint resolves after. */
export function insertionSlot(rows: readonly RowSpan[], y: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (y < (rows[i].top + rows[i].bottom) / 2) return i;
  }
  return rows.length;
}

/** Map an insertion slot (0..n, computed over the ORIGINAL row list) onto the
 *  destination index core/queue's `reorder(from, to)` expects (remove-then-insert):
 *  slots past the dragged row shift down one because the row leaves first. A result
 *  === `from` is the no-move case (`reorder` treats it as a no-op). */
export function reorderTarget(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

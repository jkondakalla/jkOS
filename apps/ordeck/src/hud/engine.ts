/**
 * hud/engine.ts — the custom grid layout engine (pure, framework-free).
 *
 * All math is in abstract GRID UNITS, independent of pixels or device. The
 * renderer turns the result into a CSS grid; later phases (drag/resize/shelf
 * drop) mutate layouts and re-run these same functions. Two invariants match
 * the design brief: vertical compaction (items pack upward, no floating gaps)
 * and NO horizontal float (x is never auto-shifted sideways).
 */

import { BREAKPOINTS, type Breakpoint, type GridItem, type HudState } from './types';

/** Do two items overlap in grid space? An item never collides with itself. */
export function collides(a: GridItem, b: GridItem): boolean {
  if (a.i === b.i) return false;
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Lowest edge of a layout (its total height in rows). */
export function bottom(items: GridItem[]): number {
  let max = 0;
  for (const it of items) max = Math.max(max, it.y + it.h);
  return max;
}

/** Fit an item inside `cols` without floating it sideways: shrink width first,
 *  then clamp x so the item stays fully on-grid. Used when reflowing a layout
 *  authored for more columns down into fewer (desktop → mobile). */
function clampToCols(it: GridItem, cols: number): GridItem {
  const w = Math.min(it.w, cols);
  const x = Math.max(0, Math.min(it.x, cols - w));
  return { ...it, w, x };
}

/**
 * Pack items upward (compactType: 'vertical'). Deterministic: process top-to-
 * bottom, left-to-right, and drop each item into the highest row where it does
 * not collide with an already-placed item. `static` items keep their y.
 */
export function compactVertical(items: GridItem[], cols: number): GridItem[] {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [];
  for (const raw of ordered) {
    const it = clampToCols(raw, cols);
    if (it.static) {
      placed.push(it);
      continue;
    }
    // Start at the top and slide down until the slot is free. Because higher
    // items are already placed, this lands the item directly beneath them.
    let y = 0;
    while (placed.some((p) => collides({ ...it, y }, p))) y++;
    placed.push({ ...it, y });
  }
  return placed;
}

/** Re-flow a layout into a different column count, then compact. This is how a
 *  12-col desktop arrangement becomes the 2-col mobile stack when no explicit
 *  mobile layout has been authored. */
export function reflow(items: GridItem[], toCols: number): GridItem[] {
  return compactVertical(items.map((it) => clampToCols(it, toCols)), toCols);
}

/** Resolve which breakpoint a viewport width falls into: the highest minWidth
 *  the viewport still clears. Falls back to the smallest tier for tiny widths. */
export function activeBreakpoint(width: number): Breakpoint {
  let best: Breakpoint | null = null;
  for (const bp of BREAKPOINTS) {
    if (width >= bp.minWidth && (best === null || bp.minWidth > best.minWidth)) best = bp;
  }
  return best ?? BREAKPOINTS.reduce((a, b) => (a.minWidth <= b.minWidth ? a : b));
}

/**
 * The placed layout for a given breakpoint. Uses the tier's stored layout when
 * present (compacted to be safe); otherwise derives it from the desktop layout
 * by reflowing into the tier's column count.
 */
export function layoutForBreakpoint(state: HudState, bp: Breakpoint): GridItem[] {
  const stored = state.layouts[bp.name];
  if (stored && stored.length) return compactVertical(stored, bp.cols);
  const base = state.layouts.desktop ?? [];
  return reflow(base, bp.cols);
}

/**
 * Place a shelved widget into a breakpoint layout at the bottom of the stack,
 * using its per-tier default footprint. Returns a NEW layout array.
 */
export function placeAtBottom(
  layout: GridItem[],
  id: string,
  size: { w: number; h: number },
  cols: number,
): GridItem[] {
  const w = Math.min(size.w, cols);
  const item: GridItem = { i: id, x: 0, y: bottom(layout), w, h: size.h };
  return compactVertical([...layout, item], cols);
}

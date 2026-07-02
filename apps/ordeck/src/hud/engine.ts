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

/**
 * Auto-balance: tidy the layout — pull cards up into the gaps so the page gets
 * shorter — WITHOUT reshuffling the arrangement into something unrecognisable.
 * (An earlier cut sorted every card by size, first-fit-decreasing: minimal
 * empty space, but it relocated everything on each press.) Two rules instead:
 *
 *   • Familiarity: movable cards are processed in READING ORDER of the current
 *     layout (top-to-bottom, left-to-right), and each lands in the slot that
 *     minimises `2·row + lateral distance from its own column`. Rising is what
 *     balance is FOR, but a sideways move costs double: a card crosses k
 *     columns only to climb more than k/2 rows. A big hole still gets filled —
 *     even from across the page when the climb earns it — but nobody trades a
 *     whole column identity for one row. A layout with no holes is a fixed
 *     point: balance leaves it exactly as-is.
 *   • Respect intent: `static` cards and ids in `opts.keep` (cards the user
 *     hand-placed this edit session) are fixed obstacles — they keep their
 *     exact cell and everyone else packs around them. One caveat: the
 *     no-floating-gaps invariant is global (layoutForBreakpoint compacts every
 *     render), so if balance clears the space directly above a kept card, the
 *     render slides it up its own column — held sideways, never reshuffled.
 *
 * Placement is still gap-seeking, so holes fill and the height drops — it's
 * just no longer worth scrambling the page over. Movable placements are
 * compactVertical-stable (each takes the topmost fit in its chosen column),
 * so the render path keeps them untouched.
 */
export function autoBalance(
  items: GridItem[],
  cols: number,
  opts: { keep?: ReadonlySet<string> } = {},
): GridItem[] {
  const fitted = items.map((it) => clampToCols(it, cols));
  const isFixed = (it: GridItem) => !!it.static || !!opts.keep?.has(it.i);
  const fixed = fitted.filter(isFixed);
  const movable = fitted.filter((it) => !isFixed(it));

  // Reading order of the CURRENT layout; the id key is a pure tie-breaker so
  // the result is deterministic.
  movable.sort((a, b) => a.y - b.y || a.x - b.x || (a.i < b.i ? -1 : 1));

  // Sparse occupancy grid — rows materialise on demand, width is fixed at `cols`.
  const rows: boolean[][] = [];
  const rowAt = (y: number) => (rows[y] ??= new Array<boolean>(cols).fill(false));
  const isFree = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) {
      const row = rowAt(yy);
      for (let xx = x; xx < x + w; xx++) if (row[xx]) return false;
    }
    return true;
  };
  const occupy = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) {
      const row = rowAt(yy);
      for (let xx = x; xx < x + w; xx++) row[xx] = true;
    }
  };

  const placed: GridItem[] = [];
  for (const it of fixed) { occupy(it.x, it.y, it.w, it.h); placed.push(it); }

  // Weighted best-fit: per column, the topmost row the card fits; the winner
  // minimises 2·row + |Δcolumn|. Cost ties keep the smaller sideways move
  // (equal cost + equal distance can only differ left/right — first found,
  // i.e. leftmost, wins). The scan can never need more rows than every card
  // stacked single-file, so that's a safe upper bound.
  const maxY = fitted.reduce((sum, it) => sum + it.h, 0) + 1;
  for (const it of movable) {
    let bestX = 0, bestY = 0, bestCost = Infinity;
    for (let x = 0; x <= cols - it.w; x++) {
      const dx = Math.abs(x - it.x);
      for (let y = 0; y < maxY; y++) {
        if (!isFree(x, y, it.w, it.h)) continue;
        const cost = y * 2 + dx;
        if (cost < bestCost || (cost === bestCost && dx < Math.abs(bestX - it.x))) {
          bestX = x; bestY = y; bestCost = cost;
        }
        break;                       // topmost fit for this column found
      }
    }
    if (bestCost === Infinity) {     // unreachable when the input has no overlaps
      bestX = Math.max(0, Math.min(it.x, cols - it.w));
      bestY = bottom(placed);
    }
    occupy(bestX, bestY, it.w, it.h);
    placed.push({ ...it, x: bestX, y: bestY });
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

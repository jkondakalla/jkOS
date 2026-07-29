/**
 * surface.ts — the card recipe factory (Full Press).
 *
 * ONE source of truth for the "tinted item" look BeigeBoard previously inlined
 * three times (task chip, time block, all-day bar). Under Full Press this is the
 * SUITE-DEFAULT solid-ink chip: it defers to hub.css's `.jk-chip*` family rather
 * than inlining a glaze + rgba shadows, because those classes are mode-gated
 * (debossed-on-paper / halated-on-the-tube) and inline styles can't be. The
 * factory's job is now to pick the class set and carry the per-item `--jk-tint`
 * so the same recipe renders identically wherever the kit is mounted (BeigeBoard
 * tabs and ORDECK widgets).
 *
 * Supersedes the old ACCENT_GLAZE surface — see DESIGN.md §8 (chip system).
 */

import type { CSSProperties } from 'react';

/** solid = the saturated `.jk-chip-solid` tab (default, cream-knockout title via
 *  `.jk-press-rev`); faint = the raised `.jk-chip` in faint tint (neutral-ink
 *  rows via `.jk-press-ink`). */
export type CardVariant = 'solid' | 'faint';

export interface CardSurfaceOpts {
  /** Tint colour (hex or CSS var) → drives `--jk-tint` for the whole chip. */
  accent: string;
  variant?: CardVariant;
  /** Spent state → `.jk-chip-done` (flat, dimmed). */
  completed?: boolean;
  /** Now / active → `.jk-chip-live` (brighter fill + ring). */
  live?: boolean;
  /** Selection ring, laid over the chip's own shadow. */
  selected?: boolean;
  /** Dense chip → `.jk-chip-sm` (calendar cells, tight rails). */
  sm?: boolean;
  /** Border radius override (CSS value/var). Defaults to the chip class radius. */
  radius?: string;
}

export interface CardSurface {
  /** Apply to the element (the mode-gated visual recipe). */
  className: string;
  /** Spread onto the element's style AFTER layout — carries `--jk-tint`, an
   *  optional radius override, and the selection ring. */
  style: CSSProperties;
}

/**
 * Produce the chip surface for a card: a class set + the `--jk-tint` seam. Add
 * layout (position / padding / size) and a pressed-type title
 * (`.jk-press-rev` on solid, `.jk-press-ink` on faint) at the call site.
 */
export function cardSurface(opts: CardSurfaceOpts): CardSurface {
  const { accent, variant = 'solid', completed = false, live = false, selected = false, sm = false, radius } = opts;

  const className = [
    'jk-chip',
    variant === 'solid' && 'jk-chip-solid',
    sm && 'jk-chip-sm',
    live && !completed && 'jk-chip-live',
    completed && 'jk-chip-done',
  ]
    .filter(Boolean)
    .join(' ');

  const style: CSSProperties = {
    ['--jk-tint' as string]: accent,
    ...(radius ? { borderRadius: radius } : null),
    ...(selected ? { outline: '1.5px solid var(--color-accent)', outlineOffset: -2 } : null),
  } as CSSProperties;

  return { className, style };
}

/** The inline "check square" inside filled cards → the suite `.jk-check` look
 *  (mode-correct: tint fill + cream tick on paper, halated on the tube). Sizeable
 *  for tight calendar cells. Host as a `role="checkbox"` with `aria-checked`, and
 *  always render `✓` as the child — `.jk-check` hides the mark until checked. The
 *  tint is inherited from the chip's `--jk-tint`. */
export function chipCheck(size: number): { className: string; style: CSSProperties } {
  return {
    className: 'jk-check',
    style: { width: size, height: size, fontSize: Math.round(size * 0.62), borderRadius: 'var(--hub-radius-xs)' },
  };
}

/**
 * surface.ts — the card recipe factory.
 *
 * ONE source of truth for the "filled accent card" look BeigeBoard previously
 * inlined three times (task chip, time block, all-day bar): an accent base under
 * a top-light glaze, an inset highlight, a tiered drop shadow, and a selected
 * ring. Token-driven (radius/accent from @jkos/design) so the same recipe scales
 * per tier and renders identically wherever the kit is mounted (BeigeBoard tabs
 * and, later, ORDECK widgets).
 */

import type { CSSProperties } from 'react';

/** Top-light → bottom-shade glaze laid OVER the flat accent, giving every card
 *  the same dimensional sheen. */
export const ACCENT_GLAZE = 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.09) 100%)';

export type CardElevation = 'chip' | 'bar' | 'block';

const ELEVATION: Record<CardElevation, { inset: string; drop: string }> = {
  chip: { inset: 'inset 0 1px 0 rgba(255,255,255,0.18)', drop: '0 1px 4px rgba(0,0,0,0.3)' },
  bar: { inset: 'inset 0 1px 0 rgba(255,255,255,0.22)', drop: '0 2px 6px rgba(0,0,0,0.35)' },
  block: {
    inset: 'inset 0 1px 0 rgba(255,255,255,0.22)',
    drop: '0 3px 10px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.25)',
  },
};

export interface CardSurfaceOpts {
  /** Accent colour (hex or CSS var). Ignored when `completed` flattens the card. */
  accent: string;
  completed?: boolean;
  selected?: boolean;
  elevation?: CardElevation;
  /** Border radius (CSS value/var). Defaults to the small radius token. */
  radius?: string;
  /** Background when `completed` (the spent state). Default = paper. */
  emptyBg?: string;
}

/**
 * Produce the surface CSS for a card. Spread it, then add layout (position /
 * padding / size) at the call site.
 */
export function cardSurface(opts: CardSurfaceOpts): CSSProperties {
  const {
    accent,
    completed = false,
    selected = false,
    elevation = 'chip',
    radius = 'var(--hub-radius-sm)',
    emptyBg = 'var(--color-paper)',
  } = opts;

  const e = ELEVATION[elevation];

  if (completed) {
    return {
      background: emptyBg,
      boxShadow: 'none',
      color: 'var(--color-muted)',
      borderRadius: radius,
      outline: selected ? '1.5px solid var(--color-accent)' : 'none',
      outlineOffset: -1,
    };
  }

  // A selected block gets a paper-gapped accent ring on top of its drop shadow;
  // chips/bars use a plain outline.
  const selectedRing =
    selected && elevation === 'block'
      ? ', 0 0 0 1px var(--color-paper), 0 0 0 3px var(--color-accent)'
      : '';

  return {
    background: `${ACCENT_GLAZE}, ${accent}`,
    boxShadow: `${e.inset}, ${e.drop}${selectedRing}`,
    color: 'rgba(255,255,255,0.95)',
    borderRadius: radius,
    outline: selected && elevation !== 'block' ? `${elevation === 'chip' ? 1.5 : 2}px solid var(--color-accent)` : 'none',
    outlineOffset: -2,
  };
}

/** The white inline "check square" used inside filled cards (week untimed/time
 *  block). Returns the box style; render the ✓ as its child when completed. */
export function chipCheckStyle(completed: boolean, size: number, tick: string): CSSProperties {
  return {
    width: size,
    height: size,
    flexShrink: 0,
    border: `1px solid ${completed ? 'var(--color-muted)' : 'rgba(255,255,255,0.7)'}`,
    background: completed ? tick : 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: Math.round(size * 0.66),
    color: 'var(--color-paper)',
    lineHeight: 1,
  };
}

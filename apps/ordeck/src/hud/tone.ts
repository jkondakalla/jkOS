/**
 * hud/tone.ts — the single tone registry.
 *
 * `Tone` is the spec layer's status vocabulary (hud/types). The data layer used
 * to re-declare it as `ViewTone` and keep its own colour/severity maps; both now
 * live here so adding a tone is one edit: extend `Tone` in types, then add its
 * colour + rank below. Both the renderer (registry) and the data hooks import
 * from here, so the layers can't drift.
 */

import type { Tone } from './types';

export type { Tone };

/** Tone → CSS colour (hub.css tokens — no hardcoded hex). */
export const TONE_COLOR: Record<Tone, string> = {
  ok:     'var(--hub-green)',
  warn:   'var(--hub-warn)',
  danger: 'var(--hub-red)',
  muted:  'var(--hub-cream-dim)',
  accent: 'var(--hub-amber)',
};

/** Severity order for feeds (notifications): problems first, ambient last. */
export const TONE_RANK: Record<Tone, number> = {
  danger: 0, warn: 1, accent: 2, ok: 3, muted: 4,
};

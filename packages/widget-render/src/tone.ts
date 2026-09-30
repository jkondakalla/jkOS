/**
 * tone.ts — the single tone registry.
 *
 * `Tone` is the spec layer's status vocabulary (the manifest's TONES). ORDECK's data
 * layer used to re-declare it as `ViewTone` and keep its own colour/severity maps; both
 * live here so adding a tone is one edit: extend TONES in the manifest, then add its
 * colour + rank below. The renderer and a host's data hooks import from here, so the
 * layers can't drift.
 */

import type { Tone } from './types';

export type { Tone };

/** Tone → CSS colour (hub.css tokens — no hardcoded hex). */
export const TONE_COLOR: Record<Tone, string> = {
  ok:     'var(--color-ok)',
  warn:   'var(--color-warn)',
  danger: 'var(--color-danger)',
  muted:  'var(--color-faint)',
  accent: 'var(--color-accent)',   // the suite accent chain: a theme's accent moves it
};

/** Severity order for feeds (notifications): problems first, ambient last. */
export const TONE_RANK: Record<Tone, number> = {
  danger: 0, warn: 1, accent: 2, ok: 3, muted: 4,
};

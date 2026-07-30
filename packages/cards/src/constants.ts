/**
 * constants.ts — the calendar kit's geometry, keyed by DENSITY.
 *
 * The timeline used to be a set of bare constants, which meant one number served
 * two very different surfaces: BeigeBoard's full-page day/week and ORDECK's
 * compact HUD widget. Raising the row to the prototype's 60px would have silently
 * grown every HUD card by 20%. So geometry is now a FUNCTION OF DENSITY, and no
 * view reads a bare constant — the density it was handed picks the number.
 *
 *   comfortable  the prototype layout: 60px rows, 1020px of timeline
 *   compact      the HUD: 48px rows, everything one notch tighter
 *
 * `WV_ROW_H` / `WV_LABEL_W` survive as the comfortable values so an outside
 * importer doesn't break, but inside the kit they are deprecated — call
 * rowHeight(density) instead.
 */
import type { CardDensity } from './types';

/** Week time-grid bounds (desktop/tablet grid; mobile uses the agenda). */
export const WV_FIRST_H = 6;
export const WV_LAST_H = 22;

/** Hours rendered in a timeline: 6 → 22 inclusive = 17 rows. */
export const GRID_HOURS = WV_LAST_H + 1 - WV_FIRST_H;

/** Row height in px. 17 × 60 = 1020px of timeline, matching the prototype. */
export const rowHeight = (density: CardDensity = 'comfortable'): number =>
  density === 'compact' ? 48 : 60;

/** Hour-gutter column width in px. */
export const labelW = (density: CardDensity = 'comfortable'): number =>
  density === 'compact' ? 60 : 52;

/** Floor for a rendered time block. A 15-minute sliver must still clip cleanly
 *  rather than collapse to a hairline — but the HUD can't afford the taller
 *  floor, so it keeps the old one. */
export const minBlockH = (density: CardDensity = 'comfortable'): number =>
  density === 'compact' ? 18 : 26;

/** Total timeline height in px. */
export const gridHeight = (density: CardDensity = 'comfortable'): number =>
  GRID_HOURS * rowHeight(density);

/** Horizontal inset of a chip inside its lane, in px: `[left, widthReduction]`.
 *  Today's single-day column can afford more air than Week's seven lanes. */
export const chipInset = (
  density: CardDensity = 'comfortable',
  surface: 'week' | 'day' = 'week',
): [number, number] => {
  if (density === 'compact') return [3, 6];
  return surface === 'day' ? [6, 12] : [5, 10];
};

/** The background gridline stack.
 *
 *  Painted in --hub-line by default, NOT --color-line-strong: hour rules are a
 *  faint ledger, not a spreadsheet. `halfHour` layers the prototype's ghost rule
 *  underneath — Today only, because the seven-lane week is deliberately quieter
 *  than the single day.
 *
 *  `tone` exists because a fixed rule colour is only faint RELATIVE TO the lane it
 *  is drawn on, and the lane colour varies. The today lane in Week used to be a
 *  mid-tone accent wash whose luminance sat almost exactly on --hub-line's, so the
 *  one column a user looks at first was the one column with no visible hour rules —
 *  the ledger vanished precisely where it was needed. A rule that is a ledger on
 *  paper must stay a ledger on a tinted lane, so a tinted lane asks for 'strong'
 *  and gets the next weight up. Same faintness, measured against its own ground. */
export const gridRules = (
  density: CardDensity = 'comfortable',
  opts: { halfHour?: boolean; tone?: 'default' | 'strong' } = {},
): string => {
  const row = rowHeight(density);
  const ink = opts.tone === 'strong' ? 'var(--hub-line-strong)' : 'var(--hub-line)';
  const hour = `repeating-linear-gradient(to bottom, ${ink} 0 1px, transparent 1px ${row}px)`;
  if (!opts.halfHour) return hour;
  const half = row / 2;
  const ghost =
    `repeating-linear-gradient(to bottom, transparent 0 ${half}px, ` +
    `color-mix(in srgb, ${ink} 45%, transparent) ${half}px ${half + 1}px, ` +
    `transparent ${half + 1}px ${row}px)`;
  return `${hour}, ${ghost}`;
};

/** @deprecated inside the kit — use rowHeight(density). Kept for outside importers. */
export const WV_ROW_H = rowHeight('comfortable');
/** @deprecated inside the kit — use labelW(density). Kept for outside importers. */
export const WV_LABEL_W = labelW('comfortable');

/** Calendar month-grid bar geometry. */
export const CV_BAR_H = 20;
export const CV_BAR_GAP = 2;
export const CV_DAY_NUM = 24;

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

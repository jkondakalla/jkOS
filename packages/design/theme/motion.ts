/**
 * motion.ts — the CHOREOGRAPHY half of the motion vocabulary.
 *
 * hub.css owns the physics (`inkDry` on paper, `crtOn` on the tube, the
 * `data-motion` axis, `prefers-reduced-motion`). What it cannot own is the
 * ORDER: `.mo-item` carries `both`, so an element with no delay just appears,
 * and the entire cascade lives in the offsets. Those offsets were prose in a
 * work order, which meant four apps were about to invent four sets of ms values.
 *
 * So the rhythm is data. A view imports the region it is animating; it does not
 * pick a number.
 *
 * Framework-free by design — these are plain numbers, consumed as
 * `animationDelay` by React, Svelte or a plain template alike.
 */

/**
 * Region → delay in ms, for the fixed regions of a view's entrance.
 *
 * The shape is deliberately flat rather than nested per view: the point is that
 * a header is a header everywhere, so Week's header bar and Calendar's header
 * both open the cascade at 0. Where a view genuinely differs (Today's timeline
 * arrives sooner than Week's because there is one lane to draw, not seven) it
 * gets its own key rather than a magic offset at the call site.
 */
export const MO_DELAYS = {
  /** The view's own header bar / masthead. Every cascade starts here. */
  header: 0,

  /** The band under the header: Week's bench strip, Today's rule, Calendar's
   *  day-of-week row. Slightly different per view — a rule is a thinner thing
   *  than a strip of chips and wants to land sooner. */
  weekBench: 70,
  todayRule: 60,
  calendarDow: 50,

  /** The structural row beneath that. */
  weekDayHeads: 120,
  calendarGrid: 100,

  /** The timeline itself. */
  weekGrid: 170,
  todayGrid: 110,

  /** Today's right rail, top to bottom. `railColophon` currently has no call
   *  site: BeigeBoard's page foot was cut on 2026-07-30 (DESIGN.md §6) and the
   *  colophon is waiting to be re-sited, not deleted. Kept so the beat is
   *  already named when it lands. */
  railFirst: 170,
  railSecond: 250,
  railColophon: 330,
} as const;

export type MoRegion = keyof typeof MO_DELAYS;

/** `animationDelay` for a named region, ready to drop into a style object. */
export const moDelay = (region: MoRegion): string => `${MO_DELAYS[region]}ms`;

/**
 * Delay for the i-th item of an indexed run — a list of goal cards, a tree of
 * forge rows. `base` is when the run starts, `step` how far apart its items are.
 *
 * The two runs in service:
 *   stagger(i, 60, 70)   goal cards on a rail
 *   stagger(i, 120, 40)  forge rows (denser, so they land tighter)
 *
 * `max` caps the total so a hundred-item list doesn't take eight seconds to
 * finish arriving; past the cap everything lands together, which reads as "the
 * rest of the list" rather than as a stall.
 */
export function stagger(i: number, base = 60, step = 70, max = 900): string {
  const raw = base + Math.max(0, i) * step;
  return `${Math.min(raw, max)}ms`;
}

/**
 * Step between two neighbours on the month RING (see ringOrder). Deliberately
 * far tighter than a list's: a run of 8 goal cards can afford 70ms apiece, but a
 * month is 31 cells and at that rate the last day of the month would land two
 * full seconds after the first. 15ms sweeps the whole grid in under half a
 * second, which is short enough that the page is usable while it is still
 * arriving — the cascade is a POINTER, not a curtain.
 */
export const MO_RING_STEP = 15;

/**
 * Where a day sits on the month grid's entrance RING.
 *
 * A month is the one grid in the suite that has a "you are here", so it does not
 * enter in reading order — it enters from TODAY. The cascade starts on the
 * current date, runs to the end of the month, wraps round to the 1st, and closes
 * on the day before today. The eye follows the start of the motion, so where the
 * animation begins is where today is: the view marks the date by choreography
 * before any pigment or light has to.
 *
 * Returns the day's position in that order — 0 for the anchor itself, count-1
 * for the day immediately before it. Multiply by MO_RING_STEP and add the
 * region's base delay.
 *
 * @param day     1-based day-of-month of the cell
 * @param anchor  1-based day the ring starts on (today; the 1st in a month that
 *                doesn't contain today, which has no "now" to start from)
 * @param count   days in the month
 */
export function ringOrder(day: number, anchor: number, count: number): number {
  if (!(count > 0)) return 0;
  const d = Math.min(Math.max(day, 1), count);
  const a = Math.min(Math.max(anchor, 1), count);
  return d >= a ? d - a : count - a + d;
}

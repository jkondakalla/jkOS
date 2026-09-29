/**
 * preview/clock.ts — the page's own clock, pinned. Imported FIRST by main.tsx, so it runs
 * before any module that reads the time.
 *
 * sample.ts pins the HUD's clock slice, but a molecule can read the time itself — the
 * @jkos/cards Week view draws its now-line from `new Date()` — and then a contact sheet
 * drifts minute by minute, and the render gate's layout ratchet can flap on a label's
 * width. So the page's `Date` is pinned to the same instant (in the zone render.mjs pins).
 * Only `Date`: timers, animation frames and fonts run on their own clocks.
 */

/** Monday 28 September 2026, 09:41:27 local — the instant every preview is drawn at. */
export const PINNED_MS = new Date(2026, 8, 28, 9, 41, 27).getTime();

const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(PINNED_MS);
    else super(...(args as [number]));
  }
  static now(): number { return PINNED_MS; }
}
(globalThis as unknown as { Date: DateConstructor }).Date = PinnedDate as unknown as DateConstructor;

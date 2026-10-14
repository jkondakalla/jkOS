/**
 * preview/clock.ts — pin a contact sheet's own clock.
 *
 * A host pins its sample slices (ORDECK's clock), but a host's kind can read the time
 * itself — the @jkos/cards Week view draws its now-line from `new Date()` — and then a
 * sheet drifts minute by minute, and the render gate's layout ratchet can flap on a
 * label's width. So each preview entry imports a module that calls this FIRST, before
 * anything reads the time. Only `Date`: timers, animation frames and fonts run on their
 * own clocks.
 */
export function pinDate(ms: number): void {
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(ms);
      else super(...(args as [number]));
    }
    static now(): number { return ms; }
  }
  (globalThis as unknown as { Date: DateConstructor }).Date = PinnedDate as unknown as DateConstructor;
}

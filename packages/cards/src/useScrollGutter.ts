/**
 * useScrollGutter — keep a non-scrolling header grid aligned with the scrolling
 * body grid below it.
 *
 * The calendar views are built as stacked CSS grids that share ONE column
 * template: the day-header band, the all-day band and the untimed band don't
 * scroll, while the hour grid under them does. On a classic-scrollbar platform
 * the scrollbar is taken out of the SCROLLER's inner width only — so the header
 * bands lay their columns out across ~8px more space than the lanes get, and the
 * two grids drift apart, worse with every column: in a 7-day week the Sunday
 * frame can miss its own date head by most of a chip's width.
 *
 * There is no CSS-only fix for this: `scrollbar-gutter` can reserve the space
 * inside the scroller, but nothing tells a SIBLING how wide that reservation is.
 * So measure it off the live element — border box minus content box — and pad
 * the header bands by the same amount. That reads 0 on overlay-scrollbar
 * platforms (where the scroller loses no width either, so the two stay in step
 * by themselves) and re-measures whenever the box changes size, which includes
 * the scrollbar appearing or disappearing.
 *
 * Pair with `scrollbarGutter: 'stable'` on the scroller so the reservation
 * doesn't blink in and out as content crosses the overflow threshold.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

export function useScrollGutter(ref: RefObject<HTMLElement | null>): number {
  const [gutter, setGutter] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth - el.clientWidth;
      // Guard the pathological read (a display:none ancestor gives 0/0) and
      // anything wider than a scrollbar could plausibly be.
      setGutter(w > 0 && w < 40 ? w : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return gutter;
}

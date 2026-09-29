/** Monday 28 September 2026, 09:41:27 local — the instant every preview and gallery cell
 *  draws its clock at. Its own module with no side effects, so the preview can pin the
 *  page's Date to it (preview/clock.ts) BEFORE anything that reads the time is loaded. */
export const PINNED_MS = new Date(2026, 8, 28, 9, 41, 27).getTime();

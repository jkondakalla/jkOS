/**
 * responsive/mediaGrid.ts — the cover-grid density ladder (ToDo.md §3 Wave 20,
 * item 20.2).
 *
 * Before this, papyros's `library.css` hardcoded the 2/3/4-column progression
 * directly on `.lib-grid[data-density="…"]`. It lives here instead, next to
 * the breakpoint source (`breakpoints.ts`, same directory), so any future
 * media grid (the eventual music app) reads the SAME ladder rather than
 * re-picking column counts by eye.
 *
 * This is the JS half of the ladder. The CSS half — `.jk-media-grid` in
 * `tokens/hub.css` — seeds its `--hub-media-cols-*` custom properties from
 * these same numbers; `test/responsive.mjs` text-parses both and fails if
 * they drift apart (the same trick it already uses for BREAKPOINT_MAX).
 *
 * `@jkos/ui`'s `<MediaGrid density>` prop is typed against `MediaGridDensity`
 * and renders `data-density` for the CSS ladder to key off — it does not
 * read `MEDIA_GRID_COLUMNS` directly (no JS layout math needed, `grid-
 * template-columns` does the work), but the map is exported so anything
 * that needs the column count as a number (not just a CSS side effect) has
 * one place to read it, and so it's cheap to assert against in tests.
 */

/** Density tiers — matches papyros's original `data-density` values exactly
 *  (`compact` / `cozy` / `comfortable`), preserved verbatim in the migration
 *  off `library.css` so the rendered grid is pixel-identical. */
export type MediaGridDensity = 'compact' | 'cozy' | 'comfortable';

/** Column count per density tier — the ladder itself. */
export const MEDIA_GRID_COLUMNS: Record<MediaGridDensity, number> = {
  compact: 2,
  cozy: 3,
  comfortable: 4,
};

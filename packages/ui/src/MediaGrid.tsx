// MediaGrid.tsx — the suite's responsive cover grid (ToDo.md §3 Wave 20, item
// 20.2). The 2/3/4-column density ladder used to be hardcoded per app
// (`.lib-grid[data-density]` in papyros's library.css); it now lives once in
// the design factory (packages/design/responsive/mediaGrid.ts + the
// `.jk-media-grid` rule in tokens/hub.css) and MediaGrid just wires the
// `data-density` attribute the CSS keys off.
import type { HTMLAttributes, ReactNode } from 'react';
import type { MediaGridDensity } from '@jkos/design';
import { cx } from './primitives';

export type { MediaGridDensity };

export interface MediaGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Which rung of the 2/3/4-column ladder to render — `'compact'` (2),
   *  `'cozy'` (3), or `'comfortable'` (4); see MEDIA_GRID_COLUMNS in
   *  @jkos/design. MediaGrid never guesses a density from the viewport
   *  itself — the caller picks the tier (typically from `useBreakpoint()`,
   *  as papyros's Library view does), so a density can be pinned
   *  independent of the live breakpoint if a future consumer wants that. */
  density: MediaGridDensity;
  children?: ReactNode;
}

/** The suite's responsive cover grid. Renders `data-density` for the
 *  design-factory ladder (`.jk-media-grid[data-density=…]` in hub.css) to
 *  pick the right column count + gap — no per-app `repeat(N, 1fr)` CSS. */
export function MediaGrid({ density, className, children, ...rest }: MediaGridProps) {
  return (
    <div className={cx('jk-media-grid', className)} data-density={density} {...rest}>
      {children}
    </div>
  );
}

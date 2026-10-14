/**
 * preview/main.tsx — ORDECK's contact sheets: its host, its grid, its face.
 *
 * The sheet itself is @jkos/widget-render's preview kit (the jobs, the readers, the
 * measuring, the ready signal). What is ORDECK's is here: a cell draws in
 * `hudHost(sampleCtx(state), tier)` — the call RoomHUD makes, over hud/sample.ts's
 * slices — a HUD card's rows are its footprints on the grid (desktop, mobile, and the
 * smallest a user may resize to; the Workshop canvas's geometry), a part's are a generous
 * cell, and the page wears ORDECK's theme.
 */

import './clock';   // FIRST: the page's Date is pinned before anything reads it
import ReactDOM from 'react-dom/client';
import { injectJkOSTheme, applyJkOSMode, applyJkOSMotion, applyJkOSTheme, ACCENT_SCHEMES } from '@jkos/design';
import { runPreview, type SheetRow } from '@jkos/widget-render/preview';
import type { WidgetDef as AnyWidgetDef } from '@jkos/widget-render';
import { hudHost } from '../src/hud/host';
import { WIDGETS } from '../src/hud/catalog';
import { DEFAULT_MIN_SIZE } from '../src/hud/types';
import { TIERS, ROW_H, unitsToPx } from '../src/workshop/EditorCanvas';
import { sampleCtx } from '../src/hud/sample';
import '../src/styles/global.css';
import '../src/styles/hud.css';
import '../src/hud/grid.css';

/** A part (no footprint, no route) is drawn in a generous cell per tier, in grid units. */
const PART = { desktop: { w: 6, h: 8 }, mobile: { w: 2, h: 10 }, min: { w: 4, h: 6 } } as const;

/** A card's rows are its footprints on the grid; a part's are generous cells. */
function rowsFor(def: AnyWidgetDef): SheetRow[] {
  const cards = [
    { tier: 'desktop', colW: TIERS.desktop.colW, label: 'DESKTOP' },
    { tier: 'mobile', colW: TIERS.mobile.colW, label: 'MOBILE' },
    { tier: 'min', colW: TIERS.desktop.colW, label: 'SMALLEST' },
  ] as const;
  return cards.map(({ tier, colW, label }) => {
    const size = !def.sizing ? PART[tier] : tier === 'min' ? def.sizing.min ?? DEFAULT_MIN_SIZE : def.sizing[tier];
    return {
      tier, label, dims: `${size.w}×${size.h}`,
      w: unitsToPx(Math.min(size.w, tier === 'mobile' ? 2 : 12), colW), h: unitsToPx(size.h, ROW_H),
    };
  });
}

runPreview({
  hostFor: (_job, state, tier) => hudHost(sampleCtx(state), tier === 'min' ? 'desktop' : tier),
  rowsFor,
  catalog: Object.keys(WIDGETS),
  cellClass: 'hud-cell',
  mount: (node) => ReactDOM.createRoot(document.getElementById('root')!).render(node),
  setup(job) {
    // ORDECK's own theme inputs (App.tsx), the requested face, and nothing moving.
    injectJkOSTheme({ selector: 'html.od-v2', radius: { base: '10px', xs: '4px', sm: '7px', lg: '16px', soft: '8px', button: '9px' } });
    document.documentElement.classList.add('od-v2');
    applyJkOSMode(job.mode === 'dark' ? 'dark' : 'light');
    applyJkOSMotion('static');
    if (job.accent != null && ACCENT_SCHEMES[job.accent]) applyJkOSTheme(ACCENT_SCHEMES[job.accent]);
  },
});

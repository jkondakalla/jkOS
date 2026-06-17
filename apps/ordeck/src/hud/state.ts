/**
 * hud/state.ts — load / persist / mutate the HUD document.
 *
 * Persisted per-user in localStorage for now (key below). When the registry
 * graduates to an admin-managed, shared store, only this module changes — the
 * engine, grid, and widgets all consume HudState and never touch storage.
 */

import {
  HUD_STATE_VERSION,
  type BreakpointName,
  type GridItem,
  type HudState,
  type WidgetDef,
} from './types';
import { layoutForBreakpoint, placeAtBottom, activeBreakpoint } from './engine';
import { BREAKPOINTS } from './types';

const STORAGE_KEY = 'ordeck-hud-v3';

/** The built-in widgets. The six ported v2 cards use the `component` escape hatch
 *  (bespoke renderers reading app data Ordeck already fetches — `today` and
 *  `calendar` are BeigeBoard-backed via /api/bb/*). `uptime` is a declarative
 *  spec example: it proves the granular factory path end-to-end (metric + bar +
 *  list primitives bound to live `systems` data) and is the shape a text→widget
 *  step will emit later. It ships shelved (absent from the default layout). */
const DEFAULT_WIDGETS: Record<string, WidgetDef> = {
  clock: {
    id: 'clock', component: 'clock', label: 'Clock',
    sizing: { desktop: { w: 4, h: 4 }, mobile: { w: 2, h: 3 } },
  },
  weather: {
    id: 'weather', component: 'weather', label: 'Weather',
    sizing: { desktop: { w: 4, h: 5 }, mobile: { w: 2, h: 4 } },
  },
  today: {
    id: 'today', component: 'today', label: 'Today',
    sizing: { desktop: { w: 5, h: 15 }, mobile: { w: 2, h: 8 } },
  },
  calendar: {
    id: 'calendar', component: 'calendar', label: 'Calendar',
    sizing: { desktop: { w: 4, h: 6 }, mobile: { w: 2, h: 6 } },
  },
  systems: {
    id: 'systems', component: 'systems', label: 'Systems',
    sizing: { desktop: { w: 3, h: 8 }, mobile: { w: 2, h: 5 } },
  },
  study: {
    id: 'study', component: 'study', label: 'Study',
    sizing: { desktop: { w: 3, h: 4 }, mobile: { w: 2, h: 3 } },
  },
  uptime: {
    id: 'uptime', label: 'Uptime',
    sizing: { desktop: { w: 3, h: 5 }, mobile: { w: 2, h: 4 } },
    spec: {
      frame: { eyebrow: 'UPTIME', source: 'ORDECK' },
      body: { t: 'stack', gap: 12, children: [
        { t: 'metric', value: { src: 'systems', path: 'up' }, unit: 'up', sub: { src: 'systems', path: 'total' } },
        { t: 'bar', value: { src: 'systems', path: 'up' }, max: { src: 'systems', path: 'total' } },
        { t: 'list', from: { src: 'systems', path: 'rows' }, empty: 'NO PROBES',
          item: { t: 'keyval', label: { src: '$', path: 'name' }, value: { src: '$', path: 'detail' } } },
      ] },
    },
  },
};

/** Default desktop arrangement (12-col). Mobile is derived by the engine
 *  (reflow → strict 2-col stack) unless the user pins an explicit mobile layout. */
const DEFAULT_DESKTOP: GridItem[] = [
  { i: 'clock',    x: 0, y: 0, w: 4, h: 4 },
  { i: 'weather',  x: 0, y: 4, w: 4, h: 5 },
  { i: 'calendar', x: 0, y: 9, w: 4, h: 6 },
  { i: 'today',    x: 4, y: 0, w: 5, h: 15 },
  { i: 'systems',  x: 9, y: 0, w: 3, h: 8 },
  { i: 'study',    x: 9, y: 8, w: 3, h: 4 },
];

export function defaultHudState(): HudState {
  return {
    version: HUD_STATE_VERSION,
    widgets: structuredClone(DEFAULT_WIDGETS),
    layouts: { desktop: structuredClone(DEFAULT_DESKTOP) },
    shelf: [],
  };
}

export function loadHudState(): HudState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultHudState();
    const parsed = JSON.parse(raw) as HudState;
    if (!parsed || parsed.version !== HUD_STATE_VERSION || !parsed.widgets) {
      return defaultHudState();
    }
    return parsed;
  } catch {
    return defaultHudState();
  }
}

export function saveHudState(state: HudState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled — HUD still works for the session */
  }
}

/** Move a placed widget to the shelf, removing it from every breakpoint layout. */
export function removeToShelf(state: HudState, id: string): HudState {
  const layouts = Object.fromEntries(
    (Object.entries(state.layouts) as [BreakpointName, GridItem[]][]).map(
      ([name, items]) => [name, items.filter((it) => it.i !== id)],
    ),
  );
  const shelf = state.shelf.includes(id) ? state.shelf : [...state.shelf, id];
  return { ...state, layouts, shelf };
}

/** Place a shelved widget into the current viewport's breakpoint, at the bottom
 *  of the stack, using its default footprint. Other tiers re-derive on render. */
export function placeFromShelf(state: HudState, id: string, viewportWidth: number): HudState {
  const def = state.widgets[id];
  if (!def) return state;
  const bp = activeBreakpoint(viewportWidth);
  const current = layoutForBreakpoint(state, bp);
  const size = bp.name === 'mobile' ? def.sizing.mobile : def.sizing.desktop;
  const next = placeAtBottom(current, id, size, bp.cols);
  return {
    ...state,
    layouts: { ...state.layouts, [bp.name]: next },
    shelf: state.shelf.filter((s) => s !== id),
  };
}

/** Persist an updated layout for one breakpoint (used by drag/resize later). */
export function setBreakpointLayout(
  state: HudState,
  name: BreakpointName,
  items: GridItem[],
): HudState {
  return { ...state, layouts: { ...state.layouts, [name]: items } };
}

/** Widgets registered but not placed in ANY breakpoint layout — the asset
 *  shelf's contents. "Absent from every layout" is the source of truth; the
 *  `shelf` array just preserves intent/order for the drawer. */
export function shelvedWidgets(state: HudState): WidgetDef[] {
  const placed = new Set<string>();
  for (const items of Object.values(state.layouts)) {
    for (const it of items ?? []) placed.add(it.i);
  }
  return Object.values(state.widgets).filter((w) => !placed.has(w.id));
}

export { BREAKPOINTS };

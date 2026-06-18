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

const STORAGE_KEY = 'ordeck-hud-v4';

const BB_URL = 'https://beigeboard.jkos.net';
const SYLIB_URL = 'https://sylibos.jkos.net';

/** The built-in widgets — all declarative specs now (the `component` escape
 *  hatch is retired). clock/today/systems/study compose from atoms + structure
 *  (`when` for their offline/empty states); weather/calendar use the molecule
 *  primitives. Every one is editable in the workshop and is the exact shape a
 *  text→widget AI step will emit. `uptime` ships shelved as a second systems view. */
const DEFAULT_WIDGETS: Record<string, WidgetDef> = {
  clock: {
    id: 'clock', label: 'Clock',
    sizing: { desktop: { w: 4, h: 4 }, mobile: { w: 2, h: 3 } },
    spec: {
      body: {
        t: 'time',
        value: { src: 'clock', path: 'hm' },
        seconds: { src: 'clock', path: 'ss' },
        sub: { src: 'clock', path: 'dateLine' },
        sub2: { src: 'clock', path: 'utcLine' },
      },
    },
  },
  weather: {
    id: 'weather', label: 'Weather',
    sizing: { desktop: { w: 4, h: 5 }, mobile: { w: 2, h: 4 } },
    spec: { body: { t: 'weather' } },
  },
  today: {
    id: 'today', label: 'Today',
    sizing: { desktop: { w: 5, h: 15 }, mobile: { w: 2, h: 8 } },
    spec: {
      frame: { eyebrow: 'TODAY', source: 'BEIGEBOARD' },
      body: { t: 'stack', gap: 8, grow: true, children: [
        { t: 'when', cond: { src: 'today', path: 'signedOut' }, then:
          { t: 'stack', gap: 8, children: [
            { t: 'text', text: 'SIGN IN TO SEE YOUR DAY', variant: 'sub' },
            { t: 'link', text: 'LOG IN', href: { src: 'authUrl' } },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'showOffline' }, then:
          { t: 'stack', gap: 8, children: [
            { t: 'text', text: 'BEIGEBOARD OFFLINE', variant: 'sub' },
            { t: 'link', text: 'OPEN BEIGEBOARD', href: { lit: BB_URL } },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'showEmpty' }, then:
          { t: 'stack', gap: 8, children: [
            { t: 'text', text: { src: 'today', path: 'emptyLabel' }, variant: 'sub' },
            { t: 'link', text: 'OPEN BEIGEBOARD', href: { lit: BB_URL } },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'showTasks' }, then:
          { t: 'stack', gap: 8, children: [
            { t: 'text', text: { src: 'today', path: 'progressLabel' }, variant: 'sub' },
            { t: 'bar', value: { src: 'today', path: 'progress' }, max: 1 },
            { t: 'list', from: { src: 'today', path: 'tasks' },
              item: { t: 'row', gap: 8, justify: 'space-between', children: [
                { t: 'text', text: { src: '$', path: 'timeLabel' }, variant: 'sub' },
                { t: 'text', text: { src: '$', path: 'title' }, variant: 'mono', grow: true },
                { t: 'pill', text: { src: '$', path: 'stateLabel' }, tone: { src: '$', path: 'tone' } },
              ] } },
          ] } },
      ] },
    },
  },
  calendar: {
    id: 'calendar', label: 'Calendar',
    sizing: { desktop: { w: 4, h: 6 }, mobile: { w: 2, h: 6 } },
    spec: { body: { t: 'calendar' } },
  },
  systems: {
    id: 'systems', label: 'Systems',
    sizing: { desktop: { w: 3, h: 8 }, mobile: { w: 2, h: 5 } },
    spec: {
      frame: { eyebrow: 'SYSTEMS', source: { src: 'systems', path: 'summary' } },
      body: { t: 'list', from: { src: 'systems', path: 'rows' }, empty: 'NO PROBES',
        item: { t: 'row', gap: 8, children: [
          { t: 'dot', tone: { src: '$', path: 'tone' } },
          { t: 'text', text: { src: '$', path: 'name' }, variant: 'mono', grow: true },
          { t: 'text', text: { src: '$', path: 'detail' }, variant: 'sub' },
        ] } },
    },
  },
  study: {
    id: 'study', label: 'Study',
    sizing: { desktop: { w: 3, h: 4 }, mobile: { w: 2, h: 3 } },
    spec: {
      frame: { eyebrow: 'STUDY', source: 'SYLIBOS', href: { lit: SYLIB_URL } },
      body: { t: 'stack', gap: 8, children: [
        { t: 'when', cond: { src: 'study', path: 'available' }, then:
          { t: 'row', justify: 'space-between', children: [
            { t: 'stack', gap: 2, grow: true, children: [
              { t: 'text', text: { src: 'study', path: 'headline' }, variant: 'title' },
              { t: 'text', text: { src: 'study', path: 'subLine' }, variant: 'sub' },
            ] },
            { t: 'when', cond: { src: 'study', path: 'showStreak' }, then:
              { t: 'metric', value: { src: 'study', path: 'streak' }, unit: 'STREAK' } },
          ] } },
        { t: 'when', cond: { src: 'study', path: 'unavailable' }, then:
          { t: 'text', text: { src: 'study', path: 'offlineLabel' }, variant: 'sub' } },
      ] },
    },
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

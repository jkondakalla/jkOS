/**
 * hud/state.ts — load / persist / mutate the HUD document.
 *
 * Persisted per-user in the shared jkAuth preferences blob (`preferences.hud`),
 * the same cross-app store that holds theme/effects — so the dashboard syncs
 * across devices with no ORDECK backend. The engine, grid, and widgets all
 * consume HudState and never touch storage; only this module knows where it
 * lives. (Legacy localStorage docs are migrated up on first load.)
 */

import { getProfile, patchProfile } from '@jkos/auth-client';
import {
  HUD_STATE_VERSION,
  type BreakpointName,
  type GridItem,
  type HudState,
  type WidgetDef,
} from './types';
import { layoutForBreakpoint, placeAtBottom, activeBreakpoint } from './engine';
import { BREAKPOINTS } from './types';
import { appOrigin } from '@jkos/weave';

/** Legacy per-device key — read once to migrate existing layouts into prefs. */
const LEGACY_STORAGE_KEY = 'ordeck-hud-v4';

/** Handoff channel: the HUD stashes a WidgetDef here, then navigates to the
 *  workshop, which reads + clears it (the "edit this card" affordance). One
 *  constant so the writer (RoomHUD) and reader (WidgetWorkshop) can't drift. */
export const WIDGET_EDIT_KEY = 'ordeck-widget-edit';

/** "Open the app" links in the built-in specs come from the app manifest, so a
 *  domain change is one edit in @jkos/weave, not scattered across widget specs. */
const BB_URL = appOrigin('beigeboard');
const SYLIB_URL = appOrigin('sylibos');

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
  // The day at a glance, as one number: a ring of % of today's tasks completed.
  // Pure read over the `today` slice the Today widget already pulls — ships
  // shelved (in the registry, not the default layout → on the add strip).
  progress: {
    id: 'progress', label: 'Progress',
    sizing: { desktop: { w: 3, h: 6 }, mobile: { w: 2, h: 5 } },
    spec: {
      frame: { eyebrow: 'PROGRESS', source: 'BEIGEBOARD' },
      body: { t: 'stack', gap: 10, grow: true, children: [
        { t: 'when', cond: { src: 'today', path: 'showTasks' }, then:
          { t: 'gauge', value: { src: 'today', path: 'progress' }, max: 1,
            label: { src: 'today', path: 'progressLabel' } } },
        { t: 'when', cond: { src: 'today', path: 'signedOut' }, then:
          { t: 'text', text: 'SIGN IN TO TRACK PROGRESS', variant: 'sub' } },
        { t: 'when', cond: { src: 'today', path: 'showEmpty' }, then:
          { t: 'text', text: 'NOTHING SCHEDULED TODAY', variant: 'sub' } },
        { t: 'when', cond: { src: 'today', path: 'showOffline' }, then:
          { t: 'text', text: 'BEIGEBOARD OFFLINE', variant: 'sub' } },
      ] },
    },
  },
  // One feed for the whole suite: down systems, the task happening now, overdue
  // items, study reminders — derived (see deriveNotifications), not stored.
  notifications: {
    id: 'notifications', label: 'Notifications',
    sizing: { desktop: { w: 4, h: 8 }, mobile: { w: 2, h: 6 } },
    spec: {
      frame: { eyebrow: 'ALERTS', source: { src: 'notifications', path: 'summary' } },
      body: { t: 'list', from: { src: 'notifications', path: 'items' }, empty: 'ALL CLEAR — NO ALERTS',
        item: { t: 'row', gap: 10, children: [
          { t: 'icon', name: { src: '$', path: 'icon' }, tone: { src: '$', path: 'tone' }, size: 16 },
          { t: 'stack', gap: 1, grow: true, children: [
            { t: 'text', text: { src: '$', path: 'text' }, variant: 'mono', grow: true },
            { t: 'text', text: { src: '$', path: 'detail' }, variant: 'sub' },
          ] },
        ] } },
    },
  },
  // Capture a task to BeigeBoard from the HUD — an interactive (write) card, so
  // it's a bespoke component (see registry.tsx) rather than a read-only spec.
  quickadd: {
    id: 'quickadd', label: 'Quick Add',
    sizing: { desktop: { w: 4, h: 4 }, mobile: { w: 2, h: 3 } },
    component: 'quickadd',
  },
  // The single "now working on" task pushed from BeigeBoard. Interactive (it can
  // clear focus), so a bespoke component. When active, the HUD dims its siblings.
  focus: {
    id: 'focus', label: 'Focus',
    sizing: { desktop: { w: 4, h: 6 }, mobile: { w: 2, h: 5 } },
    component: 'focus',
  },
  // Declarative quick-add — a WRITE widget built entirely from the command
  // vocabulary (form + input + the beigeboard.createItem capability discovered at
  // runtime), NOT a bespoke component. The forward path that the `quickadd`
  // component card will fold into, and the canonical example the workshop + a
  // text→widget AI step emit. Ships shelved (additive via withBuiltins).
  taskadd: {
    id: 'taskadd', label: 'Add Task',
    sizing: { desktop: { w: 4, h: 4 }, mobile: { w: 2, h: 3 } },
    spec: {
      frame: { eyebrow: 'ADD TASK', source: 'BEIGEBOARD' },
      body: {
        t: 'form',
        cmd: {
          app: 'beigeboard', capability: 'createItem',
          body: {
            title:    { src: '$form', path: 'title' },
            due_date: { src: 'clock', path: 'iso' },   // lands on today
          },
        },
        submit: 'ADD',
        children: [
          { t: 'input', field: 'title', placeholder: 'Add a task…' },
        ],
      },
    },
  },
  // Tasks the user pinned in BeigeBoard, mirrored onto the HUD — read-only list.
  pinned: {
    id: 'pinned', label: 'Pinned',
    sizing: { desktop: { w: 4, h: 8 }, mobile: { w: 2, h: 6 } },
    spec: {
      frame: { eyebrow: 'PINNED', source: 'BEIGEBOARD' },
      body: { t: 'stack', gap: 8, grow: true, children: [
        { t: 'when', cond: { src: 'pinned', path: 'authed' }, then:
          { t: 'list', from: { src: 'pinned', path: 'items' }, empty: 'NOTHING PINNED — PIN A TASK IN BEIGEBOARD',
            item: { t: 'row', gap: 8, justify: 'space-between', children: [
              { t: 'text', text: { src: '$', path: 'timeLabel' }, variant: 'sub' },
              { t: 'text', text: { src: '$', path: 'title' }, variant: 'mono', grow: true },
              { t: 'dot', tone: { src: '$', path: 'tone' } },
            ] } },
          else: { t: 'text', text: 'SIGN IN TO SEE PINNED TASKS', variant: 'sub' } },
      ] },
    },
  },
  // The shared @jkos/cards Calendar + Week views, dropped in as HUD widgets via the
  // `component` escape hatch (see registry.tsx). Read-only here — no DragAdapter is
  // passed, so they render in light mode and never clash with the HUD grid's own drag.
  // Ship shelved (absent from DEFAULT_DESKTOP); add from the shelf.
  'bb-calendar': {
    id: 'bb-calendar', label: 'Calendar',
    sizing: { desktop: { w: 4, h: 8 }, mobile: { w: 2, h: 6 } },
    component: 'bb-calendar',
  },
  'bb-week': {
    id: 'bb-week', label: 'Week',
    sizing: { desktop: { w: 6, h: 8 }, mobile: { w: 2, h: 6 } },
    component: 'bb-week',
  },
  'bb-day': {
    id: 'bb-day', label: 'Day',
    sizing: { desktop: { w: 4, h: 8 }, mobile: { w: 2, h: 6 } },
    component: 'bb-day',
  },
  'bb-year': {
    id: 'bb-year', label: 'Year',
    sizing: { desktop: { w: 6, h: 9 }, mobile: { w: 2, h: 6 } },
    component: 'bb-year',
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

/** Accept a value as a HudState only if it matches the current schema version. */
function validHud(v: unknown): HudState | null {
  const s = v as HudState | null;
  return s && s.version === HUD_STATE_VERSION && s.widgets ? s : null;
}

/**
 * Ensure every built-in widget exists in a loaded doc's registry — WITHOUT
 * touching layout. A stored doc carries the widget set from when it was saved,
 * so new built-ins (added in a later release) would otherwise be invisible.
 * Additive only: existing defs are left as-is, so user/workshop customisations
 * and placements survive. New built-ins land on the shelf (absent from layout).
 */
function withBuiltins(state: HudState): HudState {
  let changed = false;
  const widgets = { ...state.widgets };
  for (const [id, def] of Object.entries(DEFAULT_WIDGETS)) {
    if (!widgets[id]) { widgets[id] = structuredClone(def); changed = true; }
  }
  return changed ? { ...state, widgets } : state;
}

/** Read the legacy per-device doc (pre-prefs). Returns null if absent/invalid. */
function readLegacy(): HudState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? validHud(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Load the HUD document from jkAuth prefs. Falls back to a legacy localStorage
 * doc (migrating it up to prefs), then to defaults. Async — the dashboard
 * renders defaults immediately and hydrates when this resolves.
 */
export async function loadHudState(): Promise<HudState> {
  let profileHud: HudState | null = null;
  try {
    const profile = await getProfile();
    profileHud = validHud(profile?.preferences?.hud);
  } catch {
    /* offline / signed out — fall through to legacy/defaults */
  }
  if (profileHud) return withBuiltins(profileHud);

  const legacy = readLegacy();
  if (legacy) {
    const merged = withBuiltins(legacy);
    saveHudState(merged);                        // migrate device → prefs
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }
    return merged;
  }
  return defaultHudState();
}

/* Debounced write-through: drag/resize fire rapidly, but the HUD doc is one
   small JSON blob and prefs is a merge-patch, so coalesce to one PATCH. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveHudState(state: HudState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    patchProfile({ hud: state }).catch(() => {
      /* a failed save is non-fatal — the in-memory HUD is still correct and the
         next mutation retries. */
    });
  }, 600);
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
  // Per-tier footprint, falling back to desktop when a tier isn't authored
  // (tablet is optional — see WidgetSizing).
  const size = def.sizing[bp.name] ?? def.sizing.desktop;
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

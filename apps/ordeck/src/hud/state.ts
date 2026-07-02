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
  type Breakpoint,
  type BreakpointLayouts,
  type BreakpointName,
  type GridItem,
  type HudState,
  type WidgetDef,
} from './types';
import { layoutForBreakpoint, placeAtBottom } from './engine';
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

/** The v5 built-in catalog — 10 widgets, culled + redesigned for information
 *  density (waste no allotted space; absorb one-number cards into their parent).
 *  The fold-ins: quick-add lives INSIDE Today as a command form; progress is
 *  Today's head caption + bar; uptime is Systems' head + bar. Month is the dense
 *  `calendar` dot molecule; Week is the one @jkos/cards view that earns its
 *  footprint. Everything except Focus/Week is a declarative spec — editable in
 *  the workshop and the exact shape a text→widget AI step will emit. */
const DEFAULT_WIDGETS: Record<string, WidgetDef> = {
  clock: {
    id: 'clock', label: 'Clock',
    sizing: { desktop: { w: 4, h: 3 }, mobile: { w: 2, h: 3 } },
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
  // A real spec now (not the molecule): icon + temp + hi/lo on one row, hourly
  // strip pinned to the card's bottom edge. Fully editable in the workshop.
  weather: {
    id: 'weather', label: 'Weather',
    sizing: { desktop: { w: 4, h: 4 }, mobile: { w: 2, h: 4 } },
    spec: {
      frame: { eyebrow: 'WEATHER', source: { src: 'weather', path: 'label' } },
      body: { t: 'when', cond: { src: 'weather', path: 'ready' },
        then: { t: 'stack', gap: 10, grow: true, justify: 'space-between', children: [
          { t: 'row', gap: 12, children: [
            { t: 'icon', name: { src: 'weather', path: 'icon' }, size: 30 },
            { t: 'stack', gap: 3, grow: true, children: [
              { t: 'metric', value: { src: 'weather', path: 'temp' }, unit: '°F' },
              { t: 'text', text: { src: 'weather', path: 'descLine' }, variant: 'sub' },
            ] },
            { t: 'stack', gap: 4, children: [
              { t: 'text', text: { src: 'weather', path: 'hiLabel' }, variant: 'mono' },
              { t: 'text', text: { src: 'weather', path: 'loLabel' }, variant: 'sub' },
            ] },
          ] },
          { t: 'when', cond: { src: 'weather', path: 'slots' }, then:
            { t: 'stack', gap: 6, children: [
              { t: 'divider' },
              { t: 'list', from: { src: 'weather', path: 'slots' }, dir: 'row',
                item: { t: 'stack', gap: 2, children: [
                  { t: 'label', text: { src: '$', path: 'label' }, size: 'xs' },
                  { t: 'text', text: { src: '$', path: 'tempLabel' }, variant: 'mono' },
                ] } },
            ] } },
        ] },
        else: { t: 'text', text: { src: 'weather', path: 'statusLabel' }, variant: 'sub' },
      },
    },
  },
  // The flagship: agenda + progress (head caption + bar) + inline quick-add
  // (command form, pinned to the bottom edge). Dense rows — time · title · dot.
  today: {
    id: 'today', label: 'Today',
    sizing: { desktop: { w: 5, h: 13 }, mobile: { w: 2, h: 8 } },
    spec: {
      frame: { eyebrow: 'TODAY', source: { src: 'today', path: 'progressLabel' } },
      body: { t: 'stack', gap: 8, grow: true, children: [
        { t: 'when', cond: { src: 'today', path: 'signedOut' }, then:
          { t: 'stack', gap: 8, grow: true, children: [
            { t: 'text', text: 'SIGN IN TO SEE YOUR DAY', variant: 'sub' },
            { t: 'link', text: 'LOG IN', href: { src: 'authUrl' } },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'showOffline' }, then:
          { t: 'stack', gap: 8, grow: true, children: [
            { t: 'text', text: 'BEIGEBOARD OFFLINE', variant: 'sub' },
            { t: 'link', text: 'OPEN BEIGEBOARD', href: { lit: BB_URL } },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'showEmpty' }, then:
          { t: 'stack', gap: 8, grow: true, children: [
            { t: 'text', text: { src: 'today', path: 'emptyLabel' }, variant: 'sub' },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'showTasks' }, then:
          { t: 'stack', gap: 8, grow: true, children: [
            { t: 'bar', value: { src: 'today', path: 'progress' }, max: 1 },
            { t: 'list', from: { src: 'today', path: 'tasks' },
              item: { t: 'row', gap: 8, justify: 'space-between', children: [
                { t: 'text', text: { src: '$', path: 'timeLabel' }, variant: 'sub' },
                { t: 'text', text: { src: '$', path: 'title' }, variant: 'mono', grow: true },
                { t: 'dot', tone: { src: '$', path: 'tone' } },
              ] } },
          ] } },
        { t: 'when', cond: { src: 'today', path: 'canAdd' }, then:
          { t: 'form',
            cmd: {
              app: 'beigeboard', capability: 'createItem',
              body: {
                title:    { src: '$form', path: 'title' },
                due_date: { src: 'clock', path: 'iso' },   // lands on today
              },
            },
            submit: 'ADD',
            children: [
              { t: 'input', field: 'title', placeholder: 'Add a task for today…' },
            ] } },
      ] },
    },
  },
  // The month at a glance — the dense dot molecule (done/pending per day), not
  // the chip view: at HUD widths dots carry more signal per pixel than
  // truncated titles. Week (below) is the titles view.
  calendar: {
    id: 'calendar', label: 'Calendar',
    sizing: { desktop: { w: 4, h: 6 }, mobile: { w: 2, h: 5 } },
    spec: { body: { t: 'calendar' } },
  },
  // Absorbs the old `uptime` card: the "3 / 4 UP" head caption it always had,
  // plus the fill bar, over the same probe rows.
  systems: {
    id: 'systems', label: 'Systems',
    sizing: { desktop: { w: 3, h: 5 }, mobile: { w: 2, h: 4 } },
    spec: {
      frame: { eyebrow: 'SYSTEMS', source: { src: 'systems', path: 'summary' } },
      body: { t: 'stack', gap: 10, grow: true, children: [
        { t: 'bar', value: { src: 'systems', path: 'up' }, max: { src: 'systems', path: 'total' } },
        { t: 'list', from: { src: 'systems', path: 'rows' }, empty: 'NO PROBES',
          item: { t: 'row', gap: 8, children: [
            { t: 'dot', tone: { src: '$', path: 'tone' } },
            { t: 'text', text: { src: '$', path: 'name' }, variant: 'mono', grow: true },
            { t: 'text', text: { src: '$', path: 'detail' }, variant: 'sub' },
          ] } },
      ] },
    },
  },
  // One feed for the whole suite: down systems, the task happening now, overdue
  // items, study reminders — derived (see deriveNotifications), not stored.
  // Single-line rows: icon · text · detail.
  notifications: {
    id: 'notifications', label: 'Alerts',
    sizing: { desktop: { w: 3, h: 5 }, mobile: { w: 2, h: 4 } },
    spec: {
      frame: { eyebrow: 'ALERTS', source: { src: 'notifications', path: 'summary' } },
      body: { t: 'list', from: { src: 'notifications', path: 'items' }, empty: 'ALL CLEAR — NO ALERTS',
        item: { t: 'row', gap: 8, children: [
          { t: 'icon', name: { src: '$', path: 'icon' }, tone: { src: '$', path: 'tone' }, size: 14 },
          { t: 'text', text: { src: '$', path: 'text' }, variant: 'mono', grow: true },
          { t: 'text', text: { src: '$', path: 'detail' }, variant: 'sub' },
        ] } },
    },
  },
  study: {
    id: 'study', label: 'Study',
    sizing: { desktop: { w: 3, h: 3 }, mobile: { w: 2, h: 3 } },
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
              { t: 'metric', value: { src: 'study', path: 'streak' }, unit: 'STREAK', size: 22 } },
          ] } },
        { t: 'when', cond: { src: 'study', path: 'unavailable' }, then:
          { t: 'text', text: { src: 'study', path: 'offlineLabel' }, variant: 'sub' } },
      ] },
    },
  },
  // The single "now working on" task pushed from BeigeBoard. Interactive (it can
  // clear focus), so a bespoke component. When active, the HUD dims its siblings.
  // Ships shelved.
  focus: {
    id: 'focus', label: 'Focus',
    sizing: { desktop: { w: 4, h: 4 }, mobile: { w: 2, h: 4 } },
    component: 'focus',
  },
  // Tasks the user pinned in BeigeBoard, mirrored onto the HUD — read-only list,
  // same dense row template as Today. Ships shelved.
  pinned: {
    id: 'pinned', label: 'Pinned',
    sizing: { desktop: { w: 4, h: 5 }, mobile: { w: 2, h: 4 } },
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
  // The shared @jkos/cards Week view via the `component` escape hatch (see
  // registry.tsx) — read-only (no DragAdapter → no clash with the HUD grid's
  // drag). The planning horizon the month dots can't give. Ships shelved.
  'bb-week': {
    id: 'bb-week', label: 'Week',
    sizing: { desktop: { w: 6, h: 8 }, mobile: { w: 2, h: 6 } },
    component: 'bb-week',
  },
};

/** Default desktop arrangement (12-col) — every column lands flush at 13 rows:
 *  left 3+4+6, centre 13, right 5+5+3. Mobile is derived by the engine (reflow
 *  → strict 2-col stack) unless the user pins an explicit mobile layout. */
const DEFAULT_DESKTOP: GridItem[] = [
  { i: 'clock',         x: 0, y: 0,  w: 4, h: 3 },
  { i: 'weather',       x: 0, y: 3,  w: 4, h: 4 },
  { i: 'calendar',      x: 0, y: 7,  w: 4, h: 6 },
  { i: 'today',         x: 4, y: 0,  w: 5, h: 13 },
  { i: 'systems',       x: 9, y: 0,  w: 3, h: 5 },
  { i: 'notifications', x: 9, y: 5,  w: 3, h: 5 },
  { i: 'study',         x: 9, y: 10, w: 3, h: 3 },
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

/**
 * Merge the admin-published registry (jkAuth /auth/widgets) into a loaded doc.
 * A published def ALWAYS wins over the stored copy under the same id — this is
 * what makes "edit → re-publish" show up on the HUD instead of the stale form.
 * Two extras beyond a plain overwrite:
 *
 *  • Author-resize follow: a placed card whose footprint still equals the OLD
 *    def's default for that tier snaps to the NEW default — so publishing a
 *    size change is visible. A card the user resized themselves keeps its size
 *    (their layout is their document). Overlaps a grown card creates are
 *    resolved by the engine's compaction on render.
 *
 *  • Hygiene: a stored def that is neither a built-in, nor currently published,
 *    nor placed in any layout is dropped (with its shelf entry) — unpublished
 *    widgets must not linger as dead catalog entries. Only call this with a
 *    SUCCESSFUL registry fetch; on failure keep the doc untouched.
 */
export function mergePublished(state: HudState, published: WidgetDef[]): HudState {
  const widgets = { ...state.widgets };
  const layouts: BreakpointLayouts = { ...state.layouts };
  const pubIds = new Set<string>();

  for (const w of published) {
    if (!w || typeof w.id !== 'string' || !w.id) continue;
    pubIds.add(w.id);
    const prev = widgets[w.id];
    widgets[w.id] = w;
    if (!prev?.sizing || !w.sizing) continue;
    for (const [name, items] of Object.entries(layouts) as [BreakpointName, GridItem[]][]) {
      if (!items) continue;
      const prevSize = prev.sizing[name] ?? prev.sizing.desktop;
      const nextSize = w.sizing[name] ?? w.sizing.desktop;
      if (prevSize.w === nextSize.w && prevSize.h === nextSize.h) continue;
      layouts[name] = items.map((it) =>
        it.i === w.id && it.w === prevSize.w && it.h === prevSize.h
          ? { ...it, w: nextSize.w, h: nextSize.h }
          : it,
      );
    }
  }

  const placed = new Set<string>();
  for (const items of Object.values(layouts)) for (const it of items ?? []) placed.add(it.i);
  for (const id of Object.keys(widgets)) {
    if (DEFAULT_WIDGETS[id] || pubIds.has(id) || placed.has(id)) continue;
    delete widgets[id];
  }
  const shelf = state.shelf.filter((id) => !!widgets[id]);

  return { ...state, widgets, layouts, shelf };
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

/** Place a shelved widget into a breakpoint's layout, at the bottom of the
 *  stack, using its default footprint. Other tiers re-derive on render. The
 *  caller passes the tier the GRID is showing (HudGrid onBreakpoint) — resolving
 *  from window width here would target the wrong tier near tier boundaries. */
export function placeFromShelf(state: HudState, id: string, bp: Breakpoint): HudState {
  const def = state.widgets[id];
  if (!def) return state;
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

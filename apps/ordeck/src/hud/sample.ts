/**
 * hud/sample.ts — the data a widget preview (and the Workshop's gallery) renders against.
 *
 * Built through the SAME pure selectors the live HUD runs (clockState, viewWeather,
 * viewSystems, selectToday, selectMonth, selectCalendarItems, selectFocus,
 * selectPinned, deriveNotifications), over fixed inputs — so a preview shows exactly
 * what the HUD would draw for that data, never a hand-typed slice that has drifted
 * from the real shape. If a slice is added to WidgetCtx, this stops compiling.
 *
 * One ctx per preview STATE. The built-in slices express state through their own
 * flags (signedOut, showOffline, ready…); a declared source's state is answered by
 * fixtureReader below, from the widget's fixtures file.
 */

import type { HudFocus, HudPin } from '@jkos/auth-client';
import { readDataset, fetchDatasets, getDataset } from '@jkos/weave';
import { readExternal, type SourceReader } from '@jkos/widget-render';
import { PINNED_MS } from './pinned';
import { APP_IDS, appOrigin } from '@jkos/weave';
import type { WidgetCtx } from './host';
import {
  clockState, viewWeather, viewSystems, sysRow, selectToday, selectMonth, selectCalendarItems,
  selectFocus, selectPinned, deriveNotifications, type BbItem, type BbItemsState, type WeatherBase,
} from '../pages/hud/useHudData';

export type PreviewState = 'ready' | 'empty' | 'offline' | 'signed-out' | 'loading';
export const PREVIEW_STATES: PreviewState[] = ['ready', 'empty', 'offline', 'signed-out', 'loading'];

/** The clock is pinned (./clock.ts pins the page's Date to the same instant), so every
 *  preview reads the same — and "today", which the selectors date from `new Date()`, is
 *  the pinned day too. */
const PINNED = new Date(PINNED_MS);

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

let nextId = 1;
const item = (title: string, due: string | null, time: string | null, end: string | null, done = false, kind = 'task'): BbItem => ({
  id: nextId++, title, kind, scope: 'day', due_date: due, end_date: null,
  scheduled_time: time, scheduled_end: end, completed: done, updated_at: null,
});

const TODAY = dayOffset(0);
const ITEMS: BbItem[] = [
  item('Standup with the platform team', TODAY, '09:00', '09:15', true, 'event'),
  item('Review the access-control matrix', TODAY, '09:30', '10:30'),
  item('Reconcile the Q3 change log', TODAY, '11:00', null),
  item('Lunch', TODAY, '12:30', '13:15', false, 'event'),
  item('Write up the segregation-of-duties finding', TODAY, '14:00', '15:30'),
  item('Walk', TODAY, '17:30', null, false, 'habit'),
  item('Rotate the service-client secrets', dayOffset(-2), null, null),
  item('Draft the audit scoping memo', dayOffset(1), '10:00', '11:00'),
  item('Evidence request: user provisioning', dayOffset(3), null, null),
  item('Quarterly access review', dayOffset(7), '09:00', '12:00', false, 'event'),
  item('File the expense report', dayOffset(-5), null, null, true),
];

const WEATHER: Omit<WeatherBase, 'loaded' | 'offline'> = {
  label: 'SAN JOSE', source: 'open-meteo', temp: 71, feels: 70, desc: 'Partly cloudy', hi: 78, lo: 55,
  slots: [9, 12, 15, 18, 21].map((h, i) => {
    const temp = [62, 70, 76, 73, 64][i];
    return { label: h < 12 ? `${h}A` : h === 12 ? '12P' : `${h - 12}P`, temp, tempLabel: `${temp}°` };
  }),
};

const FOCUS: HudFocus = { app: 'beigeboard', id: String(ITEMS[1].id), label: ITEMS[1].title, deeplink: '/' };
const PINS: HudPin[] = [ITEMS[2], ITEMS[4], ITEMS[7]].map((i) => ({ app: 'beigeboard', id: String(i.id), label: i.title }));

export function sampleCtx(state: PreviewState): WidgetCtx {
  const clock = clockState(PINNED);
  const bb: BbItemsState = {
    loaded: state !== 'loading',
    authed: state !== 'signed-out',
    offline: state === 'offline',
    items: state === 'ready' ? ITEMS : [],
  };
  const weather = viewWeather(state === 'loading'
    ? { loaded: false, offline: false, ...WEATHER, slots: [] }
    : state === 'offline'
      ? { loaded: true, offline: true, ...WEATHER, slots: [] }
      : { loaded: true, offline: false, ...WEATHER, slots: state === 'empty' ? [] : WEATHER.slots });
  const systems = viewSystems(
    state === 'loading' ? ['auth', 'beigeboard', 'kouros', 'lazuros'].map((n) => sysRow(n, 'probing', '—'))
      : state === 'offline' ? ['auth', 'beigeboard', 'kouros', 'lazuros'].map((n) => sysRow(n, 'down', 'down'))
        : state === 'empty' ? []
          : [sysRow('auth', 'up', '12 ms'), sysRow('beigeboard', 'up', '18 ms'), sysRow('kouros', 'up', '24 ms'), sysRow('lazuros', 'warn', 'gpu asleep')],
  );
  const today = selectToday(bb, clock.hm);
  return {
    clock,
    weather,
    systems,
    today,
    cal: selectMonth(bb),
    items: selectCalendarItems(bb),
    todayIso: clock.iso,
    notifications: deriveNotifications({ today, systems, now: clock.hm }),
    focus: selectFocus(state === 'ready' ? FOCUS : null, bb),
    pinned: selectPinned(state === 'ready' ? PINS : [], bb),
    authUrl: '/auth',
    origins: Object.fromEntries(APP_IDS.map((id) => [id, appOrigin(id)])) as WidgetCtx['origins'],
    aiEnabled: true,
  };
}

/**
 * How a widget's sources are read for one preview STATE — shared by the preview harness
 * and the Workshop's gallery, so both draw a state the same way. The REAL reader's steps
 * stay: a dataset is discovered through its app's declaration and its answer held to it
 * (readDataset), a suite URL in a fetch source is refused (readExternal). Only the request
 * itself is answered: from the widget's fixtures (`<id>.fixtures.json`: state → source →
 * answer), else the empty answer for what the source is ([] for a list, null for one
 * document); offline is a 503, signed-out a 401, loading never answers.
 */
export function fixtureReader(state: PreviewState, fixtures: Record<string, Record<string, unknown>> | null | undefined): SourceReader {
  return async (name, source, params) => {
    const answer = async (): Promise<Response> => {
      if (state === 'loading') return new Promise<Response>(() => {});
      if (state === 'offline') return new Response('{"error":"unavailable"}', { status: 503 });
      if (state === 'signed-out') return new Response('{"error":"Not authenticated"}', { status: 401 });
      let body = fixtures?.[state]?.[name];
      if (body === undefined) {
        const one = source.kind === 'dataset'
          && getDataset(await fetchDatasets(source.app), source.dataset)?.cardinality === 'one';
        body = one ? null : [];
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    if (source.kind === 'dataset') {
      const r = await readDataset(source.app, source.dataset, params, { fetch: answer });
      return { ...r, invalidates: r.def?.invalidates };
    }
    if (source.kind === 'fetch') return readExternal(source.url, answer);
    return { state: 'unavailable', error: 'unknown source kind' };
  };
}

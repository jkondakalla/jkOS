/**
 * preview/sample.ts — the data a widget preview renders against.
 *
 * Built through the SAME pure selectors the live HUD runs (clockState, viewWeather,
 * viewSystems, selectToday, selectMonth, selectCalendarItems, selectFocus,
 * selectPinned, deriveNotifications), over fixed inputs — so a preview shows exactly
 * what the HUD would draw for that data, never a hand-typed slice that has drifted
 * from the real shape. If a slice is added to WidgetCtx, this stops compiling.
 *
 * One ctx per preview STATE. The built-in slices express state through their own
 * flags today (signedOut, showOffline, ready…); a fetch source's state is served by
 * the harness (see main.tsx).
 */

import type { HudFocus, HudPin } from '@jkos/auth-client';
import type { WidgetCtx } from '../src/hud/registry';
import {
  clockState, viewWeather, viewSystems, sysRow, selectToday, selectMonth, selectCalendarItems,
  selectFocus, selectPinned, deriveNotifications, type BbItem, type BbItemsState, type WeatherBase,
} from '../src/pages/hud/useHudData';

export type PreviewState = 'ready' | 'empty' | 'offline' | 'signed-out' | 'loading';
export const PREVIEW_STATES: PreviewState[] = ['ready', 'empty', 'offline', 'signed-out', 'loading'];

/** The clock is pinned, so every preview of a clock reads the same. The selectors
 *  date "today" from the real calendar, so the sample items are dated from it too. */
const PINNED = new Date(2026, 8, 28, 9, 41, 27);

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
  };
}

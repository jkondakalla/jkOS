/**
 * hud/slices.ts — ORDECK's own declaration: every HUD slice a widget may bind, and its
 * fields.
 *
 * An app declares what can be READ from it in a DatasetDoc; ORDECK has no backend and
 * its slices were declared nowhere a tool could read. The Workshop's path suggestions
 * came from a hand-kept HUD_SCHEMA / HUD_ITEM_FIELDS beside the interfaces, which had
 * drifted (no `loaded`, `offline` or `source` on weather; `today` without `loaded`,
 * `offline` or `tasks`' fields). An agent binding a slice had to read useHudData.ts.
 *
 * Now each slice is declared in the SAME field vocabulary a dataset uses (weave's
 * BodyField: type, label, enum, of, item, schema), and each one is typed against its
 * interface — `Fields<ClockState>` must name every key of ClockState and nothing else —
 * so adding, renaming or dropping a slice field without declaring it is a tsc error
 * (the gate's check:build runs tsc). The validator's second tier and the Workshop both
 * read it: a binding into a slice is checked the way a binding into a dataset is.
 *
 * Pure data with type-only imports, so a Node tool can transpile and read it.
 */

import type { FieldType } from '@jkos/weave';
import type {
  ClockState, WeatherState, WeatherSlot, SystemsState, SysRow, TodayState, TodayTask, MonthCalState, CalDay,
  NotificationsState, Notification, FocusState, PinnedState, PinnedTask,
} from '../pages/hud/useHudData';
import type { WidgetCtx } from './registry';

/** One declared field — the slice of weave's BodyField a reader binds against. */
export interface SliceField {
  type: FieldType;
  label?: string;
  enum?: readonly string[];
  /** A json list of scalars. */
  of?: FieldType;
  /** A json list of rows (or one object): its fields. */
  item?: SliceShape;
  /** Where a json field's shape is declared instead ('<app>.<dataset>'). */
  schema?: string;
  /** A ref's target, '<app>.<dataset>'. */
  ref?: string;
}
export type SliceShape = Readonly<Record<string, SliceField>>;

/** Every key of T, required or not — so a new field on the interface must be declared. */
type Fields<T> = { readonly [K in keyof Required<T>]: SliceField };

const TONE = ['ok', 'warn', 'danger', 'muted', 'accent'] as const;
const s = (label?: string): SliceField => ({ type: 'string', ...(label ? { label } : {}) });
const n = (label?: string): SliceField => ({ type: 'number', ...(label ? { label } : {}) });
const b = (label?: string): SliceField => ({ type: 'boolean', ...(label ? { label } : {}) });
const tone = (label?: string): SliceField => ({ type: 'enum', enum: TONE, ...(label ? { label } : {}) });
const rows = <T>(item: Fields<T>, label?: string): SliceField => ({ type: 'json', item, ...(label ? { label } : {}) });

const CLOCK: Fields<ClockState> = {
  hm: s('"09:41"'), ss: s('"27"'), dateLine: s('"MONDAY · SEP 28"'), utcShort: s('"14:41"'), jday: s('Day of the year, "271"'),
  utcLine: s('"UTC 14:41 · DAY 271"'), iso: { type: 'date', label: "Today's local date" }, now: n('This instant, epoch ms'),
};
const SLOT: Fields<WeatherSlot> = { label: s('"9A"'), temp: n(), tempLabel: s('"72°"') };
const WEATHER: Fields<WeatherState> = {
  loaded: b(), offline: b(), label: s('The place'), source: { type: 'enum', enum: ['accuweather', 'open-meteo'] },
  temp: n('°F'), feels: n('°F'), desc: s(), hi: n(), lo: n(), slots: rows(SLOT, 'The next hours'),
  ready: b('loaded and online — bind the body to this'), statusLabel: s('"LOADING…" | "WEATHER FEED OFFLINE"'),
  icon: s('An icon name'), descLine: s('"Partly cloudy · feels 74°"'), hiLabel: s('"H 78°"'), loLabel: s('"L 55°"'),
};
const SYS_ROW: Fields<SysRow> = {
  name: s(), status: { type: 'enum', enum: ['up', 'down', 'warn', 'probing'] }, detail: s('"12 ms" | "gpu asleep"'), tone: tone(),
};
const SYSTEMS: Fields<SystemsState> = { rows: rows(SYS_ROW), up: n(), total: n(), summary: s('"3 / 4 UP"') };
const TASK: Fields<TodayTask> = {
  id: { type: 'ref', ref: 'beigeboard.items', label: 'The BeigeBoard item' }, time: { type: 'time' }, endTime: { type: 'time' },
  title: s(), tag: s(), done: b(), timeLabel: s('time, or "—"'), now: b('Happening right now'),
  tone: tone('ok = done, accent = now, muted = upcoming'), stateLabel: s('"DONE" | "NOW" | the tag'),
};
const TODAY: Fields<TodayState> = {
  loaded: b(), authed: b(), offline: b(), tasks: rows(TASK, "Today's items, in time order"), doneCount: n(),
  progressLabel: s('"2 / 5"'), progress: n('0..1'), signedOut: b('Show-if: not signed in'),
  showOffline: b('Show-if: signed in, BeigeBoard unreachable'), showTasks: b('Show-if: there are tasks'),
  showEmpty: b('Show-if: signed in, online, nothing today'), emptyLabel: s(), canAdd: b('A write can land (signed in, online)'),
};
const DAY: Fields<CalDay> = { date: { type: 'date' }, count: n(), doneCount: n() };
const CAL: Fields<MonthCalState> = { loaded: b(), authed: b(), year: n(), month: n('0-indexed'), days: rows(DAY, 'Days with items') };
const NOTE: Fields<Notification> = { id: s(), icon: s('An icon name'), tone: tone(), text: s(), detail: s() };
const NOTIFICATIONS: Fields<NotificationsState> = { items: rows(NOTE, 'Most urgent first'), count: n(), empty: b(), summary: s('"2 ALERTS" | "ALL CLEAR"') };
const FOCUS: Fields<FocusState> = {
  loaded: b(), authed: b(), active: b('Something is in focus'), app: s('Which app it lives in'), id: s(), title: s(),
  timeLabel: s(), tag: s(), done: b(), deeplink: s('A URL back to it in its app'),
};
const PIN: Fields<PinnedTask> = {
  id: s(), app: s(), title: s(), timeLabel: s(), tag: s(), done: b(), tone: tone('ok = done, accent = open'), deeplink: s(),
};
const PINNED: Fields<PinnedState> = { loaded: b(), authed: b(), items: rows(PIN), count: n(), empty: b('Signed in, loaded, nothing pinned') };

/** Every slice in a widget's scope, by the name a binding's `src` uses. */
export const HUD_SLICES: { readonly [K in keyof WidgetCtx]-?: SliceField } = {
  clock: { type: 'json', label: 'The time, ticking every second', item: CLOCK },
  weather: { type: 'json', label: 'The forecast (open-meteo, or AccuWeather with a key)', item: WEATHER },
  systems: { type: 'json', label: "Each app's health probe", item: SYSTEMS },
  today: { type: 'json', label: "Today's BeigeBoard items", item: TODAY },
  cal: { type: 'json', label: 'This month, per day', item: CAL },
  items: { type: 'json', label: "BeigeBoard's items, as the calendar kit reads them", schema: 'beigeboard.items' },
  todayIso: { type: 'date', label: "Today's local date" },
  notifications: { type: 'json', label: 'One feed of what needs attention, across the suite', item: NOTIFICATIONS },
  focus: { type: 'json', label: 'The one item in focus, pushed from BeigeBoard', item: FOCUS },
  pinned: { type: 'json', label: 'Items pinned in BeigeBoard', item: PINNED },
  authUrl: { type: 'string', label: 'Where to sign in' },
};

/** The fields a binding may reach at `src` (a slice's own fields), for suggestions. */
export function sliceFields(src: string): string[] {
  const f = (HUD_SLICES as Record<string, SliceField>)[src];
  return f?.item ? Object.keys(f.item) : [];
}

/** Every field a list's `$` element can have, across the slices' lists — the `$`
 *  suggestions when the editor does not know which list an item is in. */
export function listItemFields(): string[] {
  const out = new Set<string>();
  for (const slice of Object.values(HUD_SLICES as Record<string, SliceField>)) {
    for (const f of Object.values(slice.item ?? {})) if (f.item) Object.keys(f.item).forEach((k) => out.add(k));
  }
  return [...out];
}

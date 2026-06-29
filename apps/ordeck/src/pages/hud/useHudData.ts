import { useState, useEffect, useCallback, useMemo } from 'react';
import { getProfile, authFetch, type HudPin, type HudFocus } from '@jkos/auth-client';
import { usePolledResource, invalidate, apiBase, resourceKey, probeApps, extRef, type SuiteApp } from '@jkos/weave';
import { isoDate, type CalendarItem } from '@jkos/cards';
import { TONE_RANK, type Tone } from '../../hud/tone';

/* Data hooks for the room HUD. All service calls are same-origin paths proxied
   by the edge nginx (cookies flow, no CORS); the proxied roots come from the app
   manifest (@jkos/weave), not hardcoded here. Every hook fails soft — a dead
   service renders an offline state, never an error boundary.

   The fetch/poll/teardown plumbing lives in usePolledResource (@jkos/weave);
   each hook here just declares its fetcher + how it maps failure into its own
   shape. Writes signal refetches through the keyed invalidation bus
   (invalidate('beigeboard.items') etc.) rather than per-feature window events. */

const pad = (n: number) => String(n).padStart(2, '0');
// isoDate (local-tz YYYY-MM-DD) comes from @jkos/cards — one source for the suite.

// ── Clock ────────────────────────────────────────────────────────────────────

const WD = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MO = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export interface ClockState {
  hm: string;
  ss: string;
  dateLine: string;
  utcShort: string;
  jday: string;
  /** Composed "UTC hh:mm · DAY ddd" — a single bindable line for the spec factory. */
  utcLine: string;
  /** Today's local date (YYYY-MM-DD) — a bindable "today" for command bodies
   *  (e.g. a quick-add form defaulting due_date to today). */
  iso: string;
}

export function useClock(): ClockState {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  const utcShort = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const jday = String(Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000)).padStart(3, '0');
  return {
    hm: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    ss: pad(now.getSeconds()),
    dateLine: `${WD[now.getDay()]} · ${MO[now.getMonth()]} ${pad(now.getDate())}`,
    utcShort,
    jday,
    utcLine: `UTC ${utcShort} · DAY ${jday}`,
    iso: isoDate(now),
  };
}

// ── Weather (AccuWeather when key set, open-meteo fallback) ──────────────────

export const WEATHER_STORAGE_KEY = 'ordeck-weather';
const DEFAULT_LOC = { lat: 37.34, lon: -121.89, label: 'SAN JOSE' };

const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

export interface WeatherConfig {
  lat: number;
  lon: number;
  label: string;
  accuweatherKey: string;
  acWeatherLocKey: string;
}

export interface WeatherSlot { label: string; temp: number }
export interface WeatherState {
  loaded: boolean;
  offline: boolean;
  label: string;
  source: 'accuweather' | 'open-meteo';
  temp: number;
  feels: number;
  desc: string;
  hi: number;
  lo: number;
  slots: WeatherSlot[];
}

export function weatherConfig(): WeatherConfig {
  try {
    const raw = localStorage.getItem(WEATHER_STORAGE_KEY);
    if (raw) return { ...DEFAULT_LOC, accuweatherKey: '', acWeatherLocKey: '', ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_LOC, accuweatherKey: '', acWeatherLocKey: '' };
}

export function saveWeatherConfig(cfg: Partial<WeatherConfig>) {
  const cur = weatherConfig();
  localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({ ...cur, ...cfg }));
}

// Like saveWeatherConfig but tells a live HUD to re-fetch immediately. (Used by
// settings "Save"; the internal location-key cache uses the plain saver so it
// doesn't trigger a redundant reload.)
export function saveWeatherConfigLive(cfg: Partial<WeatherConfig>) {
  saveWeatherConfig(cfg);
  invalidate('weather.config');
}

// Fetch AccuWeather location key once and cache it in localStorage.
async function acuLocationKey(cfg: WeatherConfig): Promise<string> {
  if (cfg.acWeatherLocKey) return cfg.acWeatherLocKey;
  const r = await fetch(
    `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${cfg.accuweatherKey}&q=${cfg.lat},${cfg.lon}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) throw new Error('AccuWeather location lookup failed');
  const d = await r.json();
  const key: string = d.Key;
  saveWeatherConfig({ acWeatherLocKey: key });
  return key;
}

type WeatherData = Omit<WeatherState, 'loaded' | 'offline'>;

async function fetchAccuWeather(cfg: WeatherConfig): Promise<WeatherData> {
  const locKey = await acuLocationKey(cfg);
  const [curR, dayR] = await Promise.all([
    fetch(`https://dataservice.accuweather.com/currentconditions/v1/${locKey}?apikey=${cfg.accuweatherKey}&details=true`, { signal: AbortSignal.timeout(8000) }),
    fetch(`https://dataservice.accuweather.com/forecasts/v1/daily/1day/${locKey}?apikey=${cfg.accuweatherKey}`, { signal: AbortSignal.timeout(8000) }),
  ]);
  if (!curR.ok || !dayR.ok) throw new Error('AccuWeather fetch failed');
  const [cur, day] = await Promise.all([curR.json(), dayR.json()]);
  const c = cur[0];
  const df = day.DailyForecasts?.[0];
  return {
    label: cfg.label,
    source: 'accuweather',
    temp: Math.round(c.Temperature?.Imperial?.Value ?? 0),
    feels: Math.round(c.RealFeelTemperature?.Imperial?.Value ?? 0),
    desc: c.WeatherText ?? '—',
    hi: Math.round(df?.Temperature?.Maximum?.Value ?? 0),
    lo: Math.round(df?.Temperature?.Minimum?.Value ?? 0),
    slots: [],
  };
}

async function fetchOpenMeteo(cfg: WeatherConfig): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min&hourly=temperature_2m` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('open-meteo failed');
  const d = await r.json();
  const hours = [9, 12, 15, 18, 21];
  const slots: WeatherSlot[] = hours.map(h => ({
    label: h < 12 ? `${h}A` : h === 12 ? '12P' : `${h - 12}P`,
    temp: Math.round(d.hourly?.temperature_2m?.[h] ?? 0),
  }));
  return {
    label: cfg.label,
    source: 'open-meteo',
    temp: Math.round(d.current.temperature_2m),
    feels: Math.round(d.current.apparent_temperature),
    desc: WMO[d.current.weather_code] ?? '—',
    hi: Math.round(d.daily.temperature_2m_max[0]),
    lo: Math.round(d.daily.temperature_2m_min[0]),
    slots,
  };
}

export function useWeather(): WeatherState {
  const cfg = weatherConfig();
  const initial: WeatherState = {
    loaded: false, offline: false, label: cfg.label, source: 'open-meteo',
    temp: 0, feels: 0, desc: '', hi: 0, lo: 0, slots: [],
  };
  const fetcher = useCallback(async (): Promise<WeatherState> => {
    const c = weatherConfig();
    try {
      const data = c.accuweatherKey ? await fetchAccuWeather(c) : await fetchOpenMeteo(c);
      return { loaded: true, offline: false, ...data };
    } catch {
      return {
        loaded: true, offline: true, label: c.label,
        source: c.accuweatherKey ? 'accuweather' : 'open-meteo',
        temp: 0, feels: 0, desc: '', hi: 0, lo: 0, slots: [],
      };
    }
  }, []);
  // AccuWeather: 60 min to stay within 50 calls/day free tier. open-meteo: 15 min.
  const intervalMs = cfg.accuweatherKey ? 60 * 60_000 : 15 * 60_000;
  return usePolledResource(fetcher, initial, { intervalMs, invalidateOn: ['weather.config'] });
}

// ── Systems (health probes through the edge) ─────────────────────────────────

export type SysStatus = 'up' | 'down' | 'warn' | 'probing';
export interface SysRow { name: string; status: SysStatus; detail: string; tone: Tone }
export interface SystemsState { rows: SysRow[]; up: number; total: number; summary: string }

const SYS_TONE: Record<SysStatus, Tone> = {
  up: 'ok', warn: 'warn', down: 'danger', probing: 'muted',
};

async function probe(path: string): Promise<{ ok: boolean; ms: number; body: any }> {
  const t0 = performance.now();
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(5000) });
    const ms = Math.max(1, Math.round(performance.now() - t0));
    let body: any = null;
    try { body = await r.json(); } catch { /* non-JSON health is fine */ }
    return { ok: r.ok, ms, body };
  } catch {
    return { ok: false, ms: 0, body: null };
  }
}

const sysRow = (name: string, status: SysStatus, detail: string): SysRow =>
  ({ name, status, detail, tone: SYS_TONE[status] });

// The probe set comes from the app manifest; aiEnabled drops the LazurOS row so
// the suite-wide kill switch leaves no "lazuros" mention in the systems panel.
// `suite` is the hydrated registry map (from useSuiteApps) — passing it makes the
// probe set reactive, so an app added to the registry shows up here without a
// portal code change. Omitted → the current live-or-static manifest.
export function useSystems(aiEnabled = true, suite?: Record<string, SuiteApp>): SystemsState {
  const apps = useMemo(() => probeApps(aiEnabled, suite), [aiEnabled, suite]);

  const fetcher = useCallback(async (): Promise<SystemsState> => {
    const rows = await Promise.all(apps.map(async (a) => {
      const r = await probe(a.healthPath!);
      // LazurOS reports compute (GPU) status in its body — asleep is a warn, not down.
      if (a.id === 'lazuros') {
        if (!r.ok) return sysRow('lazuros', 'down', 'down');
        if (r.body && r.body.compute_online === false) return sysRow('lazuros', 'warn', 'gpu asleep');
        return sysRow('lazuros', 'up', `${r.ms} ms`);
      }
      return sysRow(a.id, r.ok ? 'up' : 'down', r.ok ? `${r.ms} ms` : 'down');
    }));
    const up = rows.filter(r => r.status === 'up' || r.status === 'warn').length;
    return { rows, up, total: rows.length, summary: `${up} / ${rows.length} UP` };
  }, [apps]);

  const initial: SystemsState = {
    rows: apps.map(a => sysRow(a.id, 'probing', '—')),
    up: 0, total: apps.length, summary: `0 / ${apps.length} UP`,
  };
  return usePolledResource(fetcher, initial, { intervalMs: 30_000 });
}

// ── BeigeBoard items (ONE source of truth) ───────────────────────────────────

/** The subset of a BeigeBoard item ORDECK reads, normalized to ORDECK's shapes
 *  (times sliced to hh:mm, booleans coerced). The single place that knows the
 *  BeigeBoard wire shape — `today` and `cal` derive from this, and it enriches
 *  shelf pins/focus that point at BeigeBoard — so the dashboard makes ONE
 *  request, not four. */
export interface BbItem {
  id: number;
  title: string;
  kind: string;
  scope: string;
  due_date: string | null;
  end_date: string | null;
  scheduled_time: string | null;   // hh:mm
  scheduled_end: string | null;    // hh:mm
  completed: boolean;
}
export interface BbItemsState {
  loaded: boolean;
  authed: boolean;
  offline: boolean;
  items: BbItem[];
}

const hhmm = (v: unknown): string | null => (v ? String(v).slice(0, 5) : null);

function normalizeBbItem(i: any): BbItem {
  return {
    id: i.id,
    title: i.title,
    kind: i.kind ?? '',
    scope: i.scope ?? '',
    due_date: i.due_date ?? null,
    end_date: i.end_date ?? null,
    scheduled_time: hhmm(i.scheduled_time),
    scheduled_end: hhmm(i.scheduled_end),
    completed: !!i.completed,
  };
}

const BB_API = apiBase('beigeboard');
const BB_ITEMS = resourceKey('beigeboard', 'items'); // 'beigeboard.items' — derived, not free-typed

/** Fetch the BeigeBoard item list once and share it; refetches on the 60s poll
 *  and whenever a HUD write fires invalidate('beigeboard.items'). All BeigeBoard-backed
 *  slices select from the value this returns. */
export function useBbItems(): BbItemsState {
  const fetcher = useCallback(async (): Promise<BbItemsState> => {
    try {
      // authFetch silently refreshes a 15-min-expired access token from the
      // remember-me cookie + retries, so authed:false now means *genuinely* logged
      // out (refresh failed), not merely an expired access token on a live session.
      const r = await authFetch(`${BB_API}/items`);
      if (r.status === 401 || r.status === 403) return { loaded: true, authed: false, offline: false, items: [] };
      if (!r.ok) throw new Error('bb items');
      const raw = await r.json();
      return { loaded: true, authed: true, offline: false, items: (raw as any[]).map(normalizeBbItem) };
    } catch {
      return { loaded: true, authed: true, offline: true, items: [] };
    }
  }, []);
  return usePolledResource(
    fetcher,
    { loaded: false, authed: true, offline: false, items: [] },
    { intervalMs: 60_000, invalidateOn: [BB_ITEMS] },
  );
}

// ── Today (selector over BeigeBoard items) ───────────────────────────────────

/** A raw task pulled from a BbItem, before presentation fields are derived. */
interface RawTask {
  id: number;
  time: string | null;     // "09:30"
  endTime: string | null;
  title: string;
  tag: string;
  done: boolean;
}
export interface TodayTask extends RawTask {
  // ── derived (presentation-ready for the spec factory) ──
  timeLabel: string;       // time ?? "—"
  now: boolean;            // the task happening right now
  tone: Tone;              // ok = done, accent = now, muted = upcoming
  stateLabel: string;      // "DONE" | "NOW" | the tag
}
export interface TodayState {
  loaded: boolean;
  authed: boolean;
  offline: boolean;
  tasks: TodayTask[];
  doneCount: number;
  progressLabel: string;   // "2 / 5"
  progress: number;        // doneCount / total (0..1)
  // ── mutually-exclusive view flags — bind these to a card row's "show if" ──
  signedOut: boolean;      // not authenticated
  showOffline: boolean;    // authed but BeigeBoard unreachable
  showTasks: boolean;      // has tasks to render
  showEmpty: boolean;      // authed, online, but nothing scheduled
  emptyLabel: string;
}

interface TodayBase { loaded: boolean; authed: boolean; offline: boolean; tasks: RawTask[] }

/** Add the derived presentation fields. `hm` (the current HH:MM) is passed in so
 *  the result is a pure function of (data, minute) — useHudContext memoises it on
 *  the minute, so the live "now" flag updates each minute instead of each second. */
function viewToday(base: TodayBase, hm: string): TodayState {
  const tasks: TodayTask[] = base.tasks.map(t => {
    const now = isNow(t, hm);
    return {
      ...t,
      timeLabel: t.time ?? '—',
      now,
      tone: t.done ? 'ok' : now ? 'accent' : 'muted',
      stateLabel: t.done ? 'DONE' : now ? 'NOW' : t.tag,
    };
  });
  const doneCount = tasks.filter(t => t.done).length;
  const signedOut = !base.authed;
  const showOffline = base.authed && base.offline;
  const showTasks = base.authed && !base.offline && tasks.length > 0;
  const showEmpty = base.authed && !base.offline && tasks.length === 0;
  return {
    loaded: base.loaded, authed: base.authed, offline: base.offline, tasks,
    doneCount,
    progressLabel: `${doneCount} / ${tasks.length}`,
    progress: tasks.length ? doneCount / tasks.length : 0,
    signedOut, showOffline, showTasks, showEmpty,
    emptyLabel: base.loaded ? 'NOTHING SCHEDULED TODAY' : 'LOADING…',
  };
}

/** Today's scheduled items, presentation-ready. `hm` is the current HH:MM (drives
 *  the live "now" flag); pass clock.hm so the slice is memoisable on the minute. */
export function selectToday(s: BbItemsState, hm: string): TodayState {
  const iso = isoDate(new Date());
  const tasks: RawTask[] = s.items
    .filter(i => i.due_date === iso || i.end_date === iso)
    .map(i => ({ id: i.id, time: i.scheduled_time, endTime: i.scheduled_end, title: i.title, tag: i.kind, done: i.completed }))
    .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  return viewToday({ loaded: s.loaded, authed: s.authed, offline: s.offline, tasks }, hm);
}

/** Is hh:mm inside [start, end)? Handles a window that wraps past midnight
 *  (end <= start), so a late-evening task whose hour-long default window crosses
 *  00:00 still reads as "now" instead of never. */
function inWindow(hm: string, start: string, end: string): boolean {
  if (end === start) return false;
  return end < start ? (hm >= start || hm < end) : (hm >= start && hm < end);
}

/** A task is "now" if the current time falls in [start, end) — or within an
    hour of start when it has no end. */
export function isNow(t: { time: string | null; endTime: string | null; done: boolean }, hm: string): boolean {
  if (!t.time || t.done) return false;
  if (t.endTime) return inWindow(hm, t.time, t.endTime);
  const [h, m] = t.time.split(':').map(Number);
  const endMin = h * 60 + m + 60;
  const end = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
  return inWindow(hm, t.time, end);
}

// ── Monthly calendar (selector — task density per day) ───────────────────────

export interface CalDay {
  date: string;       // YYYY-MM-DD
  count: number;      // tasks scheduled that day
  doneCount: number;
}
export interface MonthCalState {
  loaded: boolean;
  authed: boolean;
  year: number;
  month: number;      // 0-indexed
  days: CalDay[];
}

export function selectMonth(s: BbItemsState): MonthCalState {
  const today = new Date();
  const yr = today.getFullYear();
  const mo = today.getMonth();
  const map = new Map<string, { count: number; doneCount: number }>();
  for (const it of s.items) {
    const d = it.due_date;
    if (!d) continue;
    const [y, m] = d.split('-').map(Number);
    if (y !== yr || m - 1 !== mo) continue;
    const cur = map.get(d) ?? { count: 0, doneCount: 0 };
    map.set(d, { count: cur.count + 1, doneCount: cur.doneCount + (it.completed ? 1 : 0) });
  }
  const days: CalDay[] = Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
  return { loaded: s.loaded, authed: s.authed, year: yr, month: mo, days };
}

/** Project the raw BeigeBoard items into the @jkos/cards CalendarItem shape that the
 *  shared Week/Calendar views render. BbItem is structurally a CalendarItem already
 *  (the kit's shape is superset-tolerant); the only coercion is null→undefined on the
 *  date fields, which the kit types as `string | undefined`. Read-only: the HUD passes
 *  these to the views with no DragAdapter, so they render in select/quick-add light
 *  mode (no internal drag to clash with the HUD grid). */
export function selectCalendarItems(s: BbItemsState): CalendarItem[] {
  return s.items.map((i) => ({
    ...i,
    due_date: i.due_date ?? undefined,
    end_date: i.end_date ?? undefined,
  }));
}

// ── Focus + Pins (selectors over the suite-wide HUD shelf) ───────────────────
// Focus/pins live in jkAuth prefs (the HUD shelf), not on BeigeBoard's items —
// so they're suite-wide: focus is one singleton across every app, and pins are
// a heterogeneous set. A reference that points at BeigeBoard is enriched from
// the live item list; a reference from any other app renders its snapshot.

/** The single "now working on" item across the whole suite, if any. */
export interface FocusState {
  loaded: boolean;
  authed: boolean;
  active: boolean;         // something is currently focused
  app: string;             // source app of the focused item
  id: string | null;
  title: string;
  timeLabel: string;       // scheduled time, or "—"
  tag: string;
  done: boolean;
  deeplink: string;        // URL back to the item in its app
}
export interface PinnedTask {
  id: string;
  app: string;             // source app of the pinned item
  title: string;
  timeLabel: string;
  tag: string;
  done: boolean;
  tone: Tone;              // ok = done, accent = open
  deeplink: string;        // URL back to the item in its app
}
export interface PinnedState {
  loaded: boolean;
  authed: boolean;
  items: PinnedTask[];
  count: number;
  empty: boolean;          // authed, loaded, nothing pinned
}

const EMPTY_FOCUS: FocusState = { loaded: false, authed: true, active: false, app: '', id: null, title: '', timeLabel: '—', tag: '', done: false, deeplink: '' };

/* Resolve a pinned/focused HudRef (app + id — the structured form of the weave
   `<app>:<id>` ext_ref) against the live item slice for its app, so a stored
   snapshot label upgrades to the live row. Keyed by app id, so surfacing a NEW
   peer's items on the shelf is one map entry below — not an edited `=== 'beigeboard'`
   conditional. BeigeBoard is the only items-bearing app today. */
function resolveLive(app: string, id: string, sources: Record<string, BbItem[]>): BbItem | undefined {
  const items = sources[app];
  if (!items) return undefined;
  const ref = extRef(app, id);
  return items.find(i => extRef(app, i.id) === ref);
}

export function selectFocus(focus: HudFocus | null, bb: BbItemsState): FocusState {
  if (!bb.authed) return { ...EMPTY_FOCUS, loaded: true, authed: false };
  if (!focus) return { ...EMPTY_FOCUS, loaded: true };
  const live = resolveLive(focus.app, focus.id, { beigeboard: bb.items });
  return {
    loaded: true, authed: true, active: true,
    app: focus.app, id: focus.id,
    title: live?.title ?? focus.label,
    timeLabel: live?.scheduled_time ?? '—',
    tag: live?.kind ?? '',
    done: live?.completed ?? false,
    deeplink: focus.deeplink ?? '',
  };
}

export function selectPinned(pins: HudPin[], bb: BbItemsState): PinnedState {
  if (!bb.authed) return { loaded: true, authed: false, items: [], count: 0, empty: false };
  const sources = { beigeboard: bb.items };
  const items: PinnedTask[] = pins.map(p => {
    const live = resolveLive(p.app, p.id, sources);
    const done = live?.completed ?? false;
    return {
      id: p.id, app: p.app,
      title: live?.title ?? p.label,
      timeLabel: live?.scheduled_time ?? '—',
      tag: live?.kind ?? '',
      done,
      tone: (done ? 'ok' : ((p.tone as Tone) || 'accent')) as Tone,
      deeplink: p.deeplink ?? '',
    };
  });
  return { loaded: bb.loaded, authed: true, items, count: items.length, empty: bb.loaded && items.length === 0 };
}

/** The HUD shelf (pins + focus) from jkAuth prefs, kept live: refetches on the
 *  60s poll, on tab focus, and when a write fires invalidate('hud.shelf'). */
export interface ShelfRefs { pins: HudPin[]; focus: HudFocus | null }
export function useShelfRefs(): ShelfRefs {
  const fetcher = useCallback(async (): Promise<ShelfRefs> => {
    try {
      const p = await getProfile();
      return { pins: p?.preferences.hudPins ?? [], focus: p?.preferences.hudFocus ?? null };
    } catch {
      return { pins: [], focus: null };
    }
  }, []);
  return usePolledResource(fetcher, { pins: [], focus: null }, { intervalMs: 60_000, refetchOnVisible: true, invalidateOn: ['hud.shelf'] });
}

// ── Study (SylibOS summary) ──────────────────────────────────────────────────

export interface StudyState {
  loaded: boolean;
  available: boolean;
  streak: number;
  nextLesson: string | null;
  courseTitle: string | null;
  todayDone: number;
  dailyGoal: number;
  // ── derived (presentation-ready) ──
  headline: string;        // next lesson → course → "All caught up"
  subLine: string;         // "2 / 4 today · Course"
  showStreak: boolean;     // available with a streak to brag about
  unavailable: boolean;    // SylibOS offline / still loading
  offlineLabel: string;
}

interface StudyBase {
  loaded: boolean; available: boolean; streak: number;
  nextLesson: string | null; courseTitle: string | null; todayDone: number; dailyGoal: number;
}

function viewStudy(d: StudyBase): StudyState {
  const course = d.courseTitle && d.nextLesson ? ` · ${d.courseTitle}` : '';
  return {
    ...d,
    headline: d.nextLesson ?? d.courseTitle ?? 'All caught up',
    subLine: `${d.todayDone} / ${d.dailyGoal} today${course}`,
    showStreak: d.available && d.streak > 0,
    unavailable: !d.available,
    offlineLabel: d.loaded ? 'SYLIBOS OFFLINE — OPEN →' : 'LOADING…',
  };
}

const SYLIB_API = apiBase('sylibos');
const STUDY_OFFLINE: StudyBase = { loaded: true, available: false, streak: 0, nextLesson: null, courseTitle: null, todayDone: 0, dailyGoal: 0 };

export function useStudy(): StudyState {
  const initial = viewStudy({ ...STUDY_OFFLINE, loaded: false });
  const fetcher = useCallback(async (): Promise<StudyState> => {
    try {
      const r = await authFetch(`${SYLIB_API}/summary`);
      if (!r.ok) throw new Error('sylib summary');
      const d = await r.json();
      return viewStudy({
        loaded: true, available: true,
        streak: d.streak ?? 0,
        nextLesson: d.nextLesson?.title ?? null,
        courseTitle: d.activeCourse?.title ?? null,
        todayDone: d.todayDone ?? 0,
        dailyGoal: d.dailyGoal ?? 0,
      });
    } catch {
      return viewStudy(STUDY_OFFLINE);
    }
  }, []);
  return usePolledResource(fetcher, initial, { intervalMs: 5 * 60_000 });
}

// ── Notifications (DERIVED — one feed over slices already in scope) ──────────

/** A single normalized alert. `icon` is a key in the registry's ICON set; `tone`
 *  drives its colour. Aggregating here means new sources (a future reminders
 *  endpoint) just push into the same shape — the widget never changes. */
export interface Notification {
  id: string;
  icon: string;
  tone: Tone;
  text: string;
  detail: string;
}
export interface NotificationsState {
  items: Notification[];
  count: number;
  empty: boolean;
  summary: string;   // "2 ALERTS" | "ALL CLEAR"
}

/** The slices a producer may read. Each app contributes a producer; adding a
 *  source (a future reminders feed, another app) is a new producer in the list
 *  below — not another branch in one growing function. */
export interface NotifSource {
  today: TodayState;
  systems: { rows: SysRow[] };
  study: StudyState;
  now: string;   // current HH:MM — passed in (not read from the clock) so the feed is pure + memoisable
}
/** A pure mapper from the live slices to zero or more alerts. */
export type NotificationProducer = (src: NotifSource) => Notification[];

// Systems — a down probe is a danger; a warn (e.g. GPU asleep) is a warning.
const systemsNotifications: NotificationProducer = ({ systems }) =>
  systems.rows.flatMap((r) =>
    r.status === 'down' ? [{ id: `sys-${r.name}`, icon: 'alert', tone: 'danger' as Tone, text: `${r.name.toUpperCase()} DOWN`, detail: 'system offline' }]
    : r.status === 'warn' ? [{ id: `sys-${r.name}`, icon: 'alert', tone: 'warn' as Tone, text: r.name.toUpperCase(), detail: r.detail }]
    : [],
  );

// BeigeBoard — the task happening now (accent) and any past-due, unfinished item.
const todayNotifications: NotificationProducer = ({ today, now }) => {
  if (!today.authed || today.offline) return [];
  return today.tasks.flatMap((t) =>
    t.now ? [{ id: `now-${t.id}`, icon: 'clock', tone: 'accent' as Tone, text: t.title, detail: 'happening now' }]
    : (t.time && !t.done && t.time < now) ? [{ id: `od-${t.id}`, icon: 'alert', tone: 'warn' as Tone, text: t.title, detail: `overdue · ${t.timeLabel}` }]
    : [],
  );
};

// SylibOS — behind on the daily study goal.
const studyNotifications: NotificationProducer = ({ study }) =>
  (study.available && study.dailyGoal > 0 && study.todayDone < study.dailyGoal && study.headline)
    ? [{ id: 'study', icon: 'book', tone: 'muted', text: study.headline, detail: `${study.todayDone} / ${study.dailyGoal} today` }]
    : [];

/** The registered producers — one per contributing app/source. */
const NOTIFICATION_PRODUCERS: NotificationProducer[] = [
  systemsNotifications,
  todayNotifications,
  studyNotifications,
];

/**
 * Fold every producer's alerts into one ranked feed. Pure — no IO of its own, so
 * it adds zero polling: useHudContext already holds these slices. Adding a source
 * means registering a producer above; this function never changes.
 */
export function deriveNotifications(src: NotifSource): NotificationsState {
  const items = NOTIFICATION_PRODUCERS.flatMap((produce) => produce(src));
  items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return {
    items,
    count: items.length,
    empty: items.length === 0,
    summary: items.length ? `${items.length} ALERT${items.length > 1 ? 'S' : ''}` : 'ALL CLEAR',
  };
}

// ── Apps (jkAuth registry, for the top-strip popover) ────────────────────────

export interface HudApp { id: string; name: string; origin: string }

export function useApps(authUrl: string): HudApp[] {
  const fetcher = useCallback(async (): Promise<HudApp[]> => {
    try {
      const r = await authFetch(`${authUrl}/auth/apps`);
      if (!r.ok) throw new Error('auth apps');
      const d = await r.json();
      return Array.isArray(d) ? d : d.apps ?? [];
    } catch {
      return [];
    }
  }, [authUrl]);
  return usePolledResource(fetcher, [], {});
}

// ── Slice schema (the bindable surface, for the workshop) ─────────────────────
// The fields each always-in-scope slice exposes. This lives WITH the slice
// interfaces above (not duplicated in the workshop) so adding a field is one edit
// here and it shows up as a binding suggestion automatically. Keep in sync with
// the interfaces — `scalars` are leaf values, `arrays` feed a list's `from`.

export interface SliceSchema { scalars: string[]; arrays?: string[] }

export const HUD_SCHEMA: Record<string, SliceSchema> = {
  clock:         { scalars: ['hm', 'ss', 'dateLine', 'utcShort', 'jday', 'utcLine', 'iso'] },
  weather:       { scalars: ['temp', 'feels', 'desc', 'hi', 'lo', 'label', 'offline', 'loaded'], arrays: ['slots'] },
  systems:       { scalars: ['up', 'total', 'summary'], arrays: ['rows'] },
  study:         { scalars: ['streak', 'headline', 'subLine', 'nextLesson', 'courseTitle', 'todayDone', 'dailyGoal', 'available', 'showStreak', 'unavailable', 'offlineLabel'] },
  cal:           { scalars: ['year', 'month'], arrays: ['days'] },
  today:         { scalars: ['authed', 'progressLabel', 'progress', 'doneCount', 'emptyLabel', 'signedOut', 'showOffline', 'showTasks', 'showEmpty'], arrays: ['tasks'] },
  notifications: { scalars: ['summary', 'count', 'empty'], arrays: ['items'] },
  focus:         { scalars: ['active', 'title', 'timeLabel', 'tag', 'done', 'authed', 'app', 'deeplink'] },
  pinned:        { scalars: ['count', 'empty', 'authed'], arrays: ['items'] },
};

/** Fields exposed by `$` (the current array element) inside a list item. */
export const HUD_ITEM_FIELDS = ['name', 'detail', 'tone', 'status', 'title', 'time', 'timeLabel', 'stateLabel', 'done', 'now', 'tag', 'label', 'temp', 'date', 'count', 'icon', 'text', 'app', 'deeplink'];

import { useState, useEffect } from 'react';

/* Data hooks for the room HUD. All service calls are same-origin paths
   proxied by the edge nginx (cookies flow, no CORS):
     /health/*            → per-service health probes
     /api/lazuros/health  → LazurOS (includes GPU compute status)
     /api/bb/*            → bb-app   (/api/bb/items → /api/items)
     /api/sylib/*         → sylibos-api (/api/sylib/summary → /api/summary)
   Every hook fails soft — a dead service renders an offline state, never an
   error boundary. */

// ── Clock ────────────────────────────────────────────────────────────────────

const WD = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MO = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');

export interface ClockState {
  hm: string;
  ss: string;
  dateLine: string;
  utcShort: string;
  jday: string;
  /** Composed "UTC hh:mm · DAY ddd" — a single bindable line for the spec factory. */
  utcLine: string;
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
  };
}

// ── Weather (AccuWeather when key set, open-meteo fallback) ──────────────────

export const WEATHER_STORAGE_KEY = 'ordeck-weather';
// Fired after saveWeatherConfig so a live HUD re-fetches without a page reload.
export const WEATHER_CHANGED_EVENT = 'ordeck-weather-changed';
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

// Like saveWeatherConfig but notifies a live HUD to re-fetch immediately.
// (Used by settings "Save"; the internal location-key cache uses the plain
// saver so it doesn't trigger a redundant reload.)
export function saveWeatherConfigLive(cfg: Partial<WeatherConfig>) {
  saveWeatherConfig(cfg);
  window.dispatchEvent(new Event(WEATHER_CHANGED_EVENT));
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

async function fetchAccuWeather(cfg: WeatherConfig): Promise<Omit<WeatherState, 'loaded' | 'offline'>> {
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

async function fetchOpenMeteo(cfg: WeatherConfig): Promise<Omit<WeatherState, 'loaded' | 'offline'>> {
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
  const [state, setState] = useState<WeatherState>({
    loaded: false, offline: false, label: cfg.label, source: 'open-meteo',
    temp: 0, feels: 0, desc: '', hi: 0, lo: 0, slots: [],
  });
  // Bumped when settings save a new location, so the effect re-runs and refetches.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onChange = () => setVersion(v => v + 1);
    window.addEventListener(WEATHER_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WEATHER_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    let dead = false;
    const c = weatherConfig();

    const load = () => {
      const p = c.accuweatherKey ? fetchAccuWeather(c) : fetchOpenMeteo(c);
      return p
        .then(data => { if (!dead) setState({ loaded: true, offline: false, ...data }); })
        .catch(() => { if (!dead) setState(s => ({ ...s, loaded: true, offline: true })); });
    };

    load();
    // AccuWeather: 60 min to stay within 50 calls/day free tier.
    // open-meteo: 15 min (no rate limit).
    const interval = c.accuweatherKey ? 60 * 60_000 : 15 * 60_000;
    const iv = setInterval(load, interval);
    return () => { dead = true; clearInterval(iv); };
  }, [version]);

  return state;
}

// ── Systems (health probes through the edge) ─────────────────────────────────

export type SysStatus = 'up' | 'down' | 'warn' | 'probing';
/** Spec-factory tone keys (mirrors the registry's TONE map). */
export type ViewTone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';
export interface SysRow { name: string; status: SysStatus; detail: string; tone: ViewTone }

const SYS_TONE: Record<SysStatus, ViewTone> = {
  up: 'ok', warn: 'warn', down: 'danger', probing: 'muted',
};

const PROBES: { name: string; path: string }[] = [
  { name: 'jkauth',     path: '/health/auth' },
  { name: 'beigeboard', path: '/health/bb' },
  { name: 'sylibos',    path: '/health/sylibos' },
];

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

// aiEnabled gates the LazurOS row — when AI is off suite-wide it isn't probed
// or shown, so the kill switch leaves no "lazuros" mention in the systems panel.
const sysRow = (name: string, status: SysStatus, detail: string): SysRow =>
  ({ name, status, detail, tone: SYS_TONE[status] });

export function useSystems(aiEnabled = true): { rows: SysRow[]; up: number; total: number; summary: string } {
  const [rows, setRows] = useState<SysRow[]>([
    ...PROBES.map(p => sysRow(p.name, 'probing', '—')),
    ...(aiEnabled ? [sysRow('lazuros', 'probing', '—')] : []),
  ]);

  useEffect(() => {
    let dead = false;

    const sweep = async () => {
      const results = await Promise.all([
        ...PROBES.map(async p => {
          const r = await probe(p.path);
          return sysRow(p.name, r.ok ? 'up' : 'down', r.ok ? `${r.ms} ms` : 'down');
        }),
        ...(aiEnabled ? [(async () => {
          const r = await probe('/api/lazuros/health');
          if (!r.ok) return sysRow('lazuros', 'down', 'down');
          if (r.body && r.body.compute_online === false) {
            return sysRow('lazuros', 'warn', 'gpu asleep');
          }
          return sysRow('lazuros', 'up', `${r.ms} ms`);
        })()] : []),
      ]);
      if (!dead) setRows(results);
    };

    sweep();
    const iv = setInterval(sweep, 30_000);
    return () => { dead = true; clearInterval(iv); };
  }, [aiEnabled]);

  // warn counts as up — the service itself responded.
  const up = rows.filter(r => r.status === 'up' || r.status === 'warn').length;
  return { rows, up, total: rows.length, summary: `${up} / ${rows.length} UP` };
}

// ── Today (BeigeBoard items) ─────────────────────────────────────────────────

/** A raw task as fetched, before presentation fields are derived. */
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
  tone: ViewTone;          // ok = done, accent = now, muted = upcoming
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

/** Add the derived presentation fields. Called every render so `now` tracks the
 *  live clock (the HUD re-renders each second), with no extra timer. */
function viewToday(base: TodayBase): TodayState {
  const hm = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
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

export function useToday(): TodayState {
  const [base, setBase] = useState<TodayBase>({ loaded: false, authed: true, offline: false, tasks: [] });

  useEffect(() => {
    let dead = false;

    const load = () => fetch('/api/bb/items', { credentials: 'include' })
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          if (!dead) setBase({ loaded: true, authed: false, offline: false, tasks: [] });
          return null;
        }
        return r.ok ? r.json() : Promise.reject();
      })
      .then((items: any[] | null) => {
        if (dead || !items) return;
        const today = new Date();
        const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const tasks: RawTask[] = items
          .filter(i => i.due_date === iso || i.end_date === iso)
          .map(i => ({
            id: i.id,
            time: i.scheduled_time ? String(i.scheduled_time).slice(0, 5) : null,
            endTime: i.scheduled_end ? String(i.scheduled_end).slice(0, 5) : null,
            title: i.title,
            tag: i.kind ?? '',
            done: !!i.completed,
          }))
          .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
        setBase({ loaded: true, authed: true, offline: false, tasks });
      })
      .catch(() => { if (!dead) setBase(s => ({ ...s, loaded: true, offline: true })); });

    load();
    const iv = setInterval(load, 60_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  return viewToday(base);
}

/** A task is "now" if the current time falls in [start, end) — or within an
    hour of start when it has no end. */
export function isNow(t: { time: string | null; endTime: string | null; done: boolean }, hm: string): boolean {
  if (!t.time || t.done) return false;
  if (t.endTime) return hm >= t.time && hm < t.endTime;
  const [h, m] = t.time.split(':').map(Number);
  const endMin = h * 60 + m + 60;
  const end = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
  return hm >= t.time && hm < end;
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

function viewStudy(d: {
  loaded: boolean; available: boolean; streak: number;
  nextLesson: string | null; courseTitle: string | null; todayDone: number; dailyGoal: number;
}): StudyState {
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

export function useStudy(): StudyState {
  const [state, setState] = useState<StudyState>(() => viewStudy({
    loaded: false, available: false, streak: 0,
    nextLesson: null, courseTitle: null, todayDone: 0, dailyGoal: 0,
  }));

  useEffect(() => {
    let dead = false;

    const load = () => fetch('/api/sylib/summary', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (dead) return;
        setState(viewStudy({
          loaded: true, available: true,
          streak: d.streak ?? 0,
          nextLesson: d.nextLesson?.title ?? null,
          courseTitle: d.activeCourse?.title ?? null,
          todayDone: d.todayDone ?? 0,
          dailyGoal: d.dailyGoal ?? 0,
        }));
      })
      .catch(() => { if (!dead) setState(s => viewStudy({ ...s, loaded: true, available: false })); });

    load();
    const iv = setInterval(load, 5 * 60_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  return state;
}

// ── Monthly calendar (BeigeBoard task density per day) ───────────────────────

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

export function useMonthCalendar(): MonthCalState {
  const now = new Date();
  const [state, setState] = useState<MonthCalState>({
    loaded: false, authed: true,
    year: now.getFullYear(), month: now.getMonth(), days: [],
  });

  useEffect(() => {
    let dead = false;

    const load = () => fetch('/api/bb/items', { credentials: 'include' })
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          if (!dead) setState(s => ({ ...s, loaded: true, authed: false }));
          return null;
        }
        return r.ok ? r.json() : Promise.reject();
      })
      .then((items: any[] | null) => {
        if (dead || !items) return;
        const today = new Date();
        const yr = today.getFullYear();
        const mo = today.getMonth();
        // Group by due_date within this month
        const map = new Map<string, { count: number; doneCount: number }>();
        for (const it of items) {
          const d = it.due_date as string | null;
          if (!d) continue;
          const [y, m] = d.split('-').map(Number);
          if (y !== yr || m - 1 !== mo) continue;
          const cur = map.get(d) ?? { count: 0, doneCount: 0 };
          map.set(d, { count: cur.count + 1, doneCount: cur.doneCount + (it.completed ? 1 : 0) });
        }
        const days: CalDay[] = Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
        setState({ loaded: true, authed: true, year: yr, month: mo, days });
      })
      .catch(() => { if (!dead) setState(s => ({ ...s, loaded: true })); });

    load();
    const iv = setInterval(load, 5 * 60_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  return state;
}

// ── Apps (jkAuth registry, for the top-strip popover) ────────────────────────

export interface HudApp { id: string; name: string; origin: string }

export function useApps(authUrl: string): HudApp[] {
  const [apps, setApps] = useState<HudApp[]>([]);
  useEffect(() => {
    let dead = false;
    fetch(`${authUrl}/auth/apps`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!dead) setApps(Array.isArray(d) ? d : d.apps ?? []); })
      .catch(() => { /* popover just shows nothing */ });
    return () => { dead = true; };
  }, [authUrl]);
  return apps;
}

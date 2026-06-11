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
}

export function useClock(): ClockState {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return {
    hm: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    ss: pad(now.getSeconds()),
    dateLine: `${WD[now.getDay()]} · ${MO[now.getMonth()]} ${pad(now.getDate())}`,
    utcShort: `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`,
    jday: String(Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000)).padStart(3, '0'),
  };
}

// ── Weather (open-meteo, no key) ─────────────────────────────────────────────

const WEATHER_KEY = 'ordeck-weather';
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

export interface WeatherSlot { label: string; temp: number }
export interface WeatherState {
  loaded: boolean;
  offline: boolean;
  label: string;
  temp: number;
  feels: number;
  desc: string;
  hi: number;
  lo: number;
  slots: WeatherSlot[];
}

function weatherLocation() {
  try {
    const raw = localStorage.getItem(WEATHER_KEY);
    if (raw) return { ...DEFAULT_LOC, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_LOC;
}

export function useWeather(): WeatherState {
  const [state, setState] = useState<WeatherState>({
    loaded: false, offline: false, label: weatherLocation().label,
    temp: 0, feels: 0, desc: '', hi: 0, lo: 0, slots: [],
  });

  useEffect(() => {
    let dead = false;
    const loc = weatherLocation();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min&hourly=temperature_2m` +
      `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;

    const load = () => fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (dead) return;
        // 5 fixed local-hour slots like the design: 9A 12P 3P 6P 9P
        const hours = [9, 12, 15, 18, 21];
        const slots: WeatherSlot[] = hours.map(h => ({
          label: h < 12 ? `${h}A` : h === 12 ? '12P' : `${h - 12}P`,
          temp: Math.round(d.hourly?.temperature_2m?.[h] ?? 0),
        }));
        setState({
          loaded: true, offline: false, label: loc.label,
          temp: Math.round(d.current.temperature_2m),
          feels: Math.round(d.current.apparent_temperature),
          desc: WMO[d.current.weather_code] ?? '—',
          hi: Math.round(d.daily.temperature_2m_max[0]),
          lo: Math.round(d.daily.temperature_2m_min[0]),
          slots,
        });
      })
      .catch(() => { if (!dead) setState(s => ({ ...s, loaded: true, offline: true })); });

    load();
    const iv = setInterval(load, 15 * 60_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  return state;
}

// ── Systems (health probes through the edge) ─────────────────────────────────

export type SysStatus = 'up' | 'down' | 'warn' | 'probing';
export interface SysRow { name: string; status: SysStatus; detail: string }

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

export function useSystems(): { rows: SysRow[]; up: number; total: number } {
  const [rows, setRows] = useState<SysRow[]>([
    ...PROBES.map(p => ({ name: p.name, status: 'probing' as SysStatus, detail: '—' })),
    { name: 'lazuros', status: 'probing', detail: '—' },
  ]);

  useEffect(() => {
    let dead = false;

    const sweep = async () => {
      const results = await Promise.all([
        ...PROBES.map(async p => {
          const r = await probe(p.path);
          return {
            name: p.name,
            status: (r.ok ? 'up' : 'down') as SysStatus,
            detail: r.ok ? `${r.ms} ms` : 'down',
          };
        }),
        (async () => {
          const r = await probe('/api/lazuros/health');
          if (!r.ok) return { name: 'lazuros', status: 'down' as SysStatus, detail: 'down' };
          if (r.body && r.body.compute_online === false) {
            return { name: 'lazuros', status: 'warn' as SysStatus, detail: 'gpu asleep' };
          }
          return { name: 'lazuros', status: 'up' as SysStatus, detail: `${r.ms} ms` };
        })(),
      ]);
      if (!dead) setRows(results);
    };

    sweep();
    const iv = setInterval(sweep, 30_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  // warn counts as up — the service itself responded.
  const up = rows.filter(r => r.status === 'up' || r.status === 'warn').length;
  return { rows, up, total: rows.length };
}

// ── Today (BeigeBoard items) ─────────────────────────────────────────────────

export interface TodayTask {
  id: number;
  time: string | null;     // "09:30"
  endTime: string | null;
  title: string;
  tag: string;
  done: boolean;
}
export interface TodayState {
  loaded: boolean;
  authed: boolean;
  offline: boolean;
  tasks: TodayTask[];
}

export function useToday(): TodayState {
  const [state, setState] = useState<TodayState>({ loaded: false, authed: true, offline: false, tasks: [] });

  useEffect(() => {
    let dead = false;

    const load = () => fetch('/api/bb/items', { credentials: 'include' })
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          if (!dead) setState({ loaded: true, authed: false, offline: false, tasks: [] });
          return null;
        }
        return r.ok ? r.json() : Promise.reject();
      })
      .then((items: any[] | null) => {
        if (dead || !items) return;
        const today = new Date();
        const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const tasks: TodayTask[] = items
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
        setState({ loaded: true, authed: true, offline: false, tasks });
      })
      .catch(() => { if (!dead) setState(s => ({ ...s, loaded: true, offline: true })); });

    load();
    const iv = setInterval(load, 60_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  return state;
}

/** A task is "now" if the current time falls in [start, end) — or within an
    hour of start when it has no end. */
export function isNow(t: TodayTask, hm: string): boolean {
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
}

export function useStudy(): StudyState {
  const [state, setState] = useState<StudyState>({
    loaded: false, available: false, streak: 0,
    nextLesson: null, courseTitle: null, todayDone: 0, dailyGoal: 0,
  });

  useEffect(() => {
    let dead = false;

    const load = () => fetch('/api/sylib/summary', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (dead) return;
        setState({
          loaded: true, available: true,
          streak: d.streak ?? 0,
          nextLesson: d.nextLesson?.title ?? null,
          courseTitle: d.activeCourse?.title ?? null,
          todayDone: d.todayDone ?? 0,
          dailyGoal: d.dailyGoal ?? 0,
        });
      })
      .catch(() => { if (!dead) setState(s => ({ ...s, loaded: true, available: false })); });

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

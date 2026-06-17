/**
 * hud/registry.tsx — the widget factory.
 *
 * Two registries, same spirit as the @jkos/design theme factory: small, fixed,
 * data-driven maps that you extend with a single entry.
 *
 *   PRIMITIVES        node type → renderer   (the composable display vocabulary)
 *   COMPONENT_REGISTRY component key → React (escape hatch for bespoke cards)
 *
 * A widget is either a declarative SPEC (frame + data sources + a tree of
 * primitives bound to data) or a bespoke `component`. The spec path is the
 * granular, expandable one: adding a primitive is one PRIMITIVES entry, adding a
 * widget is pure data — the shape a text→widget AI step will emit later. The six
 * ported v2 cards stay as components until/if they're re-expressed as specs; the
 * deprecated Module-Federation remote path is gone.
 */

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  isNow,
  type ClockState,
  type WeatherState,
  type SysRow,
  type TodayState,
  type StudyState,
  type MonthCalState,
  type CalDay,
} from '../pages/hud/useHudData';
import type { Binding, DataSource, Tone, WidgetDef, WidgetNode, WidgetSpec } from './types';

const BB_URL = 'https://beigeboard.jkos.net';
const SYLIB_URL = 'https://sylibos.jkos.net';

const MO_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Everything a widget renderer can read. RoomHUD assembles this once from its
 *  data hooks; built-in hud slices (clock/weather/today/study/systems/cal) are
 *  always in a spec's binding scope. */
export interface WidgetCtx {
  clock: ClockState;
  weather: WeatherState;
  systems: { rows: SysRow[]; up: number; total: number };
  today: TodayState;
  study: StudyState;
  cal: MonthCalState;
  authUrl: string;
}

/* ═══ Declarative spec layer ═══════════════════════════════════════════════ */

type Scope = Record<string, unknown>;

const TONE: Record<Tone, string> = {
  ok: 'var(--hub-green)',
  warn: 'var(--hub-warn)',
  danger: 'var(--hub-red)',
  muted: 'var(--hub-cream-dim)',
  accent: 'var(--hub-amber)',
};

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Resolve a binding against the current scope (literal, {lit}, or {src,path}). */
function resolve(b: Binding, scope: Scope): unknown {
  if (b === null || typeof b !== 'object') return b;
  if ('lit' in b) return b.lit;
  let v: unknown = scope[b.src];
  if (b.path) for (const k of b.path.split('.')) { if (v == null) break; v = (v as Record<string, unknown>)[k]; }
  return v ?? b.fallback;
}

function labelSize(size?: 'md' | 'sm' | 'xs'): CSSProperties {
  if (size === 'sm') return { fontSize: 9 };
  if (size === 'xs') return { fontSize: 8 };
  return {};
}
function textStyle(variant?: 'title' | 'body' | 'sub'): CSSProperties {
  if (variant === 'title') return { fontFamily: 'var(--hub-font-serif, var(--hub-font-sans))', fontSize: 15, fontWeight: 600, color: 'var(--hub-cream-bright)' };
  if (variant === 'sub') return { fontSize: 11, color: 'var(--hub-cream-dim)' };
  return { fontSize: 12, color: 'var(--hub-cream)' };
}

/** node type → renderer. Each case is one primitive; adding to the vocabulary is
 *  a new WidgetNode variant + a new entry here. */
type NodeOf<K extends WidgetNode['t']> = Extract<WidgetNode, { t: K }>;
type Primitives = { [K in WidgetNode['t']]: (node: NodeOf<K>, scope: Scope) => ReactNode };

const PRIMITIVES: Primitives = {
  stack: (n, scope) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: n.gap ?? 8, flex: n.grow ? 1 : undefined, minHeight: 0 }}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  row: (n, scope) => (
    <div style={{ display: 'flex', alignItems: n.align ?? 'center', justifyContent: n.justify ?? 'flex-start', gap: n.gap ?? 8 }}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  label: (n, scope) => <span className="hud-eyebrow" style={labelSize(n.size)}>{str(resolve(n.text, scope))}</span>,
  text: (n, scope) => <span style={textStyle(n.variant)}>{str(resolve(n.text, scope))}</span>,
  metric: (n, scope) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <b style={{ fontFamily: 'var(--hub-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 30, fontWeight: 600, color: 'var(--hub-cream-bright)', lineHeight: 1 }}>
        {str(resolve(n.value, scope))}
      </b>
      {n.unit != null && <span style={{ fontSize: 12, color: 'var(--hub-cream-dim)', letterSpacing: '0.08em' }}>{str(resolve(n.unit, scope))}</span>}
      {n.sub != null && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--hub-cream-faint)' }}>{str(resolve(n.sub, scope))}</span>}
    </div>
  ),
  bar: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 100;
    const pct = m > 0 ? Math.max(0, Math.min(100, (v / m) * 100)) : 0;
    return <span className="hud-bar"><span style={{ width: `${pct}%` }} /></span>;
  },
  pill: (n, scope) => {
    const c = TONE[n.tone ?? 'ok'];
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--hub-font-mono)', fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: 'var(--hub-radius-lg)', color: c, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}>
        {str(resolve(n.text, scope))}
      </span>
    );
  },
  dot: (n) => {
    const c = TONE[n.tone ?? 'muted'];
    return <span className={`hud-dot${n.pulse ? ' pulse' : ''}`} style={{ background: c }} />;
  },
  keyval: (n, scope) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: n.tone ? TONE[n.tone] : 'var(--hub-cream)' }}>
        {str(resolve(n.label, scope))}
      </span>
      <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream-dim)' }}>
        {str(resolve(n.value, scope))}
      </span>
    </div>
  ),
  list: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (items.length === 0 && n.empty != null) {
      return <div style={{ color: 'var(--hub-cream-faint)', fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.12em', padding: '6px 0' }}>{str(resolve(n.empty, scope))}</div>;
    }
    return <>{items.map((el, i) => <Fragment key={i}>{renderNode(n.item, { ...scope, $: el })}</Fragment>)}</>;
  },
};

function renderNode(node: WidgetNode, scope: Scope): ReactNode {
  const fn = PRIMITIVES[node.t] as (n: WidgetNode, s: Scope) => ReactNode;
  return fn ? fn(node, scope) : null;
}

/** Poll any `fetch` data sources a spec declares and expose them by name. This
 *  is the no-deploy path: a spec with a fetch source + bindings is a brand-new
 *  widget needing zero new code. `hud` sources are already in ctx scope. */
function useDataSources(sources?: Record<string, DataSource>): Scope {
  const fetchList = useMemo(
    () => Object.entries(sources ?? {}).filter(
      (e): e is [string, Extract<DataSource, { from: 'fetch' }>] => e[1].from === 'fetch',
    ),
    [sources],
  );
  const [data, setData] = useState<Scope>({});
  useEffect(() => {
    if (fetchList.length === 0) return;
    let dead = false;
    const timers: ReturnType<typeof setInterval>[] = [];
    for (const [name, s] of fetchList) {
      const load = () => fetch(s.url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
        .then((j) => { if (!dead) setData((d) => ({ ...d, [name]: j })); })
        .catch(() => { /* widget renders empty/fallback */ });
      load();
      if (s.poll) timers.push(setInterval(load, s.poll * 1000));
    }
    return () => { dead = true; timers.forEach(clearInterval); };
  }, [fetchList]);
  return data;
}

function SpecWidget({ spec, ctx }: { spec: WidgetSpec; ctx: WidgetCtx }) {
  const fetched = useDataSources(spec.sources);
  const scope: Scope = { ...(ctx as unknown as Scope), ...fetched };
  const body = renderNode(spec.body, scope);
  const f = spec.frame;

  if (!f) return <div style={{ padding: 14 }}>{body}</div>;

  const head = (f.eyebrow || f.source) ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {f.eyebrow && <span className="hud-eyebrow">{f.eyebrow}</span>}
      {f.source && <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>{f.source}</span>}
    </div>
  ) : null;

  const inner = <>{head}{body}</>;
  const cls = f.chrome === false ? 'hud-spec-raw' : 'hud-card';
  const style: CSSProperties = { padding: f.chrome === false ? '14px 6px' : 14, display: 'flex', flexDirection: 'column', height: '100%' };
  return f.href
    ? <a className={cls} href={f.href} style={style}>{inner}</a>
    : <div className={cls} style={style}>{inner}</div>;
}

/* ═══ Bespoke component escape hatch (ported v2 cards) ══════════════════════ */

function ClockWidget({ clock }: WidgetCtx) {
  return (
    <div className="hud-clock">
      <div className="hud-clock-time">
        <span className="hud-clock-hm jk-press-lg">{clock.hm}</span>
        <span className="hud-clock-ss">{clock.ss}</span>
      </div>
      <div className="hud-clock-meta">
        <span className="hud-clock-date">{clock.dateLine}</span>
        <span className="hud-clock-utc">UTC {clock.utcShort} · DAY {clock.jday}</span>
      </div>
    </div>
  );
}

function WeatherWidget({ weather }: WidgetCtx) {
  return (
    <div className="hud-card hud-weather-compact">
      <div className="hud-weather-head">
        <span className="hud-eyebrow">WEATHER</span>
        <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>
          {weather.source === 'accuweather' ? 'ACCUWEATHER' : weather.label}
        </span>
      </div>
      {weather.offline ? (
        <div style={{ color: 'var(--hub-cream-faint)', fontFamily: 'var(--hub-font-mono)', fontSize: 11, padding: '4px 0' }}>
          WEATHER FEED OFFLINE
        </div>
      ) : (
        <>
          <div className="hud-weather-compact-row">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--hub-amber)" strokeWidth="1.4" strokeLinecap="round" style={{ flex: 'none', filter: 'drop-shadow(var(--glow))' }}>
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" />
            </svg>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="hud-weather-compact-temp">
                <b>{weather.loaded ? weather.temp : '--'}</b>
                <span>°F</span>
              </div>
              <div className="hud-weather-compact-desc">
                {weather.loaded ? `${weather.desc} · feels ${weather.feels}°` : 'Loading…'}
              </div>
            </div>
            <div className="hud-weather-hilo" style={{ marginLeft: 0 }}>
              <span className="hi">H {weather.loaded ? weather.hi : '--'}°</span>
              <span className="lo">L {weather.loaded ? weather.lo : '--'}°</span>
            </div>
          </div>

          {weather.slots.length > 0 && (
            <div className="hud-weather-strip" style={{ paddingTop: 10, marginTop: 10 }}>
              {weather.slots.map((s) => (
                <div className="hud-weather-slot" key={s.label}>
                  <span className="t">{s.label}</span>
                  <span className="v">{s.temp}°</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CalendarWidget({ cal }: WidgetCtx) {
  const today = new Date();
  const yr = cal.year;
  const mo = cal.month;
  const first = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const dayMap = new Map<string, CalDay>();
  for (const d of cal.days) dayMap.set(d.date, d);

  return (
    <div className="hud-card hud-calendar">
      <div className="hud-calendar-head">
        <span className="hud-eyebrow">CALENDAR</span>
        <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>
          {MO_FULL[mo].toUpperCase()} {yr}
        </span>
      </div>
      <div className="hud-cal-grid">
        {DAY_ABBR.map((d) => (
          <div key={d} className="hud-cal-dow">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const iso = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const info = dayMap.get(iso);
          const isToday = day === today.getDate() && mo === today.getMonth() && yr === today.getFullYear();
          return (
            <div key={iso} className={`hud-cal-day${isToday ? ' today' : ''}${info ? ' has-tasks' : ''}`}>
              <span className="hud-cal-num">{day}</span>
              {info && (
                <span className="hud-cal-dot" style={{
                  background: info.doneCount === info.count ? 'var(--hub-green)' : 'var(--hub-amber)',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TodayWidget({ today, clock, authUrl }: WidgetCtx) {
  const doneCount = today.tasks.filter((t) => t.done).length;
  return (
    <div className="hud-card hud-today">
      <div className="hud-today-head">
        <span className="hud-eyebrow">TODAY</span>
        <span className="hud-eyebrow-src">BEIGEBOARD</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="hud-today-count">{doneCount} / {today.tasks.length}</span>
          <span className="hud-bar">
            <span style={{ width: today.tasks.length ? `${(doneCount / today.tasks.length) * 100}%` : '0%' }} />
          </span>
        </span>
      </div>

      {!today.authed ? (
        <div className="hud-empty">
          <span>SIGN IN TO SEE YOUR DAY</span>
          <a href={`${authUrl}/auth/login?redirect_to=${encodeURIComponent('https://jkos.net')}`}>LOG IN</a>
        </div>
      ) : today.offline ? (
        <div className="hud-empty">
          <span>BEIGEBOARD OFFLINE</span>
          <a href={BB_URL}>OPEN BEIGEBOARD →</a>
        </div>
      ) : today.tasks.length === 0 ? (
        <div className="hud-empty">
          <span>{today.loaded ? 'NOTHING SCHEDULED TODAY' : 'LOADING…'}</span>
          <a href={BB_URL}>OPEN BEIGEBOARD →</a>
        </div>
      ) : (
        <div className="hud-today-list">
          {today.tasks.map((t) => {
            const now = isNow(t, clock.hm);
            return (
              <div key={t.id} className={`hud-task${t.done ? ' done' : ''}${now ? ' now' : ''}`}>
                <span className="hud-task-time">{t.time ?? '—'}</span>
                {now ? (
                  <span style={{ minWidth: 0 }}>
                    <span className="hud-task-title" style={{ display: 'block' }}>{t.title}</span>
                    <span className="hud-task-sub">{t.tag}{t.endTime ? ` · until ${t.endTime}` : ''}</span>
                  </span>
                ) : (
                  <span className="hud-task-title">{t.title}</span>
                )}
                {t.done ? (
                  <span className="hud-task-check">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--hub-bg-0)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                ) : now ? (
                  <span className="hud-now-chip"><span className="hud-dot pulse" />NOW</span>
                ) : (
                  <span className="hud-task-tag">{t.tag}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SystemsWidget({ systems }: WidgetCtx) {
  return (
    <div className="hud-card hud-systems">
      <div className="hud-systems-head">
        <span className="hud-eyebrow">SYSTEMS</span>
        <span className="hud-systems-count">{systems.up} / {systems.total} UP</span>
      </div>
      <div className="hud-systems-list">
        {systems.rows.map((r) => (
          <div key={r.name} className={`hud-sys${r.status === 'down' ? ' down' : r.status === 'warn' ? ' warn' : ''}`}>
            <span
              className={`hud-dot${r.status === 'down' ? ' pulse' : ''}`}
              style={{
                background: r.status === 'up' ? 'var(--hub-green)'
                  : r.status === 'warn' ? 'var(--hub-warn)'
                  : r.status === 'down' ? 'var(--hub-red)'
                  : 'var(--hub-line-strong)',
              }}
            />
            <span className="hud-sys-name">{r.name}</span>
            <span className="hud-sys-val">{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudyWidget({ study }: WidgetCtx) {
  return (
    <a className="hud-card hud-info" href={SYLIB_URL}>
      <div className="hud-info-head">
        <span className="hud-eyebrow">STUDY</span>
        <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>SYLIBOS</span>
      </div>
      {study.available ? (
        <div className="hud-study-row">
          <div className="hud-study-main">
            <p className="hud-info-title">
              {study.nextLesson ?? study.courseTitle ?? 'All caught up'}
            </p>
            <p className="hud-info-sub">
              {study.todayDone} / {study.dailyGoal} today{study.courseTitle && study.nextLesson ? ` · ${study.courseTitle}` : ''}
            </p>
          </div>
          {study.streak > 0 && (
            <div className="hud-streak">
              <b>{study.streak}</b>
              <span>STREAK</span>
            </div>
          )}
        </div>
      ) : (
        <p className="hud-info-sub" style={{ margin: 0 }}>
          {study.loaded ? 'SYLIBOS OFFLINE — OPEN →' : 'LOADING…'}
        </p>
      )}
    </a>
  );
}

const COMPONENT_REGISTRY: Record<string, (ctx: WidgetCtx) => ReactNode> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  calendar: CalendarWidget,
  today: TodayWidget,
  systems: SystemsWidget,
  study: StudyWidget,
};

/* ═══ Factory entry point ══════════════════════════════════════════════════ */

function unknownWidget(name: string): ReactNode {
  return (
    <div className="hud-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, height: '100%' }}>
      <span style={{ color: 'var(--hub-cream-dim)', fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.15em' }}>
        UNKNOWN WIDGET: {name.toUpperCase()}
      </span>
    </div>
  );
}

/** Render a widget definition: declarative spec first, bespoke component second. */
export function renderWidget(def: WidgetDef, ctx: WidgetCtx): ReactNode {
  if (def.spec) return <SpecWidget spec={def.spec} ctx={ctx} />;
  if (def.component) {
    const Component = COMPONENT_REGISTRY[def.component];
    return Component ? Component(ctx) : unknownWidget(def.component);
  }
  return unknownWidget(def.id);
}

/**
 * hud/registry.tsx — the widget factory.
 *
 * A widget is a declarative SPEC: a frame (card chrome) + named data sources +
 * a tree of PRIMITIVES bound to data. Adding a primitive is one entry in the map
 * below; adding a WIDGET is pure data — the shape a text→widget AI step emits.
 *
 * The vocabulary spans three granularities, all composable:
 *   • atoms      label / text / metric / bar / gauge / pill / dot / keyval /
 *                divider / link / icon
 *   • structure  stack / row / list / when   (when = conditional, the states glue)
 *   • molecules  time / calendar / weather   (self-contained cards, like gauge)
 *
 * The six v2 cards that used a bespoke `component` escape hatch are now expressed
 * entirely as specs (see hud/state.ts) — clock/today/systems/study compose from
 * atoms + structure; weather/calendar are molecules. The escape hatch mechanism
 * stays (COMPONENT_REGISTRY) for anything a future card truly can't express, but
 * ships empty. The deprecated Module-Federation remote path is gone.
 */

import {
  Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState,
  type CSSProperties, type FormEvent, type ReactNode,
} from 'react';
import {
  fetchCapabilities, getCapability, runCommand, suiteApp, type CapabilityDoc,
} from '@jkos/weave';
import {
  type ClockState,
  type WeatherState,
  type SystemsState,
  type TodayState,
  type StudyState,
  type MonthCalState,
  type CalDay,
  type NotificationsState,
  type FocusState,
  type PinnedState,
} from '../pages/hud/useHudData';
import type { Binding, CommandRef, DataSource, Tone, ToneBinding, WidgetDef, WidgetNode, WidgetSpec } from './types';
import { TONE_COLOR } from './tone';
import { bbCreateItem, todayIso } from '../lib/bb';
import { clearHudFocus } from '../lib/shelf';

const MO_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Everything a widget renderer can read. RoomHUD assembles this once from its
 *  data hooks; built-in hud slices (clock/weather/today/study/systems/cal) are
 *  always in a spec's binding scope, alongside `authUrl`. */
export interface WidgetCtx {
  clock: ClockState;
  weather: WeatherState;
  systems: SystemsState;
  today: TodayState;
  study: StudyState;
  cal: MonthCalState;
  notifications: NotificationsState;
  focus: FocusState;
  pinned: PinnedState;
  authUrl: string;
}

/* ═══ Declarative spec layer ═══════════════════════════════════════════════ */

type Scope = Record<string, unknown>;

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

/** Resolve a tone that may be fixed OR data-bound (→ a CSS colour). Unknown
 *  resolved values fall back to `fallback`, so a bad data path degrades quietly. */
function toneColor(t: ToneBinding | undefined, scope: Scope, fallback: Tone = 'muted'): string {
  if (t == null) return TONE_COLOR[fallback];
  const v = typeof t === 'object' ? resolve(t as Binding, scope) : t;
  return TONE_COLOR[v as Tone] ?? TONE_COLOR[fallback];
}

/** Truthiness for `when` — empty arrays/strings and 0 are falsy (so "has tasks"
 *  is just a bound array, and a "0 / false / ''" condition hides cleanly). */
function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  return Boolean(v);
}

function labelSize(size?: 'md' | 'sm' | 'xs'): CSSProperties {
  if (size === 'sm') return { fontSize: 9 };
  if (size === 'xs') return { fontSize: 8 };
  return {};
}
function textStyle(variant?: 'title' | 'body' | 'sub' | 'mono'): CSSProperties {
  if (variant === 'title') return { fontFamily: 'var(--hub-font-serif, var(--hub-font-sans))', fontSize: 15, fontWeight: 600, color: 'var(--hub-cream-bright)' };
  if (variant === 'sub') return { fontSize: 11, color: 'var(--hub-cream-dim)' };
  if (variant === 'mono') return { fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' };
  return { fontSize: 12, color: 'var(--hub-cream)' };
}

/** Curated line-icon set (inherits stroke colour + size). `dot` is the fallback. */
const ICONS: Record<string, ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" /></>,
  moon: <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />,
  cloud: <path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 006 19z" />,
  rain: <><path d="M17.5 15a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 005.5 15" /><path d="M8 19v2M12 19v3M16 19v2" /></>,
  bolt: <path d="M13 2L4.5 13H11l-1 9 8.5-11H12l1-9z" />,
  check: <path d="M20 6L9 17l-5-5" />,
  book: <><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  star: <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z" />,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h16.9a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  dot: <circle cx="12" cy="12" r="6" />,
};

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
    <div style={{ display: 'flex', alignItems: n.align ?? 'center', justifyContent: n.justify ?? 'flex-start', gap: n.gap ?? 8, flex: n.grow ? 1 : undefined, minWidth: 0 }}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  label: (n, scope) => <span className="hud-eyebrow" style={labelSize(n.size)}>{str(resolve(n.text, scope))}</span>,
  text: (n, scope) => <span style={{ ...textStyle(n.variant), ...(n.grow ? { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{str(resolve(n.text, scope))}</span>,
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
    const c = toneColor(n.tone, scope, 'ok');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--hub-font-mono)', fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: 'var(--hub-radius-lg)', color: c, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}>
        {str(resolve(n.text, scope))}
      </span>
    );
  },
  dot: (n, scope) => {
    const c = toneColor(n.tone, scope, 'muted');
    return <span className={`hud-dot${n.pulse ? ' pulse' : ''}`} style={{ background: c, flex: 'none' }} />;
  },
  keyval: (n, scope) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: n.tone ? toneColor(n.tone, scope) : 'var(--hub-cream)' }}>
        {str(resolve(n.label, scope))}
      </span>
      <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream-dim)' }}>
        {str(resolve(n.value, scope))}
      </span>
    </div>
  ),
  gauge: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 100;
    const pct = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
    const R = 26, C = 2 * Math.PI * R;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <svg width="76" height="76" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--hub-line)" strokeWidth="6" />
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--hub-amber)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 36 36)"
            style={{ filter: 'drop-shadow(0 0 4px var(--hub-amber-glow))', transition: 'stroke-dasharray 0.4s ease' }} />
          <text x="36" y="41" textAnchor="middle" style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 17, fontWeight: 600, fill: 'var(--hub-cream-bright)' }}>
            {Math.round(pct * 100)}
          </text>
        </svg>
        {n.label != null && <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--hub-cream-dim)' }}>{str(resolve(n.label, scope))}</span>}
      </div>
    );
  },
  divider: (n, scope) => {
    const label = n.label != null ? str(resolve(n.label, scope)) : '';
    if (!label) return <div style={{ height: 1, background: 'var(--hub-line)', margin: '4px 0' }} />;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--hub-line)' }} />
        <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--hub-cream-dim)' }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--hub-line)' }} />
      </div>
    );
  },
  link: (n, scope) => (
    <a href={str(resolve(n.href, scope))} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--hub-font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--hub-amber)', textDecoration: 'none', border: '1px solid color-mix(in srgb, var(--hub-amber) 40%, transparent)', borderRadius: 'var(--hub-radius-sm)', padding: '7px 12px' }}>
      {str(resolve(n.text, scope))} →
    </a>
  ),
  icon: (n, scope) => {
    const name = str(resolve(n.name, scope));
    const s = n.size ?? 24;
    const color = n.tone != null ? toneColor(n.tone, scope, 'accent') : 'var(--hub-amber)';
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
        {ICONS[name] ?? ICONS.dot}
      </svg>
    );
  },
  time: (n, scope) => (
    <div className="hud-clock">
      <div className="hud-clock-time">
        <span className="hud-clock-hm jk-press-lg">{str(resolve(n.value, scope))}</span>
        {n.seconds != null && <span className="hud-clock-ss">{str(resolve(n.seconds, scope))}</span>}
      </div>
      {(n.sub != null || n.sub2 != null) && (
        <div className="hud-clock-meta">
          {n.sub != null && <span className="hud-clock-date">{str(resolve(n.sub, scope))}</span>}
          {n.sub2 != null && <span className="hud-clock-utc">{str(resolve(n.sub2, scope))}</span>}
        </div>
      )}
    </div>
  ),
  when: (n, scope) =>
    truthy(resolve(n.cond, scope)) ? renderNode(n.then, scope) : (n.else ? renderNode(n.else, scope) : null),
  calendar: (_n, scope) => <CalendarBody cal={scope.cal as MonthCalState} />,
  weather: (_n, scope) => <WeatherBody w={scope.weather as WeatherState} />,
  list: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (items.length === 0 && n.empty != null) {
      return <div style={{ color: 'var(--hub-cream-faint)', fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.12em', padding: '6px 0' }}>{str(resolve(n.empty, scope))}</div>;
    }
    const body = items.map((el, i) => <Fragment key={i}>{renderNode(n.item, { ...scope, $: el })}</Fragment>);
    if (n.dir === 'row') {
      return <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>{body}</div>;
    }
    return <>{body}</>;
  },
  // Write family — each delegates to a hook-bearing component (see below).
  form:   (n, scope) => <FormNode node={n} scope={scope} />,
  input:  (n, scope) => <InputNode node={n} scope={scope} />,
  select: (n, scope) => <SelectNode node={n} scope={scope} />,
  toggle: (n, scope) => <ToggleNode node={n} scope={scope} />,
  button: (n, scope) => <ButtonNode node={n} scope={scope} />,
};

function renderNode(node: WidgetNode, scope: Scope): ReactNode {
  const fn = PRIMITIVES[node.t] as (n: WidgetNode, s: Scope) => ReactNode;
  return fn ? fn(node, scope) : null;
}

/** The eyebrow + right-aligned source row at the top of a card. One definition
 *  for the spec frame and every bespoke card, instead of the same inline div
 *  copy-pasted per component. Renders nothing when both captions are empty. */
function CardHead({ eyebrow, source }: { eyebrow?: string; source?: string }) {
  if (!eyebrow && !source) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {eyebrow && <span className="hud-eyebrow">{eyebrow}</span>}
      {source && <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>{source}</span>}
    </div>
  );
}

/* ── Molecule bodies (self-contained cards) ─────────────────────────────────
 * These are the structurally-bespoke cards (a 7-col month grid; a multi-region
 * weather layout) that don't decompose cleanly into stack/row. They're regular
 * primitives — one registry entry, read their slice from scope, render a full
 * `.hud-card`. Specs using them carry no frame; the molecule owns its chrome. */

function CalendarBody({ cal }: { cal: MonthCalState }) {
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
        <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>{MO_FULL[mo].toUpperCase()} {yr}</span>
      </div>
      <div className="hud-cal-grid">
        {DAY_ABBR.map((d) => <div key={d} className="hud-cal-dow">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const iso = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const info = dayMap.get(iso);
          const isToday = day === today.getDate() && mo === today.getMonth() && yr === today.getFullYear();
          return (
            <div key={iso} className={`hud-cal-day${isToday ? ' today' : ''}${info ? ' has-tasks' : ''}`}>
              <span className="hud-cal-num">{day}</span>
              {info && <span className="hud-cal-dot" style={{ background: info.doneCount === info.count ? 'var(--hub-green)' : 'var(--hub-amber)' }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeatherBody({ w }: { w: WeatherState }) {
  return (
    <div className="hud-card hud-weather-compact">
      <div className="hud-weather-head">
        <span className="hud-eyebrow">WEATHER</span>
        <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>
          {w.source === 'accuweather' ? 'ACCUWEATHER' : w.label}
        </span>
      </div>
      {w.offline ? (
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
              <div className="hud-weather-compact-temp"><b>{w.loaded ? w.temp : '--'}</b><span>°F</span></div>
              <div className="hud-weather-compact-desc">{w.loaded ? `${w.desc} · feels ${w.feels}°` : 'Loading…'}</div>
            </div>
            <div className="hud-weather-hilo" style={{ marginLeft: 0 }}>
              <span className="hi">H {w.loaded ? w.hi : '--'}°</span>
              <span className="lo">L {w.loaded ? w.lo : '--'}°</span>
            </div>
          </div>
          {w.slots.length > 0 && (
            <div className="hud-weather-strip" style={{ paddingTop: 10, marginTop: 10 }}>
              {w.slots.map((s) => (
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

/* ── Interactive escape-hatch cards ─────────────────────────────────────────
 * The spec vocabulary is deliberately read-only. Cards that WRITE (capture
 * input, mutate another app) are bespoke components — they own a form and call
 * the BeigeBoard write client (lib/bb). This is the sanctioned use of the
 * COMPONENT_REGISTRY escape hatch. */

/** Quick-add: capture a task to BeigeBoard from the HUD, no app switch. Lands on
 *  today so it appears in the Today/Progress widgets immediately (writes fire a
 *  change event those read hooks listen for). */
function QuickAddBody({ authed }: { authed: boolean }) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');

  const head = <CardHead eyebrow="QUICK ADD" source="BEIGEBOARD" />;

  if (!authed) {
    return (
      <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {head}
        <span style={{ fontSize: 11, color: 'var(--hub-cream-dim)' }}>SIGN IN TO ADD TASKS</span>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || status === 'saving') return;
    setStatus('saving');
    const ok = await bbCreateItem({ title: t, due_date: todayIso() });
    if (ok) {
      setTitle('');
      setStatus('ok');
      setTimeout(() => setStatus((s) => (s === 'ok' ? 'idle' : s)), 1600);
    } else {
      setStatus('err');
    }
  };

  const note = status === 'ok' ? 'ADDED TO TODAY' : status === 'err' ? 'COULDN’T SAVE — RETRY' : 'LANDS ON TODAY';
  const noteColor = status === 'err' ? 'var(--hub-red)' : status === 'ok' ? 'var(--hub-green)' : 'var(--hub-cream-faint)';

  return (
    <form className="hud-card" onSubmit={submit} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      {head}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          style={{ flex: 1, minWidth: 0, background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', color: 'var(--hub-cream-bright)', fontFamily: 'var(--hub-font-mono)', fontSize: 12, padding: '7px 9px', borderRadius: 'var(--hub-radius-sm)' }}
        />
        <button
          type="submit"
          disabled={!title.trim() || status === 'saving'}
          style={{ flex: 'none', cursor: title.trim() ? 'pointer' : 'default', background: 'transparent', color: 'var(--hub-amber)', fontFamily: 'var(--hub-font-mono)', fontSize: 11, letterSpacing: '0.06em', padding: '7px 12px', border: '1px solid color-mix(in srgb, var(--hub-amber) 40%, transparent)', borderRadius: 'var(--hub-radius-sm)', opacity: title.trim() ? 1 : 0.4 }}
        >
          {status === 'saving' ? '…' : 'ADD'}
        </button>
      </div>
      <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 9, letterSpacing: '0.12em', color: noteColor }}>{note}</span>
    </form>
  );
}

/** Focus: the single "now working on" task pushed from BeigeBoard. Interactive
 *  (it can clear focus → a write), so it's a bespoke component. When focus is
 *  active the HUD dims its other cards around this one (see RoomHUD/HudGrid). */
function FocusBody({ focus }: { focus: FocusState }) {
  const [busy, setBusy] = useState(false);

  const head = <CardHead eyebrow="FOCUS" source="BEIGEBOARD" />;

  if (!focus.authed) {
    return <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', height: '100%' }}>{head}<span style={{ fontSize: 11, color: 'var(--hub-cream-dim)' }}>SIGN IN TO SET A FOCUS</span></div>;
  }
  if (!focus.active) {
    return (
      <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
        {head}
        <span style={{ fontFamily: 'var(--hub-font-serif, var(--hub-font-sans))', fontSize: 15, color: 'var(--hub-cream-dim)' }}>Nothing in focus</span>
        <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--hub-cream-faint)' }}>PICK A TASK IN BEIGEBOARD → FOCUS ON ORDECK</span>
      </div>
    );
  }

  const clear = async () => { setBusy(true); await clearHudFocus(); setBusy(false); };

  const titleStyle: CSSProperties = { fontFamily: 'var(--hub-font-serif, var(--hub-font-sans))', fontSize: 22, fontWeight: 600, color: 'var(--hub-cream-bright)', lineHeight: 1.2, textDecoration: focus.done ? 'line-through' : 'none', opacity: focus.done ? 0.7 : 1 };

  return (
    <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, height: '100%', borderColor: 'color-mix(in srgb, var(--hub-amber) 55%, transparent)' }}>
      {head}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
        {focus.deeplink
          ? <a href={focus.deeplink} style={{ ...titleStyle, textDecorationLine: focus.done ? 'line-through' : 'none' }}>{focus.title}</a>
          : <span style={titleStyle}>{focus.title}</span>}
        <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--hub-cream-dim)' }}>
          {focus.done ? 'DONE' : 'NOW'} · {focus.timeLabel}{focus.tag ? ` · ${focus.tag.toUpperCase()}` : ''}
        </span>
      </div>
      <button
        onClick={clear}
        disabled={busy}
        style={{ alignSelf: 'flex-start', cursor: 'pointer', background: 'transparent', color: 'var(--hub-amber)', fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.1em', padding: '6px 11px', border: '1px solid color-mix(in srgb, var(--hub-amber) 40%, transparent)', borderRadius: 'var(--hub-radius-sm)' }}
      >
        {busy ? '…' : 'END FOCUS'}
      </button>
    </div>
  );
}

/* ── Command vocabulary (declarative writes) ────────────────────────────────
 * The read-only spec grows a write family. A `form` owns a `$form` source its
 * input/select/toggle children write into; its submit (and standalone `button`s)
 * run a CommandRef through ONE capability-driven dispatcher — discover the app's
 * CapabilityDef (weave fetchCapabilities), resolve the body bindings against the
 * live scope (+$form), issue via runCommand, and let the invalidation bus
 * reconcile the owning app's views. Pure data in, so the workshop composes it and
 * an AI can emit it; the dispatcher and loading/error states live here, once. */

interface FormCtxValue { values: Record<string, unknown>; set: (field: string, v: unknown) => void }
const FormCtx = createContext<FormCtxValue | null>(null);

const fieldStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--hub-bg-0)',
  border: '1px solid var(--hub-line)', color: 'var(--hub-cream-bright)',
  fontFamily: 'var(--hub-font-mono)', fontSize: 12, padding: '7px 9px',
  borderRadius: 'var(--hub-radius-sm)',
};
const actionStyle = (color: string, on: boolean): CSSProperties => ({
  alignSelf: 'flex-start', cursor: on ? 'pointer' : 'default', background: 'transparent',
  color, fontFamily: 'var(--hub-font-mono)', fontSize: 11, letterSpacing: '0.06em',
  padding: '7px 12px', border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
  borderRadius: 'var(--hub-radius-sm)', opacity: on ? 1 : 0.4,
});

type CmdStatus = 'idle' | 'saving' | 'ok' | 'err';

/** Resolve a CommandRef to its app + capability, and expose a run() that builds
 *  the body (capability defaults under the ref's bindings) and dispatches it.
 *  `available` is false until the capability is discovered (or if it's gone) —
 *  callers render disabled, the soft-fail equivalent of an offline data source. */
function useCommand(ref: CommandRef) {
  const [doc, setDoc] = useState<CapabilityDoc | null | undefined>(undefined); // undefined = loading
  useEffect(() => {
    let dead = false;
    fetchCapabilities(ref.app).then((d) => { if (!dead) setDoc(d); });
    return () => { dead = true; };
  }, [ref.app]);

  const app = suiteApp(ref.app);
  const cap = doc ? getCapability(doc, ref.capability) : null;
  const available = !!(app?.apiBase && cap);
  const [status, setStatus] = useState<CmdStatus>('idle');

  const run = useCallback(async (scope: Scope): Promise<boolean> => {
    if (!app || !cap) return false;
    setStatus('saving');
    const body: Record<string, unknown> = {};
    for (const fld of cap.body ?? []) if (fld.default !== undefined) body[fld.name] = fld.default;
    for (const [k, b] of Object.entries(ref.body ?? {})) {
      const v = resolve(b, scope);
      if (v !== undefined && v !== null && v !== '') body[k] = v;  // keep optionals unset
    }
    const res = await runCommand(app, cap, body);
    setStatus(res.ok ? 'ok' : 'err');
    if (res.ok) setTimeout(() => setStatus((s) => (s === 'ok' ? 'idle' : s)), 1600);
    return res.ok;
  }, [app, cap, ref.body]);

  return { loading: doc === undefined, available, status, run };
}

function FormNode({ node, scope }: { node: Extract<WidgetNode, { t: 'form' }>; scope: Scope }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const set = useCallback((field: string, v: unknown) => setValues((s) => ({ ...s, [field]: v })), []);
  const cmd = useCommand(node.cmd);
  const formScope: Scope = { ...scope, $form: values };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (cmd.status === 'saving' || !cmd.available) return;
    if (await cmd.run(formScope)) setValues({});
  };

  const label = str(resolve(node.submit, scope));
  const note = !cmd.available && !cmd.loading ? 'UNAVAILABLE'
    : cmd.status === 'ok' ? 'DONE'
    : cmd.status === 'err' ? 'COULDN’T SAVE — RETRY' : '';
  const noteColor = cmd.status === 'err' ? 'var(--hub-red)' : cmd.status === 'ok' ? 'var(--hub-green)' : 'var(--hub-cream-faint)';

  return (
    <FormCtx.Provider value={{ values, set }}>
      {/* A layout container, not a card — the spec frame provides the chrome
          (like every primitive except the calendar/weather molecules). */}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
        {node.children.map((c, i) => <Fragment key={i}>{renderNode(c, formScope)}</Fragment>)}
        <button type="submit" disabled={!cmd.available || cmd.status === 'saving'} style={actionStyle('var(--hub-amber)', cmd.available)}>
          {cmd.status === 'saving' ? '…' : label}
        </button>
        {note && <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 9, letterSpacing: '0.12em', color: noteColor }}>{note}</span>}
      </form>
    </FormCtx.Provider>
  );
}

function InputNode({ node, scope }: { node: Extract<WidgetNode, { t: 'input' }>; scope: Scope }) {
  const ctx = useContext(FormCtx);
  const v = str(ctx?.values[node.field] ?? '');
  const ph = node.placeholder != null ? str(resolve(node.placeholder, scope)) : '';
  return (
    <input value={v} placeholder={ph} type={node.itype ?? 'text'}
      onChange={(e) => ctx?.set(node.field, e.target.value)} style={fieldStyle} />
  );
}

function SelectNode({ node, scope }: { node: Extract<WidgetNode, { t: 'select' }>; scope: Scope }) {
  const ctx = useContext(FormCtx);
  const raw = resolve(node.options, scope);
  const opts = (Array.isArray(raw) ? raw : []).map((o) =>
    o && typeof o === 'object'
      ? { value: str((o as { value?: unknown }).value), label: str((o as { label?: unknown }).label ?? (o as { value?: unknown }).value) }
      : { value: str(o), label: str(o) });
  const v = str(ctx?.values[node.field] ?? '');
  const ph = node.placeholder != null ? str(resolve(node.placeholder, scope)) : '';
  return (
    <select value={v} onChange={(e) => ctx?.set(node.field, e.target.value)} style={fieldStyle}>
      {ph && <option value="">{ph}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ToggleNode({ node, scope }: { node: Extract<WidgetNode, { t: 'toggle' }>; scope: Scope }) {
  const ctx = useContext(FormCtx);
  const checked = !!ctx?.values[node.field];
  const label = node.label != null ? str(resolve(node.label, scope)) : '';
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => ctx?.set(node.field, e.target.checked)} />
      {label && <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' }}>{label}</span>}
    </label>
  );
}

/** Standalone action button (outside a form): runs its command with body bound
 *  against the live scope — e.g. a "mark done" with a fixed id, or a list-row action. */
function ButtonNode({ node, scope }: { node: Extract<WidgetNode, { t: 'button' }>; scope: Scope }) {
  const cmd = useCommand(node.cmd);
  const label = str(resolve(node.text, scope));
  const color = node.tone != null ? toneColor(node.tone, scope, 'accent') : 'var(--hub-amber)';
  const text = cmd.status === 'saving' ? '…' : cmd.status === 'ok' ? 'DONE' : cmd.status === 'err' ? 'RETRY' : label;
  return (
    <button onClick={() => cmd.available && cmd.run(scope)} disabled={!cmd.available || cmd.status === 'saving'} style={actionStyle(color, cmd.available)}>
      {text}
    </button>
  );
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

  // No frame: the body is a self-contained card (a molecule, or chrome:false
  // raw content). Render it bare so it fills the grid cell directly.
  if (!f) return <>{body}</>;

  const eyebrow = f.eyebrow != null ? str(resolve(f.eyebrow, scope)) : '';
  const source = f.source != null ? str(resolve(f.source, scope)) : '';
  const href = f.href != null ? str(resolve(f.href, scope)) : '';

  const head = <CardHead eyebrow={eyebrow} source={source} />;

  const inner = <>{head}{body}</>;
  const cls = f.chrome === false ? 'hud-spec-raw' : 'hud-card';
  const style: CSSProperties = { padding: f.chrome === false ? '14px 6px' : 14, display: 'flex', flexDirection: 'column', height: '100%' };
  return href
    ? <a className={cls} href={href} style={style}>{inner}</a>
    : <div className={cls} style={style}>{inner}</div>;
}

/* ═══ Bespoke component escape hatch ════════════════════════════════════════
 * The six v2 display cards are all specs now (hud/state.ts). This registry is
 * for cards genuinely beyond the read-only primitive vocabulary — today, the
 * interactive ones that WRITE back to a service. */
const COMPONENT_REGISTRY: Record<string, (ctx: WidgetCtx) => ReactNode> = {
  quickadd: (ctx) => <QuickAddBody authed={ctx.today.authed} />,
  focus: (ctx) => <FocusBody focus={ctx.focus} />,
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

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
 * Every card is a spec. The `component` escape hatch (a bespoke React card named by a
 * def) is retired: Focus and Week, its last two, are manifest molecules, and a stored
 * def naming one is repaired on load (state.ts). The Module-Federation remote path is
 * gone too.
 */

import {
  Fragment, createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type FormEvent, type ReactNode,
} from 'react';
import {
  fetchCapabilities, getCapability, runCommand, suiteApp, followJob, format, type CapabilityDoc, type JobOutcome, resolveBinding, truthy } from '@jkos/weave';
import {
  type ClockState,
  type WeatherState,
  type SystemsState,
  type TodayState,
  type MonthCalState,
  type CalDay,
  type NotificationsState,
  type FocusState,
  type PinnedState,
} from '../pages/hud/useHudData';
import { WeekView, type CalendarItem, type CardResolvers } from '@jkos/cards';
import type { Binding, CommandRef, IconName, Tone, ToneBinding, WidgetDef, WidgetNode, WidgetSpec } from './types';
import { useDataSources, cardState, type CardState } from './sources';
import './widgets.css';
import { TONE_COLOR } from './tone';
import { safeHref, sourcesOf } from '@jkos/widgets';
import { usesAi } from './ai';
import { clearHudFocus } from '../lib/shelf';
import { Field, SelectField, Check, AsyncView } from '@jkos/ui';
import ErrorBoundary from '../components/ErrorBoundary';

const MO_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Everything a widget renderer can read. RoomHUD assembles this once from its
 *  data hooks; built-in hud slices (clock/weather/today/systems/cal) are
 *  always in a spec's binding scope, alongside `authUrl`. */
export interface WidgetCtx {
  clock: ClockState;
  weather: WeatherState;
  systems: SystemsState;
  today: TodayState;
  cal: MonthCalState;
  /** Full BeigeBoard item list (CalendarItem shape) for the @jkos/cards widgets. */
  items: CalendarItem[];
  /** Today's local date (YYYY-MM-DD) — what the calendar widgets centre on. */
  todayIso: string;
  notifications: NotificationsState;
  focus: FocusState;
  pinned: PinnedState;
  authUrl: string;
  /** The suite-wide LazurOS kill switch (profile → AI). Off, a widget that binds an AI
   *  app does not render — or read, or run anything. */
  aiEnabled: boolean;
}

/* ═══ Declarative spec layer ═══════════════════════════════════════════════ */

export type Scope = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Resolve a binding against the current scope (literal, {lit}, or {src,path}).
 *
 *  ⭐ DELEGATES TO @jkos/weave (D13). This function and the trigger engine's
 *  `resolveBindings` were the two halves of one system that never met — a
 *  WidgetSpec binds a dataset into a tree of primitives (READ), a TriggerDef binds a
 *  capability's typed output into another's body (WRITE) — each with its own
 *  vocabulary for "point at a value that will exist at run time". One model now, and
 *  this thin wrapper stays only because `resolve(b, scope)` is the argument order
 *  ~40 call sites in this file are written against. */
export function resolve(b: Binding, scope: Scope): unknown {
  return resolveBinding(b, scope);
}

/** Resolve a tone that may be fixed OR data-bound (→ a CSS colour). Unknown
 *  resolved values fall back to `fallback`, so a bad data path degrades quietly. */
function toneColor(t: ToneBinding | undefined, scope: Scope, fallback: Tone = 'muted'): string {
  if (t == null) return TONE_COLOR[fallback];
  const v = typeof t === 'object' ? resolve(t as Binding, scope) : t;
  return TONE_COLOR[v as Tone] ?? TONE_COLOR[fallback];
}

/** Truthiness for `when` lives in @jkos/weave's binding model now, beside the `not`
 *  condition that must agree with it. Re-exported for the Workshop canvas. */
export { truthy };

/** The ONLY inline style a widget renderer writes: custom properties carrying what a
 *  node's data decides (a gap, a tone's colour, a size). Every visual rule is a class in
 *  widgets.css, and check:widgets holds every `style=` in this file to this helper.
 *  ⚠️ Custom properties inherit — an element that reads one sets ALL of its own, defaults
 *  included, or a nested stack would take its parent's gap. */
function vars(v: Record<`--${string}`, string | number>): CSSProperties {
  return v as unknown as CSSProperties;
}

/** A tone for a PATTERN: the status palette, except that `accent` is the suite accent
 *  chain (--color-accent), which a theme can move — the built-ins' TONE_COLOR still maps
 *  it to amber, and moving them is the visual pass (TODO §7). */
function patternTone(t: ToneBinding | undefined, scope: Scope, fallback: Tone): string {
  const v = t == null ? fallback : typeof t === 'object' ? resolve(t as Binding, scope) : t;
  const tone = (typeof v === 'string' && v in TONE_COLOR ? v : fallback) as Tone;
  return tone === 'accent' ? 'var(--color-accent)' : TONE_COLOR[tone];
}

/** An optional binding's text: '' when the prop is absent or resolves to nothing. */
function opt(b: Binding | undefined, scope: Scope): string {
  return b == null ? '' : str(resolve(b, scope));
}

/** A sparkline's points over a 100-wide box, with a 4px inset so round caps never clip. */
function sparkPoints(arr: unknown[], path: string | undefined, h: number): string | null {
  const values = arr.map((el) => num(path && el != null && typeof el === 'object' ? (el as Record<string, unknown>)[path] : el));
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${(i / (values.length - 1)) * 100},${4 + (1 - (v - min) / span) * (h - 8)}`).join(' ');
}

/** Curated line-icon set (inherits stroke colour + size). `dot` is the fallback. Keyed
 *  by the manifest's ICON_NAMES (IconName), so a name the validator accepts always draws. */
const ICONS: Record<IconName, ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" /></>,
  moon: <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />,
  cloud: <path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 006 19z" />,
  rain: <><path d="M17.5 15a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 005.5 15" /><path d="M8 19v2M12 19v3M16 19v2" /></>,
  snow: <><path d="M17.5 14a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 005.5 14" /><path d="M8 17.5h.01M12 19h.01M16 17.5h.01M10 21h.01M14 21.5h.01" /></>,
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

/** A pattern's leading glyph, stroked in its tone (an unknown name draws the dot). */
function patternIcon(name: string, tone: string): ReactNode {
  return (
    <svg className="hud-p-icon" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={vars({ '--w-tone': tone })}>
      {ICONS[name as IconName] ?? ICONS.dot}
    </svg>
  );
}

/** node type → renderer. Each case is one primitive; adding to the vocabulary is
 *  a new WidgetNode variant + a new entry here. */
type NodeOf<K extends WidgetNode['t']> = Extract<WidgetNode, { t: K }>;
type Primitives = { [K in WidgetNode['t']]: (node: NodeOf<K>, scope: Scope) => ReactNode };

const PRIMITIVES: Primitives = {
  stack: (n, scope) => (
    <div className={`hud-w-stack${n.grow ? ' is-grow' : ''}`} style={vars({ '--w-gap': `${n.gap ?? 8}px`, '--w-justify': n.justify ?? 'flex-start' })}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  row: (n, scope) => (
    <div className={`hud-w-row${n.grow ? ' is-grow' : ''}`} style={vars({ '--w-gap': `${n.gap ?? 8}px`, '--w-justify': n.justify ?? 'flex-start', '--w-align': n.align ?? 'center' })}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  label: (n, scope) => <span className={`hud-eyebrow${n.size === 'sm' || n.size === 'xs' ? ` is-${n.size}` : ''}`}>{str(resolve(n.text, scope))}</span>,
  text: (n, scope) => (
    <span className={`hud-w-text${n.variant && n.variant !== 'body' ? ` is-${n.variant}` : ''}${n.grow ? ' is-grow' : ''}`}>{str(resolve(n.text, scope))}</span>
  ),
  metric: (n, scope) => {
    const size = n.size ?? 30;
    return (
      <div className="hud-w-metric" style={vars({ '--w-size': `${size}px`, '--w-unit': `${Math.max(10, Math.round(size * 0.4))}px` })}>
        <b>{str(resolve(n.value, scope))}</b>
        {n.unit != null && <span className="hud-w-metric-unit">{str(resolve(n.unit, scope))}</span>}
        {n.sub != null && <span className="hud-w-metric-sub">{str(resolve(n.sub, scope))}</span>}
      </div>
    );
  },
  bar: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 100;
    const pct = m > 0 ? Math.max(0, Math.min(100, (v / m) * 100)) : 0;
    return <span className="hud-bar"><span style={vars({ '--w-fill': `${pct}%` })} className="hud-w-fill" /></span>;
  },
  pill: (n, scope) => (
    <span className="hud-w-pill" style={vars({ '--w-tone': toneColor(n.tone, scope, 'ok') })}>{str(resolve(n.text, scope))}</span>
  ),
  dot: (n, scope) => (
    <span className={`hud-dot hud-w-dot${n.pulse ? ' pulse' : ''}`} style={vars({ '--w-tone': toneColor(n.tone, scope, 'muted') })} />
  ),
  keyval: (n, scope) => (
    <div className="hud-w-keyval">
      <span className="hud-w-keyval-label" style={vars({ '--w-tone': n.tone ? toneColor(n.tone, scope) : 'var(--hub-cream)' })}>
        {str(resolve(n.label, scope))}
      </span>
      <span className="hud-w-keyval-value">{str(resolve(n.value, scope))}</span>
    </div>
  ),
  gauge: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 100;
    const pct = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
    const size = n.size ?? 76;
    const R = 26, C = 2 * Math.PI * R;
    return (
      <div className="hud-w-gauge">
        <svg width={size} height={size} viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--hub-line)" strokeWidth="6" />
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--hub-amber)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 36 36)" className="hud-w-gauge-arc" />
          <text x="36" y="41" textAnchor="middle" className="hud-w-gauge-num">{Math.round(pct * 100)}</text>
        </svg>
        {n.label != null && <span className="hud-w-caption">{str(resolve(n.label, scope))}</span>}
      </div>
    );
  },
  divider: (n, scope) => {
    const label = n.label != null ? str(resolve(n.label, scope)) : '';
    if (!label) return <div className="hud-w-rule" />;
    return (
      <div className="hud-w-divider">
        <span className="hud-w-divider-line" />
        <span className="hud-w-caption">{label}</span>
        <span className="hud-w-divider-line" />
      </div>
    );
  },
  link: (n, scope) => (
    <a href={safeHref(resolve(n.href, scope))} className="hud-w-link">{str(resolve(n.text, scope))} →</a>
  ),
  icon: (n, scope) => {
    const name = str(resolve(n.name, scope));
    const s = n.size ?? 24;
    const color = n.tone != null ? toneColor(n.tone, scope, 'accent') : 'var(--hub-amber)';
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hud-w-icon">
        {ICONS[name as IconName] ?? ICONS.dot}
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
  // Focus and Week were the `component` escape hatch — bespoke cards nothing could
  // edit or keep as a file. They are molecules now, declared in the manifest.
  focus: (_n, scope) => <FocusBody focus={scope.focus as FocusState} />,
  week: (_n, scope) => <WeekBody items={scope.items as CalendarItem[]} todayIso={String(scope.todayIso ?? '')} />,
  list: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (items.length === 0 && n.empty != null) {
      return <div className="hud-w-list-empty">{str(resolve(n.empty, scope))}</div>;
    }
    const body = items.map((el, i) => <Fragment key={i}>{renderNode(n.item, { ...scope, $: el })}</Fragment>);
    if (n.dir === 'row') return <div className="hud-w-list-row">{body}</div>;
    if (n.cols && n.cols > 1) {
      return <div className="hud-w-list-grid" style={vars({ '--w-cols': Math.round(n.cols) })}>{body}</div>;
    }
    return <>{body}</>;
  },
  sparkline: (n, scope) => {
    const arr = resolve(n.from, scope);
    const values = (Array.isArray(arr) ? arr : [])
      .map((el) => num(n.path && el != null && typeof el === 'object' ? (el as Record<string, unknown>)[n.path] : el));
    if (values.length < 2) return null;
    const h = n.height ?? 28;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    // 4px vertical inset keeps the round linecaps from clipping at the extremes.
    const pts = values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${4 + (1 - (v - min) / span) * (h - 8)}`)
      .join(' ');
    const color = n.tone != null ? toneColor(n.tone, scope, 'accent') : 'var(--hub-amber)';
    return (
      <svg width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="hud-w-spark">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          vectorEffect="non-scaling-stroke" />
      </svg>
    );
  },
  /* ── Patterns: one node, a finished card body (widgets.css § Patterns) ───── */
  stat: (n, scope) => {
    const trend = n.trend != null ? resolve(n.trend, scope) : null;
    const pts = Array.isArray(trend) ? sparkPoints(trend, n.trendPath, 24) : null;
    return (
      <div className="hud-p hud-p-stat">
        {(n.label != null || n.delta != null) && (
          <div className="hud-p-line">
            {n.label != null && <span className="hud-p-label">{str(resolve(n.label, scope))}</span>}
            {n.delta != null && (
              <span className="hud-p-delta" style={vars({ '--w-tone': patternTone(n.deltaTone, scope, 'muted') })}>{str(resolve(n.delta, scope))}</span>
            )}
          </div>
        )}
        <div className="hud-p-stat-value">
          <b>{str(resolve(n.value, scope))}</b>
          {n.unit != null && <span>{str(resolve(n.unit, scope))}</span>}
        </div>
        {opt(n.sub, scope) && <div className="hud-p-sub">{opt(n.sub, scope)}</div>}
        {pts && (
          <svg className="hud-p-trend" width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none">
            <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
    );
  },
  meter: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 1;
    const pct = m > 0 ? Math.max(0, Math.min(100, (v / m) * 100)) : 0;
    return (
      <div className="hud-p hud-p-meter" style={vars({ '--w-tone': patternTone(n.tone, scope, 'accent'), '--w-fill': `${pct}%` })}>
        {(n.label != null || n.detail != null) && (
          <div className="hud-p-line">
            {n.label != null && <span className="hud-p-label">{str(resolve(n.label, scope))}</span>}
            {n.detail != null && <span className="hud-p-detail">{str(resolve(n.detail, scope))}</span>}
          </div>
        )}
        <div className="hud-p-track"><span /></div>
      </div>
    );
  },
  rows: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (!items.length) return n.empty != null ? <div className="hud-p hud-p-empty">{str(resolve(n.empty, scope))}</div> : null;
    const shown = n.max && n.max > 0 ? items.slice(0, n.max) : items;
    return (
      <div className="hud-p hud-p-rows">
        {shown.map((el, i) => {
          const s = { ...scope, $: el };
          const href = n.href != null ? safeHref(resolve(n.href, s)) : undefined;
          // An optional line whose value is empty draws nothing, not an empty line — so
          // `sub: $.error` shows only on the rows that have one.
          const lead = opt(n.lead, s), sub = opt(n.sub, s), detail = opt(n.detail, s);
          const inner = (
            <>
              {n.icon != null ? patternIcon(str(resolve(n.icon, s)), patternTone(n.mark, s, 'muted'))
                : n.mark != null ? <span className="hud-p-mark" style={vars({ '--w-tone': patternTone(n.mark, s, 'muted') })} /> : null}
              {n.lead != null && <span className="hud-p-lead">{lead}</span>}
              <span className="hud-p-main">
                <span className="hud-p-title">{str(resolve(n.title, s))}</span>
                {sub && <span className="hud-p-sub">{sub}</span>}
              </span>
              {detail && <span className="hud-p-detail">{detail}</span>}
            </>
          );
          return href ? <a key={i} className="hud-p-row" href={href}>{inner}</a> : <div key={i} className="hud-p-row">{inner}</div>;
        })}
        {items.length > shown.length && <div className="hud-p-more">+{items.length - shown.length} MORE</div>}
      </div>
    );
  },
  feed: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (!items.length) return n.empty != null ? <div className="hud-p hud-p-empty">{str(resolve(n.empty, scope))}</div> : null;
    const shown = n.max && n.max > 0 ? items.slice(0, n.max) : items;
    return (
      <div className="hud-p hud-p-feed">
        {shown.map((el, i) => {
          const s = { ...scope, $: el };
          const tone = patternTone(n.tone, s, 'muted');
          // An instant is drawn as 'ago' unless the binding already says how to draw it.
          const at = n.at == null ? null
            : typeof n.at === 'object' && 'fmt' in n.at ? str(resolve(n.at, s)) : str(format(resolve(n.at, s), 'ago', s));
          return (
            <div key={i} className="hud-p-event">
              {n.icon != null ? patternIcon(str(resolve(n.icon, s)), tone) : <span className="hud-p-mark" style={vars({ '--w-tone': tone })} />}
              <span className="hud-p-main">
                <span className="hud-p-title">{str(resolve(n.text, s))}</span>
                {opt(n.detail, s) && <span className="hud-p-sub">{opt(n.detail, s)}</span>}
              </span>
              {at && <span className="hud-p-when">{at}</span>}
            </div>
          );
        })}
        {items.length > shown.length && <div className="hud-p-more">+{items.length - shown.length} MORE</div>}
      </div>
    );
  },
  facts: (n, scope) => (
    // The grid is INSIDE the pattern: a container query styles descendants, never the
    // container itself, so the one-column narrow rule needs something to land on.
    <div className="hud-p hud-p-facts"><div className="hud-p-facts-grid" style={vars({ '--w-cols': Math.max(1, Math.round(n.cols ?? 2)) })}>
      {n.items.map((f, i) => (
        <div key={i} className="hud-p-fact">
          <span className="hud-p-label">{str(resolve(f.label, scope))}</span>
          <span className="hud-p-fact-value" style={vars({ '--w-tone': f.tone != null ? patternTone(f.tone, scope, 'muted') : 'var(--hub-cream-bright)' })}>
            {str(resolve(f.value, scope))}
          </span>
        </div>
      ))}
    </div></div>
  ),
  media: (n, scope) => {
    const img = n.image != null ? safeHref(resolve(n.image, scope)) : undefined;
    const href = n.href != null ? safeHref(resolve(n.href, scope)) : undefined;
    const p = n.progress != null ? num(resolve(n.progress, scope)) : null;
    const m = n.max != null ? num(resolve(n.max, scope)) : 1;
    const pct = p != null && m > 0 ? Math.max(0, Math.min(100, (p / m) * 100)) : null;
    const body = (
      <>
        <div className="hud-p-media-top">
          {img ? <img className="hud-p-art" src={img} alt="" /> : <span className="hud-p-art is-blank"><svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5">{ICONS.book}</svg></span>}
          <span className="hud-p-main">
            <span className="hud-p-media-title">{str(resolve(n.title, scope))}</span>
            {n.subtitle != null && <span className="hud-p-sub">{str(resolve(n.subtitle, scope))}</span>}
            {n.meta != null && <span className="hud-p-detail">{str(resolve(n.meta, scope))}</span>}
          </span>
        </div>
        {pct != null && <div className="hud-p-track" style={vars({ '--w-tone': 'var(--color-accent)', '--w-fill': `${pct}%` })}><span /></div>}
      </>
    );
    return href ? <a className="hud-p hud-p-media" href={href}>{body}</a> : <div className="hud-p hud-p-media">{body}</div>;
  },
  ask: (n, scope) => <AskNode node={n} scope={scope} />,
  // Write family — each delegates to a hook-bearing component (see below).
  form:   (n, scope) => <FormNode node={n} scope={scope} />,
  input:  (n, scope) => <InputNode node={n} scope={scope} />,
  select: (n, scope) => <SelectNode node={n} scope={scope} />,
  toggle: (n, scope) => <ToggleNode node={n} scope={scope} />,
  button: (n, scope) => <ButtonNode node={n} scope={scope} />,
};

/** Exported for the workshop's canvas editor, which reuses the SAME primitive
 *  renderers for its editable leaves (so what you edit is what ships). */
export function renderNode(node: WidgetNode, scope: Scope): ReactNode {
  const fn = PRIMITIVES[node.t] as (n: WidgetNode, s: Scope) => ReactNode;
  return fn ? fn(node, scope) : null;
}

/** The eyebrow + right-aligned source row at the top of a card. One definition
 *  for the spec frame and every bespoke card, instead of the same inline div
 *  copy-pasted per component. Renders nothing when both captions are empty. */
function CardHead({ eyebrow, source, stale }: { eyebrow?: string; source?: string; stale?: string }) {
  if (!eyebrow && !source && !stale) return null;
  return (
    <div className="hud-w-head">
      {eyebrow && <span className="hud-eyebrow">{eyebrow}</span>}
      {(source || stale) && (
        <span className="hud-eyebrow-src">
          {source}{stale && <span className="hud-widget-stale">{source ? ' · ' : ''}{stale}</span>}
        </span>
      )}
    </div>
  );
}

/** What the frame draws instead of the body, for every state but ready. The copy is the
 *  suite's (AsyncView's italic off-state note); only the empty line is the author's. */
function stateView(state: CardState, emptyText: string, authUrl: string): ReactNode {
  const appName = (id: string) => suiteApp(id as Parameters<typeof suiteApp>[0])?.label ?? id;
  // A fault reads in the error ink; being signed out is not a fault, so it takes the
  // neutral note, with the way in beside it.
  const fault =
    state.kind === 'offline' ? `${appName(state.app)} is offline.`
    : state.kind === 'forbidden' ? 'Not available to your account.'
    : state.kind === 'unavailable' ? <span title={state.error}>Unavailable.</span>
    : null;
  const neutral = state.kind === 'signed-out'
    ? <>Sign in to see this.<a href={safeHref(authUrl)}>SIGN IN →</a></>
    : emptyText;
  return (
    <AsyncView className="hud-widget-state" loading={state.kind === 'loading'} error={fault != null}
      empty={state.kind === 'empty' || state.kind === 'signed-out'} errorText={fault} emptyText={neutral}>
      {null}
    </AsyncView>
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
        <span className="hud-eyebrow-src hud-w-push">{MO_FULL[mo].toUpperCase()} {yr}</span>
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
              {info && <span className="hud-cal-dot hud-w-toned" style={vars({ '--w-tone': info.doneCount === info.count ? 'var(--hub-green)' : 'var(--hub-amber)' })} />}
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
        <span className="hud-eyebrow-src hud-w-push">
          {w.source === 'accuweather' ? 'ACCUWEATHER' : w.label}
        </span>
      </div>
      {w.offline ? (
        <div className="hud-w-weather-off">
          WEATHER FEED OFFLINE
        </div>
      ) : (
        <>
          <div className="hud-weather-compact-row">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--hub-amber)" strokeWidth="1.4" strokeLinecap="round" className="hud-w-weather-glyph">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" />
            </svg>
            <div className="hud-w-grow">
              <div className="hud-weather-compact-temp"><b>{w.loaded ? w.temp : '--'}</b><span>°F</span></div>
              <div className="hud-weather-compact-desc">{w.loaded ? `${w.desc} · feels ${w.feels}°` : 'Loading…'}</div>
            </div>
            <div className="hud-weather-hilo hud-w-flush">
              <span className="hi">H {w.loaded ? w.hi : '--'}°</span>
              <span className="lo">L {w.loaded ? w.lo : '--'}°</span>
            </div>
          </div>
          {w.slots.length > 0 && (
            <div className="hud-weather-strip hud-w-foot">
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
 * The spec vocabulary's write path is the command family (form/button →
 * capability dispatch); quick-add now lives INSIDE the Today spec as a form.
 * What remains bespoke is Focus (clears suite-wide focus state, drives the
 * dim-siblings behaviour) — the sanctioned COMPONENT_REGISTRY use. */

/** Focus: the single "now working on" task pushed from BeigeBoard. Interactive
 *  (it can clear focus → a write), so it's a bespoke component. When focus is
 *  active the HUD dims its other cards around this one (see RoomHUD/HudGrid). */
function FocusBody({ focus }: { focus: FocusState }) {
  const [busy, setBusy] = useState(false);

  const head = <CardHead eyebrow="FOCUS" source="BEIGEBOARD" />;

  if (!focus.authed) {
    return <div className="hud-card hud-w-focus">{head}<span className="hud-w-focus-note">SIGN IN TO SET A FOCUS</span></div>;
  }
  if (!focus.active) {
    return (
      <div className="hud-card hud-w-focus is-idle">
        {head}
        <span className="hud-w-focus-empty">Nothing in focus</span>
        <span className="hud-w-focus-hint">PICK A TASK IN BEIGEBOARD → FOCUS ON ORDECK</span>
      </div>
    );
  }

  const clear = async () => { setBusy(true); await clearHudFocus(); setBusy(false); };

  const titleCls = `hud-w-focus-title${focus.done ? ' is-done' : ''}`;

  return (
    <div className="hud-card hud-w-focus is-on">
      {head}
      <div className="hud-w-focus-body">
        {focus.deeplink
          ? <a href={safeHref(focus.deeplink)} className={titleCls}>{focus.title}</a>
          : <span className={titleCls}>{focus.title}</span>}
        <span className="hud-w-focus-meta">
          {focus.done ? 'DONE' : 'NOW'} · {focus.timeLabel}{focus.tag ? ` · ${focus.tag.toUpperCase()}` : ''}
        </span>
      </div>
      <button
        onClick={clear}
        disabled={busy}
        className="hud-w-focus-end"
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

// The field faces come from the @jkos/ui primitives; the widget form only makes them
// fill the card's width (.hud-w-field), and a command's button is .hud-w-action.
const actionCls = (on: boolean) => `hud-w-action${on ? '' : ' is-off'}`;

type CmdStatus = 'idle' | 'saving' | 'working' | 'ok' | 'err';

/** Resolve a CommandRef to its app + capability, and expose a run() that builds
 *  the body (capability defaults under the ref's bindings) and dispatches it.
 *  `available` is false until the capability is discovered (or if it's gone) —
 *  callers render disabled, the soft-fail equivalent of an offline data source.
 *
 *  `outcome` is what the command produced — `$result` / `$job` in a `result` slot. A
 *  synchronous capability's is its answer. An ASYNC one's (it declares `resolves`)
 *  answer is only a job handle, so the job is FOLLOWED (weave followJob, through the
 *  app's common-shape jobs dataset) until it ends, and the outcome is what it
 *  resolved to — the answer itself, never an id to go looking for. */
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
  const [outcome, setOutcome] = useState<JobOutcome | null>(null);
  const following = useRef<AbortController | null>(null);
  useEffect(() => () => following.current?.abort(), []);

  const settle = useCallback((o: JobOutcome) => {
    setOutcome(o);
    setStatus(o.phase === 'done' ? 'ok' : 'err');
    if (o.phase === 'done') setTimeout(() => setStatus((s) => (s === 'ok' ? 'idle' : s)), 1600);
  }, []);

  const run = useCallback(async (scope: Scope): Promise<boolean> => {
    if (!app || !cap) return false;
    following.current?.abort();
    setStatus('saving');
    setOutcome({ phase: 'pending' });
    const body: Record<string, unknown> = {};
    for (const fld of cap.body ?? []) if (fld.default !== undefined) body[fld.name] = fld.default;
    for (const [k, b] of Object.entries(ref.body ?? {})) {
      const v = resolve(b, scope);
      if (v !== undefined && v !== null && v !== '') body[k] = v;  // keep optionals unset
    }
    const res = await runCommand(app, cap, body);
    if (!res.ok) { settle({ phase: 'failed', error: res.error }); return false; }
    if (!Array.isArray(cap.resolves)) { settle({ phase: 'done', result: res.data }); return true; }

    const jobId = (res.data as { job_id?: unknown } | null)?.job_id;
    if (typeof jobId !== 'string' && typeof jobId !== 'number') {
      settle({ phase: 'lost', error: `${ref.app}.${ref.capability} is async and answered no job_id` });
      return false;
    }
    setStatus('working');
    const ac = new AbortController();
    following.current = ac;
    void followJob(ref.app, String(jobId), { signal: ac.signal, onUpdate: (o) => { if (!ac.signal.aborted) setOutcome(o); } })
      .then((o) => { if (!ac.signal.aborted) settle(o); });
    return true;   // accepted: the inputs clear while the job runs
  }, [app, cap, ref.app, ref.capability, ref.body, settle]);

  return { loading: doc === undefined, available, status, outcome, async: Array.isArray(cap?.resolves), run };
}

/** A command's `result` slot, drawn with what it produced: `$result` (the answer, or
 *  what an async job resolved to) and `$job` ({ phase, status, error }). */
function resultSlot(node: WidgetNode | undefined, outcome: JobOutcome | null, scope: Scope): ReactNode {
  if (!node || !outcome) return null;
  return renderNode(node, { ...scope, $result: outcome.result, $job: outcome });
}

/** The line under a command: what it is doing, or how it ended. */
function commandNote(cmd: ReturnType<typeof useCommand>): { text: string; color: string } {
  if (!cmd.available && !cmd.loading) return { text: 'UNAVAILABLE', color: 'var(--hub-cream-faint)' };
  if (cmd.status === 'working') return { text: 'WORKING…', color: 'var(--hub-cream-faint)' };
  if (cmd.status === 'ok') return { text: 'DONE', color: 'var(--hub-green)' };
  if (cmd.status === 'err') {
    // The job ran and failed; the job was not followed to an end; the call itself failed.
    const text = cmd.async && cmd.outcome?.phase === 'failed' && cmd.outcome.status ? 'FAILED'
      : cmd.outcome?.phase === 'lost' ? 'NO ANSWER YET'
      : 'COULDN’T SAVE — RETRY';
    return { text, color: 'var(--hub-red)' };
  }
  return { text: '', color: 'var(--hub-cream-faint)' };
}

function FormNode({ node, scope }: { node: Extract<WidgetNode, { t: 'form' }>; scope: Scope }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const set = useCallback((field: string, v: unknown) => setValues((s) => ({ ...s, [field]: v })), []);
  const cmd = useCommand(node.cmd);
  const formScope: Scope = { ...scope, $form: values };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (cmd.status === 'saving' || cmd.status === 'working' || !cmd.available) return;
    if (await cmd.run(formScope)) setValues({});
  };

  const label = str(resolve(node.submit, scope));
  const note = commandNote(cmd);

  return (
    <FormCtx.Provider value={{ values, set }}>
      {/* A layout container, not a card — the spec frame provides the chrome
          (like every primitive except the calendar/weather molecules). */}
      <form onSubmit={submit} className="hud-w-form">
        {node.children.map((c, i) => <Fragment key={i}>{renderNode(c, formScope)}</Fragment>)}
        <button type="submit" disabled={!cmd.available || cmd.status === 'saving' || cmd.status === 'working'}
          className={actionCls(cmd.available)} style={vars({ '--w-tone': 'var(--hub-amber)' })}>
          {cmd.status === 'saving' ? '…' : label}
        </button>
        {note.text && <span className="hud-w-note" style={vars({ '--w-tone': note.color })}>{note.text}</span>}
        {resultSlot(node.result, cmd.outcome, scope)}
      </form>
    </FormCtx.Provider>
  );
}

function InputNode({ node, scope }: { node: Extract<WidgetNode, { t: 'input' }>; scope: Scope }) {
  const ctx = useContext(FormCtx);
  const v = str(ctx?.values[node.field] ?? '');
  const ph = node.placeholder != null ? str(resolve(node.placeholder, scope)) : '';
  return (
    <Field value={v} placeholder={ph} type={node.itype ?? 'text'}
      onChange={(e) => ctx?.set(node.field, e.target.value)} className="hud-w-field" />
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
    <SelectField value={v} onChange={(e) => ctx?.set(node.field, e.target.value)}
      wrapperClassName="hud-w-field" className="hud-w-field">
      {ph && <option value="">{ph}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </SelectField>
  );
}

function ToggleNode({ node, scope }: { node: Extract<WidgetNode, { t: 'toggle' }>; scope: Scope }) {
  const ctx = useContext(FormCtx);
  const checked = !!ctx?.values[node.field];
  const label = node.label != null ? str(resolve(node.label, scope)) : '';
  return (
    <label className="hud-w-toggle">
      <Check checked={checked} onChange={(next) => ctx?.set(node.field, next)} />
      {label && <span className="hud-w-toggle-label">{label}</span>}
    </label>
  );
}

/** The `ask` pattern: one question, its answer drawn under it. The question is sent as
 *  `field` (default "text") in the command's body; an async command is FOLLOWED to what
 *  it resolved to (useCommand), and `answer` picks what to show from $result (default
 *  $result.response). */
function AskNode({ node, scope }: { node: Extract<WidgetNode, { t: 'ask' }>; scope: Scope }) {
  const field = node.field ?? 'text';
  const ref = useMemo<CommandRef>(
    () => ({ ...node.cmd, body: { ...(node.cmd.body ?? {}), [field]: { src: '$ask', path: 'q' } } }),
    [node.cmd, field],
  );
  const cmd = useCommand(ref);
  const [q, setQ] = useState('');
  const busy = cmd.status === 'saving' || cmd.status === 'working';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !cmd.available || !q.trim()) return;
    if (await cmd.run({ ...scope, $ask: { q: q.trim() } })) setQ('');
  };
  const o = cmd.outcome;
  const answer = o?.phase === 'done'
    ? str(resolve(node.answer ?? { src: '$result', path: 'response' }, { ...scope, $result: o.result, $job: o }))
    : '';
  return (
    <form className="hud-p hud-p-ask" onSubmit={submit}>
      <div className="hud-p-ask-bar">
        <Field value={q} placeholder={node.placeholder != null ? str(resolve(node.placeholder, scope)) : 'Ask…'}
          onChange={(e) => setQ(e.target.value)} className="hud-p-ask-input" />
        <button type="submit" disabled={!cmd.available || busy} className={actionCls(cmd.available)}
          style={vars({ '--w-tone': 'var(--color-accent)' })}>
          {busy ? '…' : str(resolve(node.submit ?? 'ASK', scope))}
        </button>
      </div>
      {!cmd.available && !cmd.loading && <span className="hud-p-note">Unavailable.</span>}
      {o?.phase === 'pending' && (
        <span className="hud-p-note">Working…{o.status ? ` ${o.status.toLowerCase().replace(/_/g, ' ')}` : ''}</span>
      )}
      {o?.phase === 'done' && <p className="hud-p-answer">{answer}</p>}
      {(o?.phase === 'failed' || o?.phase === 'lost') && <p className="hud-p-answer is-error">{o.error}</p>}
    </form>
  );
}

/** Standalone action button (outside a form): runs its command with body bound
 *  against the live scope — e.g. a "mark done" with a fixed id, or a list-row action. */
function ButtonNode({ node, scope }: { node: Extract<WidgetNode, { t: 'button' }>; scope: Scope }) {
  const cmd = useCommand(node.cmd);
  const label = str(resolve(node.text, scope));
  const color = node.tone != null ? toneColor(node.tone, scope, 'accent') : 'var(--hub-amber)';
  const text = cmd.status === 'saving' ? '…' : cmd.status === 'working' ? 'WORKING…' : cmd.status === 'ok' ? 'DONE' : cmd.status === 'err' ? 'RETRY' : label;
  return (
    <>
      <button onClick={() => cmd.available && cmd.run(scope)} disabled={!cmd.available || cmd.status === 'saving' || cmd.status === 'working'}
        className={actionCls(cmd.available)} style={vars({ '--w-tone': color })}>
        {text}
      </button>
      {resultSlot(node.result, cmd.outcome, scope)}
    </>
  );
}

function SpecWidget({ spec, ctx }: { spec: WidgetSpec; ctx: WidgetCtx }) {
  // `$now` is the clock's instant: what `fmt: 'ago'` measures against.
  const base: Scope = { ...(ctx as unknown as Scope), $now: ctx.clock.now };
  // Each declared source by name, and `$sources.<name>.state` beside it — ready, empty,
  // loading, signed-out, offline… (./sources.ts), so a card can tell "nothing" from "down".
  const { data, status } = useDataSources(spec.sources, base);
  const scope: Scope = { ...base, ...data, $sources: status };
  // The FRAME owns the states — loading, offline, signed-out, forbidden, unavailable,
  // empty — so no author draws them and none can forget one (sources.ts cardState).
  const state = cardState(spec.sources, status, data);
  const f = spec.frame;
  const emptyText = f?.empty != null ? str(resolve(f.empty, scope)) : 'Nothing here yet.';
  const body = state.kind === 'ready' ? renderNode(spec.body, scope) : stateView(state, emptyText, ctx.authUrl);

  // No frame: the body is a self-contained card (a molecule, or chrome:false
  // raw content). Render it bare so it fills the grid cell directly — unless it is
  // standing in for a state, which gets a card to stand in.
  if (!f) {
    return state.kind === 'ready' ? <>{body}</>
      : <div className="hud-card hud-w-frame">{body}</div>;
  }

  const eyebrow = f.eyebrow != null ? str(resolve(f.eyebrow, scope)) : '';
  const source = f.source != null ? str(resolve(f.source, scope)) : '';
  const href = f.href != null ? safeHref(resolve(f.href, scope)) : undefined;
  const stale = state.kind === 'ready' && state.stale ? 'OFFLINE' : undefined;

  const head = <CardHead eyebrow={eyebrow} source={source} stale={stale} />;

  const inner = <>{head}{body}</>;
  const cls = f.chrome === false ? 'hud-spec-raw hud-w-frame is-raw' : 'hud-card hud-w-frame';
  return href
    ? <a className={cls} href={href}>{inner}</a>
    : <div className={cls}>{inner}</div>;
}

/* ═══ The Week molecule's resolvers ═══════════════════════════════════════════ */
/** ORDECK has no goal tree or calendar-source map, so the shared kit's resolvers
 *  fall back to the suite accent chain — every item renders in the room's accent. */
const ordeckResolvers: Partial<CardResolvers> = {
  accentOf: () => 'var(--color-accent)',
  sourceColorOf: () => 'var(--color-accent)',
};

/** The shared @jkos/cards Week view, read+light (no DragAdapter → no internal drag to
 *  clash with the HUD grid): the planning horizon the month dot-grid can't give.
 *  Wrapped in ORDECK's own card chrome — bare on the canvas the kit view read as a
 *  foreign patch with no defined border; the hud-card owns the boundary and the kit
 *  scrolls inside it (minHeight 0 is what lets it shrink). */
function WeekBody({ items, todayIso }: { items: CalendarItem[]; todayIso: string }) {
  return (
    <div className="hud-card hud-w-week">
      <CardHead eyebrow="WEEK" source="BEIGEBOARD" />
      <div className="hud-w-week-body">
        <WeekView items={items} today={todayIso} resolvers={ordeckResolvers} density="compact" />
      </div>
    </div>
  );
}

/* ═══ Per-card update isolation ═════════════════════════════════════════════
 * The whole ctx object changes every second (the clock slice ticks), but a card
 * only depends on the SLICES its spec binds to. We collect those once per def
 * and gate each card behind a memo that re-renders only when one of THOSE slices
 * changes reference — so the clock card updates every second, weather on its
 * 15-min poll, systems every 30s, a static card almost never. Each slice is
 * memoised upstream (useHudContext) to keep its reference stable between real
 * changes, which is what makes this comparison meaningful. */
const SLICE_KEYS = new Set<string>([
  'clock', 'weather', 'systems', 'today', 'cal', 'items', 'todayIso', 'notifications', 'focus', 'pinned', 'authUrl', 'aiEnabled',
]);
const sliceCache = new WeakMap<object, Set<string>>();

/** The ctx slices a widget reads — cached per def (spec object identity), so it's
 *  recomputed only when the def actually changes (workshop edit / published merge). */
function usedSlices(def: WidgetDef): Set<string> {
  const key: object = def.spec ?? def;
  const cached = sliceCache.get(key);
  if (cached) return cached;
  // One walker (@jkos/widgets sourcesOf): every `{src}` binding plus each molecule's
  // manifest-declared slice. `cmd` subtrees are skipped — a command's body bindings
  // resolve at SUBMIT time, so they are not display dependencies (else a form
  // defaulting due_date to clock.iso would re-render its card every second).
  const acc = def.spec ? sourcesOf(def.spec) : new Set<string>();
  // `$now` is the clock's instant, so an `ago` re-renders with the clock.
  if (acc.has('$now')) acc.add('clock');
  // An AI widget redraws when the kill switch flips.
  if (usesAi(def)) acc.add('aiEnabled');
  // Drop non-ctx sources ($ list element, $form, fetch-source names) — they're
  // never on ctx, so they'd never (correctly) trigger a re-render anyway.
  for (const k of [...acc]) if (!SLICE_KEYS.has(k)) acc.delete(k);
  sliceCache.set(key, acc);
  return acc;
}

interface CardProps { def: WidgetDef; ctx: WidgetCtx }

/** Last time each card actually rendered, for the refreshMs heartbeat. The parent
 *  re-renders ~once a second (the clock), so cardPropsEqual is consulted at that
 *  cadence — fine-grained enough to honour any sane refresh interval. */
const lastRenderAt = new Map<string, number>();

function cardPropsEqual(prev: CardProps, next: CardProps): boolean {
  if (prev.def !== next.def) return false;     // def changed → re-render
  for (const k of usedSlices(next.def)) {
    if (prev.ctx[k as keyof WidgetCtx] !== next.ctx[k as keyof WidgetCtx]) return false;
  }
  // Manual override: force a render once refreshMs has elapsed since the last one.
  // Because the gate runs on the parent's per-second tick, the card re-renders
  // with the LATEST ctx (no staleness) — this is the safety valve over auto-detect.
  const ms = next.def.refreshMs;
  if (ms && ms > 0 && Date.now() - (lastRenderAt.get(next.def.id) ?? 0) >= ms) return false;
  return true;                                 // every bound slice stable + not due → skip
}

/** One card, isolated: re-renders when a slice it binds to changes, when its
 *  refreshMs heartbeat is due, or on its own internal state (a form's inputs, a
 *  fetch source's polled data) — so interactive/live cards still update themselves. */
const WidgetCard = memo(function WidgetCard({ def, ctx }: CardProps) {
  // Stamp the render time post-commit (not during render) for the heartbeat above.
  useEffect(() => { if (def.refreshMs) lastRenderAt.set(def.id, Date.now()); });
  return <>{renderWidgetBody(def, ctx)}</>;
}, cardPropsEqual);

/* ═══ Factory entry point ══════════════════════════════════════════════════ */

function unknownWidget(name: string): ReactNode {
  return (
    <div className="hud-card hud-w-unknown">
      <span>
        UNKNOWN WIDGET: {name.toUpperCase()}
      </span>
    </div>
  );
}

/** What an AI widget draws while the kill switch is off: no source read, no command
 *  armed — the switch is enforced here, not only by hiding the widget from the shelf. */
function aiOffTile(def: WidgetDef): ReactNode {
  return (
    <div className="hud-card hud-w-aioff" data-widget-ai-off="">
      <span className="hud-eyebrow">{(def.label || def.id).toUpperCase()}</span>
      <span className="hud-w-aioff-note">AI IS OFF — TURN IT ON IN SETTINGS</span>
    </div>
  );
}

function renderWidgetBody(def: WidgetDef, ctx: WidgetCtx): ReactNode {
  if (!ctx.aiEnabled && usesAi(def)) return aiOffTile(def);
  if (def.spec) return <SpecWidget spec={def.spec} ctx={ctx} />;
  return unknownWidget(def.id);
}

/** Render a widget definition behind its per-card update gate (see WidgetCard).
 *  Each card is isolated by an
 *  ErrorBoundary so one malformed spec (a bad published/AI/workshop widget) shows
 *  a single fault tile instead of taking the whole dashboard down. resetKey=def
 *  clears the fault when the definition is edited/republished. The boundary wraps
 *  the memo, so a stable card still bails out of re-render on the parent tick. */
export function renderWidget(def: WidgetDef, ctx: WidgetCtx): ReactNode {
  return (
    <ErrorBoundary widgetName={def.label} resetKey={def}>
      <WidgetCard def={def} ctx={ctx} />
    </ErrorBoundary>
  );
}

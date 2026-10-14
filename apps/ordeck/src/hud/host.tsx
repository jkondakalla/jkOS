/**
 * hud/host.tsx — ORDECK as a widget host.
 *
 * The widget renderer is @jkos/widget-render; ORDECK is one app that hosts it. What
 * ORDECK hands it (a WidgetHost) is this file: the HUD's slices — clock, weather,
 * systems, today, cal, items, notifications, focus, pinned, origins… each declared,
 * field by field, in ./slices.ts — and the four kinds only ORDECK can draw, because each
 * reads one of those slices: the month calendar, the weather card, Focus and the Week.
 * Everything else a card is (its frame, sources, states, bindings, patterns, commands)
 * is the renderer's.
 */

import { useState } from 'react';
import { CardHead, vars, type HostActions, type HostKindComponent, type WidgetHost } from '@jkos/widget-render';
import type { AppId } from '@jkos/weave';
import { WeekView, type CalendarItem, type CardResolvers } from '@jkos/cards';
import { safeHref } from '@jkos/widgets';
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
import { clearHudFocus } from '../lib/shelf';
import { HUD_ACTIONS } from './slices';
import { WIDGETS } from './catalog';
import './molecules.css';

/** Every slice a widget on the HUD can read by name. RoomHUD assembles this once from its
 *  data hooks (useHudContext); each slice is memoised there, so its reference moves only
 *  when its data does — which is what the renderer's per-card update gate compares. The
 *  fields of each are declared in ./slices.ts (HUD_SLICES), typed against this. */
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
  /** Each app's browsable origin, from the directory the page hydrated — so a card links
   *  to the app on THIS deployment (a literal URL in a widget file would be prod's). */
  origins: Record<AppId, string>;
  /** The suite-wide LazurOS kill switch (profile → AI). Off, a widget that binds an AI
   *  app does not render — or read, or run anything. */
  aiEnabled: boolean;
}

const MO_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* ── Molecule bodies (self-contained cards) ─────────────────────────────────
 * These are the structurally-bespoke cards (a 7-col month grid; a multi-region
 * weather layout) that don't decompose cleanly into stack/row. Each reads its slice
 * from scope and renders a full `.hud-card`; a spec using one carries no frame, the
 * molecule owns its chrome. */

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
              {info && <span className="hud-cal-dot hud-w-toned" style={vars({ '--w-tone': info.doneCount === info.count ? 'var(--color-ok)' : 'var(--color-accent)' })} />}
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
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.4" strokeLinecap="round" className="hud-w-weather-glyph">
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

/** The kinds only ORDECK draws — every HostKind in the manifest, so a new molecule is
 *  declared here or tsc says so. */
const KINDS: { readonly [K in import('@jkos/widget-render').HostKind]: HostKindComponent<K> } = {
  calendar: ({ scope }) => <CalendarBody cal={scope.cal as MonthCalState} />,
  weather: ({ scope }) => <WeatherBody w={scope.weather as WeatherState} />,
  // Focus and Week were the `component` escape hatch — bespoke cards nothing could
  // edit or keep as a file. They are molecules now, declared in the manifest.
  focus: ({ scope }) => <FocusBody focus={scope.focus as FocusState} />,
  week: ({ scope }) => <WeekBody items={scope.items as CalendarItem[]} todayIso={String(scope.todayIso ?? '')} />,
};

/** What ORDECK's engines do when a widget says so — one per declared HUD_ACTIONS entry. */
const ACTIONS: HostActions<typeof HUD_ACTIONS> = {
  'focus.clear': () => clearHudFocus(),
};

/** The HUD's context, as a widget host. */
export function hudHost(ctx: WidgetCtx): WidgetHost {
  return {
    slices: ctx as unknown as Record<string, unknown>,
    authUrl: ctx.authUrl,
    aiEnabled: ctx.aiEnabled,
    now: ctx.clock.now,
    kinds: KINDS,
    actions: ACTIONS,
    widgets: WIDGETS,
  };
}

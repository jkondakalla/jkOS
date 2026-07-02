/**
 * hud/WidgetTray.tsx — the edit-mode widget tray (the asset shelf, Phase 2).
 *
 * Slides down under the top strip when edit mode opens (the canvas is pushed,
 * not overlapped). Every shelved widget is a fixed-size TILE: a stylized
 * preview glyph over its name, so widgets read apart at a glance instead of
 * as identical "+ label" buttons. Tap a tile to place it on the current tier.
 *
 * The glyph is DERIVED, not hand-registered: widgetHero() scans a widget's
 * spec for the most visually distinct primitive it renders (time → big digits,
 * calendar → month grid, list → task/status/alert rows, gauge → ring …) and
 * maps it to one of ~14 fixed sketches. Published + workshop widgets therefore
 * get a sensible preview with zero per-widget code — the same "pure data in,
 * fixed registry out" philosophy as the spec factory itself.
 */

import { memo, type CSSProperties, type ReactNode } from 'react';
import type { WidgetDef, WidgetNode, WidgetSpec } from './types';

interface WidgetTrayProps {
  open: boolean;
  /** Shelved widgets, in shelf order (RoomHUD already applies the AI gate). */
  widgets: WidgetDef[];
  onPlace: (id: string) => void;
  onBalance: () => void;
  canUndo: boolean;
  onUndo: () => void;
}

/* ═══ Hero detection ════════════════════════════════════════════════════════
 * Scan the spec tree once for the primitives it uses (split into "top level"
 * vs "inside a list item template") plus every bound data slice, then pick the
 * dominant visual in fixed precedence order. Command subtrees are skipped when
 * collecting slices — a form defaulting due_date to clock.iso is not a clock. */

type WidgetHero =
  | 'clock' | 'calendar' | 'weather' | 'gauge' | 'spark'
  | 'alerts' | 'status' | 'agenda' | 'tasks'
  | 'metric' | 'form' | 'focus' | 'week' | 'card';

interface SpecScan {
  types: Set<string>;
  itemTypes: Set<string>;
  srcs: Set<string>;
  /** A list row led by a status dot (systems-style) vs trailed by one (tasks). */
  leadDot: boolean;
}

function scanNode(n: WidgetNode, s: SpecScan, inItem: boolean): void {
  (inItem ? s.itemTypes : s.types).add(n.t);
  switch (n.t) {
    case 'stack': case 'row': case 'form':
      for (const c of n.children) scanNode(c, s, inItem);
      break;
    case 'when':
      scanNode(n.then, s, inItem);
      if (n.else) scanNode(n.else, s, inItem);
      break;
    case 'list':
      if (n.item.t === 'row' && n.item.children[0]?.t === 'dot') s.leadDot = true;
      scanNode(n.item, s, true);
      break;
  }
}

function scanSrcs(v: unknown, srcs: Set<string>): void {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const e of v) scanSrcs(e, srcs); return; }
  const o = v as Record<string, unknown>;
  if (typeof o.src === 'string') srcs.add(o.src);
  for (const k in o) if (k !== 'cmd') scanSrcs(o[k], srcs);
}

function specHero(spec: WidgetSpec): WidgetHero {
  const s: SpecScan = { types: new Set(), itemTypes: new Set(), srcs: new Set(), leadDot: false };
  scanNode(spec.body, s, false);
  scanSrcs(spec, s.srcs);

  if (s.types.has('time')) return 'clock';
  if (s.types.has('calendar')) return 'calendar';
  // The built-in weather card is a plain spec (icon+metric+slots), so the
  // molecule check alone would miss it — the bound slice is the tell.
  if (s.types.has('weather') || s.srcs.has('weather')) return 'weather';
  if (s.types.has('gauge')) return 'gauge';
  if (s.types.has('sparkline')) return 'spark';
  if (s.types.has('list')) {
    if (s.itemTypes.has('icon')) return 'alerts';
    if (s.leadDot) return 'status';
    if (s.types.has('form')) return 'agenda';
    return 'tasks';
  }
  if (s.types.has('metric')) return 'metric';
  if (s.types.has('form') || s.types.has('input')) return 'form';
  return 'card';
}

export function widgetHero(def: WidgetDef): WidgetHero {
  if (def.component === 'focus') return 'focus';
  if (def.component === 'bb-week') return 'week';
  if (def.spec) return specHero(def.spec);
  return 'card';
}

/* ═══ Glyphs ════════════════════════════════════════════════════════════════
 * One uniform 120×64 canvas per tile. Sketches, not live cards: skeleton bars
 * for text, real shapes for the hero. All colours are hub tokens (mode-aware);
 * text font-family comes from `.hud-tile-view text` in hud.css (presentation
 * attributes can't carry var() reliably, fill/stroke can). */

const ACC    = 'var(--hub-amber)';
const BRIGHT = 'var(--hub-cream-bright)';
const DIM    = 'var(--hub-cream-dim)';
const FAINT  = 'var(--hub-cream-faint)';
const LINE   = 'var(--hub-line)';
const STRONG = 'var(--hub-line-strong)';
const OK     = 'var(--hub-green)';
const WARN   = 'var(--hub-warn)';
const RED    = 'var(--hub-red)';

function G({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 120 64" preserveAspectRatio="none" aria-hidden="true">{children}</svg>;
}

/** Skeleton text line. */
function Ln({ x, y, w, h = 4, c = STRONG, o }: { x: number; y: number; w: number; h?: number; c?: string; o?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={c} opacity={o} />;
}

function ClockGlyph() {
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase().replace(/,\s*/g, ' · ');
  return (
    <G>
      <text x="60" y="36" textAnchor="middle" fontSize="26" fontWeight="600" fill={BRIGHT} letterSpacing="-0.5">{hm}</text>
      <text x="60" y="52" textAnchor="middle" fontSize="7" fill={DIM} letterSpacing="1.6">{date}</text>
    </G>
  );
}

function CalendarGlyph() {
  const cells: ReactNode[] = [];
  for (let i = 0; i < 28; i++) {
    const x = 16 + (i % 7) * 13, y = 13 + Math.floor(i / 7) * 11;
    const today = i === 10;
    cells.push(<rect key={i} x={x} y={y} width={10} height={8} rx={2}
      fill={today ? ACC : LINE} opacity={today ? 1 : 0.75} />);
    if (i === 16) cells.push(<circle key="d1" cx={x + 5} cy={y + 4} r={1.7} fill={OK} />);
    if (i === 24) cells.push(<circle key="d2" cx={x + 5} cy={y + 4} r={1.7} fill={ACC} />);
  }
  return (
    <G>
      {Array.from({ length: 7 }, (_, c) => (
        <rect key={c} x={18 + c * 13} y={6} width={6} height={2} rx={1} fill={FAINT} opacity={0.8} />
      ))}
      {cells}
    </G>
  );
}

function WeatherGlyph() {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return <line key={i}
      x1={26 + Math.cos(a) * 10.5} y1={24 + Math.sin(a) * 10.5}
      x2={26 + Math.cos(a) * 13.5} y2={24 + Math.sin(a) * 13.5} />;
  });
  return (
    <G>
      <g stroke={ACC} strokeWidth="1.6" strokeLinecap="round" fill="none">
        <circle cx="26" cy="24" r="7" />
        {rays}
      </g>
      <text x="48" y="31" fontSize="19" fontWeight="600" fill={BRIGHT}>72°</text>
      <Ln x={90} y={19} w={16} h={3.5} c={DIM} />
      <Ln x={90} y={27} w={12} h={3.5} c={LINE} />
      <line x1="14" y1="43" x2="106" y2="43" stroke={LINE} strokeWidth="1" />
      {[7, 10, 12, 11, 8].map((h, i) => (
        <rect key={i} x={22 + i * 18} y={58 - h} width={7} height={h} rx={2}
          fill={i === 2 ? ACC : STRONG} opacity={i === 2 ? 0.9 : 0.7} />
      ))}
    </G>
  );
}

function GaugeGlyph() {
  const R = 18, C = 2 * Math.PI * R;
  return (
    <G>
      <circle cx="60" cy="32" r={R} fill="none" stroke={LINE} strokeWidth="5" />
      <circle cx="60" cy="32" r={R} fill="none" stroke={ACC} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${C * 0.72} ${C}`} transform="rotate(-90 60 32)" />
      <text x="60" y="36.5" textAnchor="middle" fontSize="13" fontWeight="600" fill={BRIGHT}>72</text>
    </G>
  );
}

function SparkGlyph() {
  return (
    <G>
      <polygon points="12,46 30,36 46,42 62,26 78,32 94,18 108,24 108,54 12,54"
        fill={ACC} opacity="0.09" />
      <polyline points="12,46 30,36 46,42 62,26 78,32 94,18 108,24"
        fill="none" stroke={ACC} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="108" cy="24" r="2.6" fill={ACC} />
    </G>
  );
}

/** Systems: uptime bar over probe rows led by status dots. */
function StatusGlyph() {
  const rows: Array<[number, string, number]> = [[24, OK, 42], [38, OK, 34], [52, RED, 46]];
  return (
    <G>
      <Ln x={14} y={9} w={92} h={3} c={LINE} />
      <Ln x={14} y={9} w={66} h={3} c={OK} o={0.85} />
      {rows.map(([y, c, w], i) => (
        <g key={i}>
          <circle cx={19} cy={y} r={2.8} fill={c} />
          <Ln x={27} y={y - 2} w={w} c={STRONG} />
          <Ln x={88} y={y - 1.5} w={18} h={3} c={i === 2 ? RED : FAINT} o={i === 2 ? 0.9 : 0.8} />
        </g>
      ))}
    </G>
  );
}

/** Alerts: icon-led feed rows in status colours. */
function AlertsGlyph() {
  return (
    <G>
      <g fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 9l6 10H13z" stroke={WARN} />
        <path d="M21 28l-5 7h6l-5 7" stroke={ACC} />
        <circle cx="19" cy="53" r="5" stroke={RED} />
      </g>
      <Ln x={32} y={12} w={52} c={STRONG} />
      <Ln x={90} y={12.5} w={16} h={3} c={FAINT} o={0.8} />
      <Ln x={32} y={33} w={38} c={STRONG} />
      <Ln x={32} y={51} w={58} c={STRONG} />
      <Ln x={96} y={51.5} w={10} h={3} c={FAINT} o={0.8} />
    </G>
  );
}

/** Today: progress bar, timed rows, quick-add form pinned to the bottom. */
function AgendaGlyph() {
  return (
    <G>
      <Ln x={14} y={8} w={92} h={3} c={LINE} />
      <Ln x={14} y={8} w={54} h={3} c={ACC} o={0.9} />
      {[20, 31].map((y, i) => (
        <g key={i}>
          <Ln x={14} y={y} w={12} h={3.5} c={FAINT} o={0.85} />
          <Ln x={32} y={y} w={i ? 44 : 58} c={STRONG} />
          <circle cx={102} cy={y + 2} r={2.4} fill={i ? OK : ACC} />
        </g>
      ))}
      <rect x="14" y="44" width="66" height="12" rx="3" fill="none" stroke={LINE} strokeWidth="1.2" />
      <Ln x={19} y={49} w={22} h={2.5} c={FAINT} o={0.8} />
      <rect x="86" y="44" width="20" height="12" rx="3"
        fill={ACC} opacity="0.16" stroke={ACC} strokeWidth="1.2" />
      <path d="M96 47.5v5M93.5 50h5" stroke={ACC} strokeWidth="1.4" strokeLinecap="round" />
    </G>
  );
}

/** Pinned & friends: plain task rows, time · title · status dot. */
function TasksGlyph() {
  const rows: Array<[number, string, number]> = [[13, ACC, 56], [31, OK, 40], [49, WARN, 50]];
  return (
    <G>
      {rows.map(([y, c, w], i) => (
        <g key={i}>
          <Ln x={14} y={y} w={12} h={3.5} c={FAINT} o={0.85} />
          <Ln x={32} y={y} w={w} c={STRONG} />
          <circle cx={102} cy={y + 2} r={2.4} fill={c} />
        </g>
      ))}
    </G>
  );
}

/** Study & other stat cards: one hero number with supporting lines. */
function MetricGlyph() {
  return (
    <G>
      <Ln x={16} y={11} w={26} h={3} c={FAINT} o={0.8} />
      <text x="16" y="47" fontSize="27" fontWeight="600" fill={BRIGHT}>14</text>
      <text x="53" y="46" fontSize="7" fill={DIM} letterSpacing="1.2">DAYS</text>
      <Ln x={76} y={27} w={30} c={STRONG} />
      <Ln x={76} y={38} w={22} h={3.5} c={LINE} />
    </G>
  );
}

function FormGlyph() {
  return (
    <G>
      <rect x="16" y="10" width="88" height="12" rx="3" fill="none" stroke={LINE} strokeWidth="1.2" />
      <Ln x={21} y={15} w={30} h={2.5} c={FAINT} o={0.8} />
      <rect x="16" y="27" width="88" height="12" rx="3" fill="none" stroke={LINE} strokeWidth="1.2" />
      <rect x="16" y="45" width="26" height="11" rx="3"
        fill={ACC} opacity="0.16" stroke={ACC} strokeWidth="1.2" />
    </G>
  );
}

/** Focus: the crosshair — one thing, dead centre. */
function FocusGlyph() {
  return (
    <G>
      <g fill="none" stroke={ACC} strokeLinecap="round">
        <circle cx="60" cy="27" r="16" strokeWidth="1.3" opacity="0.4" />
        <circle cx="60" cy="27" r="9" strokeWidth="1.4" opacity="0.75" />
        <path d="M60 6.5v5M60 42.5v5M39.5 27h5M75.5 27h5" strokeWidth="1.4" opacity="0.6" />
      </g>
      <circle cx="60" cy="27" r="3" fill={ACC} />
      <Ln x={42} y={54} w={36} c={STRONG} />
    </G>
  );
}

/** Week: day columns with a couple of scheduled blocks. */
function WeekGlyph() {
  return (
    <G>
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={12 + i * 19.2} y1={14} x2={12 + i * 19.2} y2={58} stroke={LINE} strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={16.5 + i * 19.2} y={6} width={10} height={2.5} rx={1.25} fill={FAINT} opacity={0.8} />
      ))}
      <rect x="33.5" y="19" width="14.5" height="15" rx="2.5" fill={ACC} opacity="0.28" stroke={ACC} strokeWidth="1" />
      <rect x="71.5" y="30" width="14.5" height="11" rx="2.5" fill={OK} opacity="0.28" stroke={OK} strokeWidth="1" />
      <rect x="52.5" y="42" width="14.5" height="9" rx="2.5" fill={STRONG} opacity="0.6" />
    </G>
  );
}

/** Fallback: a generic card skeleton (eyebrow + copy lines). */
function CardGlyph() {
  return (
    <G>
      <Ln x={16} y={11} w={30} h={3} c={FAINT} o={0.8} />
      <Ln x={16} y={24} w={72} h={5} c={STRONG} />
      <Ln x={16} y={37} w={86} c={LINE} />
      <Ln x={16} y={48} w={52} c={LINE} />
    </G>
  );
}

const GLYPHS: Record<WidgetHero, () => ReactNode> = {
  clock: ClockGlyph, calendar: CalendarGlyph, weather: WeatherGlyph,
  gauge: GaugeGlyph, spark: SparkGlyph, alerts: AlertsGlyph, status: StatusGlyph,
  agenda: AgendaGlyph, tasks: TasksGlyph, metric: MetricGlyph, form: FormGlyph,
  focus: FocusGlyph, week: WeekGlyph, card: CardGlyph,
};

export function WidgetGlyph({ def }: { def: WidgetDef }) {
  return <>{GLYPHS[widgetHero(def)]()}</>;
}

/* ═══ The tray ══════════════════════════════════════════════════════════════
 * Always mounted so it can animate closed; visibility/inertness are handled in
 * CSS (.hud-tray). memo'd — RoomHUD re-renders every second on the clock tick,
 * and the tray only depends on its props (the caller memoises `widgets`). */

export const WidgetTray = memo(function WidgetTray({
  open, widgets, onPlace, onBalance, canUndo, onUndo,
}: WidgetTrayProps) {
  return (
    <div className={`hud-tray${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="hud-tray-clip">
        <div className="hud-tray-inner">
          <div className="hud-tray-head">
            <span className="hud-tray-eyebrow">WIDGET TRAY</span>
            {widgets.length > 0 && (
              <span className="hud-tray-count">{widgets.length} OFF GRID</span>
            )}
            <span style={{ flex: 1 }} />
            <button
              className="hud-tray-act"
              onClick={onBalance}
              title="Tidy the layout — pull cards up into gaps. Cards you've moved this session (pinned) stay put."
            >
              ⤢ auto-balance
            </button>
            {canUndo && (
              <button
                className="hud-tray-act"
                onClick={onUndo}
                title="Put every card back where it was before the balance"
              >
                ↩ undo
              </button>
            )}
          </div>
          {widgets.length > 0 ? (
            <div className="hud-tray-strip">
              {widgets.map((w, i) => (
                <button
                  key={w.id}
                  className="hud-tile"
                  style={{ '--i': i } as CSSProperties}
                  onClick={() => onPlace(w.id)}
                  title={`Add ${w.label} to the grid`}
                >
                  <span className="hud-tile-view">
                    <WidgetGlyph def={w} />
                    {w.ai && <span className="hud-tile-ai">AI</span>}
                    <span className="hud-tile-add" aria-hidden="true">+</span>
                  </span>
                  <span className="hud-tile-name">{w.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="hud-tray-empty">
              EVERY WIDGET IS ON THE GRID — REMOVE A CARD (×) TO SHELVE IT HERE
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

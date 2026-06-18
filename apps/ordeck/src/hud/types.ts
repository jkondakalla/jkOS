/**
 * hud/types.ts — the normalized HUD state model (ORDECK v3 widget system).
 *
 * One per-user document drives the whole dashboard. It replaces the old
 * ad-hoc localStorage split (`ordeck-hud-hidden` + `ordeck-hud-widgets`) AND
 * the deprecated Module-Federation remote-widget path: widgets are now native,
 * data-driven cards arranged by a custom grid engine.
 *
 *   HudState
 *     ├─ widgets : Record<id, WidgetDef>   the registry (what exists)
 *     ├─ layouts : per-breakpoint GridItem[] (where each placed widget sits)
 *     └─ shelf   : string[]                 registered-but-unplaced widget ids
 *
 * A widget is PLACED if it appears in a breakpoint layout, SHELVED if it's in
 * `shelf`. Placement is in abstract grid units (x/y/w/h), resolved to pixels by
 * the renderer — never hardcoded per device.
 */

/** Named viewport tiers. Desktop is the 12-col matrix; mobile the strict 2-col
 *  reflow target. Add intermediate tiers here and the engine handles them. */
export type BreakpointName = 'desktop' | 'mobile';

export interface Breakpoint {
  name: BreakpointName;
  /** Active when viewport width ≥ minWidth; the largest match wins. */
  minWidth: number;
  /** Column count of the grid at this tier. */
  cols: number;
}

/** Desktop = 12 columns, mobile = 2 (the brief's strict 2-up). The crossover at
 *  880px is below the old 3-col→1-col break (1100px) so tablets keep the matrix. */
export const BREAKPOINTS: Breakpoint[] = [
  { name: 'desktop', minWidth: 880, cols: 12 },
  { name: 'mobile',  minWidth: 0,   cols: 2  },
];

/** One widget's placement within a single breakpoint, in grid units. */
export interface GridItem {
  /** Widget id — matches a key in HudState.widgets. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** When true the engine never moves it (compaction/collision skip it). */
  static?: boolean;
}

export type BreakpointLayouts = Partial<Record<BreakpointName, GridItem[]>>;

/** A widget's default footprint per tier — used when it's first placed (off the
 *  shelf) and when a tier's layout has to be derived rather than stored. */
export interface WidgetSizing {
  desktop: { w: number; h: number };
  mobile: { w: number; h: number };
}

/* ── Declarative widget spec ────────────────────────────────────────────────
 * The granular, data-driven layer — same philosophy as the @jkos/design theme
 * factory (buildJkOSTheme): a widget is COMPOSED from small declarative parts,
 * each optional, rendered by fixed registries. Adding a display primitive or a
 * data-source kind is a one-line registry entry; adding a WIDGET is pure data.
 * That data-only shape is exactly what makes text→widget (AI) generation
 * tractable later — for now it just keeps the infrastructure expandable.
 * ─────────────────────────────────────────────────────────────────────────── */

/** A value resolved at render time: a literal, or a path into a named source
 *  (`fallback` used when the path is missing). */
export type Binding =
  | string
  | number
  | boolean
  | { lit: unknown }
  | { src: string; path?: string; fallback?: unknown };

/** Where a named source's data comes from. `hud` slices are data Ordeck already
 *  pulls (clock/weather/today/study/systems/cal — always in scope); `fetch` is a
 *  generic client-polled endpoint, the no-deploy path for brand-new widgets. */
export type DataSource =
  | { from: 'hud'; key: string }
  | { from: 'fetch'; url: string; poll?: number };

/** The composable display vocabulary. Each variant is one registered primitive.
 *  `list` repeats its `item` template over a bound array, exposing the current
 *  element as the `$` source inside the template. */
export type WidgetNode =
  | { t: 'stack'; gap?: number; grow?: boolean; children: WidgetNode[] }
  | { t: 'row'; gap?: number; justify?: string; align?: string; children: WidgetNode[] }
  | { t: 'label'; text: Binding; size?: 'md' | 'sm' | 'xs' }
  | { t: 'text'; text: Binding; variant?: 'title' | 'body' | 'sub' }
  | { t: 'metric'; value: Binding; unit?: Binding; sub?: Binding }
  | { t: 'bar'; value: Binding; max?: Binding }
  | { t: 'pill'; text: Binding; tone?: Tone }
  | { t: 'dot'; tone?: Tone; pulse?: boolean }
  | { t: 'keyval'; label: Binding; value: Binding; tone?: Tone }
  | { t: 'gauge'; value: Binding; max?: Binding; label?: Binding }
  | { t: 'divider'; label?: Binding }
  | { t: 'link'; text: Binding; href: Binding }
  | { t: 'list'; from: Binding; item: WidgetNode; empty?: Binding };

export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';

/** Card chrome around a body. */
export interface WidgetFrame {
  eyebrow?: string;
  source?: string;
  href?: string;
  /** Bordered card surface (default true). Set false for raw-on-background (clock). */
  chrome?: boolean;
}

export interface WidgetSpec {
  frame?: WidgetFrame;
  /** Named sources beyond the always-available hud slices (e.g. fetch endpoints). */
  sources?: Record<string, DataSource>;
  body: WidgetNode;
}

/** A registered widget: metadata + sizing + EITHER a declarative spec (the
 *  granular, AI-emittable path) OR a `component` escape hatch (a registered React
 *  component, for cards too bespoke for primitives today — the ported v2 cards
 *  use this). The Module-Federation remote-widget path is retired. */
export interface WidgetDef {
  id: string;
  label: string;
  sizing: WidgetSizing;
  /** Compose the widget from primitives + data bindings. */
  spec?: WidgetSpec;
  /** Render a bespoke React component registered under this key. */
  component?: string;
  /** AI-backed widgets honor the suite-wide LazurOS kill switch. */
  ai?: boolean;
}

/** The whole per-user HUD document. `version` guards future migrations. */
export interface HudState {
  version: number;
  widgets: Record<string, WidgetDef>;
  layouts: BreakpointLayouts;
  shelf: string[];
}

export const HUD_STATE_VERSION = 3;

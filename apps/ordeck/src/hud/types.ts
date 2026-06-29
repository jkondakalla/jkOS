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

/** Named viewport tiers. The tier NAMES and their minWidths are the suite-wide
 *  canonical breakpoints (@jkos/design) — ORDECK only layers a column count on
 *  top. Desktop is the 12-col matrix, tablet an intermediate 6-col, mobile the
 *  strict 2-up. (Retires ORDECK's old bespoke 880px crossover.) */
import { BREAKPOINTS as BASE_BREAKPOINTS, type BreakpointName } from '@jkos/design';

export type { BreakpointName };

export interface Breakpoint {
  name: BreakpointName;
  /** Active when viewport width ≥ minWidth; the largest match wins. */
  minWidth: number;
  /** Column count of the grid at this tier. */
  cols: number;
}

/** Column count per tier — ORDECK's call; the minWidths come from the canonical
 *  source so CSS, the JS hook, and this engine can never disagree. */
const COLS: Record<BreakpointName, number> = { desktop: 12, tablet: 6, mobile: 2 };

export const BREAKPOINTS: Breakpoint[] = BASE_BREAKPOINTS.map((bp) => ({
  name: bp.name,
  minWidth: bp.minWidth,
  cols: COLS[bp.name],
}));

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
  /** Optional intermediate footprint; when omitted the tablet tier derives from
   *  the desktop layout by reflowing into 6 cols (engine layoutForBreakpoint). */
  tablet?: { w: number; h: number };
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
  | { from: 'fetch'; url: string; poll?: number; invalidateOn?: string[] };

/** A tone can be a fixed key OR bound to data (e.g. a list item's `$.tone`),
 *  so list rows can colour themselves by status. Resolves to 'muted' if the
 *  bound value isn't a known tone. */
export type ToneBinding = Tone | { lit: unknown } | { src: string; path?: string; fallback?: unknown };

/** The composable display vocabulary. Each variant is one registered primitive.
 *  `list` repeats its `item` template over a bound array, exposing the current
 *  element as the `$` source inside the template. `when` shows `then`/`else` by a
 *  condition's truthiness — the conditional building block for offline/empty
 *  states. `time`, `calendar`, and `weather` are higher-level "molecule"
 *  primitives (self-contained cards) the same way `gauge` is. */
export type WidgetNode =
  | { t: 'stack'; gap?: number; grow?: boolean; children: WidgetNode[] }
  | { t: 'row'; gap?: number; justify?: string; align?: string; grow?: boolean; children: WidgetNode[] }
  | { t: 'label'; text: Binding; size?: 'md' | 'sm' | 'xs' }
  | { t: 'text'; text: Binding; variant?: 'title' | 'body' | 'sub' | 'mono'; grow?: boolean }
  | { t: 'metric'; value: Binding; unit?: Binding; sub?: Binding }
  | { t: 'bar'; value: Binding; max?: Binding }
  | { t: 'pill'; text: Binding; tone?: ToneBinding }
  | { t: 'dot'; tone?: ToneBinding; pulse?: boolean }
  | { t: 'keyval'; label: Binding; value: Binding; tone?: ToneBinding }
  | { t: 'gauge'; value: Binding; max?: Binding; label?: Binding }
  | { t: 'divider'; label?: Binding }
  | { t: 'link'; text: Binding; href: Binding }
  | { t: 'icon'; name: Binding; tone?: ToneBinding; size?: number }
  | { t: 'time'; value: Binding; seconds?: Binding; sub?: Binding; sub2?: Binding }
  | { t: 'when'; cond: Binding; then: WidgetNode; else?: WidgetNode }
  | { t: 'calendar' }
  | { t: 'weather' }
  | { t: 'list'; from: Binding; item: WidgetNode; empty?: Binding; dir?: 'col' | 'row' }
  /* ── Write / interactive vocabulary (the command family) ──────────────────
   * `form` owns a mutable `$form` source its `input`/`select`/`toggle` children
   * write into, and a submit that runs `cmd`. `button` is a standalone action.
   * All writes go through one capability-driven dispatcher (see registry useCommand);
   * still pure data, so the workshop composes them and an AI can emit them. */
  | { t: 'form'; cmd: CommandRef; submit: Binding; children: WidgetNode[] }
  | { t: 'input'; field: string; placeholder?: Binding; itype?: 'text' | 'number' | 'date' | 'time' }
  | { t: 'select'; field: string; options: Binding; placeholder?: Binding }
  | { t: 'toggle'; field: string; label?: Binding }
  | { t: 'button'; text: Binding; cmd: CommandRef; tone?: ToneBinding };

export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';

/** A widget's reference to a declared cross-app command (a CapabilityDef in an
 *  app's CapabilityDoc, discovered via @jkos/weave fetchCapabilities). `body` maps
 *  capability fields to Bindings — literals, live slices, or `$form.<field>` values
 *  captured by a form's inputs. The renderer resolves these to a plain body, then
 *  weave's runCommand issues the request and invalidates the declared resources. */
export interface CommandRef {
  app: string;            // manifest id, e.g. 'beigeboard'
  capability: string;     // CapabilityDef id, e.g. 'createItem'
  body?: Record<string, Binding>;
}

/** Card chrome around a body. The captions are Bindings so they can show live
 *  values (e.g. a systems card's "3 / 4 UP" on the right). */
export interface WidgetFrame {
  eyebrow?: Binding;
  source?: Binding;
  href?: Binding;
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
  /** Manual refresh override (ms). The card normally re-renders only when a slice
   *  it binds to changes (auto-detected). Set this to ALSO force a re-render at
   *  least every N ms — a safety valve for when the auto-detection misses a
   *  dependency, and the way to make a "live" card tick faster or a heavy one
   *  refresh on a fixed beat. Omit/0 = pure auto. */
  refreshMs?: number;
}

/** The whole per-user HUD document. `version` guards future migrations. */
export interface HudState {
  version: number;
  widgets: Record<string, WidgetDef>;
  layouts: BreakpointLayouts;
  shelf: string[];
}

/* v4: the six built-in cards became declarative specs (no more `component`
   escape hatch), so any v3 document — whose defaults referenced bespoke
   components — is rebuilt from the new spec defaults on load. */
export const HUD_STATE_VERSION = 4;

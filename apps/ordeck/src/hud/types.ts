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
  /** Set when the USER hand-resized this cell in edit mode. It tells the
   *  published-registry merge to leave this footprint alone — the author's
   *  default no longer overrides a size the user chose on purpose. Cleared
   *  naturally by re-shelving + re-placing (that lands the author default). */
  userSized?: boolean;
}

export type BreakpointLayouts = Partial<Record<BreakpointName, GridItem[]>>;

/** Global legibility floor for a hand-resize, in grid units — the minimum any
 *  card may be shrunk to unless its sizing.min overrides it. Two columns and two
 *  rows keep a card's frame + a line of content readable. Tune here (or per card
 *  via WidgetSizing.min) to change how small cards are allowed to get. */
export const DEFAULT_MIN_SIZE = { w: 2, h: 2 } as const;

/* ── The widget file ────────────────────────────────────────────────────────
 * A widget def — its spec, its sizing on this grid, its node vocabulary — is the widget
 * renderer's format (@jkos/widget-render), not ORDECK's: ORDECK is one app that hosts
 * widgets. Re-exported here so the HUD's modules name it in one place. */
export type {
  Binding, ToneBinding, CommandRef, WidgetFrame, WidgetSpec, WidgetSizing, WidgetDef,
  WidgetNode, Tone, IconName, DataSource, SourceState, SourceStatus,
} from '@jkos/widget-render';
import type { WidgetDef } from '@jkos/widget-render';

/** The whole per-user HUD document. `version` guards future migrations. */
export interface HudState {
  version: number;
  widgets: Record<string, WidgetDef>;
  layouts: BreakpointLayouts;
  shelf: string[];
}

/* v4: the six built-in cards became declarative specs (no more `component`
   escape hatch), so any v3 document — whose defaults referenced bespoke
   components — is rebuilt from the new spec defaults on load.
   v5: the catalog cull + density redesign — quickadd/taskadd folded into Today,
   uptime into Systems, progress into Today's head; bb-calendar/day/year retired
   (Week is the one kit view). A v4 doc references retired ids and pre-redesign
   specs, so it's rebuilt from the new defaults on load. */
export const HUD_STATE_VERSION = 5;

/**
 * types.ts — a widget file, as the renderer reads it.
 *
 * A widget is a declarative SPEC: a frame (card chrome) + named data sources + a tree of
 * nodes bound to data. The node vocabulary is GENERATED from @jkos/widgets' manifest
 * (packages/widgets/src/manifest.js → ./nodes.gen.ts), so the renderer's primitive map
 * cannot miss a kind or keep a dead one. Everything a HOST adds (the slices a binding can
 * name, the kinds only it can draw) is ./render.tsx's WidgetHost.
 */

import type { AppId, Binding as WeaveBinding } from '@jkos/weave';
import type { DataSource } from './sources';
import type { WidgetNode, Tone } from './nodes.gen';

export type { WidgetNode, Tone, IconName, HostKind, HostKindsOf, WidgetAction, ActionChain } from './nodes.gen';
export type { DataSource, SourceState, SourceStatus } from './sources';

/** A value resolved at render time: a literal, or a path into a named source
 *  (`fallback` used when the path is missing).
 *
 *  ⭐ THE MODEL IS SHARED (D13). This is `@jkos/weave`'s binding model — a WidgetSpec binds
 *  a dataset into a tree of primitives (READ) and a TriggerDef binds a capability's typed
 *  output into another capability's body (WRITE), and those were two halves of one system
 *  that never met. Re-exported rather than re-declared, so there is exactly one. */
export type Binding = string | number | boolean | WeaveBinding;

/** A tone can be a fixed key OR bound to data (a list item's `$.tone`, or a status mapped
 *  onto tones: `{ src: '$', path: 'status', map: { DONE: 'ok' }, fallback: 'muted' }`).
 *  Resolves to 'muted' if the bound value isn't a known tone. */
export type ToneBinding = Tone | WeaveBinding;

/** A widget's reference to a declared cross-app command (a CapabilityDef in an app's
 *  CapabilityDoc, discovered via @jkos/weave fetchCapabilities). `body` maps capability
 *  fields to Bindings — literals, live slices, or `$form.<field>` values captured by a
 *  form's inputs. The renderer resolves these to a plain body, then weave's runCommand
 *  issues the request and invalidates the declared resources. */
export interface CommandRef {
  app: AppId;             // canonical manifest id, e.g. 'beigeboard' (typo = type error)
  capability: string;     // CapabilityDef id, e.g. 'createItem'
  body?: Record<string, Binding>;
}

/** Card chrome around a body. The captions are Bindings so they can show live values
 *  (e.g. a systems card's "3 / 4 UP" on the right). */
export interface WidgetFrame {
  eyebrow?: Binding;
  source?: Binding;
  href?: Binding;
  /** Bordered card surface (default true). Set false for raw-on-background (clock). */
  chrome?: boolean;
  /** The empty state's copy, when every source answered nothing. */
  empty?: Binding;
}

/** One of a widget's own variables: `$state.<name>`, written by a `set` action and by a
 *  control with `state`. Every instance of the widget has its own, from `default`. */
export interface StateVar {
  type: 'string' | 'number' | 'boolean' | 'json';
  default?: unknown;
}

/** One input a part declares — what the widget that `use`s it hands it, read as `$in`. */
export interface WidgetInput {
  type: 'string' | 'number' | 'boolean' | 'json';
  required?: boolean;
  default?: unknown;
}

export interface WidgetSpec {
  frame?: WidgetFrame;
  /** What the widget that `use`s this one hands it (`$in`). */
  inputs?: Record<string, WidgetInput>;
  /** Named sources beyond the host's slices, which are always in scope. */
  sources?: Record<string, DataSource>;
  /** This widget's own variables (`$state`). */
  state?: Record<string, StateVar>;
  body: WidgetNode;
  /** The phone's body, where the phone UI genuinely differs (a host on the `mobile` tier
   *  draws it instead of `body`). Same sources, state and frame. */
  mobile?: WidgetNode;
}

/** A widget's default footprint per tier on a placement grid (ORDECK's HUD) — used when
 *  it's first placed and when a tier's layout has to be derived rather than stored. */
export interface WidgetSizing {
  desktop: { w: number; h: number };
  /** Optional intermediate footprint; when omitted the tablet tier derives from the
   *  desktop layout by reflowing into 6 cols. */
  tablet?: { w: number; h: number };
  mobile: { w: number; h: number };
  /** Smallest footprint (grid units) a user may drag this card down to — the legibility
   *  floor. Applies across tiers (width auto-clamps to the tier's columns). */
  min?: { w: number; h: number };
}

/** A widget file: metadata + a declarative spec, and a footprint if it is placed on a
 *  grid. (The `component` escape hatch — a bespoke React card named by the def — is
 *  retired; ORDECK's hud/state.ts repairs a stored def that still names one.) */
export interface WidgetDef {
  id: string;
  label: string;
  /** A PAGE's route ("/books/:id"): a host that routes draws it at a matching path, with
   *  the params as `$route` (@jkos/widgets routes.js). A page has no `sizing`. */
  route?: string;
  /** Its footprint on a placement grid (ORDECK's HUD). A widget that is not placed — a
   *  screen, or a part another widget `use`s — has none; a HUD card always does (the
   *  catalog and jkAuth's publish keep a sizing-less widget off the HUD). */
  sizing?: WidgetSizing;
  /** Compose the widget from primitives + data bindings. Optional only because a def
   *  arrives from the wire; one without a spec draws the unknown-widget tile. */
  spec?: WidgetSpec;
  /** Manual refresh override (ms). A card normally re-renders only when a slice it binds
   *  to changes (auto-detected). Set this to ALSO force a re-render at least every N ms —
   *  a safety valve for when the auto-detection misses a dependency. Omit/0 = pure auto. */
  refreshMs?: number;
}

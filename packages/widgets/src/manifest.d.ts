// Types for the widget manifest (manifest.js). The TS union ORDECK renders against is
// GENERATED from these values (scripts/gen.mjs → packages/widget-render/src/nodes.gen.ts).

export type PropType = 'binding' | 'tone' | 'number' | 'boolean' | 'string' | 'enum' | 'field' | 'cmd' | 'pairs' | 'node' | 'nodes' | 'params' | 'state' | 'events';

export interface PropSpec {
  type: PropType;
  required?: boolean;
  /** enum: the legal values. binding: the known literals (checked when a literal is given). */
  values?: readonly string[];
  /** The value is a URL — it must pass safeHref. */
  href?: boolean;
  /** A binding into `$`, each row of the node's `from` (a list pattern's per-row prop). */
  row?: boolean;
  /** A binding into `$result` / `$job`, what the node's command produced. */
  result?: boolean;
  /** number: the bounds the validator holds it to, and the renderer's default. */
  min?: number;
  max?: number;
  default?: number;
  /** binding: a literal value is a LIST (select options) — the Workshop edits it as one. */
  list?: boolean;
  /** Only meaningful beside this other prop (a button's `result` draws what its `cmd` produced). */
  with?: string;
  doc?: string;
}

export type NodeKind = 'atom' | 'layout' | 'logic' | 'molecule' | 'control' | 'pattern';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  hint: string;
  props: Record<string, PropSpec>;
  placement?: { form?: 'inside' | 'outside'; root?: boolean; /** with this prop, it sits outside a form instead */ outside?: string };
  /** Groups of props of which exactly one is given. */
  oneOf?: string[][];
  /** The events its `on` may name → what each means. */
  events?: Record<string, string>;
  /** The HUD slice(s) a molecule reads straight from scope. */
  reads?: string | string[];
  example: { t: string } & Record<string, unknown>;
}

export const TONES: readonly string[];
export const ICON_NAMES: readonly string[];
/** Retired `component` names → the molecule each became. */
export const RETIRED_COMPONENTS: Readonly<Record<string, string>>;
export const TIER_COLS: { desktop: number; tablet: number; mobile: number };
export const LIMITS: {
  WIDGET_DEF_MAX: number;
  MAX_DEPTH: number;
  MAX_NODES: number;
  MAX_ROWS: number;
  ID_PATTERN: string;
};
export const NODES: Record<string, NodeSpec>;
export const FRAME: Record<string, PropSpec>;
/** What a state variable may hold. */
export const STATE_TYPES: readonly string[];
/** The actions an event may run, by the key that names each. */
export const ACTIONS: Record<string, { label: string; hint: string; props: Record<string, PropSpec>; example: Record<string, unknown> }>;
/** The source kinds (spec.sources): each kind's props. */
export const SOURCES: Record<string, { label: string; hint: string; props: Record<string, PropSpec> }>;
export const KINDS: string[];
export function childProps(t: string): { name: string; many: boolean; required: boolean }[];

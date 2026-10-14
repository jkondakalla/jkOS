// Types for the widget manifest (manifest.js). The TS union ORDECK renders against is
// GENERATED from these values (scripts/gen.mjs → packages/widget-render/src/nodes.gen.ts).

export type PropType = 'binding' | 'tone' | 'number' | 'boolean' | 'string' | 'enum' | 'field' | 'cmd' | 'pairs' | 'node' | 'nodes' | 'params';

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
  doc?: string;
}

export type NodeKind = 'atom' | 'layout' | 'logic' | 'molecule' | 'control' | 'pattern';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  hint: string;
  props: Record<string, PropSpec>;
  placement?: { form?: 'inside' | 'outside'; root?: boolean };
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
/** The source kinds (spec.sources): each kind's props. */
export const SOURCES: Record<string, { label: string; hint: string; props: Record<string, PropSpec> }>;
export const KINDS: string[];
export function childProps(t: string): { name: string; many: boolean; required: boolean }[];

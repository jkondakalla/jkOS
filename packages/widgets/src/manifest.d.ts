// Types for the widget manifest (manifest.js). The TS union ORDECK renders against is
// GENERATED from these values (scripts/gen.mjs → apps/ordeck/src/hud/nodes.gen.ts).

export type PropType = 'binding' | 'tone' | 'number' | 'boolean' | 'string' | 'enum' | 'field' | 'cmd' | 'node' | 'nodes';

export interface PropSpec {
  type: PropType;
  required?: boolean;
  /** enum: the legal values. binding: the known literals (checked when a literal is given). */
  values?: readonly string[];
  /** The value is a URL — it must pass safeHref. */
  href?: boolean;
  doc?: string;
}

export type NodeKind = 'atom' | 'layout' | 'logic' | 'molecule' | 'control';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  hint: string;
  props: Record<string, PropSpec>;
  placement?: { form?: 'inside' | 'outside'; root?: boolean };
  /** The HUD slice a molecule reads straight from scope. */
  reads?: string;
  example: { t: string } & Record<string, unknown>;
}

export const TONES: readonly string[];
export const ICON_NAMES: readonly string[];
export const COMPONENTS: readonly string[];
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
export const KINDS: string[];
export function childProps(t: string): { name: string; many: boolean; required: boolean }[];

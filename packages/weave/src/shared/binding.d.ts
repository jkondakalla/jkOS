// Types for THE binding model (binding.js). One model, two directions: a WidgetSpec
// binds a dataset into a primitive tree (read); a TriggerDef binds a capability's
// typed output into another's body (write). See binding.js for why the two
// vocabularies that existed were not a compromise to merge — one was strictly the
// other's degenerate case.

/** The implicit source a legacy `{from}` trigger binding reads. */
export const EVENT_SOURCE: 'event';

/** The canonical form: point at `path` within the named source `src`. */
export interface SourceBinding {
  src: string;
  path?: string;
  fallback?: unknown;
}

/** An explicit literal — for a value that would otherwise look like a binding. */
export interface LiteralBinding {
  lit: unknown;
}

/** ⚠️ Sugar, kept because it is what every existing TriggerDef is written in:
 *  `{from:'a.b'}` ≡ `{src:'event', path:'a.b'}`. Normalised before use. */
export interface EventBinding {
  from: string;
}

export type Binding = SourceBinding | LiteralBinding | EventBinding;

/** A slot that takes a bare literal OR a binding. */
export type Bindable<T = unknown> = T | Binding;

export function isBinding(v: unknown): v is SourceBinding | EventBinding;
export function normalizeBinding(v: unknown): SourceBinding | null;
export function dig(obj: unknown, path?: string): unknown;
export function resolveBinding(v: unknown, sources?: Record<string, unknown>): unknown;
export function resolveBody(
  template: Record<string, unknown>,
  sources?: Record<string, unknown>,
): Record<string, unknown>;

// Types for THE binding model (binding.js). One model, two directions: a WidgetSpec
// binds a dataset into a primitive tree (read); a TriggerDef binds a capability's
// typed output into another's body (write). See binding.js for why the two
// vocabularies that existed were not a compromise to merge — one was strictly the
// other's degenerate case.

/** The implicit source a legacy `{from}` trigger binding reads. */
export const EVENT_SOURCE: 'event';

/** A format `fmt` may name (binding.js `format` says what each does). */
export type Format = 'upper' | 'lower' | 'number' | 'percent' | 'time' | 'date' | 'ago' | 'duration';
export const FORMATS: readonly Format[];

/** The canonical form: point at `path` within the named source `src`, optionally
 *  through a lookup table (`map`) and a format (`fmt`), in that order. */
export interface SourceBinding {
  src: string;
  path?: string;
  /** Used when the path is missing — and, with `map`, for a value not in the table. */
  fallback?: unknown;
  map?: Record<string, unknown>;
  fmt?: Format;
}

/** A condition: resolves to true or false. Operands are literals or bindings. */
export type ConditionBinding =
  | { eq: [Bindable, Bindable] }
  | { in: [Bindable, Bindable[] | Binding] }
  | { not: Bindable };
export const CONDITIONS: readonly ('eq' | 'in' | 'not')[];

/** An explicit literal — for a value that would otherwise look like a binding. */
export interface LiteralBinding {
  lit: unknown;
}

/** ⚠️ Sugar, kept because it is what every existing TriggerDef is written in:
 *  `{from:'a.b'}` ≡ `{src:'event', path:'a.b'}`. Normalised before use. */
export interface EventBinding {
  from: string;
}

export type Binding = SourceBinding | LiteralBinding | EventBinding | ConditionBinding;

/** A slot that takes a bare literal OR a binding. */
export type Bindable<T = unknown> = T | Binding;

export function isBinding(v: unknown): v is SourceBinding | EventBinding | ConditionBinding;
export function isCondition(v: unknown): v is ConditionBinding;
/** `when`/`not` truthiness: [], '', 0, 'false', '0' are false. */
export function truthy(v: unknown): boolean;
/** A source binding in canonical form; null for a literal or a condition. */
export function normalizeBinding(v: unknown): SourceBinding | null;
/** Every source binding inside a value, a condition's operands included. */
export function sourceBindings(v: unknown): SourceBinding[];
export function format(v: unknown, fmt: Format | string, sources?: Record<string, unknown>): unknown;
export function dig(obj: unknown, path?: string): unknown;
export function resolveBinding(v: unknown, sources?: Record<string, unknown>): unknown;
export function resolveBody(
  template: Record<string, unknown>,
  sources?: Record<string, unknown>,
): Record<string, unknown>;

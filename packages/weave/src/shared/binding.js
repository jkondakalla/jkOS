// binding.js — THE binding model (D13 / WV-2).
//
// ⭐ WHY THIS FILE EXISTS. The suite grew two halves of one system that never met:
//
//   READ   `WidgetSpec` (ORDECK) binds a dataset into a tree of primitives — a
//          label's text, a gauge's value, a list's array.
//   WRITE  `TriggerDef` (weave) binds one capability's typed output into another
//          capability's body — "when a job resolves, create a task titled …".
//
// Both are "point at a value that will exist at run time, and fall back sensibly if
// it does not". `trigger.ts`'s header calls itself *"the design-time shapes a
// Workshop GUI / an AI emits"* — which is the same sentence `WidgetSpec`'s docs use,
// about the same GUI, for the other direction. They had two vocabularies:
//
//     ORDECK    literal | { lit } | { src, path?, fallback? }
//     weave     { from: 'dotted.path' }              (one implicit source)
//
// ⚠️ THE CONVERGENCE IS NOT A COMPROMISE — one of them was strictly the other's
// degenerate case. `{ from: 'x' }` is `{ src: 'event', path: 'x' }` with the source
// left implicit because a trigger only ever had one. ORDECK's form already carried
// the two things the trigger form could not express: a LITERAL that might look like
// a binding, and a FALLBACK. So the richer form wins and the narrower becomes sugar
// for it, which is why nothing had to be rewritten to converge them.
//
// This is the spec the widget factory is built from: one model, two directions.
//
// ESM, like docShape.js and activity.js, for the same reason — Vite bundles its
// named exports for the browser while the no-bundler Node backends require() it
// through Node's require(ESM) interop.

/** The implicit source a legacy `{from}` trigger binding reads: the WHEN event's
 *  payload. Named so the two forms are interchangeable rather than merely similar. */
export const EVENT_SOURCE = 'event'

/** Is this a binding rather than a literal? A bare string/number/boolean is a
 *  literal; `{lit}` is an explicit literal (for values that would otherwise look
 *  like a binding); `{src}` and `{from}` are bindings. */
export function isBinding(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  return typeof v.src === 'string' || typeof v.from === 'string'
}

/** Normalise either form to the canonical `{ src, path?, fallback? }`.
 *  Returns null for a non-binding. */
export function normalizeBinding(v) {
  if (!isBinding(v)) return null
  if (typeof v.src === 'string') {
    return { src: v.src, path: v.path, fallback: v.fallback }
  }
  /* `{from:'a.b'}` — the whole string is a path into the one implicit source. The
     trigger engine has always split on the first dot to find the field it type-checks
     against; the rest is the nested path. Same split here, so a legacy trigger
     resolves identically. */
  return { src: EVENT_SOURCE, path: String(v.from), fallback: undefined }
}

/** Walk a dotted path. Missing at any hop ⇒ undefined, never a throw: a binding
 *  points at data that may not have arrived, which is a normal state and not an
 *  error. */
export function dig(obj, path) {
  if (!path) return obj
  let v = obj
  for (const k of String(path).split('.')) {
    if (v == null) return undefined
    v = v[k]
  }
  return v
}

/**
 * Resolve one value against a set of named sources.
 *
 * @param {*} v a literal, `{lit}`, `{src,path,fallback}`, or `{from}`
 * @param {Record<string, unknown>} sources named data in scope
 */
export function resolveBinding(v, sources = {}) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
  if ('lit' in v) return v.lit
  const b = normalizeBinding(v)
  if (!b) return v
  const out = dig(sources[b.src], b.path)
  return out ?? b.fallback
}

/** Resolve a whole body/props template — every value through resolveBinding. */
export function resolveBody(template, sources = {}) {
  const out = {}
  for (const [k, v] of Object.entries(template || {})) out[k] = resolveBinding(v, sources)
  return out
}

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

/* ── Derived values: `map`, `fmt`, and the conditions ─────────────────────────
 *
 * A binding used to be able to POINT at a value and nothing else, so every derived
 * value had to be computed in code before a widget could show it: the HUD slices
 * pre-bake `timeLabel`, `tone`, `progressLabel` in TypeScript, and LazurOS's jobs
 * widget could not colour a row by status at all (a status is 'DONE', not a tone) nor
 * show a timestamp as anything but the raw ISO string. Three derivations cover it:
 *
 *   { src, path, map: { DONE: 'ok', FAILED: 'danger' }, fallback: 'muted' }
 *       a lookup table. A value not in it resolves to `fallback` when one is given,
 *       else passes through unchanged.
 *   { src, path, fmt: 'ago' }
 *       one of FORMATS, applied last (after `map`).
 *   { eq: [a, b] }  { in: [a, [x, y]] }  { not: a }
 *       CONDITIONS — a binding that resolves to true/false, for `when.cond` or any
 *       boolean slot. Operands are themselves literals or bindings. `eq`/`in` compare
 *       loosely across string/number (an id is 7 in one app and '7' in another);
 *       `not` negates the same truthiness `when` uses.
 */

/** The formats `fmt` may name. */
export const FORMATS = ['upper', 'lower', 'number', 'percent', 'time', 'date', 'ago', 'duration']

/** The condition operators, each a one-key object. */
export const CONDITIONS = ['eq', 'in', 'not']

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A condition binding: exactly one key, and it is one of CONDITIONS. */
export function isCondition(v) {
  if (!isPlain(v)) return false
  const keys = Object.keys(v)
  return keys.length === 1 && CONDITIONS.includes(keys[0])
}

/** Is this a binding rather than a literal? A bare string/number/boolean is a
 *  literal; `{lit}` is an explicit literal (for values that would otherwise look
 *  like a binding); `{src}`, `{from}` and a condition are bindings. */
export function isBinding(v) {
  if (!isPlain(v)) return false
  return typeof v.src === 'string' || typeof v.from === 'string' || isCondition(v)
}

/** Truthiness for `when` and `not` — an empty array or string, 0, "false" and "0" are
 *  false, so "has tasks" is just a bound array and a flag that arrives as text works. */
export function truthy(v) {
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0'
  return Boolean(v)
}

/** Normalise a SOURCE binding (either spelling) to the canonical
 *  `{ src, path?, fallback?, map?, fmt? }`. Returns null for a literal and for a
 *  condition, which points at no one source. */
export function normalizeBinding(v) {
  if (!isBinding(v) || isCondition(v)) return null
  if (typeof v.src === 'string') {
    return { src: v.src, path: v.path, fallback: v.fallback, map: v.map, fmt: v.fmt }
  }
  /* `{from:'a.b'}` — the whole string is a path into the one implicit source. The
     trigger engine has always split on the first dot to find the field it type-checks
     against; the rest is the nested path. Same split here, so a legacy trigger
     resolves identically. */
  return { src: EVENT_SOURCE, path: String(v.from), fallback: undefined, map: undefined, fmt: undefined }
}

/** Every source binding inside a value (a condition's operands, recursively) —
 *  what a type-checker or a dependency tracker needs from a derived binding. */
export function sourceBindings(v) {
  if (!isPlain(v)) return []
  if (isCondition(v)) {
    const arg = v[Object.keys(v)[0]]
    return (Array.isArray(arg) ? arg : [arg]).flatMap(sourceBindings)
  }
  const b = normalizeBinding(v)
  return b ? [b] : []
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
  if (!isPlain(v)) return v
  if ('lit' in v) return v.lit
  if (isCondition(v)) return resolveCondition(v, sources)
  const b = normalizeBinding(v)
  if (!b) return v
  let out = dig(sources[b.src], b.path)
  if (out == null) out = b.fallback
  if (isPlain(b.map)) {
    const key = String(out)
    if (Object.prototype.hasOwnProperty.call(b.map, key)) out = b.map[key]
    else if (b.fallback !== undefined) out = b.fallback
  }
  if (b.fmt) out = format(out, b.fmt, sources)
  return out
}

/** Loose equality across the two spellings an id or a count arrives in. */
function same(a, b) {
  if (a === b) return true
  if (a == null || b == null || typeof a === 'object' || typeof b === 'object') return false
  return String(a) === String(b)
}

function resolveCondition(v, sources) {
  if ('not' in v) return !truthy(resolveBinding(v.not, sources))
  const [a, b] = Array.isArray(v.eq ?? v.in) ? (v.eq ?? v.in) : []
  const x = resolveBinding(a, sources)
  if ('eq' in v) return same(x, resolveBinding(b, sources))
  const list = resolveBinding(b, sources)
  return Array.isArray(list) && list.some((e) => same(x, resolveBinding(e, sources)))
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const two = (n) => String(n).padStart(2, '0')
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const HM = /^(\d{2}):(\d{2})/

/** A value as a local Date: an epoch ms, an ISO instant, or a YYYY-MM-DD day (read
 *  as a LOCAL day — `new Date('2026-09-28')` is UTC midnight, the day before west of
 *  Greenwich). null when it is none of them. */
function toDate(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v) : null
  if (typeof v !== 'string') return null
  const d = v.match(DAY)
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t)
}

/**
 * Apply one of FORMATS. A value it cannot read passes through unchanged, so a format
 * never blanks a value that arrived in an unexpected shape.
 *
 *   upper · lower       case
 *   number              1234.56 → '1,234.6'
 *   percent             0.42 → '42%'   (a fraction, as every progress value here is)
 *   time                an ISO instant or 'HH:MM[:SS]' → 'HH:MM', local, 24-hour
 *   date                an ISO instant or 'YYYY-MM-DD' → 'SEP 28'
 *   ago                 an instant → '42s ago' · '5m ago' · '3h ago' · '2d ago', against
 *                       the `$now` source (epoch ms or ISO) when one is in scope, so a
 *                       renderer with a pinned clock draws the same text every time
 *   duration            seconds → 'm:ss' or 'h:mm:ss'
 */
export function format(v, fmt, sources = {}) {
  if (v == null || v === '') return v
  switch (fmt) {
    case 'upper': return String(v).toUpperCase()
    case 'lower': return String(v).toLowerCase()
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n)) return v
      const [i, f] = (Math.round(n * 10) / 10).toFixed(1).split('.')
      const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      return f === '0' ? grouped : `${grouped}.${f}`
    }
    case 'percent': {
      const n = Number(v)
      return Number.isFinite(n) ? `${Math.round(n * 100)}%` : v
    }
    case 'time': {
      if (typeof v === 'string' && HM.test(v) && !v.includes('T')) return v.slice(0, 5)
      const d = toDate(v)
      return d ? `${two(d.getHours())}:${two(d.getMinutes())}` : v
    }
    case 'date': {
      const d = toDate(v)
      return d ? `${MON[d.getMonth()]} ${d.getDate()}` : v
    }
    case 'ago': {
      const d = toDate(v)
      if (!d) return v
      const nowD = sources.$now != null ? toDate(sources.$now) : null
      const s = Math.max(0, Math.round(((nowD ? nowD.getTime() : Date.now()) - d.getTime()) / 1000))
      return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`
    }
    case 'duration': {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n) || n < 0) return v
      const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60
      return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
    }
    default:
      return v
  }
}

/** Resolve a whole body/props template — every value through resolveBinding. */
export function resolveBody(template, sources = {}) {
  const out = {}
  for (const [k, v] of Object.entries(template || {})) out[k] = resolveBinding(v, sources)
  return out
}

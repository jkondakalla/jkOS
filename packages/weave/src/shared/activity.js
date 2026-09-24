// activity.js — THE declared shape of "what the user did" (XC-2 / D6).
//
// WHY THIS EXISTS
// Three apps keep a per-user, append-only record of what someone did, in four
// schemas, none of them aggregatable:
//
//   · kouros  `history`       — item_ref, started_at, ms_played, completed
//   · kouros  `book_history`  — item_ref, started_at, ms_played, completed
//   · beigeboard `items` — started_at / completed_at, two columns on a wide table
//   · lazuros `jobs`     — capability, status, created_at, updated_at
//
// ⚠️ The first two are FIELD-FOR-FIELD IDENTICAL and were invented independently,
// months apart, by people solving the same problem without a word for it. That is
// the actual finding: not that the code is duplicated, but that the SUITE had no
// way to say "this app records activity", so each app had to make one up.
//
// ⭐ THE RULE: DECLARE ONE SHAPE; DO NOT SHARE AN IMPLEMENTATION.
// This file is a vocabulary and a validator. It is not a table, not a base class,
// and not a place to put a query. Each app stays authoritative about its own
// ledger — kouros's play events are kouros's business, and its `history` table
// keeps exactly the columns it wants — and answers about ITSELF in this shape.
// Weave fans the question out and merges the answers (fetchActivity.ts).
//
// Why that boundary and not a shared table: an app that owns its ledger can change
// it, index it, and delete a user's rows on request without coordinating with three
// other apps. A shared implementation would make every one of those a suite-wide
// migration. The only thing that genuinely needs to be common is the ANSWER.
//
// Two payoffs, and the second is why RESET promotes this above the rest of Stage D:
//   1. "what did I do today" becomes answerable across the suite (the ML corpus for
//      the variance feature)
//   2. the same mechanism IS the suite's action-audit trail
//
// ESM, like docShape.js, and for the same reason: Vite bundles its named exports
// for the browser read path while the no-bundler Node backends require() it through
// Node's require(ESM) interop. A `module.exports` form breaks the rollup build.

/** Where an app serves its activity, relative to its apiBase. Derived into
 *  `activityPath` by @jkos/suite-manifest — never re-typed by an app. */
import { MAX_DOC_VERSION, DOC_VERSION_UNSUPPORTED } from './docShape.js'
import { PAGE_DEFAULT, PAGE_MAX } from './paging.js'

export const ACTIVITY_PATH = '/activity'

/** How many events one app may return in a single answer. A merge across five
 *  apps is a phone rendering a list; an unbounded ledger read is neither useful
 *  nor safe, and a caller that wants more should walk `before`. */
/* ⚠️ FROM THE ONE PAGING CONTRACT (WEAVE.md §3.2), not two more numbers. Three
   hand-rolled clamps that disagreed is what made a cross-app fan-out unmergeable in
   the first place — "give me 100" meaning three different windows, and the merged
   page silently short. */
export const ACTIVITY_MAX_LIMIT = PAGE_MAX
export const ACTIVITY_DEFAULT_LIMIT = PAGE_DEFAULT

/* ── The event ────────────────────────────────────────────────────────────────
 *
 * Deliberately SMALL. Every field here had to earn its place by being answerable
 * by all four ledgers and needed by the two consumers; anything an app wants to
 * say beyond this belongs in its own dataset, which the `ref` points at.
 *
 *   id        stable and unique WITHIN the app. `<table>:<rowid>` by convention.
 *             Stable because a merged feed is paged and de-duplicated by it.
 *   kind      the app's own verb, and it MUST be one the doc declares. A closed
 *             list per app rather than a suite-wide enum: "listened" and "trained"
 *             are not the same act, and flattening them into one vocabulary is how
 *             you end up unable to ask either question.
 *   at        WHEN, in the canonical millisecond-ISO wire format (XC-1). This is
 *             the merge key across apps, so a second-resolution stamp here would
 *             re-introduce exactly the cross-app sort bug wireTime.js exists to
 *             stop — the two formats sort against each other incorrectly.
 *   ref       WHAT it was about, as an ext_ref ("<app>:<localId>"), or null for an
 *             act with no subject. ⚠️ The ext_ref namespace is itself unresolved
 *             (BB-5) and D7 settles it; emitting through @jkos/weave's extRef()
 *             means this inherits that resolution rather than forking a fifth
 *             convention.
 *   label     a human string for `ref`, because a merged feed cannot deeplink into
 *             four apps to render a list, and "kouros:book:88" is not a sentence.
 *   ms        how long the act actually took, when that is meaningful. NOT
 *             wall-clock duration — kouros's two ledgers both mean "time actually
 *             played", excluding paused time, and that distinction is the whole
 *             value of the number.
 *   completed did it finish. Tri-state on purpose, and `null` is a real answer
 *             rather than a missing one: it means "unknown here" — either this kind
 *             of act has no notion of finishing (BeigeBoard's `start`), or it has
 *             not finished YET (a LazurOS job still queued). Both are different from
 *             `false`, which asserts that it ran and did not complete.
 */

const KIND_RE = /^[a-z][a-z0-9_]{0,31}$/
const CANONICAL_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Validate one event against a set of declared kind ids.
 *  @returns {string|null} an error string, or null when valid. */
export function checkActivityEvent(e, kindIds) {
  if (!e || typeof e !== 'object') return 'event must be an object'
  if (typeof e.id !== 'string' || !e.id) return 'event.id must be a non-empty string'
  if (typeof e.kind !== 'string' || !e.kind) return `event ${e.id}: kind must be a non-empty string`
  if (kindIds && !kindIds.has(e.kind)) {
    return `event ${e.id}: kind '${e.kind}' is not declared (declared: ${[...kindIds].join(', ') || 'none'})`
  }
  // The merge key. Held to the canonical format rather than to "parses as a date"
  // because a merged sort is a STRING sort across apps.
  if (!CANONICAL_AT.test(String(e.at))) {
    return `event ${e.id}: at must be canonical millisecond ISO (got '${e.at}')`
  }
  if (e.ref != null && typeof e.ref !== 'string') return `event ${e.id}: ref must be a string or null`
  if (e.label != null && typeof e.label !== 'string') return `event ${e.id}: label must be a string or null`
  if (e.ms != null && (typeof e.ms !== 'number' || !Number.isFinite(e.ms) || e.ms < 0)) {
    return `event ${e.id}: ms must be a non-negative finite number or null`
  }
  if (e.completed != null && typeof e.completed !== 'boolean') {
    return `event ${e.id}: completed must be a boolean or null`
  }
  return null
}

/**
 * Validate an ActivityDoc: `{ app, version, kinds[], activity[] }`.
 *
 * Same envelope as a CapabilityDoc and a DatasetDoc (docShape.js) on purpose — an
 * app's three declarations should look like three of the same thing, because they
 * are: what it can be told to do, what it can be read for, and what it remembers
 * having done.
 *
 * @returns {string|null} an error string, or null when valid.
 */
export function checkActivityDoc(doc) {
  if (!doc || typeof doc !== 'object') return 'doc must be an object'
  if (typeof doc.app !== 'string' || !doc.app) return 'doc.app must be a non-empty string'
  if (typeof doc.version !== 'number') return 'doc.version must be a number'
  /* The same fail-closed rule the other two declarations obey (WEAVE.md §3.3): a
     consumer that half-understands a contract is worse than one that refuses. */
  if (doc.version > MAX_DOC_VERSION) {
    return `${DOC_VERSION_UNSUPPORTED}: doc.version ${doc.version} is newer than this consumer understands (max ${MAX_DOC_VERSION})`
  }
  if (!Array.isArray(doc.kinds)) return 'doc.kinds must be an array'
  if (!doc.kinds.length) return 'doc.kinds must declare at least one kind — an activity surface with no vocabulary says nothing'

  const kindIds = new Set()
  for (const k of doc.kinds) {
    if (!k || typeof k.id !== 'string' || !KIND_RE.test(k.id)) {
      return `every kind needs a lowercase snake_case id (got '${k && k.id}')`
    }
    if (kindIds.has(k.id)) return `duplicate kind id '${k.id}'`
    if (typeof k.label !== 'string' || !k.label) return `kind '${k.id}' needs a label`
    kindIds.add(k.id)
  }

  if (!Array.isArray(doc.activity)) return 'doc.activity must be an array'
  const seen = new Set()
  for (const e of doc.activity) {
    const err = checkActivityEvent(e, kindIds)
    if (err) return err
    // Uniqueness within the app is what makes the merged feed de-duplicable.
    if (seen.has(e.id)) return `duplicate event id '${e.id}'`
    seen.add(e.id)
  }
  return null
}

/** Boolean form — true when the doc is structurally valid. */
export function isValidActivityDoc(doc) {
  return checkActivityDoc(doc) === null
}

/**
 * Merge several apps' answers into one feed, newest first.
 *
 * Each event is stamped with the `app` it came from — the apps don't stamp
 * themselves, because the doc already says who it is and repeating it per row is
 * a thing that can disagree with itself.
 *
 * ⚠️ The sort is a plain string compare on `at`, which is only correct because
 * every stamp is held to the canonical millisecond-ISO format above. That is the
 * whole reason the format is validated rather than merely parsed.
 *
 * @param {Array<{app: string, kinds: Array, activity: Array}|null>} docs
 * @param {{limit?: number}} [opts]
 */
export function mergeActivity(docs, { limit = ACTIVITY_DEFAULT_LIMIT } = {}) {
  const out = []
  for (const doc of docs) {
    if (!doc || !isValidActivityDoc(doc)) continue
    const labels = new Map(doc.kinds.map((k) => [k.id, k.label]))
    for (const e of doc.activity) {
      out.push({ ...e, app: doc.app, kindLabel: labels.get(e.kind) ?? e.kind })
    }
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.app < b.app ? -1 : 1)))
  return out.slice(0, Math.max(0, limit))
}

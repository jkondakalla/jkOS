// extref.js — the cross-app addressing convention, once, for BOTH halves.
//
// An ext_ref is "<app>:<localId>" — one opaque string, owned by the writing app,
// that says "this thing lives in app X with id Y." No central join table, no
// referential integrity, deliberately: the writing app owns the string, readers
// split it to know which app to deeplink or query.
//
// ⚠️ It lived only in extref.ts, which is TypeScript, so no Node backend could
// import it — and the activity contract (D6) needs it on the SERVER side, where
// every app is CJS. The choice was a fifth hand-typed copy of `${app}:${id}` or
// one shared definition; this is the shared definition, in the same ESM-consumed-
// by-both form docShape.js already uses. extref.ts re-exports it for the frontend.
//
/** Build "<app>:<id>". */
export const extRef = (app, id) => `${app}:${id}`

/** Split on the FIRST ':' so ids may themselves contain colons. */
export function parseExtRef(ref) {
  const s = String(ref)
  const i = s.indexOf(':')
  return i < 0 ? { app: '', id: s } : { app: s.slice(0, i), id: s.slice(i + 1) }
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE NAMESPACE (BB-5 / D7)
   ══════════════════════════════════════════════════════════════════════════════

   ⚠️ FOUR incompatible schemes shared one `ext_ref` column, and the audit only
   found three:

     beigeboard:41            a row owned by a suite app
     itunes:1234567           an external provider's catalog id
     routine:24:2026-08-18    BeigeBoard's engine occurrence identity
     routinedoc:squat-cycle   BeigeBoard's routine DOCUMENT identity, keyed by slug

   The finding is stated from the reader's side and that is the right side: *"an AI
   author reading the dataset docs cannot tell these apart."* Nothing said which
   prefixes existed, what any of them meant, or that `itunes` was a provider rather
   than an app — `itunes:` was a bare literal in one route file, declared nowhere.

   THE RESOLUTION IS AN ALLOCATION, NOT A REFORMAT. Every scheme is DECLARED, in
   the app that writes it, in one of three classes; `pnpm check:refs` proves the
   declarations are globally disjoint and that no source literal writes an
   undeclared prefix.

     'suite'     the scheme IS a jkOS app id (@jkos/suite-manifest). "this row came
                 from app X, local id Y". Implicit — never declared per app,
                 because the app directory already declares it.
     'external'  the scheme is a third-party catalog. "this is provider X's id Y".
                 The provider, NOT the connector that fetched it: papyros's
                 connector is `meta` and writes `itunes:` refs, and conflating the
                 two is how the prefix ended up meaning nothing to a reader.
     'internal'  an app-private engine identity. Opaque to every other app, and
                 that opacity is the point — `routine:24:2026-08-18` encodes the
                 mint's own record and only BeigeBoard may parse it.

   ⚠️ WHY NOT RE-PREFIX EVERYTHING AS `<app>:<scheme>:<id>`, which would make the
   first segment always an app id and need no allocation table? Because it is a
   data migration of a UNIQUE-INDEXED column that the routine engine's idempotency
   depends on, plus `routines.cadence_skips`, which stores ref SUFFIXES — for a
   gain a declaration already delivers. The uniformity would be prettier; it would
   not tell a reader one thing the declaration does not. */

/** The three classes a scheme can belong to. */
export const EXT_REF_CLASSES = Object.freeze(['suite', 'external', 'internal'])

/* ⚠️ SUITE-RESERVED schemes — owned by the suite's own tooling, not by any app, so
   there is no app declaration for them to live in. Enumerating the namespace turned
   up a FIFTH scheme the audit had not found (it found three of five): the
   suite-prober tags every row its live round-trip creates `prober:<runid>` and
   sweeps by that prefix afterwards. It appeared in exactly one file, explained in
   exactly one comment, and to a reader of the dataset docs it was indistinguishable
   from an app's rows — which is BB-5 in miniature, in the very tool built to catch
   that class of thing. */
export const RESERVED_SCHEMES = Object.freeze({
  prober: 'Rows created by packages/suite-prober\'s live round-trip, swept after each run',
})

/** The scheme part of a ref — everything before the FIRST ':'. */
export const refScheme = (ref) => parseExtRef(ref).app

const SCHEME_RE = /^[a-z][a-z0-9_]{0,31}$/

/**
 * Validate one app's ext_ref scheme declaration:
 * `{ app, version, schemes: [{ id, class, label, shape }] }`.
 *
 * ⚠️ `class: 'suite'` is rejected. A suite scheme is an app id and the app
 * directory already declares those; letting an app also declare one would create a
 * second place for the same fact to be written, which is the class of defect this
 * whole namespace exists to close.
 *
 * @returns {string|null} an error string, or null when valid.
 */
export function checkExtRefDoc(doc) {
  if (!doc || typeof doc !== 'object') return 'doc must be an object'
  if (typeof doc.app !== 'string' || !doc.app) return 'doc.app must be a non-empty string'
  if (typeof doc.version !== 'number') return 'doc.version must be a number'
  if (!Array.isArray(doc.schemes)) return 'doc.schemes must be an array'
  const seen = new Set()
  for (const s of doc.schemes) {
    if (!s || !SCHEME_RE.test(String(s.id))) return `every scheme needs a lowercase snake_case id (got '${s && s.id}')`
    if (seen.has(s.id)) return `duplicate scheme id '${s.id}'`
    seen.add(s.id)
    if (s.class === 'suite') {
      return `scheme '${s.id}' declares class 'suite' — a suite scheme IS an app id and `
        + '@jkos/suite-manifest already declares those; do not restate it here'
    }
    if (s.class !== 'external' && s.class !== 'internal') {
      return `scheme '${s.id}' needs class 'external' or 'internal' (got '${s.class}')`
    }
    if (typeof s.label !== 'string' || !s.label) return `scheme '${s.id}' needs a label`
    // The SHAPE is what a reader actually needs: 'routine:<routineId>:<date>' says
    // in one line what prose takes a paragraph to fail to say.
    if (typeof s.shape !== 'string' || !s.shape.startsWith(`${s.id}:`)) {
      return `scheme '${s.id}' needs a shape starting '${s.id}:' (got '${s.shape}')`
    }
  }
  return null
}

/** One line per scheme, for the `doc` string on a dataset's `ext_ref` field — so
 *  the prose a reader sees is GENERATED from the declaration and cannot drift from
 *  it. That drift is the whole finding: the column's meaning lived in four source
 *  files and no document. */
export function extRefFieldDoc(doc) {
  const lines = (doc?.schemes || []).map((s) => `${s.shape} — ${s.label} (${s.class})`)
  return 'An ext_ref is "<scheme>:<rest>". A scheme that is a jkOS app id means the row '
    + 'came from that app. This app also writes: '
    + (lines.length ? lines.join('; ') : 'no app-specific schemes')
    + '. See packages/weave/src/shared/extref.js for the allocation rules.'
}

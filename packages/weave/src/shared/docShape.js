// docShape.js — the single source of truth for a weave discovery-doc's shape.
//
// A CapabilityDoc (what an app can be told to DO) and a DatasetDoc (what it can
// be READ for) share the same envelope: { app, version, <list>[] } where every
// entry has a string id. That rule was enforced in TWO places that could drift:
// the server validated its OWN doc at boot (contracts.js, throw), while a peer
// CONSUMER only checked `Array.isArray(list)` on read (fetchCapabilities/
// fetchDatasets) — so a malformed peer doc (no app, no version, an entry missing
// its id) sailed past the reader. This is that rule, once. It is ESM (the weave
// package is type:module): Vite/rollup bundle its named exports natively for the
// browser read path, and the no-bundler Node backends `require()` it via Node's
// require(ESM) interop (stable on the deployed node:20-slim, Node >=20.19). It is
// NOT CommonJS — a `module.exports` form breaks the rollup build, which cannot
// name-import a workspace CJS module. The authoritative TS shapes live in
// ../capability.ts and ../dataset.ts; the .d.ts twin types this guard.

/* ⭐ THE HIGHEST DECLARATION VERSION THIS CODE UNDERSTANDS (RESET A2c.3).
 *
 * ⚠️ `version` was declared and not actionable: this file checked `typeof
 * doc.version === 'number'` and the docs said "bump on a breaking field change", and
 * NOTHING ANYWHERE said what a consumer does with a version it does not recognise.
 * A number nobody acts on is decoration, and the failure it invites is the quiet one
 * — a reader half-understanding a v2 doc through v1 eyes, binding fields that have
 * moved and skipping ones that did not exist.
 *
 * THE RULING: FAIL CLOSED, with a named code. A declaration is a contract, and a
 * consumer that half-understands one is worse than a consumer that refuses. Refusing
 * is visible; degrading is not.
 *
 * Bump this ONLY together with a breaking change to the doc shape itself — not when
 * an app bumps its own doc's version for its own reasons. */
export const MAX_DOC_VERSION = 1

/** The code a refusal carries, so a caller can tell "this peer speaks a dialect I do
 *  not know" apart from "this peer is broken". */
export const DOC_VERSION_UNSUPPORTED = 'DOC_VERSION_UNSUPPORTED'

/**
 * Validate a discovery doc's shape. Returns null when valid, else an error string.
 * @param {*} doc
 * @param {'capabilities'|'datasets'} listKey
 * @returns {string|null}
 */
export function checkDocShape(doc, listKey) {
  if (!doc || typeof doc !== 'object') return 'doc must be an object'
  if (typeof doc.app !== 'string' || !doc.app) return 'doc.app must be a non-empty string'
  if (typeof doc.version !== 'number') return 'doc.version must be a number'
  /* Fail closed on a version from the future. A LOWER version is fine — this code
     understands every dialect it has ever spoken; it cannot understand one written
     after it. */
  if (doc.version > MAX_DOC_VERSION) {
    return `${DOC_VERSION_UNSUPPORTED}: doc.version ${doc.version} is newer than this consumer understands (max ${MAX_DOC_VERSION}) — refusing rather than half-reading a contract`
  }
  if (!Array.isArray(doc[listKey])) return `doc.${listKey} must be an array`
  for (const entry of doc[listKey]) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      return `every ${listKey} entry needs a string id`
    }
  }
  return null
}

/** Boolean form — true when the doc is structurally valid. */
export function isValidDoc(doc, listKey) {
  return checkDocShape(doc, listKey) === null
}

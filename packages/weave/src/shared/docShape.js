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

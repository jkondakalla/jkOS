'use strict'
// weave/server/contracts.js — serve the discovery declarations.
//
// An app declares what can be DONE to it (CapabilityDoc, writes) and what can be
// READ from it (DatasetDoc, reads) as pure data, served at its capabilities/
// datasets paths. The DATA stays in the app (it's app-owned); these helpers only
// validate the shape at boot and return the JSON handler — so a typo'd doc fails
// loudly here instead of silently breaking a peer's discovery.
//
// The canonical TS shapes live in ../capability.ts and ../dataset.ts (design-time
// source of truth); this is the runtime guard that keeps a JS backend honest.

function validateDoc(doc, listKey, label) {
  if (!doc || typeof doc !== 'object') throw new Error(`weave: ${label} doc must be an object`)
  if (typeof doc.app !== 'string' || !doc.app) throw new Error(`weave: ${label} doc.app must be a non-empty string`)
  if (typeof doc.version !== 'number') throw new Error(`weave: ${label} doc.version must be a number`)
  if (!Array.isArray(doc[listKey])) throw new Error(`weave: ${label} doc.${listKey} must be an array`)
  for (const entry of doc[listKey]) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      throw new Error(`weave: every ${label} entry needs a string id`)
    }
  }
  return doc
}

/** Validate + serve a CapabilityDoc (writes). */
function serveCapabilities(doc) {
  const valid = validateDoc(doc, 'capabilities', 'capabilities')
  return (_req, res) => res.json(valid)
}

/** Validate + serve a DatasetDoc (reads). */
function serveDatasets(doc) {
  const valid = validateDoc(doc, 'datasets', 'datasets')
  return (_req, res) => res.json(valid)
}

module.exports = { serveCapabilities, serveDatasets }

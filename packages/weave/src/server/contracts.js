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
// source of truth); the structural rule lives ONCE in ../shared/docShape.js, shared
// with the browser read path (fetchCapabilities/fetchDatasets) so a serve-side doc
// and a consumer can't disagree on what "valid" means. Here we throw at boot (a
// typo'd doc fails loudly on the producer) rather than return null (the reader).

const { checkDocShape } = require('../shared/docShape')

function validateDoc(doc, listKey, label) {
  const err = checkDocShape(doc, listKey)
  if (err) throw new Error(`weave: ${label} ${err}`)
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

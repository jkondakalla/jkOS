'use strict'
// @jkos/weave/server — the BACKEND half of the suite fabric (CJS entry).
//
// The server-side counterpart to the frontend `@jkos/weave` import: the shared
// Express interop every jkOS backend weaves in with — identity, write
// authorization, CORS, health, the capability/dataset discovery declarations,
// list filters, weave-column coercion — plus the headless peer client. One import
// so backends stop hand-rolling (and drifting on) the same wiring.
//
// Plain JS (Node) so the no-bundler backends consume it exactly like
// @jkos/auth-middleware; the frontend `.` export stays TS for Vite. The ESM twin
// (index.mjs) re-exports this for `type: module` backends.

const { weaveCors } = require('./cors')
const { weaveAuth, requireScope, verifyToken } = require('./auth')
const { weaveWriteGate } = require('./writeGate')
const { healthHandler } = require('./health')
const { serveCapabilities, serveDatasets } = require('./contracts')
const { buildItemFilters } = require('./filters')
const { coerceWeaveColumn } = require('./columns')
const { weaveServerClient } = require('./serverClient')

module.exports = {
  weaveCors,
  weaveAuth,
  requireScope,
  verifyToken,
  weaveWriteGate,
  healthHandler,
  serveCapabilities,
  serveDatasets,
  buildItemFilters,
  coerceWeaveColumn,
  weaveServerClient,
}

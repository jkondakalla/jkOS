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
const { buildItemFilters, filterSpec } = require('./filters')
const { coerceWeaveColumn } = require('./columns')
const { weaveServerClient, assertServiceClientProvisioned } = require('./serverClient')
const { defineCollection, backfillWireTime } = require('./collection')
/* ⚠️ `wireNow` is here because its ABSENCE was load-bearing. Five of wireTime's six
   helpers reached backends through this barrel and `now()` — the one that produces a
   canonical instant FROM JS, which is what you bind when comparing against a
   canonical column — did not. So a backend needing one either hand-rolled it
   (jkAuth's tokens.js grew its own `nowIso`) or reached for SQLite's `datetime('now')`
   and got the legacy format back. jkAuth's OTP expiry did the latter, and compared
   the two formats as strings. A shared module you cannot reach the whole of is a
   shared module people route around. */
const { SQL_NOW, sqlConvert, now: wireNow, isCanonical: isCanonicalTime, canonical: canonicalTime, parse: parseWireTime } = require('./wireTime')
const { callerZone, zonedParts, callerDay } = require('./callerDay')
const { defineActivity } = require('./activity')
const { extRef, parseExtRef } = require('../shared/extref')
const { pageLimit, PAGE_DEFAULT, PAGE_MAX, CURSOR_PARAM } = require('../shared/paging')
const { defineConnector } = require('./connector')
const { defineLibraryScanner } = require('./libraryScanner')
const { defineMediaRoutes, decidePlayback } = require('./mediaRoutes')
const { serveSpa } = require('./spa')
const { createTriggerEngine, resolveBindings, validateTriggerTypes, triggerWebhook, serverDispatch } = require('./trigger')
/* ⚠️ The RECEIVER, exported because `defineCollection` is not the only write door.
   Until this line it was reachable only from inside collection.js, so a hand-rolled
   POST — BeigeBoard's createItem and importItems, LazurOS's job doors — had no way to
   honour the key the trigger engine sends except by re-implementing the store. The
   same shape as `wireNow` above: a shared module you cannot reach is one people
   route around. */
const { withIdempotency, DDL: IDEMPOTENCY_DDL } = require('./idempotency')
const { IDEMPOTENCY_FIELD, idempotencyKeyOf, idempotencyKeyError, idempotencyBodyField } = require('../shared/idempotency')
// Re-export the canonical error-code vocabulary + envelope helper so backends that
// already weave in @jkos/weave/server (jkAuth, BeigeBoard) get one source for the
// `code` field without a second auth-middleware import. Single source lives in
// @jkos/auth-middleware/codes.
const { CODES, authError } = require('@jkos/auth-middleware')

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
  filterSpec,
  coerceWeaveColumn,
  weaveServerClient,
  assertServiceClientProvisioned,
  defineCollection,
  backfillWireTime,
  SQL_NOW, sqlConvert, wireNow, isCanonicalTime, canonicalTime, parseWireTime,
  callerZone, zonedParts, callerDay,
  defineActivity, extRef, parseExtRef,
  pageLimit, PAGE_DEFAULT, PAGE_MAX, CURSOR_PARAM,
  defineConnector,
  defineLibraryScanner,
  defineMediaRoutes,
  decidePlayback,
  serveSpa,
  createTriggerEngine,
  resolveBindings,
  validateTriggerTypes,
  triggerWebhook,
  serverDispatch,
  withIdempotency, IDEMPOTENCY_DDL, IDEMPOTENCY_FIELD, idempotencyKeyOf, idempotencyKeyError, idempotencyBodyField,
  CODES,
  authError,
}

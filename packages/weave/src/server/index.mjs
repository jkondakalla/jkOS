// ESM entry — re-exports the CJS implementation so `type: module` backends can
// `import { weaveCors, weaveAuth, ... } from '@jkos/weave/server'`. Mirrors the
// @jkos/auth-middleware index.mjs pattern.
import server from './index.js'

export const weaveCors = server.weaveCors
export const weaveAuth = server.weaveAuth
export const requireScope = server.requireScope
export const verifyToken = server.verifyToken
export const weaveWriteGate = server.weaveWriteGate
export const healthHandler = server.healthHandler
export const serveCapabilities = server.serveCapabilities
export const serveDatasets = server.serveDatasets
export const buildItemFilters = server.buildItemFilters
export const filterSpec = server.filterSpec
export const coerceWeaveColumn = server.coerceWeaveColumn
export const weaveServerClient = server.weaveServerClient
export const defineCollection = server.defineCollection
export const backfillWireTime = server.backfillWireTime
export const SQL_NOW = server.SQL_NOW
export const sqlConvert = server.sqlConvert
export const isCanonicalTime = server.isCanonicalTime
export const parseWireTime = server.parseWireTime
export const defineConnector = server.defineConnector
export const defineLibraryScanner = server.defineLibraryScanner
export const defineMediaRoutes = server.defineMediaRoutes
export const decidePlayback = server.decidePlayback
export const serveSpa = server.serveSpa
export const createTriggerEngine = server.createTriggerEngine
export const resolveBindings = server.resolveBindings
export const validateTriggerTypes = server.validateTriggerTypes
export const triggerWebhook = server.triggerWebhook
export const serverDispatch = server.serverDispatch
export const CODES = server.CODES
export const authError = server.authError
export default server

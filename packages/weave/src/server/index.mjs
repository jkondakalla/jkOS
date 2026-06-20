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
export const coerceWeaveColumn = server.coerceWeaveColumn
export const weaveServerClient = server.weaveServerClient
export default server

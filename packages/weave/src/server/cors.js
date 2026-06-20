'use strict'
// weave/server/cors.js — the one CORS header block, once.
//
// Every jkOS backend used to hand-roll the same allow-origin/credentials/methods
// reflection (three subtly different copies across the suite). It lives here now.
// The ORIGIN SOURCE stays pluggable — jkAuth passes its registry-backed
// getAppOrigins (direct DB), resource apps pass an env-derived list — because the
// header logic is what drifted, not the source.
//
// Note: under the suite's same-origin edge model, peer browser calls don't hit
// this path at all (they're same-origin through nginx). This covers the genuine
// cross-origin calls — an app frontend calling jkAuth's /auth/refresh, etc.

/**
 * @param {(() => string[]) | string[]} originResolver allowed origins, or a
 *   function returning them (evaluated per request so a cache can refresh).
 */
function weaveCors(originResolver) {
  return function weaveCorsMw(req, res, next) {
    const origin = req.headers.origin
    if (origin) {
      const allowed = typeof originResolver === 'function' ? originResolver() : originResolver
      if (Array.isArray(allowed) && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
      }
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  }
}

module.exports = { weaveCors }

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
    // The response (the reflected Allow-Origin) depends on the request Origin, so a
    // shared/proxy cache MUST key on it — without Vary it could serve one origin's
    // credentialed ACAO header to a request from another origin. `res.vary` appends,
    // so it won't clobber a Vary another middleware set.
    res.vary('Origin')
    const origin = req.headers.origin
    if (origin) {
      const allowed = typeof originResolver === 'function' ? originResolver() : originResolver
      if (Array.isArray(allowed) && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        res.setHeader('Access-Control-Max-Age', '600')  // cache the preflight (10 min) instead of re-OPTIONS every call
      }
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  }
}

module.exports = { weaveCors }

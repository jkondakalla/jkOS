'use strict'
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

// Canonical jkOS auth middleware. Verifies the jkos_token cookie (RS256 JWT)
// minted by jkAuth. Superset of every prior per-service copy:
//   - publicKey  from opts.publicKey  or env JKOS_AUTH_PUBLIC_KEY
//   - jwksUri    from opts.jwksUri    or env JKOS_AUTH_JWKS_URI — when set, the
//     verifying key is selected by the token's `kid` from the live JWKS (key
//     rotation, U3). Takes precedence over a static publicKey.
//   - issuer     from opts.issuer     or env JKOS_AUTH_ISSUER (default 'jkos-auth';
//     staging passes 'jkos-auth-staging')
//   - cookieName from opts.cookieName or 'jkos_token' + env JKOS_COOKIE_SUFFIX
//     (staging passes _staging so it reads jkos_token_staging, not the prod
//     cookie that the browser also sends to every *.jkos.net host)

function resolveKey(publicKey) {
  const key = (publicKey || process.env.JKOS_AUTH_PUBLIC_KEY || '').replace(/\\n/g, '\n')
  if (!key.trim()) throw new Error('jkosAuth: publicKey (or JKOS_AUTH_PUBLIC_KEY) is required')
  return key
}

function resolveIssuer(issuer) {
  return issuer || process.env.JKOS_AUTH_ISSUER || 'jkos-auth'
}

function resolveCookieName(cookieName) {
  return cookieName || 'jkos_token' + (process.env.JKOS_COOKIE_SUFFIX || '')
}

// Build a key resolver over a remote JWKS. Caches PEMs by `kid`, refreshes the
// whole set when stale, and refetches on an unknown kid (a rotation just
// happened) — throttled so a barrage of bad/old tokens can't hammer jkAuth.
function makeJwksResolver(jwksUri, { cacheMaxMs = 10 * 60 * 1000, minRefetchMs = 30 * 1000 } = {}) {
  let keys = new Map()        // kid -> PEM (spki)
  let fetchedAt = 0
  let inflight = null

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      const res = await fetch(jwksUri, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`jkosAuth: JWKS fetch failed (${res.status})`)
      const body = await res.json()
      const next = new Map()
      for (const jwk of body.keys || []) {
        if (!jwk.kid) continue
        try {
          next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }))
        } catch { /* skip unparseable key */ }
      }
      if (next.size) { keys = next; fetchedAt = Date.now() }
    })().finally(() => { inflight = null })
    return inflight
  }

  return async function getKey(kid) {
    if (!kid) return null
    const stale = Date.now() - fetchedAt >= cacheMaxMs
    if (keys.has(kid) && !stale) return keys.get(kid)
    // (Re)fetch when the cache is empty, stale, or the kid is unknown — but rate-
    // limit refetches for unknown kids so bogus tokens don't trigger a flood.
    if (!keys.size || stale || Date.now() - fetchedAt >= minRefetchMs) {
      try { await refresh() } catch (err) { if (!keys.size) throw err }
    }
    return keys.get(kid) || null
  }
}

/**
 * Verify a jkos_token and return its decoded payload, or throw.
 * @param {string} token
 * @param {{ publicKey?: string, issuer?: string }} [opts]
 */
function verifyToken(token, opts = {}) {
  return jwt.verify(token, resolveKey(opts.publicKey), {
    algorithms: ['RS256'],
    issuer:     resolveIssuer(opts.issuer),
  })
}

/**
 * Express middleware factory. Sets req.user = decoded payload
 * ({ sub, email, name, role, iat, exp }); 401 + { error, code } on failure.
 * @param {{ publicKey?: string, jwksUri?: string, issuer?: string, cookieName?: string }} [opts]
 */
function jkosAuth(opts = {}) {
  const issuer = resolveIssuer(opts.issuer)
  const cookieName = resolveCookieName(opts.cookieName)
  const jwksUri = opts.jwksUri || process.env.JKOS_AUTH_JWKS_URI

  if (jwksUri) {
    const getKey = makeJwksResolver(jwksUri, opts.jwksOptions)
    return async function jkosAuthMiddleware(req, res, next) {
      const token = req.cookies?.[cookieName]
      if (!token) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
      try {
        const kid = jwt.decode(token, { complete: true })?.header?.kid
        const key = await getKey(kid)
        if (!key) return res.status(401).json({ error: 'Invalid token', code: 'UNAUTHENTICATED' })
        req.user = jwt.verify(token, key, { algorithms: ['RS256'], issuer })
        next()
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
        }
        res.status(401).json({ error: 'Invalid token', code: 'UNAUTHENTICATED' })
      }
    }
  }

  // Static-key path (unchanged) — synchronous verify against a single PEM.
  const key = resolveKey(opts.publicKey)
  return function jkosAuthMiddleware(req, res, next) {
    const token = req.cookies?.[cookieName]
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
    }
    try {
      req.user = jwt.verify(token, key, { algorithms: ['RS256'], issuer })
      next()
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
      }
      res.status(401).json({ error: 'Invalid token', code: 'UNAUTHENTICATED' })
    }
  }
}

module.exports = { jkosAuth, verifyToken }

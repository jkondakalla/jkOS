'use strict'
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { CODES, authError } = require('./codes')

// Canonical jkOS auth middleware. Verifies the jkos_token cookie (RS256 JWT)
// minted by jkAuth — OR an Authorization: Bearer token (service-to-service).
// Superset of every prior per-service copy:
//   - publicKey  from opts.publicKey  or env JKOS_AUTH_PUBLIC_KEY
//   - jwksUri    from opts.jwksUri    or env JKOS_AUTH_JWKS_URI — when set, the
//     verifying key is selected by the token's `kid` from the live JWKS (key
//     rotation, U3). Takes precedence over a static publicKey.
//   - issuer     from opts.issuer     or env JKOS_AUTH_ISSUER (default 'jkos-auth';
//     staging passes 'jkos-auth-staging')
//   - cookieName from opts.cookieName or 'jkos_token' + env JKOS_COOKIE_SUFFIX
//   - appId      from opts.appId      or env JKOS_APP_ID — when set, the token's
//     `aud` MUST include it (registry-derived audience enforcement). Opt-in so
//     rollout is safe: leave unset until aud-bearing tokens are flowing, then set
//     it to start rejecting tokens not minted for this app.
//
// req.user is the decoded payload: { sub, email, name, role, scope, azp, aud, ...}
// for a user token, or { sub:'svc:<id>', typ:'service', azp, scope, aud } for a
// service token (distinguish via req.user.typ === 'service').

function resolveKey(publicKey) {
  const key = (publicKey || process.env.JKOS_AUTH_PUBLIC_KEY || '').replace(/\\n/g, '\n')
  if (!key.trim()) throw new Error('jkosAuth: publicKey (or JKOS_AUTH_PUBLIC_KEY) is required')
  return key
}

// The default token issuer and the access-cookie base name — the two literals the
// whole suite must agree on. Producers (jkAuth) and verifiers (this middleware,
// jkos-deploy's python port) import these instead of re-typing 'jkos-auth' /
// 'jkos_token' independently; `pnpm test:contracts` asserts the python mirror matches.
const ISSUER_DEFAULT = 'jkos-auth'
const ACCESS_COOKIE_BASE = 'jkos_token'

function resolveIssuer(issuer) {
  return issuer || process.env.JKOS_AUTH_ISSUER || ISSUER_DEFAULT
}

// Apply the per-environment cookie suffix (prod '' / staging '_staging') to a base.
// One place owns "how an env-isolated cookie name is built"; callers pass the base
// (jkAuth also builds its own jkos_refresh name through this).
function cookieName(base) {
  return base + (process.env.JKOS_COOKIE_SUFFIX || '')
}

function resolveCookieName(override) {
  return override || cookieName(ACCESS_COOKIE_BASE)
}

function resolveAppId(appId) {
  return appId || process.env.JKOS_APP_ID || null
}

// Pull the bearer credential: the cookie (browser SSO) first, then an
// Authorization: Bearer header (service-to-service, no cookie).
function extractToken(req, cookieName) {
  const cookie = req.cookies?.[cookieName]
  if (cookie) return cookie
  const auth = req.headers?.authorization
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return null
}

// Verify options shared by both key paths; audience added only when appId is set.
function verifyOpts(issuer, appId) {
  const opts = { algorithms: ['RS256'], issuer }
  if (appId) opts.audience = appId
  return opts
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
 * @param {{ publicKey?: string, issuer?: string, appId?: string }} [opts]
 */
function verifyToken(token, opts = {}) {
  return jwt.verify(token, resolveKey(opts.publicKey), verifyOpts(resolveIssuer(opts.issuer), resolveAppId(opts.appId)))
}

/**
 * Express middleware factory. Sets req.user = decoded payload; 401 + { error,
 * code } on failure. Reads the cookie or an Authorization: Bearer token.
 * @param {{ publicKey?: string, jwksUri?: string, issuer?: string, cookieName?: string, appId?: string }} [opts]
 */
function jkosAuth(opts = {}) {
  const issuer = resolveIssuer(opts.issuer)
  const cookieName = resolveCookieName(opts.cookieName)
  const appId = resolveAppId(opts.appId)
  const jwksUri = opts.jwksUri || process.env.JKOS_AUTH_JWKS_URI

  const fail = (res, err) => {
    if (err?.name === 'TokenExpiredError') {
      return authError(res, 401, CODES.TOKEN_EXPIRED, 'Token expired')
    }
    authError(res, 401, CODES.UNAUTHENTICATED, 'Invalid token')
  }

  if (jwksUri) {
    const getKey = makeJwksResolver(jwksUri, opts.jwksOptions)
    return async function jkosAuthMiddleware(req, res, next) {
      const token = extractToken(req, cookieName)
      if (!token) return authError(res, 401, CODES.UNAUTHENTICATED, 'Not authenticated')
      try {
        const kid = jwt.decode(token, { complete: true })?.header?.kid
        const key = await getKey(kid)
        if (!key) return authError(res, 401, CODES.UNAUTHENTICATED, 'Invalid token')
        req.user = jwt.verify(token, key, verifyOpts(issuer, appId))
        next()
      } catch (err) {
        fail(res, err)
      }
    }
  }

  // Static-key path — synchronous verify against a single PEM.
  const key = resolveKey(opts.publicKey)
  return function jkosAuthMiddleware(req, res, next) {
    const token = extractToken(req, cookieName)
    if (!token) {
      return authError(res, 401, CODES.UNAUTHENTICATED, 'Not authenticated')
    }
    try {
      req.user = jwt.verify(token, key, verifyOpts(issuer, appId))
      next()
    } catch (err) {
      fail(res, err)
    }
  }
}

/**
 * Guard a route on named scopes. Use AFTER jkosAuth. Passes only when the token's
 * `scope` array contains every required scope (e.g. requireScope('beigeboard:write')).
 * @param {...string} required
 */
function requireScope(...required) {
  return function scopeGuard(req, res, next) {
    const have = new Set(Array.isArray(req.user?.scope) ? req.user.scope : [])
    if (required.every(s => have.has(s))) return next()
    authError(res, 403, CODES.INSUFFICIENT_SCOPE, 'Insufficient scope', { required })
  }
}

module.exports = {
  jkosAuth, verifyToken, requireScope, CODES, authError,
  resolveIssuer, resolveCookieName, cookieName, ISSUER_DEFAULT, ACCESS_COOKIE_BASE,
}

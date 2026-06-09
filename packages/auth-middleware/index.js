'use strict'
const jwt = require('jsonwebtoken')

// Canonical jkOS auth middleware. Verifies the jkos_token cookie (RS256 JWT)
// minted by jkAuth. Superset of every prior per-service copy:
//   - publicKey from opts.publicKey or env JKOS_AUTH_PUBLIC_KEY
//   - issuer    from opts.issuer    or env JKOS_AUTH_ISSUER (default 'jkos-auth';
//     staging passes 'jkos-auth-staging')

function resolveKey(publicKey) {
  const key = (publicKey || process.env.JKOS_AUTH_PUBLIC_KEY || '').replace(/\\n/g, '\n')
  if (!key.trim()) throw new Error('jkosAuth: publicKey (or JKOS_AUTH_PUBLIC_KEY) is required')
  return key
}

function resolveIssuer(issuer) {
  return issuer || process.env.JKOS_AUTH_ISSUER || 'jkos-auth'
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
 * ({ sub, email, name, avatar_url, role, iat, exp }); 401 + { error, code } on failure.
 * @param {{ publicKey?: string, issuer?: string }} [opts]
 */
function jkosAuth(opts = {}) {
  const key = resolveKey(opts.publicKey)
  const issuer = resolveIssuer(opts.issuer)
  return function jkosAuthMiddleware(req, res, next) {
    const token = req.cookies?.jkos_token
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

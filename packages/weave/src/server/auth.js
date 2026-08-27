'use strict'
// weave/server/auth.js — the identity gate, standardised.
//
// Every backend wrote the same ladder: prefer JWKS-by-kid, else a static public
// key, else (non-prod only) a dev stub user — plus a production fatal-guard that
// refuses to boot with no verifying key. That ladder + guard lives here once,
// wrapping @jkos/auth-middleware's jkosAuth. requireScope/verifyToken are
// re-exported so an app imports the whole fabric from one place.

const { jkosAuth, requireScope, verifyToken } = require('@jkos/auth-middleware')
const { applyDelegation } = require('./delegation')

// Wrap a verify middleware so that, on a successful verify, a delegated (on-behalf-of)
// service token is normalized to its effective acting user BEFORE the route or the
// write-gate runs (G1). Failure paths send their own response and never call next, so
// this only post-processes the success path.
function withDelegation(mw) {
  return function delegatingAuth(req, res, next) {
    mw(req, res, (err) => {
      if (!err && req.user) applyDelegation(req.user)
      next(err)
    })
  }
}

/**
 * Build the suite auth gate.
 * @param {{ publicKey?: string, jwksUri?: string, issuer?: string, appId?: string,
 *           cookieName?: string, devUser?: object }} [opts]
 *   publicKey/jwksUri/issuer/appId default to the JKOS_AUTH_* / JKOS_APP_ID env
 *   vars (see @jkos/auth-middleware). `appId` (or JKOS_APP_ID) turns on audience
 *   enforcement — set it once aud-bearing tokens flow suite-wide. `devUser` is the
 *   stub injected ONLY when no key is configured outside production.
 */
function weaveAuth(opts = {}) {
  const pk = (opts.publicKey ?? process.env.JKOS_AUTH_PUBLIC_KEY ?? '').trim()
  const jwksUri = opts.jwksUri ?? process.env.JKOS_AUTH_JWKS_URI
  const pass = { issuer: opts.issuer, appId: opts.appId, cookieName: opts.cookieName }

  // ⚠️ Audience enforcement is OPT-IN, and an opt-in containment that nobody
  // opted into is not a containment (C7 / JK-A14 / WV-3). jkAuth computes and
  // mints `aud` per role, and until 2026-08-27 no service verified it — while
  // ONE cookie is sent to every *.jkos.net host, so any app's token was spendable
  // at any other app. The compose files now set JKOS_APP_ID per service; this
  // refuses to start without it in production so the claim cannot quietly go
  // back to being decorative after a config edit.
  if (!(opts.appId ?? process.env.JKOS_APP_ID) && process.env.NODE_ENV === 'production') {
    console.error('[weave] FATAL: JKOS_APP_ID is not set in production, so the token audience is not verified. Refusing to start.')
    process.exit(1)
  }

  if (jwksUri) return withDelegation(jkosAuth({ jwksUri, ...pass }))
  if (pk) return withDelegation(jkosAuth({ publicKey: pk, ...pass }))

  // No verifying key. Never run open in production.
  if (process.env.NODE_ENV === 'production') {
    console.error('[weave] FATAL: neither JKOS_AUTH_PUBLIC_KEY nor JKOS_AUTH_JWKS_URI is set in production. Refusing to start.')
    process.exit(1)
  }
  const devUser = opts.devUser || { sub: 1, role: 'admin' }
  console.warn('[weave] DEV AUTH FALLBACK — no key configured; injecting a stub user. Never use in production.')
  return (req, _res, next) => { req.user = { ...devUser }; next() }
}

module.exports = { weaveAuth, requireScope, verifyToken }

'use strict'
const { CODES, authError } = require('@jkos/auth-middleware')
// weave/server/writeGate.js — the standard write authorization gate.
//
// Three checks, most-specific first, applied to POST/PATCH/DELETE (reads need no
// extra gate beyond a valid token — every row is already scoped to its owner):
//   1. Guests are read-only.
//   2. A service token carries no human user (sub is 'svc:<id>'), so a per-user
//      write would orphan rows — reject UNLESS it is a delegated (on-behalf-of)
//      token, which weaveAuth has already normalized to its acting user (G1): then
//      `req.user.sub` IS that user and the write is owned correctly.
//   3. Capability scope: a token that carries a `scope` array must hold the app's
//      write scope. Tokens minted before Weave carry no scope and fall through to
//      the role gate above (rollout-safe).
// Use AFTER weaveAuth.

/**
 * @param {{ scope?: string }} [opts] the app's write scope, e.g. 'beigeboard:write'.
 *   Omit to enforce only the guest/service gates.
 */
function weaveWriteGate({ scope } = {}) {
  const WRITE = ['POST', 'PATCH', 'DELETE']
  return function writeGate(req, res, next) {
    if (!WRITE.includes(req.method)) return next()
    const u = req.user
    // Fail closed: a write with no identity must never pass. weaveAuth normally
    // rejects before this, but if this gate is ever mounted without it (or on an
    // optional-auth path) an undefined user would otherwise slip every check below.
    if (!u) {
      return authError(res, 401, CODES.NO_AUTH, 'Authentication required')
    }
    if (u?.role === 'guest') {
      return authError(res, 403, CODES.READ_ONLY, 'Guest access is read-only')
    }
    if (u?.typ === 'service' && !u.delegated) {
      return authError(res, 403, CODES.NO_USER_CONTEXT, 'Service tokens cannot write per-user data')
    }
    // Capability scope, at the finest grain the token expresses (C4 / WV-4).
    //
    // `<app>:write` used to be the only write grant, so a caller that needed to
    // CREATE one row had to be handed the right to DELETE every row — nothing
    // could ask for less. The method now maps to a verb, and EITHER the specific
    // verb OR the legacy blanket `write` satisfies the gate. That ordering is
    // what makes this backward compatible: every token minted before the ladder
    // existed carries `write` and keeps working, while a service client can now
    // be configured with `beigeboard:create` alone and be held to exactly that.
    if (scope && Array.isArray(u?.scope)) {
      const [app] = String(scope).split(':')
      const verb = { POST: 'create', PATCH: 'update', DELETE: 'delete' }[req.method]
      const specific = verb ? `${app}:${verb}` : null
      const held = u.scope.includes(scope) || (specific && u.scope.includes(specific))
      if (!held) {
        return authError(res, 403, CODES.INSUFFICIENT_SCOPE, 'Insufficient scope',
          { required: specific ? [scope, specific] : [scope] })
      }
    }
    next()
  }
}

module.exports = { weaveWriteGate }

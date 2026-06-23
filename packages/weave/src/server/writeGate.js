'use strict'
// weave/server/writeGate.js — the standard write authorization gate.
//
// Three checks, most-specific first, applied to POST/PATCH/DELETE (reads need no
// extra gate beyond a valid token — every row is already scoped to its owner):
//   1. Guests are read-only.
//   2. A service token carries no human user (sub is 'svc:<id>'), so a per-user
//      write would orphan rows — reject until an explicit on-behalf-of mechanism
//      exists (see WEAVE.md, the delegation seam).
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
      return res.status(401).json({ error: 'Authentication required', code: 'NO_AUTH' })
    }
    if (u?.role === 'guest') {
      return res.status(403).json({ error: 'Guest access is read-only', code: 'READ_ONLY' })
    }
    if (u?.typ === 'service') {
      return res.status(403).json({ error: 'Service tokens cannot write per-user data', code: 'NO_USER_CONTEXT' })
    }
    if (scope && Array.isArray(u?.scope) && !u.scope.includes(scope)) {
      return res.status(403).json({ error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPE', required: [scope] })
    }
    next()
  }
}

module.exports = { weaveWriteGate }

'use strict'
// weave/server/delegation.js — resolve a delegated (on-behalf-of) service token to
// its EFFECTIVE acting user (G1).
//
// A trusted automation backend (the trigger engine) mints a service token carrying an
// `act` claim — the user it is acting for (jkAuth only issues this to a delegation-
// enrolled client; see apps/jkauth signService + the /auth/token gate). The token
// stays typ 'service' so it can never be mistaken for a real login, but every backend
// route already keys per-user data on `req.user.sub`. So we normalize ONCE, right after
// identity is verified: a delegated service token's effective subject BECOMES the acting
// user, with the original svc identity preserved for audit. Every existing route then
// writes to the acting user's rows transparently — no per-route change.
//
// Safety: this fires ONLY for typ:'service' tokens that carry `act`. A user token never
// carries `act` (jkAuth doesn't sign it), and the claim is inside the RS256 signature,
// so it is unforgeable — the trust chain is the client_secret + jkAuth's delegation
// allow-list, nothing here. The write-gate still enforces the token's capability scope.

/**
 * If `user` is a delegated service token, rewrite its effective subject to the acting
 * user. Idempotent; a no-op for user tokens and non-delegated service tokens.
 * @param {{ typ?: string, sub?: string, act?: string, delegated?: boolean }} user
 * @returns the same user object (mutated)
 */
function applyDelegation(user) {
  if (user && user.typ === 'service' && user.act != null && !user.delegated) {
    user.svc = user.sub         // keep the svc:<id> identity for audit
    user.sub = String(user.act) // the effective owner of any per-user write
    user.delegated = true
  }
  return user
}

module.exports = { applyDelegation }

'use strict'
// codes.js — the suite's canonical error-code vocabulary + envelope helper.
//
// One source of truth for the machine-readable `code` every jkOS auth response
// carries, so the PRODUCERS (this middleware, weave's write gate, jkAuth's routes,
// jkos-deploy's python verifier) and the CONSUMER (auth-client's authFetch, which
// branches on it to decide refresh-vs-surface) can't silently drift the way the
// numeric-`sub` contract did. Rename a code here and every importer moves together;
// jkos-deploy mirrors this in jkos_auth.py and `pnpm test:contracts` asserts the
// two stay key-for-key equal, so a code changed on one side fails the build.
//
// Dependency-free (no node-only imports) so the frontend can import the subpath
// `@jkos/auth-middleware/codes` without dragging jsonwebtoken into the bundle.

const CODES = Object.freeze({
  // Identity / verification — emitted by the verifier, read by every client.
  // authFetch refreshes-then-retries on exactly these two; everything else it
  // surfaces to the caller unchanged.
  UNAUTHENTICATED: 'UNAUTHENTICATED',   // no token / invalid token (refreshable)
  TOKEN_EXPIRED:   'TOKEN_EXPIRED',     // access token past exp (refreshable)
  // Authorization — authenticated, but not allowed.
  FORBIDDEN:          'FORBIDDEN',           // role/owner check failed
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',  // token lacks a required capability scope
  // Write gate (weave serverClient) — the standard POST/PATCH/DELETE refusals.
  NO_AUTH:         'NO_AUTH',           // a write with no identity at all
  READ_ONLY:       'READ_ONLY',         // guest write
  NO_USER_CONTEXT: 'NO_USER_CONTEXT',   // service token can't write per-user data
  // Session / refresh lifecycle — POST /auth/refresh; every auth-client hits it.
  SESSION_EXPIRED: 'SESSION_EXPIRED',   // refresh token expired → re-login
  SESSION_REVOKED: 'SESSION_REVOKED',   // refresh reuse burned the session family
})

/**
 * Send a JSON error in the suite's standard `{ error, code }` envelope.
 * @param {object} res     Express response
 * @param {number} status  HTTP status
 * @param {string} code    one of CODES
 * @param {string} error   human-readable message
 * @param {object} [extra] extra fields merged into the body (e.g. { required })
 */
function authError(res, status, code, error, extra) {
  return res.status(status).json({ error, code, ...(extra || {}) })
}

module.exports = { CODES, authError }

'use strict';
// Auth middleware surface: the jkos SSO identity gate, the optional-auth wrapper the
// OAuth callbacks use, and the public-path allowlist. app.js applies the gate
// globally; routes/calendar.js reuses authMiddleware + optionalAuth on its callbacks.
const { weaveAuth } = require('@jkos/weave/server');
const { JKOS_AUTH_PUBLIC_KEY, JKOS_AUTH_JWKS_URI, JKOS_AUTH_ISSUER } = require('./config');

/* These API paths are reachable without a valid jkos_token cookie */
const PUBLIC_PATHS = [
  '/api/auth/google',            // initiates Google Calendar OAuth
  '/api/auth/outlook',           // initiates Outlook Calendar OAuth
  // The OAuth popup callbacks are public so a popup that arrived WITHOUT the
  // jkos_token cookie (third-party-cookie stripping, an expired session) reaches
  // its handler and gets the postMessage error contract instead of a bare 401 body
  // rendered as the popup's whole page (BUG-6.2). They still re-run auth optionally
  // (optionalAuth below) to attach the calendar to the signed-in user, and the
  // bb_oauth_state CSRF cookie still guards the flow.
  '/api/auth/google/callback',
  '/api/auth/outlook/callback',
  '/api/capabilities',    // Weave capability declaration — public, no secrets
  '/api/datasets',        // Weave dataset declaration — public, no secrets
];

/* Identity gate: JWKS-by-kid → static key → dev stub, with the production
   fatal-guard, all standardised in @jkos/weave/server (weaveAuth). */
const authMiddleware = weaveAuth({
  publicKey: JKOS_AUTH_PUBLIC_KEY,
  jwksUri: JKOS_AUTH_JWKS_URI,
  issuer: JKOS_AUTH_ISSUER,
});

/* Run an auth middleware WITHOUT failing closed: a valid token sets req.user and we
   continue; on the middleware's 401 we swallow the response and continue anyway
   (req.user stays undefined) so the route can render its OWN error contract. Used on
   the OAuth callbacks (BUG-6.2) — a cookie-less popup must still reach the handler to
   postMessage a friendly "session expired" to its opener, not show a raw 401 page.
   The middleware is driven with a sink response: whether it succeeds (calls our next)
   or fails (writes a 401 into the sink), we advance exactly once. */
function optionalAuth(mw) {
  return (req, res, next) => {
    let advanced = false;
    const go = () => { if (!advanced) { advanced = true; next(); } };
    const sink = {
      status() { return sink; }, set() { return sink; }, setHeader() { return sink; },
      json() { go(); return sink; }, send() { go(); return sink; }, end() { go(); return sink; },
    };
    try { mw(req, sink, go); } catch { go(); }
  };
}

module.exports = { PUBLIC_PATHS, authMiddleware, optionalAuth };

'use strict'
// Native sign-in — how an installed app (KourOS Alpha) gets a Bearer token without ever
// seeing a password or holding a cookie. OAuth 2.0 for native apps (RFC 8252): the
// authorization-code grant with PKCE (RFC 7636), in a Custom Tab, back to a private-use URI
// scheme that only the app can register.
//
//   GET  /auth/native/authorize   response_type=code, client_id, redirect_uri,
//                                 code_challenge, code_challenge_method=S256, state
//        → the sign-in page if needed → a consent page → 302 redirect_uri?code&state
//   POST /auth/native/authorize   the consent page's Allow / Cancel
//   POST /auth/native/token       grant_type=authorization_code {code, code_verifier, client_id, redirect_uri}
//                                 grant_type=refresh_token      {refresh_token, client_id}
//        → { access_token, token_type, expires_in, refresh_token, user }
//   POST /auth/native/revoke      { client_id, token } — signs the app out (RFC 7009: always 200)
//
// WHAT HOLDS IT:
//   · The client list is GENERATED (native-clients.json, from native/shells.js) and filtered
//     to this jkAuth's own environment (JKOS_NATIVE_ENV). An unknown client or a redirect URI
//     that is not byte-equal to the registered one gets a dead-end page — never a redirect,
//     because an unvalidated redirect is exactly where a stolen code would be sent.
//   · The code is 256 random bits, stored only as a sha256, valid NATIVE_CODE_TTL_MS, single
//     use (migration 024's trigger), and bound to the client, the redirect URI and the PKCE
//     challenge. Redeeming it needs the verifier, which never left the app. A code presented
//     a second time burns the session its first redemption minted.
//   · The session it mints is TRANSPORT-BOUND: sessions.client_id says the refresh token
//     travels in a JSON body for this client and nowhere else (tokens.js, migration 024).
//     Refresh tokens rotate with the browser's reuse detection and absolute cap unchanged.
//   · The access token is the suite's ordinary user token (signAccess), so every backend's
//     existing verification applies: KourOS reads it from `Authorization: Bearer`.
//   · Every step is an auth_events row: native_consent, native_consent_denied, native_code,
//     native_token, native_code_reuse, native_revoke.

const express = require('express')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const {
  AUTH_ORIGIN, PRIVATE_KEY, PUBLIC_KEY, JWT_ISSUER, JWT_KID, ACCESS_TTL_MS,
  NATIVE_ENV, NATIVE_CODE_TTL_MS, NATIVE_CONSENT_TTL_MS,
} = require('../config')
const { db, get, run, logEvent } = require('../db')
const {
  sha256, signAccess, resolveOrRefresh, publicUser, rotateNative, issueNativeSession,
} = require('../tokens')
const { nativeConsentPage, nativeErrorPage } = require('../views')
const NATIVE_CLIENTS = require('../native-clients.json')

const router = express.Router()

/** This jkAuth's native clients, by client id. Empty when native sign-in is off. */
const CLIENTS = new Map(NATIVE_ENV
  ? NATIVE_CLIENTS.clients.filter((c) => c.env === NATIVE_ENV).map((c) => [c.client_id, c])
  : [])

// RFC 7636 §4.1–4.2: a verifier is 43–128 unreserved characters; an S256 challenge is the
// base64url of a sha256, so exactly 43. `state` is the app's own CSRF token, echoed back.
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
const STATE_RE = /^[A-Za-z0-9\-._~]{8,256}$/
const CODE_RE = /^[A-Za-z0-9_-]{43}$/

const nowIso = () => new Date().toISOString()
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const s256 = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest())

function timingSafeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** The client a request names, but only when its redirect URI is the registered one. */
function clientFor(clientId, redirectUri) {
  const c = typeof clientId === 'string' ? CLIENTS.get(clientId) : null
  return c && redirectUri === c.redirect_uri ? c : null
}

/** `redirect_uri` with query parameters appended. The registered URIs carry no query. */
function back(client, params) {
  return `${client.redirect_uri}?${new URLSearchParams(params).toString()}`
}

// Off unless this jkAuth was told which environment's apps it signs in (config.js).
router.use('/auth/native', (req, res, next) => {
  if (!NATIVE_ENV) return res.status(404).json({ error: 'Native sign-in is not enabled' })
  next()
})

// The consent ticket: a signed, short-lived binding of EVERYTHING the Allow button commits
// to. The form carries nothing else, so no hidden field can be edited to send a code
// somewhere else, for someone else, or under another challenge. Its own audience keeps it
// from ever passing as an access token (and an access token from passing as it).
const CONSENT_AUD = 'auth:native-consent'
function signConsent(userId, client, challenge, state) {
  return jwt.sign(
    { sub: String(userId), cid: client.client_id, ruri: client.redirect_uri, cc: challenge, st: state },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: NATIVE_CONSENT_TTL_MS / 1000, issuer: JWT_ISSUER, keyid: JWT_KID, audience: CONSENT_AUD })
}
function verifyConsent(token) {
  try {
    return jwt.verify(String(token || ''), PUBLIC_KEY, { algorithms: ['RS256'], issuer: JWT_ISSUER, audience: CONSENT_AUD })
  } catch {
    return null
  }
}

/**
 * The consent page's own CSP: the global one plus the app's scheme in `form-action`.
 * ⚠️ Chrome (and so a Custom Tab) enforces form-action on the REDIRECT a form submission
 * answers with, not only on the form's action. Under the global `form-action 'self'` the
 * Allow button's 302 to `net.jkos.kouros.alpha:/oauth2redirect?code=…` is blocked, and the
 * app waits forever for a code that was minted and never delivered.
 */
function allowSchemeInFormAction(res, client) {
  const scheme = client.redirect_uri.slice(0, client.redirect_uri.indexOf(':'))
  const csp = String(res.getHeader('Content-Security-Policy') || '')
  res.setHeader('Content-Security-Policy', csp.replace("form-action 'self'", `form-action 'self' ${scheme}:`))
}

// GET /auth/native/authorize — the Custom Tab lands here.
router.get('/auth/native/authorize', (req, res) => {
  const q = req.query
  const client = clientFor(q.client_id, q.redirect_uri)
  if (!client) {
    logEvent('native_authorize_refused', null, req, { client_id: String(q.client_id || '').slice(0, 100), why: 'client' })
    return res.status(400).send(nativeErrorPage('This app is not registered with this jkOS sign-in, or it asked to return somewhere it may not.'))
  }
  if (q.response_type !== 'code' || q.code_challenge_method !== 'S256'
      || !CHALLENGE_RE.test(String(q.code_challenge || '')) || !STATE_RE.test(String(q.state || ''))) {
    logEvent('native_authorize_refused', null, req, { client_id: client.client_id, why: 'params' })
    return res.status(400).send(nativeErrorPage('The app sent an incomplete sign-in request (it must use PKCE with S256).'))
  }

  const jwtUser = resolveOrRefresh(req, res)
  if (!jwtUser) {
    // Sign in first, then come straight back to this exact request. AUTH_ORIGIN is on
    // validateRedirectTo's allow-list, so the login (and its 2FA step) returns here.
    return res.redirect('/auth/login?redirect_to=' + encodeURIComponent(AUTH_ORIGIN + req.originalUrl))
  }
  const user = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!user) return res.redirect('/auth/login?redirect_to=' + encodeURIComponent(AUTH_ORIGIN + req.originalUrl))

  logEvent('native_consent', user.id, req, { client_id: client.client_id })
  allowSchemeInFormAction(res, client)
  res.send(nativeConsentPage({
    appName: client.name, user, environment: NATIVE_ENV,
    consent: signConsent(user.id, client, q.code_challenge, q.state),
  }))
})

// POST /auth/native/authorize — Allow or Cancel. A cross-site POST carries no session cookie
// (SameSite=lax), and the ticket must name the person signed in NOW, so this can only be
// the signed-in person pressing the button jkAuth rendered for them.
router.post('/auth/native/authorize', (req, res) => {
  const ticket = verifyConsent(req.body?.consent)
  const client = ticket && clientFor(ticket.cid, ticket.ruri)
  if (!ticket || !client) {
    return res.status(400).send(nativeErrorPage('This sign-in page expired. Start again from the app.'))
  }
  const jwtUser = resolveOrRefresh(req, res)
  if (!jwtUser || String(jwtUser.sub) !== ticket.sub) {
    return res.status(400).send(nativeErrorPage('You are no longer signed in as the account this page was for. Start again from the app.'))
  }
  const userId = Number(ticket.sub)
  allowSchemeInFormAction(res, client)

  if (req.body?.decision !== 'allow') {
    logEvent('native_consent_denied', userId, req, { client_id: client.client_id })
    return res.redirect(back(client, { error: 'access_denied', state: ticket.st }))
  }

  const code = b64url(crypto.randomBytes(32))
  run(`INSERT INTO native_auth_codes (code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at)
       VALUES (?,?,?,?,?,?)`,
    [sha256(code), userId, client.client_id, client.redirect_uri, ticket.cc,
      new Date(Date.now() + NATIVE_CODE_TTL_MS).toISOString()])
  logEvent('native_code', userId, req, { client_id: client.client_id })
  res.redirect(back(client, { code, state: ticket.st }))
})

/** The token response — the one shape both grants answer with. */
function tokenResponse(user, client, refresh) {
  return {
    access_token: signAccess(user, { azp: client.app }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    user: publicUser(user),
  }
}
const invalidGrant = (res, why) => res.status(400).json({ error: 'invalid_grant', error_description: why })

// Claim a code: exactly one caller flips used_at, and only while it is unexpired. Done
// BEFORE the client/redirect/PKCE checks, so a code that is presented wrongly is spent too:
// whoever intercepted it gets one try, and it is the app's try they used up.
const claimCode = db.transaction((hash, now) => {
  const row = get('SELECT * FROM native_auth_codes WHERE code_hash=?', [hash])
  if (!row) return { row: null }
  const claim = run('UPDATE native_auth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at > ?',
    [now, hash, now])
  return { row, claimed: claim.changes === 1 }
})

// POST /auth/native/token
router.post('/auth/native/token', (req, res) => {
  const b = req.body || {}
  const client = typeof b.client_id === 'string' ? CLIENTS.get(b.client_id) : null
  if (!client) return res.status(401).json({ error: 'invalid_client' })

  if (b.grant_type === 'authorization_code') {
    if (!CODE_RE.test(String(b.code || '')) || !VERIFIER_RE.test(String(b.code_verifier || ''))) {
      return invalidGrant(res, 'code and code_verifier are required')
    }
    const hash = sha256(b.code)
    const { row, claimed } = claimCode(hash, nowIso())
    if (!row) return invalidGrant(res, 'unknown code')
    if (!claimed) {
      // Expired, or presented twice. Twice means a copy exists: burn whatever the first
      // redemption minted (RFC 6749 §4.1.2) — the tombstone is the evidence.
      if (row.used_at && row.family_id) {
        run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE family_id=? AND revoked_at IS NULL',
          [nowIso(), 'code_reuse', row.family_id])
        logEvent('native_code_reuse', row.user_id, req, { client_id: client.client_id, family: row.family_id })
      }
      return invalidGrant(res, 'code expired or already used')
    }
    if (row.client_id !== client.client_id || row.redirect_uri !== b.redirect_uri
        || !timingSafeEq(s256(b.code_verifier), row.code_challenge)) {
      logEvent('native_token_refused', row.user_id, req, { client_id: client.client_id })
      return invalidGrant(res, 'code does not match this client, redirect or verifier')
    }
    const user = get('SELECT * FROM users WHERE id=?', [row.user_id])
    if (!user) return invalidGrant(res, 'account no longer exists')
    const { refresh, family } = issueNativeSession(user, client.client_id)
    run('UPDATE native_auth_codes SET family_id=? WHERE code_hash=?', [family, hash])
    logEvent('native_token', user.id, req, { client_id: client.client_id, family })
    return res.json(tokenResponse(user, client, refresh))
  }

  if (b.grant_type === 'refresh_token') {
    const r = rotateNative(req, b.refresh_token, client.client_id)
    if (r.status === 'ok') return res.json(tokenResponse(r.user, client, r.refresh))
    if (r.status === 'race') {
      return res.status(409).json({ error: 'refresh_race', code: 'REFRESH_RACE',
        error_description: 'this refresh token was rotated moments ago; refreshes must be serialised' })
    }
    return invalidGrant(res, r.status === 'reuse' ? 'refresh token reused — this sign-in was revoked' : 'refresh token expired or revoked')
  }

  res.status(400).json({ error: 'unsupported_grant_type' })
})

// POST /auth/native/revoke — the app's "Sign out". Revokes the whole session family, as a
// browser logout does. Always 200 (RFC 7009 §2.2): an unknown token is already signed out,
// and a different answer would tell a caller which tokens exist.
router.post('/auth/native/revoke', (req, res) => {
  const b = req.body || {}
  const client = typeof b.client_id === 'string' ? CLIENTS.get(b.client_id) : null
  if (!client) return res.status(401).json({ error: 'invalid_client' })
  if (b.token) {
    const session = get('SELECT * FROM sessions WHERE token_hash=? AND client_id=?', [sha256(String(b.token)), client.client_id])
    if (session?.family_id) {
      run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE family_id=? AND revoked_at IS NULL',
        [nowIso(), 'logout', session.family_id])
      logEvent('native_revoke', session.user_id, req, { client_id: client.client_id, family: session.family_id })
    }
  }
  res.json({ ok: true })
})

module.exports = router

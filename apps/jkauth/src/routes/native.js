'use strict'
// Native app sign-in — OAuth 2.0 for Native Apps (RFC 8252) with PKCE (RFC 7636), S256 only.
//
//   GET  /auth/native/authorize   the app opens this in the system browser (a Custom Tab).
//                                 Signed out → the ordinary login page, then back here.
//                                 Signed in  → a one-button consent page.
//   POST /auth/native/authorize   the consent form → 302 to the app's redirect URI with a
//                                 one-minute, one-use authorization code.
//   POST /auth/native/token       grant_type=authorization_code (code + code_verifier) or
//                                 grant_type=refresh_token → tokens in a JSON body.
//   POST /auth/native/revoke      sign this device out (RFC 7009: always 200).
//
// WHY THE BROWSER, NOT A PASSWORD FORM IN THE APP: the app never sees the password, 2FA and
// the per-account backoff work unchanged, and a person already signed in on the phone's
// browser signs in with one tap. The app gets a device session — the same rows, families,
// rotation and reuse detection as a browser (tokens.js, "the native transport"), listed and
// revocable under Your devices.
//
// The clients are GENERATED (native/shells.js → native-clients.json → config.NATIVE_CLIENTS):
// a client id is an Android package, and each may use exactly one redirect URI.

const express = require('express')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const {
  AUTH_ORIGIN, PRIVATE_KEY, PUBLIC_KEY, JWT_ISSUER, JWT_KID,
  NATIVE_CLIENTS, NATIVE_CODE_TTL_MS, NATIVE_CONSENT_TTL_MS,
} = require('../config')
const { get, run, logEvent, roleClaims } = require('../db')
const { sha256, resolveOrRefresh, issueNativeTokens, rotateNative, revokeNative } = require('../tokens')
const { nativeConsentPage, nativeErrorPage } = require('../views')

const router = express.Router()

const S256 = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url')
// RFC 7636 §4.1: 43–128 unreserved characters. A challenge is S256 of one: 43 base64url.
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
const STATE_MAX = 512

/** The client and its redirect URI, or null. The URI must be the client's own, exactly. */
function clientFor(clientId, redirectUri) {
  const client = NATIVE_CLIENTS.get(String(clientId || ''))
  return client && client.redirect_uri === redirectUri ? client : null
}

/** May this person use the client's app at all? The same answer their token's `aud` gives. */
const mayUse = (role, client) => roleClaims(role).aud.includes(client.app)

/** Back to the app with `params` on its redirect URI (code+state, or error+state). */
function toApp(res, client, params) {
  const u = new URL(client.redirect_uri)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v)
  res.redirect(302, u.toString())
}

// The consent form carries the request it answers as a short-lived signed token, so the POST
// cannot be pointed at a different client, redirect URI, challenge or person than the page
// showed. `typ` keeps it from ever passing for an access token (no `aud`, no `role` either).
function signConsent(p) {
  return jwt.sign({ typ: 'native_consent', ...p }, PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: Math.floor(NATIVE_CONSENT_TTL_MS / 1000), issuer: JWT_ISSUER, keyid: JWT_KID })
}
function verifyConsent(token) {
  try {
    const p = jwt.verify(String(token || ''), PUBLIC_KEY, { algorithms: ['RS256'], issuer: JWT_ISSUER })
    return p.typ === 'native_consent' ? p : null
  } catch { return null }
}

// GET /auth/native/authorize
router.get('/auth/native/authorize', (req, res) => {
  const q = req.query
  const client = clientFor(q.client_id, q.redirect_uri)
  // Until the client and its redirect URI are known-good, nothing may redirect to it.
  if (!client) {
    logEvent('native_authorize_refused', null, req, { client_id: String(q.client_id || '').slice(0, 200) })
    return res.status(400).send(nativeErrorPage('This app is not registered to sign in with jkOS.'))
  }
  const state = String(q.state || '')
  if (q.response_type !== 'code' || q.code_challenge_method !== 'S256'
      || !CHALLENGE_RE.test(String(q.code_challenge || '')) || !state || state.length > STATE_MAX) {
    return toApp(res, client, { error: 'invalid_request', state: state.slice(0, STATE_MAX) })
  }

  const user = resolveOrRefresh(req, res)
  if (!user) {
    // Through the ordinary sign-in (password, 2FA, backoff — all unchanged), then back here.
    const back = AUTH_ORIGIN + req.originalUrl
    return res.redirect('/auth/login?redirect_to=' + encodeURIComponent(back))
  }
  const u = get('SELECT * FROM users WHERE id=?', [user.sub])
  if (!u) return res.redirect('/auth/login')
  if (!mayUse(u.role, client)) {
    logEvent('native_authorize_denied', u.id, req, { client_id: client.client_id, reason: 'role' })
    return toApp(res, client, { error: 'access_denied', state })
  }
  const consent = signConsent({
    sub: String(u.id), client_id: client.client_id, redirect_uri: client.redirect_uri,
    code_challenge: q.code_challenge, state,
  })
  res.send(nativeConsentPage({ client, user: u, consent }))
})

// POST /auth/native/authorize — the consent form.
router.post('/auth/native/authorize', (req, res) => {
  const c = verifyConsent(req.body?.consent)
  if (!c) return res.status(400).send(nativeErrorPage('This sign-in request has expired. Start again from the app.'))
  const client = clientFor(c.client_id, c.redirect_uri)
  if (!client) return res.status(400).send(nativeErrorPage('This app is no longer registered to sign in with jkOS.'))

  // The person answering must be the person the page was rendered for, still signed in in
  // THIS browser. The session cookie is SameSite=Lax, so a cross-site form post arrives
  // without it and stops here.
  const user = resolveOrRefresh(req, res)
  if (!user || String(user.sub) !== c.sub) {
    return res.status(403).send(nativeErrorPage('You are no longer signed in as the person this request was for.'))
  }
  if (req.body?.decision !== 'allow') {
    logEvent('native_authorize_denied', c.sub, req, { client_id: client.client_id, reason: 'user' })
    return toApp(res, client, { error: 'access_denied', state: c.state })
  }

  const code = crypto.randomBytes(32).toString('base64url')
  run(`INSERT INTO native_auth_codes (code_hash, client_id, redirect_uri, code_challenge, user_id, expires_at)
       VALUES (?,?,?,?,?,?)`,
    [sha256(code), client.client_id, client.redirect_uri, c.code_challenge, c.sub,
      new Date(Date.now() + NATIVE_CODE_TTL_MS).toISOString()])
  // Spent and expired codes are evidence for a day, then go.
  run('DELETE FROM native_auth_codes WHERE expires_at < ?', [new Date(Date.now() - 86400000).toISOString()])
  logEvent('native_authorize', c.sub, req, { client_id: client.client_id })
  toApp(res, client, { code, state: c.state })
})

// POST /auth/native/token — RFC 6749 §5 error shapes ({ error }), never a page.
router.post('/auth/native/token', (req, res) => {
  res.set('Cache-Control', 'no-store')
  const b = req.body || {}
  const client = NATIVE_CLIENTS.get(String(b.client_id || ''))
  if (!client) return res.status(401).json({ error: 'invalid_client' })

  if (b.grant_type === 'authorization_code') {
    if (b.redirect_uri !== client.redirect_uri) return res.status(400).json({ error: 'invalid_grant' })
    const verifier = String(b.code_verifier || '')
    if (!VERIFIER_RE.test(verifier)) return res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier' })
    const hash = sha256(String(b.code || ''))
    const now = new Date().toISOString()

    // Spend the code FIRST, whatever happens next: a wrong verifier burns it too, so a code
    // stolen off the redirect gets one guess, not a minute of them.
    const spent = run('UPDATE native_auth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at > ?',
      [now, hash, now])
    const row = get('SELECT * FROM native_auth_codes WHERE code_hash=?', [hash])
    if (spent.changes !== 1) {
      // A code presented twice: revoke what the first exchange issued (RFC 6749 §4.1.2).
      if (row?.used_at && row.family_id) {
        run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE family_id=? AND revoked_at IS NULL',
          [now, 'code_replay', row.family_id])
        logEvent('native_code_replay', row.user_id, req, { client_id: client.client_id, family: row.family_id })
      }
      return res.status(400).json({ error: 'invalid_grant' })
    }
    const challengeOk = (() => {
      const a = Buffer.from(S256(verifier)), e = Buffer.from(row.code_challenge)
      return a.length === e.length && crypto.timingSafeEqual(a, e)
    })()
    if (row.client_id !== client.client_id || row.redirect_uri !== client.redirect_uri || !challengeOk) {
      logEvent('native_token_denied', row.user_id, req, { client_id: client.client_id, reason: challengeOk ? 'client' : 'pkce' })
      return res.status(400).json({ error: 'invalid_grant' })
    }
    const user = get('SELECT * FROM users WHERE id=?', [row.user_id])
    if (!user || !mayUse(user.role, client)) return res.status(400).json({ error: 'invalid_grant' })

    const { body, family } = issueNativeTokens(user, client)
    run('UPDATE native_auth_codes SET family_id=? WHERE code_hash=?', [family, hash])
    logEvent('native_login', user.id, req, { client_id: client.client_id, family })
    return res.json(body)
  }

  if (b.grant_type === 'refresh_token') {
    const r = rotateNative(req, String(b.refresh_token || ''), client)
    if (r.status === 'ok') {
      if (!mayUse(r.user.role, client)) return res.status(400).json({ error: 'invalid_grant', code: 'ACCESS_REVOKED' })
      return res.json(r.body)
    }
    // A concurrent second refresh of the same token: not theft, but nothing to hand back —
    // the winner holds the successor. The app serialises refreshes, so this is a bug signal.
    if (r.status === 'race') return res.status(409).json({ error: 'invalid_grant', code: 'REFRESH_RACE' })
    if (r.status === 'reuse') return res.status(400).json({ error: 'invalid_grant', code: 'SESSION_REVOKED' })
    return res.status(400).json({ error: 'invalid_grant', code: 'SESSION_EXPIRED' })
  }

  res.status(400).json({ error: 'unsupported_grant_type' })
})

// POST /auth/native/revoke — the app's "Sign out". RFC 7009 §2.2: 200 whether or not the
// token was known, so the endpoint can't be used to test tokens.
router.post('/auth/native/revoke', (req, res) => {
  const client = NATIVE_CLIENTS.get(String(req.body?.client_id || ''))
  if (!client) return res.status(401).json({ error: 'invalid_client' })
  const userId = revokeNative(String(req.body?.token || req.body?.refresh_token || ''), client)
  if (userId) logEvent('logout', userId, req, { client_id: client.client_id })
  res.json({ ok: true })
})

module.exports = router

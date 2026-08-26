'use strict'
// Page + credential routes: the portal/login/register pages and the
// login / register / logout / guest POST handlers.

const express = require('express')
const crypto = require('crypto')
const { CODES } = require('@jkos/auth-middleware')   // canonical wire codes (single source)
const { GUEST_PASSWORD, PASSWORD_MAX, REFRESH_COOKIE, SERVICE_CLIENTS, DELEGATION_CLIENTS } = require('../config')
const { get, run, logEvent } = require('../db')
const { isJsonReq, validateRedirectTo, passwordError, loginBackoffMs } = require('../util')
const { loginPage, dashboardPage, twoFactorPage } = require('../views')
const {
  DUMMY_HASH, sha256, issueTokens, clearTokens, tryRotate, resolveOrRefresh, publicUser,
  signPending, verifyPending, signService,
} = require('../tokens')
const { HASH_ALGO, hashPassword, verifyPassword, needsRehash } = require('../password')
const {
  twoFactorEnabled, enabledMethods, sendEmailOtp, verifySecondFactor,
} = require('../twofactor')

const router = express.Router()

// GET / → portal when signed in (direct navigation), else login
router.get('/', (req, res) => {
  const user = resolveOrRefresh(req, res)
  res.redirect(user ? '/auth/dashboard' : '/auth/login')
})

// GET /auth/dashboard — the jkOS portal
router.get('/auth/dashboard', (req, res) => {
  const jwtUser = resolveOrRefresh(req, res)
  if (!jwtUser) return res.redirect('/auth/login')
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) { clearTokens(res); return res.redirect('/auth/login') }
  res.send(dashboardPage(u, res.locals.cspNonce))
})

// GET /auth/login — login page (HTML)
router.get('/auth/login', (req, res) => {
  const user = resolveOrRefresh(req, res)
  if (user) {
    // App-initiated login returns to the app; direct visits land on the portal.
    const dest = validateRedirectTo(req.query.redirect_to)
    return res.redirect(dest || '/auth/dashboard')
  }
  res.send(loginPage({ redirectTo: req.query.redirect_to }))
})

// GET /auth/register — register page (HTML)
router.get('/auth/register', (req, res) => {
  const user = resolveOrRefresh(req, res)
  if (user) return res.redirect('/auth/dashboard')
  res.send(loginPage({ redirectTo: req.query.redirect_to, mode: 'register' }))
})

// POST /auth/register (form + JSON)
router.post('/auth/register', async (req, res) => {
  const isJson = isJsonReq(req)
  const { email, name, password, redirect_to } = req.body
  const normalEmail = (email || '').toLowerCase()
  if (!normalEmail || !password) {
    if (isJson) return res.status(400).json({ error: 'Email and password required' })
    return res.send(loginPage({ error: 'Email and password required', redirectTo: redirect_to, mode: 'register' }))
  }
  const pwErr = passwordError(password)
  if (pwErr) {
    if (isJson) return res.status(400).json({ error: pwErr })
    return res.send(loginPage({ error: pwErr, redirectTo: redirect_to, mode: 'register' }))
  }
  if (get('SELECT 1 FROM users WHERE email=?', [normalEmail])) {
    if (isJson) return res.status(409).json({ error: 'Email already registered' })
    return res.send(loginPage({ error: 'Email already registered', redirectTo: redirect_to, mode: 'register' }))
  }
  try {
    const { hash, algo } = await hashPassword(password)
    // First *real* (non-guest) user becomes admin. Counting only non-guest rows
    // stops a seeded guest from silently consuming the admin bootstrap. (S12)
    const realUsers = get("SELECT COUNT(*) AS c FROM users WHERE role != 'guest'").c
    const role = realUsers === 0 ? 'admin' : 'user'
    const result = run('INSERT INTO users (email, name, password_hash, hash_algo, role) VALUES (?,?,?,?,?)',
      [normalEmail, (name || normalEmail.split('@')[0]).slice(0, 64), hash, algo, role])
    const user = get('SELECT * FROM users WHERE id=?', [result.lastInsertRowid])
    issueTokens(req, res, user)
    logEvent('register', user.id, req, { role })
    if (isJson) return res.status(201).json({ user: publicUser(user) })
    const dest = validateRedirectTo(redirect_to) || '/auth/dashboard'
    res.redirect(dest)
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(e.message)) {
      if (isJson) return res.status(409).json({ error: 'Email already registered' })
      return res.send(loginPage({ error: 'Email already registered', redirectTo: redirect_to, mode: 'register' }))
    }
    console.error('[register]', e)
    if (isJson) return res.status(500).json({ error: 'Registration failed' })
    res.send(loginPage({ error: 'Registration failed', redirectTo: redirect_to, mode: 'register' }))
  }
})

// POST /auth/login (form + JSON)
router.post('/auth/login', async (req, res) => {
  const isJson = isJsonReq(req)
  const { email, password, redirect_to, remember_me } = req.body
  const normalEmail = (email || '').toLowerCase()
  const user = get('SELECT * FROM users WHERE email=?', [normalEmail])
  const now = Date.now()

  // Soft per-account lockout (S6): while in exponential backoff, refuse fast with
  // a Retry-After. No hard lock, so a known victim can't be permanently DoS'd.
  const lockedUntil = user?.lockout_until ? Date.parse(user.lockout_until) : 0
  if (user && lockedUntil > now) {
    const retryMs = lockedUntil - now
    logEvent('login_locked', user.id, req)
    res.setHeader('Retry-After', String(Math.ceil(retryMs / 1000)))
    const msg = 'Too many attempts. Please wait a moment and try again.'
    if (isJson) return res.status(429).json({ error: msg, code: 'ACCOUNT_LOCKED', retry_after_ms: retryMs })
    return res.send(loginPage({ error: msg, redirectTo: redirect_to }))
  }

  // Reject over-long input before hashing (slow-hash DoS guard); presents as a
  // normal invalid-credentials response so it leaks nothing. (S3)
  const tooLong = (password || '').length > PASSWORD_MAX
  // Always run bcrypt even when no user found to prevent timing-based enumeration.
  const hash = user?.password_hash ?? DUMMY_HASH
  const algo = user?.password_hash ? user.hash_algo : HASH_ALGO
  const valid = !tooLong && await verifyPassword(password || '', hash, algo) && !!user

  if (!valid) {
    if (user) {
      // Grow the backoff for this account; a later success clears it. (S6)
      const attempts = (user.failed_attempts || 0) + 1
      const until = new Date(now + loginBackoffMs(attempts)).toISOString()
      run('UPDATE users SET failed_attempts=?, lockout_until=? WHERE id=?', [attempts, until, user.id])
    }
    logEvent('login_fail', user?.id, req, { email: normalEmail })
    if (isJson) return res.status(401).json({ error: 'Invalid email or password' })
    return res.send(loginPage({ error: 'Invalid email or password', redirectTo: redirect_to }))
  }

  // Credentials good → clear the failure backoff and stamp the login.
  run("UPDATE users SET failed_attempts=0, lockout_until=NULL, last_login=datetime('now') WHERE id=?", [user.id])

  // Lazy migration: upgrade a legacy bcrypt-on-raw hash to the current
  // SHA-256-prehash scheme now that we hold the plaintext. (U1)
  if (user.password_hash && needsRehash(user.hash_algo)) {
    try {
      const up = await hashPassword(password)
      run('UPDATE users SET password_hash=?, hash_algo=? WHERE id=?', [up.hash, up.algo, user.id])
    } catch (e) { console.error('[rehash]', e.message) }
  }

  // JSON callers can pass remember_me boolean; form callers send '1' when checked.
  const remember = isJson ? !!remember_me : remember_me === '1'

  // Second factor (U6): if enabled, withhold the session and challenge for a code.
  // The pending token carries the remember choice + redirect target statelessly.
  if (twoFactorEnabled(user)) {
    const dest = validateRedirectTo(redirect_to) || ''
    const pending = signPending(user.id, remember, dest)
    if (user.email_2fa_enabled) {
      try { await sendEmailOtp(user, 'login') } catch (e) { console.error('[otp send]', e.message) }
    }
    logEvent('login_2fa_challenge', user.id, req, { methods: enabledMethods(user) })
    if (isJson) {
      return res.json({ pending: true, code: 'TWO_FACTOR_REQUIRED', pending_token: pending, methods: enabledMethods(user) })
    }
    return res.send(twoFactorPage({ pendingToken: pending, methods: enabledMethods(user), redirectTo: dest }))
  }

  issueTokens(req, res, user, remember)
  logEvent('login', user.id, req, { remember })
  if (isJson) return res.json({ user: publicUser(user) })
  const dest = validateRedirectTo(redirect_to) || '/auth/dashboard'
  res.redirect(dest)
})

// POST /auth/login/2fa (form + JSON) — complete a login that required a second
// factor. Accepts the pending token from POST /auth/login plus a code valid for
// any enabled method (TOTP, a recovery code, or the emailed OTP). (U6)
router.post('/auth/login/2fa', async (req, res) => {
  const isJson = isJsonReq(req)
  const { pending_token, code } = req.body
  const pending = verifyPending(pending_token)
  if (!pending) {
    if (isJson) return res.status(401).json({ error: 'Verification expired, please sign in again', code: 'PENDING_EXPIRED' })
    return res.send(loginPage({ error: 'Verification expired — please sign in again' }))
  }
  const user = get('SELECT * FROM users WHERE id=?', [pending.sub])
  if (!user || !twoFactorEnabled(user)) {
    clearTokens(res)
    if (isJson) return res.status(401).json({ error: 'Cannot verify', code: CODES.UNAUTHENTICATED })
    return res.send(loginPage({ error: 'Could not verify — please sign in again' }))
  }
  const method = verifySecondFactor(user, code)
  if (!method) {
    logEvent('login_2fa_fail', user.id, req)
    if (isJson) return res.status(401).json({ error: 'Invalid code', code: 'TWO_FACTOR_INVALID' })
    return res.send(twoFactorPage({
      pendingToken: pending_token, methods: enabledMethods(user),
      redirectTo: pending.rt, error: 'Invalid or expired code',
    }))
  }
  run("UPDATE users SET last_login=datetime('now') WHERE id=?", [user.id])
  // Carry the pending redirect target through so token provenance (azp) resolves
  // to the app being entered, not just the request Origin.
  req.body.redirect_to = pending.rt || req.body.redirect_to
  issueTokens(req, res, user, !!pending.remember)
  logEvent('login', user.id, req, { remember: !!pending.remember, twofa: method })
  if (isJson) return res.json({ user: publicUser(user) })
  res.redirect(validateRedirectTo(pending.rt) || '/auth/dashboard')
})

// POST /auth/logout (form + JSON) — revoke the whole session family so logging
// out on one device invalidates every rotation of that login. Revocation is a
// TOMBSTONE (revoked_at/revoked_reason), not a DELETE: hard-deleting destroyed
// the very evidence a "your devices" view or an incident review needs (JK-A10).
// Tombstones age out via the prune in tokens.js.
router.post('/auth/logout', (req, res) => {
  const isJson = isJsonReq(req)
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (refresh) {
    const now = new Date().toISOString()
    const session = get('SELECT * FROM sessions WHERE token_hash=?', [sha256(refresh)])
    if (session?.family_id) {
      run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE family_id=? AND revoked_at IS NULL',
        [now, 'logout', session.family_id])
    } else if (session) {
      run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE token_hash=? AND revoked_at IS NULL',
        [now, 'logout', sha256(refresh)])
    }
    if (session) logEvent('logout', session.user_id, req)
  }
  clearTokens(res)
  if (isJson) return res.json({ ok: true })
  res.redirect('/auth/login')
})

// POST /auth/refresh — rotate refresh + issue a new access token, with reuse
// detection (a rotated token re-presented after the grace window burns the
// family). See tryRotate. (S2/S9)
router.post('/auth/refresh', (req, res) => {
  try {
    const result = tryRotate(req, res)
    switch (result.status) {
      // 'race' = a benign concurrent refresh: the winning call already Set-Cookie'd
      // fresh tokens into the shared cookie jar, so report success and let the
      // client retry its request with the new access cookie (avoids a spurious
      // logout in the losing tab).
      case 'ok':
      case 'race':  return res.json({ ok: true })
      case 'none':  return res.status(401).json({ error: 'No refresh token', code: CODES.UNAUTHENTICATED })
      case 'reuse': return res.status(401).json({ error: 'Session revoked', code: CODES.SESSION_REVOKED })
      default:      return res.status(401).json({ error: 'Session expired', code: CODES.SESSION_EXPIRED })
    }
  } catch (e) {
    console.error('[refresh]', e)
    res.status(500).json({ error: 'Failed to issue token' })
  }
})

// POST /auth/token — service-to-service client-credentials grant. A configured
// service (JKOS_SERVICE_CLIENTS) presents its id + secret and gets a short-lived
// Bearer token (typ:'service', no human sub) scoped to a subset of its allowed
// scopes. This is how a backend acts cross-app WITHOUT a user cookie — a cron,
// agent, or webhook. Issuance is auth-core; the directory it acts on is Weave.
router.post('/auth/token', (req, res) => {
  if (!SERVICE_CLIENTS || Object.keys(SERVICE_CLIENTS).length === 0) {
    return res.status(503).json({ error: 'Service tokens are not enabled' })
  }
  const { client_id, client_secret, scope, on_behalf_of } = req.body || {}
  const client = client_id ? SERVICE_CLIENTS[client_id] : null
  const secretOk = client && (() => {
    const a = Buffer.from(String(client_secret || ''))
    const b = Buffer.from(client.secret)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  })()
  if (!secretOk) {
    logEvent('service_token_denied', null, req, { client_id })
    return res.status(401).json({ error: 'Invalid client credentials' })
  }
  // Default to the client's full grant; clamp any request to it (never escalate).
  const requested = Array.isArray(scope) ? scope
    : typeof scope === 'string' ? scope.split(/[\s,]+/).filter(Boolean)
    : client.scopes
  const granted = requested.filter(s => client.scopes.includes(s))
  if (granted.length === 0) {
    // Nothing grantable → a token with no scope (and an empty audience) is useless
    // and signals a misconfigured request; fail loudly instead of minting it.
    return res.status(400).json({ error: 'No grantable scope requested', code: 'NO_SCOPE' })
  }
  // On-behalf-of delegation (G1): only a client explicitly enrolled in DELEGATION_CLIENTS
  // may mint a token that acts AS a user. Gated separately from the scope grant so a
  // normal service client can never escalate to per-user writes by guessing a parameter.
  let act
  if (on_behalf_of != null && String(on_behalf_of) !== '') {
    if (!DELEGATION_CLIENTS || !DELEGATION_CLIENTS.has(client_id)) {
      logEvent('service_token_delegation_denied', null, req, { client_id, on_behalf_of: String(on_behalf_of) })
      return res.status(403).json({ error: 'Delegation is not permitted for this client', code: 'NO_DELEGATION' })
    }
    act = String(on_behalf_of)
  }
  const token = signService(client_id, granted, { act })
  logEvent('service_token', null, req, { client_id, scopes: granted, ...(act ? { act } : {}) })
  res.json({ access_token: token, token_type: 'Bearer', expires_in: 600, scope: granted.join(' ') })
})

// POST /auth/guest — guest login. ⚠️ JK-A1, the marquee finding of the 2026-08-26
// audit: GUEST_PASSWORD was hashed, stored on the guest row, and NEVER COMPARED —
// a credential in configuration and in the database that was absent from the code
// path, so anyone who could reach the endpoint got a session. The route now
// verifies the presented password against the stored hash with the same
// timing-safe shape as /auth/login, and the guest row joins the per-account
// exponential backoff (it was "exempt from lockout" only because there was no
// credential for the throttle to count).
router.post('/auth/guest', async (req, res) => {
  const isJson = isJsonReq(req)
  if (!GUEST_PASSWORD) {
    if (isJson) return res.status(403).json({ error: 'Guest access is not enabled' })
    return res.send(loginPage({ error: 'Guest access is not enabled' }))
  }
  const guest = get("SELECT * FROM users WHERE email='guest@jkos.net'")
  if (!guest) {
    if (isJson) return res.status(500).json({ error: 'Guest account not available' })
    return res.send(loginPage({ error: 'Guest account not available' }))
  }

  const now = Date.now()
  const lockedUntil = guest.lockout_until ? Date.parse(guest.lockout_until) : 0
  if (lockedUntil > now) {
    const retryMs = lockedUntil - now
    logEvent('login_locked', guest.id, req, { guest: true })
    res.setHeader('Retry-After', String(Math.ceil(retryMs / 1000)))
    const msg = 'Too many attempts. Please wait a moment and try again.'
    if (isJson) return res.status(429).json({ error: msg, code: 'ACCOUNT_LOCKED', retry_after_ms: retryMs })
    return res.send(loginPage({ error: msg, redirectTo: req.body?.redirect_to }))
  }

  const password = req.body?.password
  const tooLong = (password || '').length > PASSWORD_MAX
  const valid = !tooLong
    && await verifyPassword(password || '', guest.password_hash ?? DUMMY_HASH, guest.hash_algo)
    && !!guest.password_hash
  if (!valid) {
    const attempts = (guest.failed_attempts || 0) + 1
    const until = new Date(now + loginBackoffMs(attempts)).toISOString()
    run('UPDATE users SET failed_attempts=?, lockout_until=? WHERE id=?', [attempts, until, guest.id])
    logEvent('guest_login_fail', guest.id, req)
    if (isJson) return res.status(401).json({ error: 'Invalid guest password' })
    return res.send(loginPage({ error: 'Invalid guest password', redirectTo: req.body?.redirect_to }))
  }
  run('UPDATE users SET failed_attempts=0, lockout_until=NULL, last_login=datetime(\'now\') WHERE id=?', [guest.id])

  issueTokens(req, res, guest)
  logEvent('guest_login', guest.id, req)
  if (isJson) {
    const { redirect_to } = req.body
    return res.json({ user: publicUser(guest), redirect_to: validateRedirectTo(redirect_to) })
  }
  const dest = validateRedirectTo(req.body?.redirect_to) || '/auth/dashboard'
  res.redirect(dest)
})

module.exports = router

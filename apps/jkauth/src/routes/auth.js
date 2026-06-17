'use strict'
// Page + credential routes: the portal/login/register pages and the
// login / register / logout / guest POST handlers.

const express = require('express')
const bcrypt = require('bcryptjs')
const { GUEST_PASSWORD, PASSWORD_MAX, REFRESH_COOKIE } = require('../config')
const { get, run, logEvent } = require('../db')
const { validateRedirectTo, passwordError } = require('../util')
const { loginPage, dashboardPage } = require('../views')
const {
  DUMMY_HASH, sha256, issueTokens, clearTokens, tryRotate, resolveOrRefresh, publicUser,
} = require('../tokens')

const router = express.Router()

const isJsonReq = req => req.headers['content-type']?.includes('application/json')

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
    const hash = await bcrypt.hash(password, 12)
    // First *real* (non-guest) user becomes admin. Counting only non-guest rows
    // stops a seeded guest from silently consuming the admin bootstrap. (S12)
    const realUsers = get("SELECT COUNT(*) AS c FROM users WHERE role != 'guest'").c
    const role = realUsers === 0 ? 'admin' : 'user'
    const result = run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
      [normalEmail, (name || normalEmail.split('@')[0]).slice(0, 64), hash, role])
    const user = get('SELECT * FROM users WHERE id=?', [result.lastInsertRowid])
    issueTokens(res, user)
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
  // Reject over-long input before bcrypt (slow-hash DoS guard); presents as a
  // normal invalid-credentials response so it leaks nothing. (S3)
  const tooLong = (password || '').length > PASSWORD_MAX
  // Always run bcrypt even when no user found to prevent timing-based user enumeration
  const hash = user?.password_hash ?? DUMMY_HASH
  const valid = !tooLong && await bcrypt.compare(password || '', hash) && !!user
  if (!valid) {
    logEvent('login_fail', user?.id, req, { email: normalEmail })
    if (isJson) return res.status(401).json({ error: 'Invalid email or password' })
    return res.send(loginPage({ error: 'Invalid email or password', redirectTo: redirect_to }))
  }
  run("UPDATE users SET last_login=datetime('now') WHERE id=?", [user.id])
  // JSON callers can pass remember_me boolean; form callers send '1' when checked.
  const remember = isJson ? !!remember_me : remember_me === '1'
  issueTokens(res, user, remember)
  logEvent('login', user.id, req, { remember })
  if (isJson) return res.json({ user: publicUser(user) })
  const dest = validateRedirectTo(redirect_to) || '/auth/dashboard'
  res.redirect(dest)
})

// POST /auth/logout (form + JSON) — revoke the whole session family so logging
// out on one device invalidates every rotation of that login.
router.post('/auth/logout', (req, res) => {
  const isJson = isJsonReq(req)
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (refresh) {
    const session = get('SELECT * FROM sessions WHERE token_hash=?', [sha256(refresh)])
    if (session?.family_id) run('DELETE FROM sessions WHERE family_id=?', [session.family_id])
    else if (session) run('DELETE FROM sessions WHERE token_hash=?', [sha256(refresh)])
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
      case 'none':  return res.status(401).json({ error: 'No refresh token', code: 'UNAUTHENTICATED' })
      case 'reuse': return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' })
      default:      return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' })
    }
  } catch (e) {
    console.error('[refresh]', e)
    res.status(500).json({ error: 'Failed to issue token' })
  }
})

// POST /auth/guest — guest login (only when GUEST_PASSWORD is set)
router.post('/auth/guest', (req, res) => {
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
  issueTokens(res, guest)
  logEvent('guest_login', guest.id, req)
  if (isJson) {
    const { redirect_to } = req.body
    return res.json({ user: publicUser(guest), redirect_to: validateRedirectTo(redirect_to) })
  }
  const dest = validateRedirectTo(req.body?.redirect_to) || '/auth/dashboard'
  res.redirect(dest)
})

module.exports = router

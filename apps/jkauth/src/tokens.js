'use strict'
// Token + session core: mint/verify the RS256 access JWT, issue/rotate/clear the
// access+refresh cookies, and resolve the current user from either (silently
// refreshing a remembered session on real navigations).

const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const {
  PRIVATE_KEY, PUBLIC_KEY, JWT_ISSUER, JWT_KID,
  TOKEN_COOKIE, REFRESH_COOKIE, COOKIE_OPTS,
  ACCESS_TTL_MS, REFRESH_TTL_MS, REMEMBER_TTL_MS,
} = require('./config')
const { run, get } = require('./db')

// Pre-computed hash used in the login path when the email doesn't exist, so bcrypt
// always runs and the response time doesn't reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('_timing_sentinel_' + crypto.randomBytes(16).toString('hex'), 12)

function signAccess(user) {
  if (!PRIVATE_KEY) throw new Error('JKOS_AUTH_PRIVATE_KEY not set')
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, role: user.role },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '15m', issuer: JWT_ISSUER, keyid: JWT_KID }
  )
}

// remember=true  → both cookies get maxAge (persist across browser close for 30 days)
// remember=false → access cookie gets 15-min maxAge; refresh is session-only (no maxAge)
//                  — closes the browser = logged out
function issueTokens(res, user, remember = true) {
  const token = signAccess(user)
  const refresh = crypto.randomBytes(64).toString('hex')
  const refreshHash = crypto.createHash('sha256').update(refresh).digest('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString()
  run("DELETE FROM sessions WHERE user_id=? AND expires_at < datetime('now')", [user.id])
  run('INSERT INTO sessions (user_id, token_hash, expires_at, remember_me) VALUES (?,?,?,?)',
    [user.id, refreshHash, expiresAt, remember ? 1 : 0])
  // Cap active sessions per user at 10 to prevent unbounded accumulation
  run(`DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
    SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  )`, [user.id, user.id])
  res.cookie(TOKEN_COOKIE, token, { ...COOKIE_OPTS, maxAge: ACCESS_TTL_MS })
  if (remember) {
    res.cookie(REFRESH_COOKIE, refresh, { ...COOKIE_OPTS, maxAge: REMEMBER_TTL_MS })
  } else {
    // Session cookie — browser close clears it (no maxAge)
    res.cookie(REFRESH_COOKIE, refresh, { ...COOKIE_OPTS })
  }
}

function clearTokens(res) {
  const clear = { ...COOKIE_OPTS, maxAge: 0 }
  res.cookie(TOKEN_COOKIE, '', clear)
  res.cookie(REFRESH_COOKIE, '', clear)
}

// Find the live (unexpired) refresh-cookie session + its user, or null.
// The refresh cookie persists for 30 days when "Remember me" was checked; the
// 15-min access token does not. This is what lets a remembered session be
// revived after the access token has expired.
function liveSession(req) {
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (!refresh) return null
  const hash = crypto.createHash('sha256').update(refresh).digest('hex')
  const session = get("SELECT * FROM sessions WHERE token_hash=? AND expires_at > datetime('now')", [hash])
  if (!session) return null
  const user = get('SELECT * FROM users WHERE id=?', [session.user_id])
  return user ? { session, user, hash } : null
}

function resolveUser(req) {
  const token = req.cookies?.[TOKEN_COOKIE]
  if (!token || !PUBLIC_KEY) return null
  try {
    return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'], issuer: JWT_ISSUER })
  } catch {
    return null
  }
}

// Resolve the user for a server-rendered navigation: from the access token if
// present, else silently refresh from a valid remember-me session (mint a new
// access token + rotate the refresh token). This is the server-side equivalent
// of the SPA apps' getMe→refresh→getMe dance — without it, a remembered user
// returning to the jkAuth portal after the 15-min access token expired would be
// bounced to the login page despite holding a valid 30-day session. Safe to
// Set-Cookie here because these are real top-level navigations (unlike the
// nginx auth_request gate, which can't deliver Set-Cookie to the browser).
function resolveOrRefresh(req, res) {
  const jwtUser = resolveUser(req)
  if (jwtUser) return jwtUser
  const live = liveSession(req)
  if (!live) return null
  issueTokens(res, live.user, !!live.session.remember_me)
  run('DELETE FROM sessions WHERE token_hash=?', [live.hash])
  return { sub: live.user.id, email: live.user.email, name: live.user.name, avatar_url: live.user.avatar_url, role: live.user.role }
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url, role: u.role }
}

module.exports = {
  DUMMY_HASH, signAccess, issueTokens, clearTokens,
  liveSession, resolveUser, resolveOrRefresh, publicUser,
}

'use strict'
// Token + session core: mint/verify the RS256 access JWT, issue/rotate/clear the
// access+refresh cookies, and resolve the current user from either (silently
// refreshing a remembered session on real navigations).

const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const {
  PRIVATE_KEY, PUBLIC_KEY, JWT_ISSUER, JWT_KID,
  TOKEN_COOKIE, REFRESH_COOKIE, COOKIE_OPTS,
  ACCESS_TTL_MS, REFRESH_TTL_MS, REMEMBER_TTL_MS, REFRESH_GRACE_MS,
} = require('./config')
const { run, get, logEvent, roleClaims, appIdForOrigin } = require('./db')
const { hashPasswordSync } = require('./password')

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')

// SQLite datetime('now') is space-separated UTC with no zone; make it parseable.
const sqliteToMs = s => Date.parse(String(s).replace(' ', 'T') + 'Z')

// Pre-computed hash used in the login path when the email doesn't exist, so bcrypt
// always runs and the response time doesn't reveal whether an account exists. Built
// with the current scheme so verifyPassword(..., HASH_ALGO) does identical work.
const DUMMY_HASH = hashPasswordSync('_timing_sentinel_' + crypto.randomBytes(16).toString('hex')).hash

// The origin of a URL, or null if unparseable.
function originOf(url) { try { return new URL(url).origin } catch { return null } }

// `azp` (authorized party / provenance): which app a token is minted through.
// Prefer the login's redirect target (the app being entered), else the request
// Origin (set by the SPA on a cross-origin refresh/login fetch). Best-effort —
// null when neither resolves to a registered app.
function provenance(req, redirectTo) {
  return (redirectTo && appIdForOrigin(originOf(redirectTo)))
    || appIdForOrigin(req?.headers?.origin)
    || null
}

const redirectFromReq = req => req?.body?.redirect_to || req?.query?.redirect_to || null

// avatar_url is intentionally NOT in the access token: an arbitrary-length URL
// bloats every cookie/request, and no backend reads it from the token (apps fetch
// it from /auth/me). Keep this payload minimal. (slim-JWT, U9)
//
// The token carries the maximal-security claims (registry-derived, role-based):
//   aud   — app ids this role may access; each app verifies its own id ∈ aud
//   scope — named-scope grant the resource apps gate capabilities on
//   azp   — provenance (which app minted the session), when known
function signAccess(user, { azp = null } = {}) {
  if (!PRIVATE_KEY) throw new Error('JKOS_AUTH_PRIVATE_KEY not set')
  const { aud, scope } = roleClaims(user.role)
  // `sub` is stringified per RFC 7519 (it SHOULD be a StringOrURI). node's
  // jsonwebtoken accepts a number, but strict verifiers — python-jose >= 3.4,
  // PyJWT >= 2.10 — reject a numeric sub ("Subject must be a string") and 401
  // every token, which is exactly what looped staging.jkos.net/deploy. Emitting
  // a string here makes the whole suite's verifiers agree, regardless of runtime.
  // SQLite numeric affinity means `WHERE id = '5'` still matches the INTEGER row,
  // so the many `[user.sub]` query params are unaffected. (svc tokens already use
  // a string `svc:<id>` subject — this brings user tokens in line.)
  const payload = { sub: String(user.id), email: user.email, name: user.name, role: user.role, scope }
  if (azp) payload.azp = azp
  return jwt.sign(payload, PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '15m', issuer: JWT_ISSUER, keyid: JWT_KID, audience: aud })
}

// Service-to-service token (client-credentials grant, POST /auth/token). No human
// `sub` — it carries the client identity (azp + sub 'svc:<id>'), typ 'service' so
// middleware can distinguish it, and the requested scopes. `aud` is derived from
// the scope prefixes so the same per-app audience check applies as for users.
//
// `act` (RFC 8693 actor): when a delegation-enabled client mints on-behalf-of a user
// (G1), the token additionally carries `act` = that user id (a string, like `sub`).
// The token stays typ 'service' (so it's never mistaken for a real login), but the
// weave write-gate reads `act` to authorize a per-user write AS that user — lifting
// NO_USER_CONTEXT for trusted automation. Only set for delegation clients (the grant
// handler gates it); a normal service token has no `act`.
function signService(clientId, scope, { act } = {}) {
  if (!PRIVATE_KEY) throw new Error('JKOS_AUTH_PRIVATE_KEY not set')
  const aud = [...new Set(scope.map(s => s.split(':')[0]).filter(Boolean))]
  const payload = { typ: 'service', azp: clientId, scope }
  if (act != null && String(act) !== '') payload.act = String(act)
  return jwt.sign(payload, PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '10m', issuer: JWT_ISSUER, keyid: JWT_KID,
      subject: `svc:${clientId}`, audience: aud })
}

// Issue a fresh access JWT + refresh token for a user, writing both cookies.
//
// remember=true  → BOTH cookies are persistent (Max-Age 30d) so they survive a
//   browser restart. The access JWT still expires in 15 min; persisting its
//   cookie just means the browser keeps sending the (now-expired) JWT, so the
//   server can answer TOKEN_EXPIRED and the client refreshes — instead of the
//   cookie vanishing and looking like a hard logout. (This vanishing access
//   cookie was why "remember me" failed to auto-log-in across the suite.)
// remember=false → BOTH cookies are session-only (no Max-Age): browser close =
//   logged out, for the two cookies in lockstep.
//
// familyId: pass the existing family when rotating (refresh) so the lineage is
// preserved; omit on a fresh login to start a new family. (S2)
// `req` is read for token provenance (azp) only — the originating app from the
// login redirect or the request Origin.
function issueTokens(req, res, user, remember = true, familyId = null) {
  const token = signAccess(user, { azp: provenance(req, redirectFromReq(req)) })
  const refresh = crypto.randomBytes(64).toString('hex')
  const refreshHash = sha256(refresh)
  const family = familyId || crypto.randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString()
  // Prune fully-expired rows and rotated rows past the reuse-detection window so
  // the table stays bounded without discarding tokens we still need to flag.
  run("DELETE FROM sessions WHERE user_id=? AND expires_at < datetime('now')", [user.id])
  run("DELETE FROM sessions WHERE user_id=? AND rotated_at IS NOT NULL AND rotated_at < datetime('now','-1 hour')", [user.id])
  run('INSERT INTO sessions (user_id, token_hash, expires_at, remember_me, family_id) VALUES (?,?,?,?,?)',
    [user.id, refreshHash, expiresAt, remember ? 1 : 0, family])
  // Cap active (un-rotated) sessions per user at 10 so a busy account isn't
  // capped out of real devices by its own rotation history.
  run(`DELETE FROM sessions WHERE user_id = ? AND rotated_at IS NULL AND id NOT IN (
    SELECT id FROM sessions WHERE user_id = ? AND rotated_at IS NULL ORDER BY created_at DESC LIMIT 10
  )`, [user.id, user.id])
  const opts = remember ? { ...COOKIE_OPTS, maxAge: REMEMBER_TTL_MS } : { ...COOKIE_OPTS }
  res.cookie(TOKEN_COOKIE, token, opts)
  res.cookie(REFRESH_COOKIE, refresh, opts)
}

function clearTokens(res) {
  const clear = { ...COOKIE_OPTS, maxAge: 0 }
  res.cookie(TOKEN_COOKIE, '', clear)
  res.cookie(REFRESH_COOKIE, '', clear)
}

// Find the live (unexpired, un-rotated) refresh-cookie session + its user, or
// null. The refresh cookie persists for 30 days when "Remember me" was checked;
// the access JWT expires in 15 min. This is what lets a remembered session be
// revived after the access token has expired. A rotated token is NOT live.
function liveSession(req) {
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (!refresh) return null
  const hash = sha256(refresh)
  const session = get("SELECT * FROM sessions WHERE token_hash=? AND rotated_at IS NULL AND expires_at > datetime('now')", [hash])
  if (!session) return null
  const user = get('SELECT * FROM users WHERE id=?', [session.user_id])
  return user ? { session, user, hash } : null
}

// Rotate the refresh cookie: atomically consume the presented token and issue a
// new access+refresh pair in the same family. Detects token reuse/theft. Sets or
// clears cookies on `res` as appropriate and returns a status the caller maps to
// an HTTP response or a resolved user:
//   { status: 'none' }                 no refresh cookie present
//   { status: 'ok', user }             rotated; new cookies set
//   { status: 'expired' }              unknown / expired token; cookies cleared
//   { status: 'reuse' }                rotated token re-presented → family revoked; cleared
//   { status: 'race' }                 benign concurrent double-refresh; cookies untouched
function tryRotate(req, res) {
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (!refresh) return { status: 'none' }
  const hash = sha256(refresh)

  // Atomically claim the token: only one caller can flip rotated_at NULL→now.
  // Wins the race (S9) and is the gate for reuse detection (S2).
  const claim = run(
    "UPDATE sessions SET rotated_at=datetime('now') WHERE token_hash=? AND rotated_at IS NULL AND expires_at > datetime('now')",
    [hash])

  if (claim.changes === 1) {
    const session = get('SELECT * FROM sessions WHERE token_hash=?', [hash])
    const user = get('SELECT * FROM users WHERE id=?', [session.user_id])
    if (!user) { clearTokens(res); return { status: 'expired' } }
    issueTokens(req, res, user, !!session.remember_me, session.family_id)
    return { status: 'ok', user }
  }

  // Claim failed — figure out why.
  const session = get('SELECT * FROM sessions WHERE token_hash=?', [hash])
  if (!session) { clearTokens(res); return { status: 'expired' } }
  if (sqliteToMs(session.expires_at) <= Date.now()) { clearTokens(res); return { status: 'expired' } }

  // Token exists, not expired, but the claim failed → it was already rotated.
  const rotatedAgoMs = Date.now() - sqliteToMs(session.rotated_at)
  if (rotatedAgoMs >= 0 && rotatedAgoMs <= REFRESH_GRACE_MS) {
    // Benign concurrent refresh (two tabs / retry): the winner already minted
    // and Set-Cookie'd a new pair, so DON'T clear cookies — just signal a no-op.
    return { status: 'race' }
  }

  // A token rotated long ago is being presented again → theft. Burn the family.
  run('DELETE FROM sessions WHERE family_id=?', [session.family_id])
  clearTokens(res)
  logEvent('refresh_reuse', session.user_id, req, { family: session.family_id })
  return { status: 'reuse' }
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

// Short-lived signed token issued when a password login passes but a
// second factor is still required. It is NOT a session — it only authorises the
// 2FA step. Stateless (no DB row): carries the user id, the remember choice, and
// the redirect target, and is rejected unless it bears pending_2fa. (U6)
function signPending(userId, remember, redirectTo) {
  if (!PRIVATE_KEY) throw new Error('JKOS_AUTH_PRIVATE_KEY not set')
  return jwt.sign(
    // String(userId) for the same RFC-7519 / strict-verifier reason as signAccess.
    { sub: String(userId), pending_2fa: true, remember: !!remember, rt: redirectTo || '' },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '5m', issuer: JWT_ISSUER, keyid: JWT_KID }
  )
}

function verifyPending(token) {
  if (!token || !PUBLIC_KEY) return null
  try {
    const p = jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'], issuer: JWT_ISSUER })
    return p.pending_2fa ? p : null
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
  const result = tryRotate(req, res)
  if (result.status !== 'ok') return null
  const u = result.user
  return { sub: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url, role: u.role }
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url, role: u.role }
}

module.exports = {
  DUMMY_HASH, sha256, signAccess, signService, issueTokens, clearTokens,
  liveSession, tryRotate, resolveUser, resolveOrRefresh, publicUser,
  signPending, verifyPending, provenance,
}

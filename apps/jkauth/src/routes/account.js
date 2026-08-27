'use strict'
// Account self-service (Stage C3): the things a polished SSO must have and this
// one did not. These are ABSENCES from the 2026-08-26 audit, not bugs — each is
// an audit finding in its own right (JK-A12):
//
//   · password change   — a credential that cannot be rotated is the finding.
//   · password reset    — there was no forgot-password flow and no reset token.
//   · email verification— email is the 2FA DELIVERY CHANNEL, so email-OTP second
//                         factors were being sent to an unverified address.
//   · your devices      — logout used to hard-DELETE session rows, so there was
//                         no evidence to show. Migration 017 made revocation a
//                         tombstone and added last_used_at precisely for this.
//
// Every route answers a form post with HTML and a JSON caller with JSON, the same
// dual contract the rest of jkAuth honours.

const express = require('express')
const { PASSWORD_MAX, REFRESH_COOKIE } = require('../config')
const { get, all, run, logEvent } = require('../db')
const { isJsonReq, passwordError } = require('../util')
const { loginPage, forgotPage, resetPage, verifyEmailPage, securityPage } = require('../views')
const { resolveUser, DUMMY_HASH, sessionFamilies, currentFamilyOf } = require('../tokens')
const { hashPassword, verifyPassword } = require('../password')
const { mintOtp, verifyEmailOtp, recoveryCodesRemaining } = require('../twofactor')
const { can } = require('../policy')
const { sendResetEmail, sendVerifyEmail } = require('../email')

const router = express.Router()

// Codes for these flows live longer than a login OTP: a person checks mail on a
// different device, and 10 minutes is a real source of failed resets.
const RESET_TTL_MS = 30 * 60 * 1000
const VERIFY_TTL_MS = 30 * 60 * 1000

function currentUser(req, res) {
  const jwtUser = resolveUser(req)
  if (!jwtUser) {
    if (isJsonReq(req)) { res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' }); return null }
    res.redirect('/auth/login?redirect_to=' + encodeURIComponent('/auth/security')); return null
  }
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) {
    if (isJsonReq(req)) { res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' }); return null }
    res.send(loginPage({ error: 'Session expired — please sign in again' })); return null
  }
  return u
}

const secInfo = (u, req) => ({
  totpEnabled: !!u.totp_enabled,
  emailEnabled: !!u.email_2fa_enabled,
  emailVerified: !!u.email_verified,
  recoveryRemaining: u.totp_enabled ? recoveryCodesRemaining(u.id) : 0,
  devices: sessionFamilies(u.id, currentFamilyOf(req)),
})

/* ── Password change ──────────────────────────────────────────────────────── */

// POST /auth/password — change the password of the signed-in user.
//
// Every OTHER session family is revoked on success. That is the point of a
// password change from a security standpoint: if the reason you are rotating is
// that someone else has a session, leaving their session alive makes the whole
// exercise theatre. The CURRENT family survives so the person doing the rotating
// isn't signed out of the tab they did it in.
router.post('/auth/password', async (req, res) => {
  const isJson = isJsonReq(req)
  const u = currentUser(req, res); if (!u) return
  const { current_password, new_password } = req.body ?? {}

  const fail = (msg, status = 400) => {
    if (isJson) return res.status(status).json({ error: msg })
    return res.status(status).send(securityPage(u, secInfo(u, req), { error: msg }))
  }

  const pwErr = passwordError(new_password)
  if (pwErr) return fail(pwErr)
  if ((current_password || '').length > PASSWORD_MAX) return fail('Current password is incorrect', 401)

  // Timing-safe in the same shape as the login route: bcrypt always runs, even
  // for an account with no password hash at all.
  const okNow = await verifyPassword(current_password || '', u.password_hash ?? DUMMY_HASH, u.hash_algo)
  if (!okNow || !u.password_hash) {
    logEvent('password_change_fail', u.id, req)
    return fail('Current password is incorrect', 401)
  }

  const { hash, algo } = await hashPassword(new_password)
  run('UPDATE users SET password_hash=?, hash_algo=? WHERE id=?', [hash, algo, u.id])

  const currentFamily = currentFamilyOf(req)
  const now = new Date().toISOString()
  run(`UPDATE sessions SET revoked_at=?, revoked_reason='password_change'
       WHERE user_id=? AND revoked_at IS NULL AND (family_id IS NOT ? OR ? IS NULL)`,
    [now, u.id, currentFamily, currentFamily])
  logEvent('password_change', u.id, req, { other_sessions_revoked: true })

  if (isJson) return res.json({ ok: true })
  res.send(securityPage(get('SELECT * FROM users WHERE id=?', [u.id]), secInfo(u, req),
    { notice: 'Password changed. Every other signed-in device was signed out.' }))
})

/* ── Password reset ───────────────────────────────────────────────────────── */

// GET /auth/forgot — the request form.
router.get('/auth/forgot', (req, res) => res.send(forgotPage({})))

// POST /auth/reset/request — ALWAYS answers the same way.
//
// ⚠️ The identical response for a known and an unknown address is the whole
// security property here: anything that differs — a message, a status code, or a
// materially different response time — turns this endpoint into an account
// enumeration oracle, which is exactly the kind of leak the rest of this service
// works to avoid (see DUMMY_HASH on the login path).
router.post('/auth/reset/request', async (req, res) => {
  const isJson = isJsonReq(req)
  const email = String(req.body?.email || '').toLowerCase().trim()
  const u = email ? get('SELECT * FROM users WHERE email=?', [email]) : null

  if (u && can(u, 'password:reset')) {
    try {
      const code = mintOtp(u.id, 'password_reset', RESET_TTL_MS)
      if (code) await sendResetEmail(u.email, code)
      logEvent('password_reset_request', u.id, req)
    } catch (e) {
      // A mail failure must not change the answer — that would leak too.
      console.error('[reset] send failed:', e.message)
    }
  }

  const said = 'If that address has an account, a reset code is on its way.'
  if (isJson) return res.json({ ok: true, message: said })
  res.send(resetPage({ email, notice: said }))
})

// GET /auth/reset — the code + new password form.
router.get('/auth/reset', (req, res) => res.send(resetPage({ email: req.query.email })))

// POST /auth/reset/confirm — consume the code, set the password, revoke EVERY
// family (unlike a change, a reset means the old credential may be compromised
// and there is no session here worth preserving).
router.post('/auth/reset/confirm', async (req, res) => {
  const isJson = isJsonReq(req)
  const email = String(req.body?.email || '').toLowerCase().trim()
  const { code, new_password } = req.body ?? {}
  const u = email ? get('SELECT * FROM users WHERE email=?', [email]) : null

  const fail = (msg) => {
    if (isJson) return res.status(400).json({ error: msg })
    return res.status(400).send(resetPage({ email, error: msg }))
  }
  const pwErr = passwordError(new_password)
  if (pwErr) return fail(pwErr)
  // One message for a bad code and an unknown address, for the reason above.
  if (!u || !verifyEmailOtp(u.id, code, 'password_reset')) {
    if (u) logEvent('password_reset_fail', u.id, req)
    return fail('That code was wrong or has expired.')
  }

  const { hash, algo } = await hashPassword(new_password)
  run('UPDATE users SET password_hash=?, hash_algo=?, failed_attempts=0, lockout_until=NULL WHERE id=?',
    [hash, algo, u.id])
  run(`UPDATE sessions SET revoked_at=?, revoked_reason='password_reset'
       WHERE user_id=? AND revoked_at IS NULL`, [new Date().toISOString(), u.id])
  logEvent('password_reset', u.id, req, { all_sessions_revoked: true })

  if (isJson) return res.json({ ok: true })
  res.send(loginPage({ notice: 'Password reset. Sign in with your new password.' }))
})

/* ── Email verification ───────────────────────────────────────────────────── */

// POST /auth/verify/send — mail a fresh confirmation code to the signed-in user.
router.post('/auth/verify/send', async (req, res) => {
  const isJson = isJsonReq(req)
  const u = currentUser(req, res); if (!u) return
  if (u.email_verified) {
    if (isJson) return res.json({ ok: true, already: true })
    return res.send(verifyEmailPage({ email: u.email, notice: 'That address is already confirmed.' }))
  }
  const code = mintOtp(u.id, 'verify_email', VERIFY_TTL_MS)
  if (!code) {
    const msg = 'A code was just sent — check your mail, or wait a moment before asking for another.'
    if (isJson) return res.status(429).json({ error: msg, code: 'OTP_THROTTLED' })
    return res.status(429).send(verifyEmailPage({ email: u.email, error: msg }))
  }
  try { await sendVerifyEmail(u.email, code) } catch (e) { console.error('[verify] send failed:', e.message) }
  logEvent('email_verify_sent', u.id, req)
  if (isJson) return res.json({ ok: true })
  res.send(verifyEmailPage({ email: u.email, notice: 'Code sent — enter it below.' }))
})

router.get('/auth/verify', (req, res) => {
  const u = currentUser(req, res); if (!u) return
  res.send(verifyEmailPage({ email: u.email, verified: !!u.email_verified }))
})

// POST /auth/verify/confirm — consume the code and mark the address confirmed.
router.post('/auth/verify/confirm', (req, res) => {
  const isJson = isJsonReq(req)
  const u = currentUser(req, res); if (!u) return
  if (!verifyEmailOtp(u.id, req.body?.code, 'verify_email')) {
    const msg = 'That code was wrong or has expired.'
    if (isJson) return res.status(400).json({ error: msg })
    return res.status(400).send(verifyEmailPage({ email: u.email, error: msg }))
  }
  run('UPDATE users SET email_verified=1 WHERE id=?', [u.id])
  logEvent('email_verified', u.id, req)
  if (isJson) return res.json({ ok: true, email_verified: true })
  res.send(verifyEmailPage({ email: u.email, verified: true, notice: 'Address confirmed.' }))
})

/* ── Your devices ─────────────────────────────────────────────────────────── */

// GET /auth/sessions — the caller's own session FAMILIES, newest first.
//
// A family is one login; its rows are that login's rotations. Reporting rows
// would show "47 sessions" for one browser that has been open a month, which is
// noise rather than information — so the rows fold into the family and the
// timestamps are the family's: first seen, last used.
router.get('/auth/sessions', (req, res) => {
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  res.json({ sessions: sessionFamilies(jwtUser.sub, currentFamilyOf(req)) })
})

// POST /auth/sessions/revoke — sign one device out.
//
// Scoped to the caller's OWN rows: the WHERE clause carries user_id, so a
// guessed family_id belonging to someone else matches nothing. It answers 404
// rather than 403 for an unknown family, because "that isn't yours" and "that
// doesn't exist" should be indistinguishable to a prober.
router.post('/auth/sessions/revoke', (req, res) => {
  const isJson = isJsonReq(req)
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const familyId = String(req.body?.family_id || '')
  if (!familyId) return res.status(400).json({ error: 'family_id is required' })

  const r = run(`UPDATE sessions SET revoked_at=?, revoked_reason='user_revoked'
                  WHERE user_id=? AND family_id=? AND revoked_at IS NULL`,
    [new Date().toISOString(), jwtUser.sub, familyId])
  if (!r.changes) return res.status(404).json({ error: 'No such active session' })
  logEvent('session_revoked', jwtUser.sub, req, { family: familyId })
  if (isJson) return res.json({ ok: true, revoked: r.changes })
  res.redirect('/auth/security')
})

module.exports = router

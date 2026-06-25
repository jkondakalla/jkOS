'use strict'
// Authenticated 2FA management (U6): the account Security page plus the TOTP and
// email-OTP enable/disable endpoints. All routes require a live session. The
// login-time challenge itself lives in routes/auth.js (POST /auth/login/2fa).

const express = require('express')
const { get, run, logEvent } = require('../db')
const { resolveUser } = require('../tokens')
const { securityPage, totpSetupPage, recoveryCodesPage, loginPage } = require('../views')
const {
  beginTotpSetup, qrForSecret, verifyTotpCode, generateRecoveryCodes, recoveryCodesRemaining,
} = require('../twofactor')

const router = express.Router()

const isJsonReq = req => req.headers['content-type']?.includes('application/json')

// Resolve the current user row (fresh from DB) or send a 401 / redirect.
function requireUser(req, res) {
  const jwtUser = resolveUser(req)
  if (!jwtUser) {
    if (isJsonReq(req)) { res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' }); return null }
    res.redirect('/auth/login?redirect_to=' + encodeURIComponent('/auth/security')); return null
  }
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) { res.send(loginPage({ error: 'Session expired — please sign in again' })); return null }
  return u
}

const secInfo = u => ({
  totpEnabled: !!u.totp_enabled,
  emailEnabled: !!u.email_2fa_enabled,
  recoveryRemaining: u.totp_enabled ? recoveryCodesRemaining(u.id) : 0,
})

// GET /auth/security — management page.
router.get('/auth/security', (req, res) => {
  const u = requireUser(req, res); if (!u) return
  res.send(securityPage(u, secInfo(u)))
})

// POST /auth/2fa/totp/setup — generate a secret + QR and show the confirm step.
// The unverified secret is stored now (totp_enabled stays 0 until a code confirms).
router.post('/auth/2fa/totp/setup', async (req, res) => {
  const u = requireUser(req, res); if (!u) return
  if (u.totp_enabled) return res.send(securityPage(u, secInfo(u), { error: 'Authenticator is already enabled.' }))
  try {
    const { secret, qr } = await beginTotpSetup(u)
    run('UPDATE users SET totp_secret=? WHERE id=?', [secret, u.id])
    res.send(totpSetupPage({ secret, qr }))
  } catch (e) {
    console.error('[totp setup]', e)
    res.send(securityPage(u, secInfo(u), { error: 'Could not start setup. Try again.' }))
  }
})

// POST /auth/2fa/totp/enable — confirm a first code, flip on, show recovery codes.
router.post('/auth/2fa/totp/enable', async (req, res) => {
  const u = requireUser(req, res); if (!u) return
  if (u.totp_enabled) return res.send(securityPage(u, secInfo(u), { notice: 'Authenticator already enabled.' }))
  if (!u.totp_secret) return res.send(securityPage(u, secInfo(u), { error: 'Start setup first.' }))
  if (!verifyTotpCode(u.totp_secret, req.body.code)) {
    // Re-render the confirm step with a QR for the SAME stored secret.
    const qr = await qrForSecret(u.totp_secret, u.email)
    return res.send(totpSetupPage({ secret: u.totp_secret, qr, error: 'That code was wrong or expired. Try again.' }))
  }
  run('UPDATE users SET totp_enabled=1 WHERE id=?', [u.id])
  const codes = generateRecoveryCodes(u.id)
  logEvent('2fa_totp_enabled', u.id, req)
  res.send(recoveryCodesPage(codes))
})

// POST /auth/2fa/totp/disable — turn off TOTP and drop secret + recovery codes.
router.post('/auth/2fa/totp/disable', (req, res) => {
  const u = requireUser(req, res); if (!u) return
  run('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?', [u.id])
  run('DELETE FROM recovery_codes WHERE user_id=?', [u.id])
  logEvent('2fa_totp_disabled', u.id, req)
  const fresh = get('SELECT * FROM users WHERE id=?', [u.id])
  res.send(securityPage(fresh, secInfo(fresh), { notice: 'Authenticator turned off.' }))
})

// POST /auth/2fa/email/enable — opt into emailed login codes. The account email
// is already the verified login identity, so no extra confirmation step.
router.post('/auth/2fa/email/enable', (req, res) => {
  const u = requireUser(req, res); if (!u) return
  run('UPDATE users SET email_2fa_enabled=1 WHERE id=?', [u.id])
  logEvent('2fa_email_enabled', u.id, req)
  const fresh = get('SELECT * FROM users WHERE id=?', [u.id])
  res.send(securityPage(fresh, secInfo(fresh), { notice: 'Email codes turned on.' }))
})

// POST /auth/2fa/email/disable
router.post('/auth/2fa/email/disable', (req, res) => {
  const u = requireUser(req, res); if (!u) return
  run('UPDATE users SET email_2fa_enabled=0 WHERE id=?', [u.id])
  logEvent('2fa_email_disabled', u.id, req)
  const fresh = get('SELECT * FROM users WHERE id=?', [u.id])
  res.send(securityPage(fresh, secInfo(fresh), { notice: 'Email codes turned off.' }))
})

module.exports = router

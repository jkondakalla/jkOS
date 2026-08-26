'use strict'
// Two-factor authentication (U6). Supports TOTP (RFC 6238, via otpauth) with
// single-use recovery codes, and email one-time passcodes (via src/email.js).
// A user may enable either or both; verifySecondFactor accepts any enabled
// method, so the login challenge needs only one code input.

const crypto = require('crypto')
const { TOTP, Secret } = require('otpauth')
const QRCode = require('qrcode')
const { run, get } = require('./db')
const { sendOtpEmail } = require('./email')
const { openSecret } = require('./secretbox')

const TOTP_ISSUER = 'jkOS'
const OTP_TTL_MS = 10 * 60 * 1000        // email code lifetime
const OTP_RESEND_MS = 30 * 1000          // min spacing between email sends per user
const RECOVERY_CODE_COUNT = 8

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const normCode = c => String(c ?? '').replace(/[\s-]/g, '').toLowerCase()

// ── TOTP ────────────────────────────────────────────────────────────────────
function makeTotp(secretBase32, label) {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label: label || 'account',
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: Secret.fromBase32(secretBase32),
  })
}

// New secret + provisioning material. Does NOT enable — the caller stores the
// secret and only flips totp_enabled once a first code verifies (proves the
// authenticator app is set up correctly).
async function beginTotpSetup(user) {
  const secret = new Secret({ size: 20 })   // 160-bit, the RFC-recommended size
  const totp = makeTotp(secret.base32, user.email)
  const uri = totp.toString()
  return { secret: secret.base32, uri, qr: await QRCode.toDataURL(uri) }
}

// QR data URL for an already-stored secret (e.g. re-rendering the setup page
// after a mistyped code) — does NOT mint a new secret. Accepts the STORED value
// (sealed or legacy plaintext — JK-A4); openSecret handles both.
async function qrForSecret(storedSecret, label) {
  const secret = openSecret(storedSecret)
  if (!secret) throw new Error('stored TOTP secret could not be opened')
  return QRCode.toDataURL(makeTotp(secret, label).toString())
}

// `storedSecret` is the value as it sits in users.totp_secret — sealed
// (`enc:v1:…`, JK-A4) or legacy plaintext. A sealed secret that cannot be
// opened (missing/wrong key) verifies as false: fail closed, never bypass.
function verifyTotpCode(storedSecret, code) {
  const secretBase32 = openSecret(storedSecret)
  if (!secretBase32 || !code) return false
  const token = String(code).replace(/\s/g, '')
  if (!/^\d{6}$/.test(token)) return false
  // window:1 → tolerate ±1 time step for clock drift.
  return makeTotp(secretBase32).validate({ token, window: 1 }) !== null
}

// ── Recovery codes ───────────────────────────────────────────────────────────
// (Re)generate the full set, return plaintext ONCE for display. Stored hashed.
function generateRecoveryCodes(userId, n = RECOVERY_CODE_COUNT) {
  run('DELETE FROM recovery_codes WHERE user_id=?', [userId])
  const codes = []
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString('hex')   // 10 hex chars
    const display = `${raw.slice(0, 5)}-${raw.slice(5)}`
    codes.push(display)
    run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)', [userId, sha256(normCode(display))])
  }
  return codes
}

function consumeRecoveryCode(userId, code) {
  const row = get('SELECT id FROM recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL',
    [userId, sha256(normCode(code))])
  if (!row) return false
  run("UPDATE recovery_codes SET used_at=datetime('now') WHERE id=?", [row.id])
  return true
}

function recoveryCodesRemaining(userId) {
  return get('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id=? AND used_at IS NULL', [userId]).c
}

// ── Email OTP ─────────────────────────────────────────────────────────────────
// True if enough time has passed since the last send to issue another (anti-spam).
function canSendEmailOtp(userId, purpose = 'login') {
  const recent = get(
    "SELECT 1 FROM auth_otp WHERE user_id=? AND purpose=? AND created_at > datetime('now','-30 seconds') LIMIT 1",
    [userId, purpose])
  return !recent
}

// Generate, store (hashed), and email a fresh 6-digit code; invalidates prior
// unused codes for the same purpose. Honours the resend cooldown unless forced.
async function sendEmailOtp(user, purpose = 'login', { force = false } = {}) {
  if (!force && !canSendEmailOtp(user.id, purpose)) return { sent: false, throttled: true }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString()
  run("UPDATE auth_otp SET used_at=datetime('now') WHERE user_id=? AND purpose=? AND used_at IS NULL",
    [user.id, purpose])
  run('INSERT INTO auth_otp (user_id, code_hash, purpose, expires_at) VALUES (?,?,?,?)',
    [user.id, sha256(code), purpose, expires])
  await sendOtpEmail(user.email, code)
  return { sent: true }
}

function verifyEmailOtp(userId, code, purpose = 'login') {
  const token = String(code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(token)) return false
  const row = get(
    "SELECT id FROM auth_otp WHERE user_id=? AND purpose=? AND code_hash=? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
    [userId, purpose, sha256(token)])
  if (!row) return false
  run("UPDATE auth_otp SET used_at=datetime('now') WHERE id=?", [row.id])
  return true
}

// ── Aggregate ────────────────────────────────────────────────────────────────
const twoFactorEnabled = user => !!(user.totp_enabled || user.email_2fa_enabled)

function enabledMethods(user) {
  const m = []
  if (user.totp_enabled) m.push('totp')
  if (user.email_2fa_enabled) m.push('email')
  return m
}

// Accept any code valid for an enabled method: TOTP, a recovery code, or the
// emailed OTP. Returns the method that matched (for the audit log) or null.
function verifySecondFactor(user, code) {
  const c = String(code ?? '').trim()
  if (!c) return null
  if (user.totp_enabled && user.totp_secret && verifyTotpCode(user.totp_secret, c)) return 'totp'
  if (user.totp_enabled && consumeRecoveryCode(user.id, c)) return 'recovery'
  if (user.email_2fa_enabled && verifyEmailOtp(user.id, c, 'login')) return 'email'
  return null
}

module.exports = {
  beginTotpSetup, qrForSecret, verifyTotpCode,
  generateRecoveryCodes, consumeRecoveryCode, recoveryCodesRemaining,
  canSendEmailOtp, sendEmailOtp, verifyEmailOtp,
  twoFactorEnabled, enabledMethods, verifySecondFactor,
}

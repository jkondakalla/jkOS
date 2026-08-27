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
const TOTP_PERIOD_S = 30                 // seconds per TOTP time step (RFC 6238 default)
const OTP_TTL_MS = 10 * 60 * 1000        // email code lifetime
const OTP_RESEND_MS = 30 * 1000          // min spacing between email sends per user
const RECOVERY_CODE_COUNT = 8
// 80 bits, not 40 (JK-A8). A recovery code BYPASSES the second factor entirely,
// which makes it password-equivalent — and unlike a password it is stored under a
// bare unsalted SHA-256, because it must be looked up by hash. At the old
// randomBytes(5) that is 2^40, brute-forceable offline in minutes on a GPU. At
// 2^80 the bare hash is fine: there is no dictionary to attack and no cheaper
// path than exhausting the space. Displayed in three groups so it can be read
// aloud and typed; normCode strips the separators before hashing, so existing
// 40-bit codes keep verifying and simply age out as sets are regenerated.
const RECOVERY_CODE_BYTES = 10

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
// Returns the accepted TIME STEP (not a boolean) or null. The step is what makes
// a code single-use: see consumeTotp below (JK-A19).
function totpStepFor(storedSecret, code) {
  const secretBase32 = openSecret(storedSecret)
  if (!secretBase32 || !code) return null
  const token = String(code).replace(/\s/g, '')
  if (!/^\d{6}$/.test(token)) return null
  // window:1 → tolerate ±1 time step for clock drift. `validate` returns the
  // DELTA in steps (0 = current window, -1 = the previous one), so the absolute
  // step is the current counter plus that delta.
  const delta = makeTotp(secretBase32).validate({ token, window: 1 })
  if (delta === null) return null
  return Math.floor(Date.now() / (TOTP_PERIOD_S * 1000)) + delta
}

function verifyTotpCode(storedSecret, code) {
  return totpStepFor(storedSecret, code) !== null
}

/** Verify AND burn a TOTP code (JK-A19). A code used to stay valid for its whole
 *  ±1-step window (~90 s), so one observed over a shoulder or lifted from a log
 *  could be replayed. Recording the accepted step and refusing anything at or
 *  below it makes each code single-use, and also refuses an EARLIER code from
 *  inside the same window — which is what a replay of a captured code looks like. */
function consumeTotp(user, code) {
  const step = totpStepFor(user.totp_secret, code)
  if (step === null) return false
  if (user.totp_last_counter != null && step <= user.totp_last_counter) return false
  run('UPDATE users SET totp_last_counter=? WHERE id=?', [step, user.id])
  return true
}

// ── Recovery codes ───────────────────────────────────────────────────────────
// (Re)generate the full set, return plaintext ONCE for display. Stored hashed.
function generateRecoveryCodes(userId, n = RECOVERY_CODE_COUNT) {
  run('DELETE FROM recovery_codes WHERE user_id=?', [userId])
  const codes = []
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex')   // 20 hex chars
    const display = `${raw.slice(0, 7)}-${raw.slice(7, 14)}-${raw.slice(14)}`
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
  // The window DERIVES from OTP_RESEND_MS (JK-A17): the constant used to be
  // declared here and the actual policy hardcoded as '-30 seconds' in the SQL,
  // so there were two sources and only one of them was enforced.
  const recent = get(
    `SELECT 1 FROM auth_otp WHERE user_id=? AND purpose=? AND created_at > datetime('now', ?) LIMIT 1`,
    [userId, purpose, `-${Math.ceil(OTP_RESEND_MS / 1000)} seconds`])
  return !recent
}

/** Mint a fresh 6-digit code for any purpose, store it hashed, and invalidate
 *  the caller's prior unused codes for that same purpose. Returns the plaintext
 *  code for the caller to deliver, or null when the resend cooldown says no.
 *
 *  Split out of sendEmailOtp so password-reset and email-verification share the
 *  mint, the cooldown and the one-live-code-per-purpose rule rather than each
 *  growing its own copy — the flows differ only in TTL and in which mail goes
 *  out. ⚠️ A 6-digit code is 10^6, so the cooldown and the per-account throttle
 *  ARE the security of these flows; the hash adds almost nothing at that size. */
function mintOtp(userId, purpose, ttlMs = OTP_TTL_MS, { force = false } = {}) {
  if (!force && !canSendEmailOtp(userId, purpose)) return null
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const expires = new Date(Date.now() + ttlMs).toISOString()
  run("UPDATE auth_otp SET used_at=datetime('now') WHERE user_id=? AND purpose=? AND used_at IS NULL",
    [userId, purpose])
  run('INSERT INTO auth_otp (user_id, code_hash, purpose, expires_at) VALUES (?,?,?,?)',
    [userId, sha256(code), purpose, expires])
  return code
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
  // consumeTotp, not verifyTotpCode — every accepted second factor here must be
  // SINGLE-USE (JK-A19). Recovery codes and email OTPs were already consumed on
  // use; TOTP was the one that stayed replayable inside its window.
  if (user.totp_enabled && user.totp_secret && consumeTotp(user, c)) return 'totp'
  if (user.totp_enabled && consumeRecoveryCode(user.id, c)) return 'recovery'
  if (user.email_2fa_enabled && verifyEmailOtp(user.id, c, 'login')) return 'email'
  return null
}

module.exports = {
  OTP_TTL_MS, OTP_RESEND_MS,
  beginTotpSetup, qrForSecret, verifyTotpCode, totpStepFor, consumeTotp,
  generateRecoveryCodes, consumeRecoveryCode, recoveryCodesRemaining,
  canSendEmailOtp, sendEmailOtp, verifyEmailOtp, mintOtp,
  twoFactorEnabled, enabledMethods, verifySecondFactor,
}

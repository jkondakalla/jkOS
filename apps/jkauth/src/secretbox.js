'use strict'
// Envelope encryption for secrets the server must READ BACK (JK-A4).
//
// bcrypt is for secrets we only ever COMPARE. A TOTP secret is different: the
// server needs the plaintext back to compute the expected code, so hashing is
// not available — and storing it bare means one read of `users.totp_secret` is
// a permanent 2FA bypass for every enrolled user. This module seals such
// secrets with AES-256-GCM under a key derived from `JKOS_2FA_ENC_KEY`, so the
// database alone is no longer sufficient to mint second factors.
//
// Format: `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`. The prefix is what lets
// `openSecret` pass legacy plaintext rows through unchanged (nobody gets locked
// out of 2FA by the upgrade) and lets the boot-time sweep in db.js find and seal
// them. The key is derived as SHA-256 of the raw env value, so any sufficiently
// random string works — generate one with `openssl rand -hex 32`.
//
// Fail-closed contract: with no key configured, NEW enrollment is refused (the
// route 503s) rather than quietly writing plaintext — a control that exists
// only when an env var happens to be set is the defect class this whole pass
// exists to close. A SEALED row read with no key opens to null, which verifies
// as "wrong code", never as a bypass.

const crypto = require('crypto')
const { TWOFA_ENC_KEY } = require('./config')

const PREFIX = 'enc:v1:'

const key = TWOFA_ENC_KEY
  ? crypto.createHash('sha256').update(TWOFA_ENC_KEY, 'utf8').digest()
  : null

const sealingEnabled = () => !!key

const isSealed = v => typeof v === 'string' && v.startsWith(PREFIX)

function sealSecret(plain) {
  if (!key) throw new Error('JKOS_2FA_ENC_KEY is not set — refusing to store a readable secret in plaintext')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return PREFIX + [iv, cipher.getAuthTag(), ct].map(b => b.toString('base64')).join(':')
}

// The stored value back as plaintext: sealed rows are decrypted, legacy
// plaintext rows pass through. Returns null — never throws into a login path —
// when a sealed row cannot be opened (no key, wrong key, or a tampered blob);
// the caller's code comparison then simply fails.
function openSecret(stored) {
  if (stored == null) return null
  if (!isSealed(stored)) return String(stored)
  if (!key) {
    console.error('[secretbox] a sealed secret was read but JKOS_2FA_ENC_KEY is not set — 2FA verify will fail closed')
    return null
  }
  try {
    const [iv, tag, ct] = String(stored).slice(PREFIX.length).split(':').map(s => Buffer.from(s, 'base64'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (e) {
    console.error('[secretbox] failed to open a sealed secret:', e.message)
    return null
  }
}

module.exports = { sealSecret, openSecret, isSealed, sealingEnabled }

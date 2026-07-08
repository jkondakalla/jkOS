'use strict';
// Secret-at-rest encryption for calendar credentials + the OAuth CSRF-state cookie.
const crypto = require('crypto');
const { CALENDAR_ENC_KEY, IS_PROD } = require('./config');

/* ── Secret-at-rest encryption (AES-256-GCM) for calendar refresh tokens + the
   iCloud app-specific password, long-lived reusable credentials. Backward-compatible
   and prefix-tagged (`enc:v1:`) so reads are dual-mode: with no CALENDAR_ENC_KEY set,
   secrets store as-is; legacy plaintext rows (no tag) still read back verbatim even
   AFTER a key is added — so introducing a key is a safe, migration-free rollout. The
   one sharp edge: REMOVING or changing the key after rows were encrypted makes those
   rows undecryptable (decryptSecret throws) — recovery is to reconnect the calendar.
   Documented in OPERATIONS.md → CALENDAR_ENC_KEY key lifecycle. ────────────── */
function encKeyBuf() {
  return /^[0-9a-fA-F]{64}$/.test(CALENDAR_ENC_KEY) ? Buffer.from(CALENDAR_ENC_KEY, 'hex') : null;
}
function encryptSecret(plain) {
  const key = encKeyBuf();
  if (!key || plain == null) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decryptSecret(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc:v1:')) return stored;  // legacy plaintext
  const key = encKeyBuf();
  if (!key) throw new Error('CALENDAR_ENC_KEY is required to decrypt a stored secret');
  const raw = Buffer.from(stored.slice('enc:v1:'.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/* ── OAuth CSRF state — a random nonce set in an HttpOnly cookie when a calendar
   connect is initiated, required to match on the callback. Stops an attacker from
   grafting their calendar onto a victim's account via a forged callback. ───── */
const OAUTH_STATE_COOKIE = 'bb_oauth_state';
function setOAuthState(res) {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 600000, path: '/' });
  return state;
}
function checkOAuthState(req, res) {
  const cookie = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
  return !!(req.query.state && cookie && req.query.state === cookie);
}

module.exports = { encKeyBuf, encryptSecret, decryptSecret, OAUTH_STATE_COOKIE, setOAuthState, checkOAuthState };

'use strict'
// Small shared helpers: HTML escaping, redirect-target allow-listing, and the
// password length policy.

const {
  AUTH_ORIGIN, PASSWORD_MIN, PASSWORD_MAX,
  LOCKOUT_FREE, LOCKOUT_BASE_MS, LOCKOUT_CAP_MS,
} = require('./config')
const { getAppOrigins } = require('./db')

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Allow redirect_to only when its origin is this service or a registered app —
// prevents open-redirect. Returns the original url (when allowed) or null.
function validateRedirectTo(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const allowed = [AUTH_ORIGIN, ...getAppOrigins()]
    return allowed.some(o => parsed.origin === o) ? url : null
  } catch {
    return null
  }
}

// Returns an error string if the password violates the length policy, else null.
// Max guards against bcrypt's silent 72-byte truncation + slow-hash DoS. (S3)
function passwordError(password) {
  const pw = password || ''
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`
  if (pw.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters`
  return null
}

// Recursive object-wise merge (ARCH-7.2): plain objects merge key-by-key so a
// PATCH of one preference slice (e.g. { theme }) never drops a sibling slice
// (e.g. { hud }) the way a shallow spread does. Arrays and scalars REPLACE (a
// caller sending an array means "this is the new array", not "append") — the
// documented contract the optimistic-lock retry relies on. Null/undefined
// patch values overwrite. Not for prototype-polluting keys.
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}
function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out
}

// Backoff (ms) the account must wait before its next login attempt, given how
// many have failed in a row. The first LOCKOUT_FREE failures are free; after
// that the delay doubles each time, capped at LOCKOUT_CAP_MS. (S6)
function loginBackoffMs(failedAttempts) {
  if (failedAttempts <= LOCKOUT_FREE) return 0
  const exp = failedAttempts - LOCKOUT_FREE - 1
  return Math.min(LOCKOUT_CAP_MS, LOCKOUT_BASE_MS * 2 ** exp)
}

module.exports = { escHtml, validateRedirectTo, passwordError, loginBackoffMs, deepMerge }

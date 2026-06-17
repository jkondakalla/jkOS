'use strict'
// Small shared helpers: HTML escaping, redirect-target allow-listing, and the
// password length policy.

const { AUTH_ORIGIN, PASSWORD_MIN, PASSWORD_MAX } = require('./config')
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

module.exports = { escHtml, validateRedirectTo, passwordError }

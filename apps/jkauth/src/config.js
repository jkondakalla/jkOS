'use strict'
// Centralised configuration — every env-derived constant lives here so the rest
// of the service reads from one place. Values are resolved once at require time.

const PORT = process.env.PORT || 3100
const DB_PATH = process.env.DB_PATH || './jkos-auth.db'
const PORTAL_URL = process.env.PORTAL_URL || 'https://jkos.net'
const AUTH_ORIGIN = process.env.AUTH_ORIGIN || 'https://auth.jkos.net'

const PRIVATE_KEY = (process.env.JKOS_AUTH_PRIVATE_KEY || '').replace(/\\n/g, '\n')
const PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').replace(/\\n/g, '\n')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`

const ADMIN_SEED_EMAIL = process.env.ADMIN_SEED_EMAIL || ''
const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || ''
const GUEST_PASSWORD = process.env.GUEST_PASSWORD || ''

const ACCESS_TTL_MS = 15 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000   // same as REFRESH_TTL_MS — explicit alias

// Grace window for refresh-token rotation: a token presented again within this
// window of being rotated is treated as a benign concurrent double-refresh (the
// SPA client dedups, but network retries / two tabs can race) rather than theft.
// Past the window, re-presenting a rotated token is reuse → revoke the family. (S2/S9)
// Overridable so tests can drive the reuse path without a real-time wait.
const REFRESH_GRACE_MS = process.env.REFRESH_GRACE_MS != null
  ? Number(process.env.REFRESH_GRACE_MS)
  : 10 * 1000

// Rate-limit budgets per window per IP. Credential endpoints stay tight; refresh
// is legitimately frequent (every access-token expiry) so it gets headroom. (S6)
// All overridable via env (tests raise them so the suite isn't throttled).
const numEnv = (k, d) => (process.env[k] != null ? Number(process.env[k]) : d)
const RL_WINDOW_MS = numEnv('RL_WINDOW_MS', 15 * 60 * 1000)
const RL_CREDENTIALS = numEnv('RL_CREDENTIALS', 10)   // /auth/login · /auth/register · /auth/guest
const RL_REFRESH = numEnv('RL_REFRESH', 120)          // /auth/refresh
const RL_GOOGLE = numEnv('RL_GOOGLE', 30)             // /auth/google · /auth/google/callback

// bcrypt silently truncates at 72 bytes; cap input length to avoid that footgun
// becoming load-bearing and to stop slow-hash DoS on absurd inputs. (S3)
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

// Cookie name suffix isolates environments that share a parent domain. Prod uses
// '' → jkos_token on .jkos.net; staging sets JKOS_COOKIE_SUFFIX=_staging →
// jkos_token_staging on staging.jkos.net. Without distinct names the prod cookie
// (sent to every *.jkos.net host) collides with the staging cookie and the
// server reads whichever the browser sends first — defeating env isolation.
const COOKIE_SUFFIX = process.env.JKOS_COOKIE_SUFFIX || ''
const TOKEN_COOKIE = 'jkos_token' + COOKIE_SUFFIX
const REFRESH_COOKIE = 'jkos_refresh' + COOKIE_SUFFIX
const OAUTH_NONCE_COOKIE = '_oauth_nonce' + COOKIE_SUFFIX   // env-suffixed too (S8)

const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.jkos.net'
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: true, path: '/', domain: COOKIE_DOMAIN }

const JWT_ISSUER = process.env.JKOS_AUTH_ISSUER || 'jkos-auth'
const JWT_KID = '1'   // matches /auth/jwks; gives key rotation a handle (S4)

module.exports = {
  PORT, DB_PATH, PORTAL_URL, AUTH_ORIGIN,
  PRIVATE_KEY, PUBLIC_KEY,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
  ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, GUEST_PASSWORD,
  ACCESS_TTL_MS, REFRESH_TTL_MS, REMEMBER_TTL_MS, REFRESH_GRACE_MS,
  RL_WINDOW_MS, RL_CREDENTIALS, RL_REFRESH, RL_GOOGLE,
  PASSWORD_MIN, PASSWORD_MAX,
  COOKIE_SUFFIX, TOKEN_COOKIE, REFRESH_COOKIE, OAUTH_NONCE_COOKIE,
  COOKIE_DOMAIN, COOKIE_OPTS,
  JWT_ISSUER, JWT_KID,
}

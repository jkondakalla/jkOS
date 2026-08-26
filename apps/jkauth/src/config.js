'use strict'
// Centralised configuration — every env-derived constant lives here so the rest
// of the service reads from one place. Values are resolved once at require time.

// Identity contract (issuer default + cookie naming) comes from the canonical
// @jkos/auth-middleware so jkAuth (the PRODUCER) and the verifiers share one source
// instead of independently re-typing 'jkos-auth' / 'jkos_token'.
const { resolveIssuer, cookieName, ACCESS_COOKIE_BASE } = require('@jkos/auth-middleware')

const PORT = process.env.PORT || 3100
const DB_PATH = process.env.DB_PATH || './jkos-auth.db'
const PORTAL_URL = process.env.PORTAL_URL || 'https://jkos.net'
const AUTH_ORIGIN = process.env.AUTH_ORIGIN || 'https://auth.jkos.net'

const PRIVATE_KEY = (process.env.JKOS_AUTH_PRIVATE_KEY || '').replace(/\\n/g, '\n')
const PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').replace(/\\n/g, '\n')

// Optional second public key published alongside the active one in /auth/jwks, so
// verifiers can pick up a new key BEFORE jkAuth starts signing with it (zero-
// downtime rotation, U3). To rotate: set *_NEXT to the new public key + a new
// kid, deploy, let caches warm, then promote NEXT to the active signing key.
const PUBLIC_KEY_NEXT = (process.env.JKOS_AUTH_PUBLIC_KEY_NEXT || '').replace(/\\n/g, '\n')

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
// 30 credential POSTs per IP per window, not 10: one address is one HOUSEHOLD
// (NAT) or one carrier (CGNAT), not one person, and a 15-minute wall after ten
// mistyped passwords is a lockout in everything but name. The per-account
// exponential backoff is what actually costs an attacker time — it makes 30
// attempts against a single account take minutes on its own.
const RL_CREDENTIALS = numEnv('RL_CREDENTIALS', 30)   // /auth/login · /auth/register · /auth/guest
const RL_REFRESH = numEnv('RL_REFRESH', 120)          // /auth/refresh

// Passwords are SHA-256 pre-hashed before bcrypt (see src/password.js), so the
// 72-byte bcrypt truncation no longer applies — but we still cap input length to
// stop a slow-hash DoS on absurd inputs and to keep the min a real policy. (S3/U1)
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const BCRYPT_COST = numEnv('BCRYPT_COST', 12)

// Per-account login throttle (S6). After LOCKOUT_FREE failed attempts the next
// attempt must wait an exponentially growing delay (LOCKOUT_BASE_MS, doubling)
// capped at LOCKOUT_CAP_MS. A soft backoff, not a hard lock — a known victim
// can't be permanently DoS'd out of their account, and a success resets it.
const LOCKOUT_FREE = numEnv('LOCKOUT_FREE', 3)
const LOCKOUT_BASE_MS = numEnv('LOCKOUT_BASE_MS', 1000)
const LOCKOUT_CAP_MS = numEnv('LOCKOUT_CAP_MS', 30 * 1000)

// Cookie name suffix isolates environments that share a parent domain. Prod uses
// '' → jkos_token on .jkos.net; staging sets JKOS_COOKIE_SUFFIX=_staging →
// jkos_token_staging on staging.jkos.net. Without distinct names the prod cookie
// (sent to every *.jkos.net host) collides with the staging cookie and the
// server reads whichever the browser sends first — defeating env isolation.
const COOKIE_SUFFIX = process.env.JKOS_COOKIE_SUFFIX || ''
// Built through the shared cookieName() so the suffix-application rule (and the
// access-cookie base the verifiers read) live in one place. jkos_refresh is a
// jkAuth-internal base; jkos_token is the cross-system contract.
const TOKEN_COOKIE = cookieName(ACCESS_COOKIE_BASE)
const REFRESH_COOKIE = cookieName('jkos_refresh')

const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.jkos.net'
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: true, path: '/', domain: COOKIE_DOMAIN }

// Service-to-service clients (client-credentials grant at POST /auth/token).
// Format: JKOS_SERVICE_CLIENTS = "id:secret:scopeA|scopeB,id2:secret2:scopeC"
// — a comma list of clients, each "<clientId>:<secret>:<pipe-separated scopes>".
// A client may only ever be granted scopes from its own configured set. Unset →
// the endpoint refuses (503); no service tokens exist until an operator opts in.
function parseServiceClients(raw) {
  const out = {}
  for (const entry of String(raw || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const i = entry.indexOf(':')
    const j = entry.indexOf(':', i + 1)
    if (i < 0 || j < 0) continue
    const id = entry.slice(0, i)
    const secret = entry.slice(i + 1, j)
    const scopes = entry.slice(j + 1).split('|').map(s => s.trim()).filter(Boolean)
    if (id && secret) out[id] = { secret, scopes }
  }
  return out
}
const SERVICE_CLIENTS = parseServiceClients(process.env.JKOS_SERVICE_CLIENTS)

// On-behalf-of delegation (G1). A service client listed here MAY mint a token that
// acts AS a user (POST /auth/token with on_behalf_of=<userId> → an `act` claim), so a
// trusted automation backend (the trigger engine) can write per-user data that the
// weave write-gate would otherwise reject (NO_USER_CONTEXT). Opt-in + separate from
// the scope grant: a normal service client can NEVER act as a user. Comma list of
// client ids. Unset → no client may delegate. The client still presents its secret
// AND must hold the target app's write scope — delegation only supplies the WHO.
const DELEGATION_CLIENTS = new Set(
  String(process.env.JKOS_DELEGATION_CLIENTS || '').split(',').map(s => s.trim()).filter(Boolean)
)

const JWT_ISSUER = resolveIssuer()   // shared default ('jkos-auth'), JKOS_AUTH_ISSUER overrides
// kid of the ACTIVE signing key (must appear in /auth/jwks). Env-overridable so a
// rotation can advance it without a code change. (S4/U3)
const JWT_KID = process.env.JKOS_AUTH_KID || '1'
const JWT_KID_NEXT = process.env.JKOS_AUTH_KID_NEXT || '2'   // kid for PUBLIC_KEY_NEXT

module.exports = {
  PORT, DB_PATH, PORTAL_URL, AUTH_ORIGIN,
  PRIVATE_KEY, PUBLIC_KEY, PUBLIC_KEY_NEXT,
  ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, GUEST_PASSWORD,
  ACCESS_TTL_MS, REFRESH_TTL_MS, REMEMBER_TTL_MS, REFRESH_GRACE_MS,
  RL_WINDOW_MS, RL_CREDENTIALS, RL_REFRESH,
  PASSWORD_MIN, PASSWORD_MAX, BCRYPT_COST,
  LOCKOUT_FREE, LOCKOUT_BASE_MS, LOCKOUT_CAP_MS,
  COOKIE_SUFFIX, TOKEN_COOKIE, REFRESH_COOKIE,
  COOKIE_DOMAIN, COOKIE_OPTS,
  JWT_ISSUER, JWT_KID, JWT_KID_NEXT,
  SERVICE_CLIENTS, DELEGATION_CLIENTS,
}

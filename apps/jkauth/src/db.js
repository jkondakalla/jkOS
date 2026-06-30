'use strict'
// Database layer: opens the SQLite handle, runs migrations + seeds (on require,
// once, exactly as the old monolith did at startup), and exposes the tiny
// run/all/get helpers plus the cached app-origin list used for CORS + redirect
// validation.

const Database = require('better-sqlite3')
const { registrySeed } = require('@jkos/suite-manifest')
const { DB_PATH, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, GUEST_PASSWORD } = require('./config')
const { hashPasswordSync } = require('./password')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const run = (sql, p = []) => db.prepare(sql).run(...p)
const all = (sql, p = []) => db.prepare(sql).all(...p)
const get = (sql, p = []) => db.prepare(sql).get(...p)

// Idempotent column-add: ALTER only when the column is absent. Lets each
// migration self-heal a DB that recorded its marker without the column (the
// symptom of an earlier ordering bug) and is a no-op once present.
function addColumn(table, column, decl) {
  const exists = all(`PRAGMA table_info(${table})`).some(c => c.name === column)
  if (!exists) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}

// Ordered migration list. Each [id, fn] runs once (recorded in `migrations`) and
// in array order — later entries ALTER tables earlier ones create, so do NOT
// reorder. The bodies are written to be safe to re-run (CREATE IF NOT EXISTS /
// addColumn), so a half-applied DB heals on next boot.
const MIGRATIONS = [
  ['001_init', () => {
    run(`CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT,
      avatar_url    TEXT,
      password_hash TEXT,
      google_id     TEXT UNIQUE,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login    TEXT
    )`)
    run(`CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL,
      app_id      TEXT,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    run(`CREATE TABLE IF NOT EXISTS app_registry (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      origin        TEXT NOT NULL,
      icon_url      TEXT,
      allowed_roles TEXT NOT NULL DEFAULT 'user,admin'
    )`)
    run(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)`)
    run(`CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id)`)
  }],

  // Cross-app preferences blob on the user row.
  ['002_user_preferences', () => addColumn('users', 'preferences', "TEXT NOT NULL DEFAULT '{}'")],

  // Whether a session was created with "Remember me" — the refresh endpoint
  // re-issues persistent cookies only when this is set.
  ['003_remember_me', () => addColumn('sessions', 'remember_me', 'INTEGER NOT NULL DEFAULT 0')],

  // Refresh-token rotation lineage (S2/S9): family_id groups every rotation of
  // one login; rotated_at marks a token as consumed so re-presenting it is
  // detectable as reuse (→ revoke the whole family).
  ['004_session_family', () => {
    addColumn('sessions', 'family_id', 'TEXT')
    addColumn('sessions', 'rotated_at', 'TEXT')
    run(`CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id)`)
  }],

  // Audit trail (S5): durable record of auth events for review + abuse detection.
  ['005_auth_events', () => {
    run(`CREATE TABLE IF NOT EXISTS auth_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      type       TEXT NOT NULL,
      ip         TEXT,
      ua         TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    run(`CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id)`)
    run(`CREATE INDEX IF NOT EXISTS idx_auth_events_time ON auth_events(created_at)`)
  }],

  // Password hashing scheme marker (U1/S3). NULL = legacy bcrypt-on-raw-password;
  // 'sha256-bcrypt' = the current SHA-256-prehash→bcrypt scheme. Legacy rows are
  // rehashed on next successful login.
  ['006_password_hashing', () => addColumn('users', 'hash_algo', 'TEXT')],

  // Per-account login throttle (S6): failed_attempts drives an exponential
  // backoff; lockout_until is the soft "no attempt before" timestamp. No hard
  // lock — backoff is capped — so a known victim can't be DoS'd out of their
  // account.
  ['007_account_lockout', () => {
    addColumn('users', 'failed_attempts', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('users', 'lockout_until', 'TEXT')
  }],

  // Two-factor (U6): a TOTP shared secret (set at setup, only trusted once a
  // first code verifies → totp_enabled), and an email-OTP opt-in flag.
  ['008_two_factor', () => {
    addColumn('users', 'totp_secret', 'TEXT')
    addColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('users', 'email_2fa_enabled', 'INTEGER NOT NULL DEFAULT 0')
  }],

  // Single-use TOTP recovery codes (U6). Stored as SHA-256 hashes; consumed by
  // stamping used_at.
  ['009_recovery_codes', () => {
    run(`CREATE TABLE IF NOT EXISTS recovery_codes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash  TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    run(`CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id)`)
  }],

  // Short-lived email one-time passcodes (U6). Stored hashed; expire fast and are
  // consumed by stamping used_at. purpose lets the same table serve login 2FA and
  // any future flows (e.g. email verification).
  ['010_email_otp', () => {
    run(`CREATE TABLE IF NOT EXISTS auth_otp (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash  TEXT NOT NULL,
      purpose    TEXT NOT NULL DEFAULT 'login',
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    run(`CREATE INDEX IF NOT EXISTS idx_auth_otp_user ON auth_otp(user_id)`)
  }],

  // Suite-wide widget registry (ORDECK v3 workshop). Admins publish declarative
  // widget definitions here; every HUD reads them and can place them. `def` is the
  // full WidgetDef JSON; id/label are denormalized for listing/ordering.
  ['011_widget_registry', () => {
    run(`CREATE TABLE IF NOT EXISTS widget_registry (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      def         TEXT NOT NULL,
      created_by  INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  }],

  // Suite fabric (Weave): integration metadata on the app directory so the
  // portal's manifest can hydrate from the registry as the single source of
  // truth — where each app's edge-proxied API lives (api_base), how to probe it
  // (health_path), where its capability declaration is (capabilities_path), and
  // whether it's gated by the suite-wide AI kill switch (ai). Backfilled for the
  // seeded apps because seedAppRegistry only inserts MISSING rows — existing rows
  // would otherwise keep NULL metadata.
  ['012_app_registry_weave', () => {
    addColumn('app_registry', 'api_base', 'TEXT')
    addColumn('app_registry', 'health_path', 'TEXT')
    addColumn('app_registry', 'capabilities_path', 'TEXT')
    addColumn('app_registry', 'ai', 'INTEGER NOT NULL DEFAULT 0')
    const meta = {
      beigeboard: { api_base: '/api/bb',    health_path: '/health/bb',      capabilities_path: '/api/bb/capabilities', ai: 0 },
      sylibos:    { api_base: '/api/sylib', health_path: '/health/sylibos', capabilities_path: null,                   ai: 0 },
      auth:       { api_base: null,         health_path: '/health/auth',    capabilities_path: null,                   ai: 0 },
    }
    for (const [id, m] of Object.entries(meta)) {
      run('UPDATE app_registry SET api_base=?, health_path=?, capabilities_path=?, ai=? WHERE id=?',
        [m.api_base, m.health_path, m.capabilities_path, m.ai, id])
    }
  }],

  // Suite fabric (Weave) READ contract: where each app's dataset declaration lives
  // (datasets_path) — the read-side twin of capabilities_path, so the portal's
  // manifest hydrates DatasetDoc discovery from the registry too. Backfilled for the
  // apps that publish one (BeigeBoard); the rest stay NULL (no readable datasets).
  ['013_app_registry_datasets', () => {
    addColumn('app_registry', 'datasets_path', 'TEXT')
    run("UPDATE app_registry SET datasets_path='/api/bb/datasets' WHERE id='beigeboard'")
  }],

  // Edge-slug canonicalization (ToDo A1): BeigeBoard's edge token is now its id
  // (`/api/beigeboard`) instead of the old `bb` slug, derived from @jkos/suite-manifest.
  // seedAppRegistry only INSERTS missing rows, so existing DBs (seeded with the /api/bb
  // paths by migrations 012/013) need an in-place update to the canonical values.
  ['014_canonical_beigeboard_edge', () => {
    const bb = registrySeed().find((r) => r.id === 'beigeboard')
    run('UPDATE app_registry SET api_base=?, health_path=?, capabilities_path=?, datasets_path=? WHERE id=?',
      [bb.api_base, bb.health_path, bb.capabilities_path, bb.datasets_path, 'beigeboard'])
  }],

  // LazurOS joins the registry (was registry:false, internal-gateway-only) for the
  // Weave refactor: a row makes its capability scopes (lazuros:write) role-gated and
  // lets the portal hydrate its ai/capabilities/datasets metadata. seedAppRegistry
  // only runs on fresh DBs, so existing DBs need this one INSERT — pulled from the
  // single source (registrySeed) so it can't drift from the seed/manifest/nginx. Its
  // origin is '' (no browsable origin); the launcher skips origin-less rows.
  ['015_lazuros_registry', () => {
    const lz = registrySeed().find((r) => r.id === 'lazuros')
    if (lz && !get('SELECT 1 FROM app_registry WHERE id=?', ['lazuros'])) {
      run(`INSERT INTO app_registry (id, name, origin, icon_url, allowed_roles, api_base, health_path, capabilities_path, datasets_path, ai)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [lz.id, lz.name, lz.origin, lz.icon_url, lz.allowed_roles, lz.api_base, lz.health_path, lz.capabilities_path, lz.datasets_path, lz.ai])
    }
  }],
]

function runMigrations() {
  run(`CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY)`)
  const applied = id => !!get('SELECT 1 FROM migrations WHERE id=?', [id])
  for (const [id, fn] of MIGRATIONS) {
    if (applied(id)) continue
    fn()
    run('INSERT INTO migrations VALUES (?)', [id])
  }
}

// Append an audit event. Never throws into the request path — auditing must not
// be able to fail a login/refresh. (S5)
function logEvent(type, userId, req, meta) {
  try {
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null
    const ua = (req?.headers?.['user-agent'] || '').slice(0, 300) || null
    run('INSERT INTO auth_events (user_id, type, ip, ua, meta) VALUES (?,?,?,?,?)',
      [userId ?? null, String(type).slice(0, 64), ip, ua, meta ? JSON.stringify(meta).slice(0, 500) : null])
  } catch (e) {
    console.error('[audit]', e.message)
  }
}

function seedAdmin() {
  if (!ADMIN_SEED_EMAIL || !ADMIN_SEED_PASSWORD) return
  const email = ADMIN_SEED_EMAIL.toLowerCase()
  if (get('SELECT 1 FROM users WHERE email=?', [email])) return
  const { hash, algo } = hashPasswordSync(ADMIN_SEED_PASSWORD)
  run('INSERT INTO users (email, name, password_hash, hash_algo, role) VALUES (?,?,?,?,?)',
    [email, email.split('@')[0], hash, algo, 'admin'])
  console.log('[boot] admin seeded:', email)
}

function seedGuest() {
  if (!GUEST_PASSWORD) return
  if (get("SELECT 1 FROM users WHERE email='guest@jkos.net'")) return
  const { hash, algo } = hashPasswordSync(GUEST_PASSWORD)
  run('INSERT INTO users (email, name, password_hash, hash_algo, role) VALUES (?,?,?,?,?)',
    ['guest@jkos.net', 'Guest', hash, algo, 'guest'])
  console.log('[boot] guest user seeded')
}

function seedAppRegistry() {
  // Integration metadata (api_base/health_path/capabilities_path/datasets_path/ai)
  // DERIVES from the single source (@jkos/suite-manifest) — the same APPS table the
  // Weave manifest and nginx peer config build from, so this seed can't drift from
  // them (ToDo A2). Seeds fresh DBs here; existing DBs are backfilled by migrations
  // 012–014. Edit an app in @jkos/suite-manifest, not here.
  const defaults = registrySeed()
  for (const app of defaults) {
    if (!get('SELECT 1 FROM app_registry WHERE id=?', [app.id])) {
      run(`INSERT INTO app_registry (id, name, origin, icon_url, allowed_roles, api_base, health_path, capabilities_path, datasets_path, ai)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [app.id, app.name, app.origin, app.icon_url, app.allowed_roles, app.api_base, app.health_path, app.capabilities_path, app.datasets_path, app.ai])
    }
  }
}

// In-memory cache of app origins loaded at startup — app_registry only changes
// via seedAppRegistry (at boot) or direct DB edits (which require a restart).
let _cachedAppOrigins = null
function getAppOrigins() {
  if (!_cachedAppOrigins) {
    _cachedAppOrigins = all('SELECT origin FROM app_registry').map(r => r.origin)
  }
  return _cachedAppOrigins
}

// origin → app id, cached. Used to stamp an access token's `azp` (provenance:
// which app the session was minted through) from the login redirect / request
// origin. Same restart-to-refresh contract as getAppOrigins.
let _cachedOriginToId = null
function appIdForOrigin(origin) {
  if (!origin) return null
  if (!_cachedOriginToId) {
    _cachedOriginToId = new Map(all('SELECT id, origin FROM app_registry').map(r => [r.origin, r.id]))
  }
  return _cachedOriginToId.get(origin) || null
}

// Registry-derived token claims for a role, cached per role. `aud` is the set of
// app ids the role may access (allowed_roles ⊇ role) — each app verifies its own
// id ∈ aud, giving real audience enforcement without breaking the single shared
// SSO cookie. `scope` is the named-scope grant derived from the same set:
// <app>:read for every reachable app, +<app>:write for non-guests, +<app>:admin
// for admins, plus a suite-wide suite:admin. Capabilities declare required scopes
// and the resource app checks token.scope ⊇ required. Cached because app_registry
// only changes on restart (same contract as the other caches above).
const _cachedRoleClaims = new Map()
function roleClaims(role) {
  if (_cachedRoleClaims.has(role)) return _cachedRoleClaims.get(role)
  const aud = []
  const scope = []
  for (const r of all('SELECT id, allowed_roles FROM app_registry')) {
    const roles = String(r.allowed_roles || '').split(',').map(s => s.trim())
    if (!roles.includes(role)) continue
    aud.push(r.id)
    scope.push(`${r.id}:read`)
    if (role !== 'guest') scope.push(`${r.id}:write`)
    if (role === 'admin') scope.push(`${r.id}:admin`)
  }
  if (role === 'admin') scope.push('suite:admin')
  const claims = { aud, scope }
  _cachedRoleClaims.set(role, claims)
  return claims
}

runMigrations()
seedAdmin()
seedGuest()
seedAppRegistry()

module.exports = { db, run, all, get, getAppOrigins, appIdForOrigin, roleClaims, logEvent }

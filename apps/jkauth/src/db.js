'use strict'
// Database layer: opens the SQLite handle, runs migrations + seeds (on require,
// once, exactly as the old monolith did at startup), and exposes the tiny
// run/all/get helpers plus the cached app-origin list used for CORS + redirect
// validation.

const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const { DB_PATH, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, GUEST_PASSWORD } = require('./config')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const run = (sql, p = []) => db.prepare(sql).run(...p)
const all = (sql, p = []) => db.prepare(sql).all(...p)
const get = (sql, p = []) => db.prepare(sql).get(...p)

function runMigrations() {
  run(`CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY)`)

  const applied = id => !!get('SELECT 1 FROM migrations WHERE id=?', [id])

  // Migrations run in dependency order: 001_init creates the base tables, then
  // later migrations alter them. Do NOT reorder — 002 ALTERs the users table that
  // 001 creates, so on a fresh DB 001 must run first.
  if (!applied('001_init')) {
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
    run(`INSERT INTO migrations VALUES ('001_init')`)
  }

  // Ensure the preferences column exists on every boot, independent of the
  // migration marker. This self-heals DBs that recorded 002 without actually
  // adding the column (the symptom of an earlier ordering bug) and is a no-op
  // once the column is present.
  const hasPreferences = all(`PRAGMA table_info(users)`).some(c => c.name === 'preferences')
  if (!hasPreferences) {
    run(`ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}'`)
  }
  if (!applied('002_user_preferences')) {
    run(`INSERT INTO migrations VALUES ('002_user_preferences')`)
  }

  // 003_remember_me: tracks whether a session was created with "Remember me".
  // The refresh endpoint re-issues with persistent cookies only when this is set.
  const hasRememberMe = all(`PRAGMA table_info(sessions)`).some(c => c.name === 'remember_me')
  if (!hasRememberMe) {
    run(`ALTER TABLE sessions ADD COLUMN remember_me INTEGER NOT NULL DEFAULT 0`)
  }
  if (!applied('003_remember_me')) {
    run(`INSERT INTO migrations VALUES ('003_remember_me')`)
  }
}

function seedAdmin() {
  if (!ADMIN_SEED_EMAIL || !ADMIN_SEED_PASSWORD) return
  const email = ADMIN_SEED_EMAIL.toLowerCase()
  if (get('SELECT 1 FROM users WHERE email=?', [email])) return
  const hash = bcrypt.hashSync(ADMIN_SEED_PASSWORD, 12)
  run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
    [email, email.split('@')[0], hash, 'admin'])
  console.log('[boot] admin seeded:', email)
}

function seedGuest() {
  if (!GUEST_PASSWORD) return
  if (get("SELECT 1 FROM users WHERE email='guest@jkos.net'")) return
  const hash = bcrypt.hashSync(GUEST_PASSWORD, 12)
  run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
    ['guest@jkos.net', 'Guest', hash, 'guest'])
  console.log('[boot] guest user seeded')
}

function seedAppRegistry() {
  const defaults = [
    { id: 'beigeboard', name: 'BeigeBoard', origin: 'https://beigeboard.jkos.net', icon_url: null, allowed_roles: 'user,admin,guest' },
    { id: 'sylibos',    name: 'SylibOS',    origin: 'https://sylibos.jkos.net',    icon_url: null, allowed_roles: 'user,admin' },
    { id: 'auth',       name: 'jkOS Auth',  origin: 'https://auth.jkos.net',       icon_url: null, allowed_roles: 'user,admin,guest' },
    { id: 'ordeck',     name: 'ORDECK',     origin: 'https://jkos.net',            icon_url: null, allowed_roles: 'user,admin' },
    { id: 'staging',    name: 'Staging',    origin: 'https://staging.jkos.net',    icon_url: null, allowed_roles: 'admin' },
  ]
  for (const app of defaults) {
    if (!get('SELECT 1 FROM app_registry WHERE id=?', [app.id])) {
      run('INSERT INTO app_registry (id, name, origin, icon_url, allowed_roles) VALUES (?,?,?,?,?)',
        [app.id, app.name, app.origin, app.icon_url, app.allowed_roles])
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

runMigrations()
seedAdmin()
seedGuest()
seedAppRegistry()

module.exports = { db, run, all, get, getAppOrigins }

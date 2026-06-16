'use strict'
const express = require('express')
const cookieParser = require('cookie-parser')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const path = require('path')
const rateLimit = require('express-rate-limit')
// Google OAuth is three plain HTTPS calls (auth URL, token exchange, userinfo)
// done with Node 20's global fetch — no googleapis SDK. Dropping that 116 MB
// dependency is what makes this image build in ~1 min instead of several.

const PORT = process.env.PORT || 3100
const DB_PATH = process.env.DB_PATH || './jkos-auth.db'
const PORTAL_URL = process.env.PORTAL_URL || 'https://jkos.net'
const PRIVATE_KEY = (process.env.JKOS_AUTH_PRIVATE_KEY || '').replace(/\\n/g, '\n')
const PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').replace(/\\n/g, '\n')
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`
const ADMIN_SEED_EMAIL = process.env.ADMIN_SEED_EMAIL || ''
const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || ''
const GUEST_PASSWORD = process.env.GUEST_PASSWORD || ''

// Pre-computed hash used in the login path when the email doesn't exist, so bcrypt
// always runs and the response time doesn't reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('_timing_sentinel_' + crypto.randomBytes(16).toString('hex'), 12)

const ACCESS_TTL_MS = 15 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000   // same as REFRESH_TTL_MS — explicit alias
// Cookie name suffix isolates environments that share a parent domain. Prod uses
// '' → jkos_token on .jkos.net; staging sets JKOS_COOKIE_SUFFIX=_staging →
// jkos_token_staging on staging.jkos.net. Without distinct names the prod cookie
// (sent to every *.jkos.net host) collides with the staging cookie and the
// server reads whichever the browser sends first — defeating env isolation.
const COOKIE_SUFFIX = process.env.JKOS_COOKIE_SUFFIX || ''
const TOKEN_COOKIE = 'jkos_token' + COOKIE_SUFFIX
const REFRESH_COOKIE = 'jkos_refresh' + COOKIE_SUFFIX
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.jkos.net'
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: true, path: '/', domain: COOKIE_DOMAIN }
const JWT_ISSUER = process.env.JKOS_AUTH_ISSUER || 'jkos-auth'

// ── Database ─────────────────────────────────────────────────────────────────

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

runMigrations()

// ── Seed ─────────────────────────────────────────────────────────────────────

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

seedAdmin()
seedGuest()
seedAppRegistry()

// In-memory cache of app origins loaded at startup — app_registry only changes
// via seedAppRegistry (at boot) or direct DB edits (which require a restart).
let _cachedAppOrigins = null
function getAppOrigins() {
  if (!_cachedAppOrigins) {
    _cachedAppOrigins = all('SELECT origin FROM app_registry').map(r => r.origin)
  }
  return _cachedAppOrigins
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function signAccess(user) {
  if (!PRIVATE_KEY) throw new Error('JKOS_AUTH_PRIVATE_KEY not set')
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, role: user.role },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '15m', issuer: JWT_ISSUER }
  )
}

// remember=true  → both cookies get maxAge (persist across browser close for 30 days)
// remember=false → access cookie gets 15-min maxAge; refresh is session-only (no maxAge)
//                  — closes the browser = logged out
function issueTokens(res, user, remember = true) {
  const token = signAccess(user)
  const refresh = crypto.randomBytes(64).toString('hex')
  const refreshHash = crypto.createHash('sha256').update(refresh).digest('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString()
  run("DELETE FROM sessions WHERE user_id=? AND expires_at < datetime('now')", [user.id])
  run('INSERT INTO sessions (user_id, token_hash, expires_at, remember_me) VALUES (?,?,?,?)',
    [user.id, refreshHash, expiresAt, remember ? 1 : 0])
  // Cap active sessions per user at 10 to prevent unbounded accumulation
  run(`DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
    SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  )`, [user.id, user.id])
  res.cookie(TOKEN_COOKIE, token, { ...COOKIE_OPTS, maxAge: ACCESS_TTL_MS })
  if (remember) {
    res.cookie(REFRESH_COOKIE, refresh, { ...COOKIE_OPTS, maxAge: REMEMBER_TTL_MS })
  } else {
    // Session cookie — browser close clears it (no maxAge)
    res.cookie(REFRESH_COOKIE, refresh, { ...COOKIE_OPTS })
  }
}

function clearTokens(res) {
  const clear = { ...COOKIE_OPTS, maxAge: 0 }
  res.cookie(TOKEN_COOKIE, '', clear)
  res.cookie(REFRESH_COOKIE, '', clear)
}

// Find the live (unexpired) refresh-cookie session + its user, or null.
// The refresh cookie persists for 30 days when "Remember me" was checked; the
// 15-min access token does not. This is what lets a remembered session be
// revived after the access token has expired.
function liveSession(req) {
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (!refresh) return null
  const hash = crypto.createHash('sha256').update(refresh).digest('hex')
  const session = get("SELECT * FROM sessions WHERE token_hash=? AND expires_at > datetime('now')", [hash])
  if (!session) return null
  const user = get('SELECT * FROM users WHERE id=?', [session.user_id])
  return user ? { session, user, hash } : null
}

// Resolve the user for a server-rendered navigation: from the access token if
// present, else silently refresh from a valid remember-me session (mint a new
// access token + rotate the refresh token). This is the server-side equivalent
// of the SPA apps' getMe→refresh→getMe dance — without it, a remembered user
// returning to the jkAuth portal after the 15-min access token expired would be
// bounced to the login page despite holding a valid 30-day session. Safe to
// Set-Cookie here because these are real top-level navigations (unlike the
// nginx auth_request gate, which can't deliver Set-Cookie to the browser).
function resolveOrRefresh(req, res) {
  const jwtUser = resolveUser(req)
  if (jwtUser) return jwtUser
  const live = liveSession(req)
  if (!live) return null
  issueTokens(res, live.user, !!live.session.remember_me)
  run('DELETE FROM sessions WHERE token_hash=?', [live.hash])
  return { sub: live.user.id, email: live.user.email, name: live.user.name, avatar_url: live.user.avatar_url, role: live.user.role }
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url, role: u.role }
}

function validateRedirectTo(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const selfOrigin = process.env.AUTH_ORIGIN || `https://auth.jkos.net`
    const allowed = [selfOrigin, ...getAppOrigins()]
    return allowed.some(o => parsed.origin === o) ? url : null
  } catch {
    return null
  }
}

function resolveUser(req) {
  const token = req.cookies?.[TOKEN_COOKIE]
  if (!token || !PUBLIC_KEY) return null
  try {
    return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'], issuer: JWT_ISSUER })
  } catch {
    return null
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))
app.set('trust proxy', 1)

// CORS — allow registered app origins to call the auth API cross-origin
// (needed for POST /auth/refresh and POST /auth/logout called from app frontends)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    const allowed = getAppOrigins()
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Rate limit login and register — 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
})
app.use(['/auth/login', '/auth/register', '/auth/guest'], authLimiter)

// Prevent clickjacking on the server-rendered auth portal pages
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
  next()
})

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — jkOS</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`
}

function loginPage(opts = {}) {
  const { error, redirectTo, mode } = opts
  const redirectInput = redirectTo ? `<input type="hidden" name="redirect_to" value="${escHtml(redirectTo)}">` : ''
  const errorHtml = error ? `<p class="error">${escHtml(error)}</p>` : ''
  const googleEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
  const guestEnabled = !!GUEST_PASSWORD
  const isRegister = mode === 'register'
  const googleHref = `/auth/google${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}`

  return layout(isRegister ? 'Register' : 'Sign in', `
<div class="card">
  <h1 class="wordmark">jk<span>OS</span></h1>
  <p class="subtitle">${isRegister ? 'Create your account' : 'Sign in to your workspace'}</p>
  ${errorHtml}
  <form method="POST" action="${isRegister ? '/auth/register' : '/auth/login'}">
    ${redirectInput}
    ${isRegister ? '<input type="text" id="name" name="name" placeholder="Your name" required autocomplete="name">' : ''}
    <input type="email" id="email" name="email" placeholder="Email" required autocomplete="username" autocapitalize="none" spellcheck="false">
    <input type="password" id="password" name="password" placeholder="Password" required autocomplete="${isRegister ? 'new-password' : 'current-password'}">
    ${!isRegister ? `<label class="remember-row"><input type="checkbox" name="remember_me" value="1" checked> Remember me for 30 days</label>` : ''}
    <button type="submit" class="btn-primary">${isRegister ? 'Create account' : 'Sign in'}</button>
  </form>
  ${googleEnabled ? `<a href="${googleHref}" class="btn-google"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Continue with Google</a>` : ''}
  ${!isRegister && guestEnabled ? `<form method="POST" action="/auth/guest">${redirectInput}<button type="submit" class="btn-ghost">Continue as guest</button></form>` : ''}
  <p class="toggle">${isRegister
    ? `Already have an account? <a href="/auth/login${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}">Sign in</a>`
    : `No account? <a href="/auth/register${redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''}">Register</a>`
  }</p>
</div>`)
}

// jkOS portal — shown when a user navigates to jkAuth directly (vs. being
// bounced here to sign in for a specific app). App launcher + account + the
// suite-wide AI (LazurOS) controls. Interactive bits read/write /auth/profile.
function dashboardPage(user) {
  const src = (user.name || user.email || '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()
  const roleBadge = user.role && user.role !== 'user'
    ? `<span class="role">${escHtml(user.role)}</span>` : ''

  return layout('Portal', `
<style>
  body { display:block; align-items:initial; justify-content:initial; }
  .dash { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; display:flex; flex-direction:column; gap: 1.75rem; }
  .dash-top { display:flex; align-items:center; gap: 1rem; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; flex-shrink:0; display:grid; place-items:center;
    background: var(--accent); color:#fff; font-weight:700; font-size: 1rem; }
  .who { min-width:0; flex:1; }
  .who h1 { font-size: 1.15rem; font-weight: 700; letter-spacing:-0.01em; display:flex; align-items:center; gap:.5rem; }
  .who .email { color: var(--muted); font-size: .85rem; margin-top: 2px; }
  .role { font-size: .6rem; letter-spacing:.12em; text-transform:uppercase; color:#fff; background:var(--accent);
    padding: 2px 7px; border-radius: 999px; font-weight:600; }
  .sign-out { margin-left:auto; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.25rem 1.4rem; }
  .panel > h2 { font-size: .7rem; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 1rem; }
  .apps { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: .7rem; }
  .app { display:flex; align-items:center; gap:.7rem; padding:.8rem .9rem; border:1px solid var(--border); border-radius:10px;
    text-decoration:none; color:var(--text); background:var(--bg); transition: border-color .15s, transform .15s; }
  .app:hover { border-color: var(--accent); transform: translateY(-1px); }
  .app .ic { width:30px; height:30px; border-radius:8px; flex-shrink:0; display:grid; place-items:center;
    background: var(--accent); color:#fff; font-weight:700; font-size:.85rem; }
  .app .nm { font-weight:600; font-size:.9rem; }
  .muted-note { color: var(--muted); font-size: .85rem; }
  .row { display:flex; align-items:center; gap:.8rem; margin-top:.7rem; }
  .row label { width: 64px; flex-shrink:0; font-size:.82rem; color: var(--muted); }
  .row input[type=text] { flex:1; }
  .ai-head { display:flex; align-items:center; justify-content:space-between; margin-bottom: .25rem; }
  .ai-head h2 { margin-bottom: 0; }
  .switch { width: 46px; height: 26px; border-radius: 999px; border:1px solid var(--border); background:#ddd4cc;
    position:relative; cursor:pointer; transition: background .18s; flex-shrink:0; }
  .switch[aria-checked=true] { background: var(--accent); border-color: var(--accent); }
  .switch .knob { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff;
    transition: left .18s; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .switch[aria-checked=true] .knob { left: 22px; }
  .ai-body[data-off=true] { opacity:.45; pointer-events:none; }
  .ai-status { font-size:.8rem; color: var(--muted); margin-top:.6rem; min-height: 1em; }
</style>
<div class="dash">
  <div class="dash-top">
    <div class="avatar">${escHtml(inits)}</div>
    <div class="who">
      <h1>${escHtml(user.name || 'jkOS User')} ${roleBadge}</h1>
      <div class="email">${escHtml(user.email)}</div>
    </div>
    <form class="sign-out" method="POST" action="/auth/logout">
      <button type="submit" class="btn-ghost" style="width:auto;padding:.5rem .9rem;">Sign out</button>
    </form>
  </div>

  <section class="panel">
    <h2>Your apps</h2>
    <div class="apps" id="apps"><div class="muted-note">Loading…</div></div>
  </section>

  <section class="panel">
    <div class="ai-head">
      <h2>AI · LazurOS</h2>
      <div class="switch" id="ai-switch" role="switch" aria-checked="true" tabindex="0" title="Turn AI on/off across the suite">
        <span class="knob"></span>
      </div>
    </div>
    <p class="muted-note">One switch for AI across every jkOS app. Off hides LazurOS everywhere.</p>
    <div class="ai-body" id="ai-body">
      <div class="row"><label for="ai-url">Gateway</label><input type="text" id="ai-url" placeholder="http://host:8080" spellcheck="false"></div>
      <div class="row"><label for="ai-model">Model</label><input type="text" id="ai-model" placeholder="llama3.2" spellcheck="false"></div>
    </div>
    <div class="ai-status" id="ai-status"></div>
  </section>
</div>

<script>
'use strict';
const ROLE = ${JSON.stringify(user.role || 'user')};

// App launcher — registered apps this role may use (exclude jkAuth itself).
fetch('/auth/apps', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : { apps: [] })
  .then(({ apps }) => {
    const el = document.getElementById('apps');
    const list = (apps || []).filter(a =>
      a.id !== 'auth' && (a.allowed_roles || '').split(',').map(s => s.trim()).includes(ROLE));
    if (!list.length) { el.innerHTML = '<div class="muted-note">No apps available for your account.</div>'; return; }
    el.innerHTML = list.map(a => {
      const ic = (a.name || '?').trim()[0].toUpperCase();
      return '<a class="app" href="' + a.origin + '"><span class="ic">' + ic + '</span><span class="nm">' + a.name + '</span></a>';
    }).join('');
  })
  .catch(() => { document.getElementById('apps').innerHTML = '<div class="muted-note">Could not load apps.</div>'; });

// AI controls — backed by /auth/profile preferences.lazuros.
const sw = document.getElementById('ai-switch');
const body = document.getElementById('ai-body');
const urlEl = document.getElementById('ai-url');
const modelEl = document.getElementById('ai-model');
const status = document.getElementById('ai-status');
let lazuros = { enabled: true, url: '', model: 'llama3.2' };
let saveTimer = null;

function paint() {
  sw.setAttribute('aria-checked', String(!!lazuros.enabled));
  body.setAttribute('data-off', String(!lazuros.enabled));
}
function save() {
  status.textContent = 'Saving…';
  fetch('/auth/profile', {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { lazuros } }),
  }).then(r => { status.textContent = r.ok ? 'Saved' : 'Save failed'; })
    .catch(() => { status.textContent = 'Save failed'; });
}
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }

fetch('/auth/profile', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : null)
  .then(p => { if (p && p.preferences && p.preferences.lazuros) lazuros = Object.assign(lazuros, p.preferences.lazuros);
    urlEl.value = lazuros.url || ''; modelEl.value = lazuros.model || ''; paint(); })
  .catch(() => {});

sw.addEventListener('click', () => { lazuros.enabled = !lazuros.enabled; paint(); save(); });
sw.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); sw.click(); } });
urlEl.addEventListener('change', () => { lazuros.url = urlEl.value.trim(); queueSave(); });
modelEl.addEventListener('change', () => { lazuros.model = modelEl.value.trim(); queueSave(); });
</script>`)
}

// ── Auth routes ───────────────────────────────────────────────────────────────

// GET / → portal when signed in (direct navigation), else login
app.get('/', (req, res) => {
  const user = resolveOrRefresh(req, res)
  res.redirect(user ? '/auth/dashboard' : '/auth/login')
})

// GET /auth/dashboard — the jkOS portal
app.get('/auth/dashboard', (req, res) => {
  const jwtUser = resolveOrRefresh(req, res)
  if (!jwtUser) return res.redirect('/auth/login')
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) { clearTokens(res); return res.redirect('/auth/login') }
  res.send(dashboardPage(u))
})

// GET /auth/login — login page (HTML)
app.get('/auth/login', (req, res) => {
  const user = resolveOrRefresh(req, res)
  if (user) {
    // App-initiated login returns to the app; direct visits land on the portal.
    const dest = validateRedirectTo(req.query.redirect_to)
    return res.redirect(dest || '/auth/dashboard')
  }
  res.send(loginPage({ redirectTo: req.query.redirect_to }))
})

// GET /auth/register — register page (HTML)
app.get('/auth/register', (req, res) => {
  const user = resolveOrRefresh(req, res)
  if (user) return res.redirect('/auth/dashboard')
  res.send(loginPage({ redirectTo: req.query.redirect_to, mode: 'register' }))
})

// POST /auth/register (form + JSON)
app.post('/auth/register', async (req, res) => {
  const isJson = req.headers['content-type']?.includes('application/json')
  const { email, name, password, redirect_to } = req.body
  const normalEmail = (email || '').toLowerCase()
  if (!normalEmail || !password) {
    if (isJson) return res.status(400).json({ error: 'Email and password required' })
    return res.send(loginPage({ error: 'Email and password required', redirectTo: redirect_to, mode: 'register' }))
  }
  if (password.length < 8) {
    if (isJson) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    return res.send(loginPage({ error: 'Password must be at least 8 characters', redirectTo: redirect_to, mode: 'register' }))
  }
  if (get('SELECT 1 FROM users WHERE email=?', [normalEmail])) {
    if (isJson) return res.status(409).json({ error: 'Email already registered' })
    return res.send(loginPage({ error: 'Email already registered', redirectTo: redirect_to, mode: 'register' }))
  }
  try {
    const hash = await bcrypt.hash(password, 12)
    const userCount = get('SELECT COUNT(*) AS c FROM users').c
    const role = userCount === 0 ? 'admin' : 'user'
    const result = run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
      [normalEmail, (name || normalEmail.split('@')[0]).slice(0, 64), hash, role])
    const user = get('SELECT * FROM users WHERE id=?', [result.lastInsertRowid])
    issueTokens(res, user)
    if (isJson) return res.status(201).json({ user: publicUser(user) })
    const dest = validateRedirectTo(redirect_to) || '/auth/dashboard'
    res.redirect(dest)
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(e.message)) {
      if (isJson) return res.status(409).json({ error: 'Email already registered' })
      return res.send(loginPage({ error: 'Email already registered', redirectTo: redirect_to, mode: 'register' }))
    }
    console.error('[register]', e)
    if (isJson) return res.status(500).json({ error: 'Registration failed' })
    res.send(loginPage({ error: 'Registration failed', redirectTo: redirect_to, mode: 'register' }))
  }
})

// POST /auth/login (form + JSON)
app.post('/auth/login', async (req, res) => {
  const isJson = req.headers['content-type']?.includes('application/json')
  const { email, password, redirect_to, remember_me } = req.body
  const normalEmail = (email || '').toLowerCase()
  const user = get('SELECT * FROM users WHERE email=?', [normalEmail])
  // Always run bcrypt even when no user found to prevent timing-based user enumeration
  const hash = user?.password_hash ?? DUMMY_HASH
  const valid = await bcrypt.compare(password || '', hash) && !!user
  if (!valid) {
    if (isJson) return res.status(401).json({ error: 'Invalid email or password' })
    return res.send(loginPage({ error: 'Invalid email or password', redirectTo: redirect_to }))
  }
  run("UPDATE users SET last_login=datetime('now') WHERE id=?", [user.id])
  // JSON callers can pass remember_me boolean; form callers send '1' when checked.
  const remember = isJson ? !!remember_me : remember_me === '1'
  issueTokens(res, user, remember)
  if (isJson) return res.json({ user: publicUser(user) })
  const dest = validateRedirectTo(redirect_to) || '/auth/dashboard'
  res.redirect(dest)
})

// POST /auth/logout (form + JSON)
app.post('/auth/logout', (req, res) => {
  const isJson = req.headers['content-type']?.includes('application/json')
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (refresh) {
    const hash = crypto.createHash('sha256').update(refresh).digest('hex')
    run('DELETE FROM sessions WHERE token_hash=?', [hash])
  }
  clearTokens(res)
  if (isJson) return res.json({ ok: true })
  res.redirect('/auth/login')
})

// POST /auth/refresh — issue new access token
app.post('/auth/refresh', (req, res) => {
  const refresh = req.cookies?.[REFRESH_COOKIE]
  if (!refresh) return res.status(401).json({ error: 'No refresh token', code: 'UNAUTHENTICATED' })
  const hash = crypto.createHash('sha256').update(refresh).digest('hex')
  const session = get("SELECT * FROM sessions WHERE token_hash=? AND expires_at > datetime('now')", [hash])
  if (!session) { clearTokens(res); return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' }) }
  const user = get('SELECT * FROM users WHERE id=?', [session.user_id])
  if (!user) { clearTokens(res); return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' }) }
  try {
    issueTokens(res, user, !!session.remember_me)
    run('DELETE FROM sessions WHERE token_hash=?', [hash])
    res.json({ ok: true })
  } catch (e) {
    console.error('[refresh]', e)
    res.status(500).json({ error: 'Failed to issue token' })
  }
})

// GET /auth/require-admin — nginx auth_request target; returns only HTTP status codes, no redirects.
// Falls back to the refresh-cookie session (read-only — auth_request cannot deliver Set-Cookie to
// the browser, so we never rotate here) so a remembered admin whose 15-min access token has lapsed
// still passes the staging gate; the SPA behind it then refreshes its own access token.
app.get('/auth/require-admin', (req, res) => {
  const user = resolveUser(req) || liveSession(req)?.user
  if (!user) return res.status(401).json({ error: 'Authentication required' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  res.status(200).json({ ok: true })
})

// GET /auth/me — validate token, return user
app.get('/auth/me', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [user.sub])
  if (!u) { clearTokens(res); return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' }) }
  res.json({ user: publicUser(u) })
})

// GET /auth/profile — user info + cross-app preferences
app.get('/auth/profile', (req, res) => {
  const jwt = resolveUser(req)
  if (!jwt) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [jwt.sub])
  if (!u) return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' })
  let preferences = {}
  try { preferences = JSON.parse(u.preferences || '{}') } catch {}
  res.json({ user: publicUser(u), preferences })
})

// PATCH /auth/profile — update display name, avatar_url, or preferences (merge patch)
app.patch('/auth/profile', (req, res) => {
  const jwt = resolveUser(req)
  if (!jwt) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [jwt.sub])
  if (!u) return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' })

  const { name, avatar_url, preferences } = req.body ?? {}
  const setClauses = []
  const params = []

  if (typeof name === 'string') {
    setClauses.push('name = ?')
    params.push(name.trim().slice(0, 100))
  }
  if (avatar_url === null || typeof avatar_url === 'string') {
    setClauses.push('avatar_url = ?')
    params.push(avatar_url ? String(avatar_url).slice(0, 500) : null)
  }
  if (preferences !== null && typeof preferences === 'object') {
    let current = {}
    try { current = JSON.parse(u.preferences || '{}') } catch {}
    setClauses.push('preferences = ?')
    params.push(JSON.stringify({ ...current, ...preferences }))
  }

  if (setClauses.length > 0) {
    params.push(jwt.sub)
    run(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params)
  }
  res.json({ ok: true })
})

// POST /auth/guest — guest login (only when GUEST_PASSWORD is set)
app.post('/auth/guest', (req, res) => {
  const isJson = req.headers['content-type']?.includes('application/json')
  if (!GUEST_PASSWORD) {
    if (isJson) return res.status(403).json({ error: 'Guest access is not enabled' })
    return res.send(loginPage({ error: 'Guest access is not enabled' }))
  }
  const guest = get("SELECT * FROM users WHERE email='guest@jkos.net'")
  if (!guest) {
    if (isJson) return res.status(500).json({ error: 'Guest account not available' })
    return res.send(loginPage({ error: 'Guest account not available' }))
  }
  issueTokens(res, guest)
  if (isJson) {
    const { redirect_to } = req.body
    return res.json({ user: publicUser(guest), redirect_to: validateRedirectTo(redirect_to) })
  }
  const dest = validateRedirectTo(req.body?.redirect_to) || '/auth/dashboard'
  res.redirect(dest)
})

// GET /auth/apps — registered apps list (requires auth)
app.get('/auth/apps', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const apps = all('SELECT id, name, origin, icon_url, allowed_roles FROM app_registry ORDER BY name')
  res.json({ apps })
})

// GET /auth/jwks — RSA public key in JWKS format
app.get('/auth/jwks', (req, res) => {
  if (!PUBLIC_KEY) return res.status(503).json({ error: 'Public key not configured' })
  try {
    const keyObj = crypto.createPublicKey(PUBLIC_KEY)
    const jwk = keyObj.export({ format: 'jwk' })
    res.json({ keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: '1' }] })
  } catch {
    res.status(500).json({ error: 'Failed to export key' })
  }
})

// ── Google OAuth (native fetch — no googleapis SDK) ────────────────────────────

const GOOGLE_AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).send(loginPage({ error: 'Google sign-in is not configured' }))
  }
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = Buffer.from(JSON.stringify({
    redirect_to: req.query.redirect_to || '',
    nonce,
  })).toString('base64url')
  // Store nonce in a short-lived httpOnly cookie; verified on callback to prevent CSRF
  res.cookie('_oauth_nonce', nonce, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 10 * 60 * 1000, path: '/' })
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  })
  res.redirect(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`)
})

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.redirect('/auth/login?error=google_no_code')
  let redirectTo = ''
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    redirectTo = validateRedirectTo(parsed.redirect_to) || ''
    const storedNonce = req.cookies?._oauth_nonce
    if (!storedNonce || parsed.nonce !== storedNonce) {
      res.clearCookie('_oauth_nonce')
      return res.redirect('/auth/login?error=google_invalid_state')
    }
  } catch {
    res.clearCookie('_oauth_nonce')
    return res.redirect('/auth/login?error=google_invalid_state')
  }
  res.clearCookie('_oauth_nonce')
  try {
    // 1) Exchange the auth code for an access token.
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`)
    const tokens = await tokenRes.json()

    // 2) Fetch the user's basic profile (id, email, name, picture).
    const profileRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!profileRes.ok) throw new Error(`userinfo failed (${profileRes.status})`)
    const profile = await profileRes.json()

    const profileEmail = (profile.email || '').toLowerCase()
    let user = get('SELECT * FROM users WHERE google_id=?', [profile.id])
    if (!user) user = get('SELECT * FROM users WHERE email=?', [profileEmail])
    if (user) {
      run('UPDATE users SET google_id=?, avatar_url=?, last_login=datetime("now") WHERE id=?',
        [profile.id, profile.picture, user.id])
      user = get('SELECT * FROM users WHERE id=?', [user.id])
    } else {
      const userCount = get('SELECT COUNT(*) AS c FROM users').c
      const role = userCount === 0 ? 'admin' : 'user'
      const result = run('INSERT INTO users (email, name, avatar_url, google_id, role) VALUES (?,?,?,?,?)',
        [profileEmail, profile.name, profile.picture, profile.id, role])
      user = get('SELECT * FROM users WHERE id=?', [result.lastInsertRowid])
    }
    issueTokens(res, user)
    res.redirect(redirectTo || '/auth/dashboard')
  } catch (e) {
    console.error('[google callback]', e)
    res.redirect('/auth/login?error=google_failed')
  }
})

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true }))

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`[jkos-auth] listening on :${PORT}`))

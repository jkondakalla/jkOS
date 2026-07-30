'use strict'
// Identity routes — strictly "who are you": the nginx admin gate plus the user's
// own record and preferences. The suite directory (apps/widgets/events/jwks) now
// lives in routes/weave.js; this file is auth-core-adjacent and intentionally small.
// /auth/me, /auth/profile (GET/PATCH), /auth/require-admin.

const express = require('express')
const { get, run } = require('../db')
const { deepMerge } = require('../util')
const { resolveUser, liveSession, clearTokens, publicUser } = require('../tokens')

const router = express.Router()

// GET /auth/require-admin — nginx auth_request target; returns only HTTP status codes, no redirects.
// Falls back to the refresh-cookie session (read-only — auth_request cannot deliver Set-Cookie to
// the browser, so we never rotate here) so a remembered admin whose 15-min access token has lapsed
// still passes the staging gate; the SPA behind it then refreshes its own access token.
router.get('/auth/require-admin', (req, res) => {
  const user = resolveUser(req) || liveSession(req)?.user
  if (!user) return res.status(401).json({ error: 'Authentication required' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  res.status(200).json({ ok: true })
})

// GET /auth/me — validate token, return user
router.get('/auth/me', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [user.sub])
  if (!u) { clearTokens(res); return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' }) }
  res.json({ user: publicUser(u) })
})

// GET /auth/profile — user info + cross-app preferences. `prefs_version` is the
// optimistic-lock cursor (ARCH-7.2): a client echoes it back on PATCH so a write
// built on a stale blob is rejected instead of silently clobbering a concurrent one.
router.get('/auth/profile', (req, res) => {
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' })
  let preferences = {}
  // Serving {} for an unparseable blob is right (the client gets a usable baseline and
  // its next PATCH repairs the row), but it must not be SILENT: this server is the only
  // writer and always writes JSON.stringify, so a parse failure means the row was damaged
  // from outside, and that is worth knowing about.
  try { preferences = JSON.parse(u.preferences || '{}') }
  catch (e) { console.error(`[profile] user ${u.id} has an unparseable preferences blob:`, e.message) }
  res.json({ user: publicUser(u), preferences, prefs_version: u.prefs_version ?? 0 })
})

// PATCH /auth/profile — update display name, avatar_url, or preferences.
//
// Preferences are DEEP-merged (object-wise; arrays/scalars replace) so two tabs
// editing different slices — say ORDECK's HUD layout and the theme — no longer
// clobber each other the way a shallow spread did (ARCH-7.2 / G8). On top of that,
// an OPTIONAL optimistic lock: when the body carries `prefs_version`, it must equal
// the stored version or the write is refused with 409 CONFLICT + the current
// {prefs_version, preferences} so the client can re-apply its slice onto the fresh
// blob and retry. A client that omits prefs_version (e.g. a fire-and-forget HUD
// autosave) skips the check — it still deep-merges, so it can't drop a sibling slice.
router.patch('/auth/profile', (req, res) => {
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' })

  const { name, avatar_url, preferences, prefs_version } = req.body ?? {}
  const version = u.prefs_version ?? 0
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
  let bumpedVersion = version
  if (preferences !== null && typeof preferences === 'object') {
    let current = {}
    // This catch is the load-bearing one: `current` is the BASE of the deep merge, so
    // falling back to {} turns a partial PATCH into a full replacement of the blob —
    // exactly the sibling-slice clobber the deep merge exists to prevent. It stays a
    // fallback (an unparseable blob has no recoverable slices, so the write repairs the
    // row) but it is no longer silent, because the difference between "merged" and
    // "replaced everything" is invisible in the 200 response.
    try { current = JSON.parse(u.preferences || '{}') }
    catch (e) {
      console.error(
        `[profile] user ${u.id} has an unparseable preferences blob — PATCH will REPLACE it, ` +
        `not merge onto it: ${e.message}`,
      )
    }
    if (prefs_version !== undefined && Number(prefs_version) !== version) {
      return res.status(409).json({
        error: 'Preferences changed elsewhere', code: 'CONFLICT',
        prefs_version: version, preferences: current,
      })
    }
    setClauses.push('preferences = ?')
    params.push(JSON.stringify(deepMerge(current, preferences)))
    setClauses.push('prefs_version = prefs_version + 1')
    bumpedVersion = version + 1
  }

  if (setClauses.length > 0) {
    params.push(jwtUser.sub)
    run(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params)
  }
  res.json({ ok: true, prefs_version: bumpedVersion })
})

module.exports = router

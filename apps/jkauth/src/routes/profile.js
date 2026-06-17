'use strict'
// Identity + API routes consumed by the SPA apps and the nginx auth gate:
// /auth/me, /auth/profile (GET/PATCH), /auth/apps, /auth/require-admin, /auth/jwks.

const express = require('express')
const crypto = require('crypto')
const { PUBLIC_KEY, JWT_KID } = require('../config')
const { get, all, run } = require('../db')
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

// GET /auth/profile — user info + cross-app preferences
router.get('/auth/profile', (req, res) => {
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) return res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' })
  let preferences = {}
  try { preferences = JSON.parse(u.preferences || '{}') } catch {}
  res.json({ user: publicUser(u), preferences })
})

// PATCH /auth/profile — update display name, avatar_url, or preferences (merge patch)
router.patch('/auth/profile', (req, res) => {
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const u = get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
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
    params.push(jwtUser.sub)
    run(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params)
  }
  res.json({ ok: true })
})

// GET /auth/apps — registered apps list (requires auth)
router.get('/auth/apps', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const apps = all('SELECT id, name, origin, icon_url, allowed_roles FROM app_registry ORDER BY name')
  res.json({ apps })
})

// GET /auth/jwks — RSA public key in JWKS format
router.get('/auth/jwks', (req, res) => {
  if (!PUBLIC_KEY) return res.status(503).json({ error: 'Public key not configured' })
  try {
    const keyObj = crypto.createPublicKey(PUBLIC_KEY)
    const jwk = keyObj.export({ format: 'jwk' })
    res.json({ keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: JWT_KID }] })
  } catch {
    res.status(500).json({ error: 'Failed to export key' })
  }
})

module.exports = router

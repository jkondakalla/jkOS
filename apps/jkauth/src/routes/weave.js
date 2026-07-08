'use strict'
// Weave — the suite fabric directory. Everything other apps consume to discover
// the suite and weave into it: the app registry (/auth/apps), the suite-wide
// widget registry (/auth/widgets), the audit feed (/auth/events), and the JWKS
// verifiers fetch (/auth/jwks). Split out of profile.js so that file stays pure
// identity (me/profile/require-admin). Token *issuance* still lives in tokens.js;
// this module only reads the directory and serves declarations.

const express = require('express')
const crypto = require('crypto')
const { PUBLIC_KEY, PUBLIC_KEY_NEXT, JWT_KID, JWT_KID_NEXT } = require('../config')
const { all, run } = require('../db')
const { resolveUser } = require('../tokens')

const router = express.Router()

// GET /auth/apps — the suite directory (requires auth). Returns the full app row
// including the integration metadata the portal's manifest hydrates from
// (api_base/health_path/capabilities_path/ai). Kept snake_case + `name` for
// backward compatibility; the frontend maps it to the camelCase SuiteApp shape.
router.get('/auth/apps', (req, res) => {
  const user = resolveUser(req)
  // The UNAUTHENTICATED code lets authFetch refresh an expired token + retry.
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const apps = all(`SELECT id, name, origin, icon_url, allowed_roles,
                           api_base, health_path, capabilities_path, datasets_path, ai
                    FROM app_registry ORDER BY name`)
  res.json({ apps })
})

// GET /auth/events — recent audit events. Admins see the whole suite; everyone
// else sees only their own. Read-only view over the auth_events table. (S5)
router.get('/auth/events', (req, res) => {
  const jwtUser = resolveUser(req)
  if (!jwtUser) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const events = jwtUser.role === 'admin'
    ? all('SELECT id, user_id, type, ip, ua, meta, created_at FROM auth_events ORDER BY id DESC LIMIT ?', [limit])
    : all('SELECT id, user_id, type, ip, ua, meta, created_at FROM auth_events WHERE user_id=? ORDER BY id DESC LIMIT ?', [jwtUser.sub, limit])
  res.json({ events })
})

// GET /auth/jwks — RSA public key(s) in JWKS format. Publishes the active key and,
// when configured, a second (next/previous) key so verifiers can rotate without
// downtime: they fetch the new key by kid before jkAuth signs with it. (S4/U3)
router.get('/auth/jwks', (req, res) => {
  if (!PUBLIC_KEY) return res.status(503).json({ error: 'Public key not configured' })
  try {
    const keys = []
    const add = (pem, kid) => {
      if (!pem) return
      const jwk = crypto.createPublicKey(pem).export({ format: 'jwk' })
      keys.push({ ...jwk, use: 'sig', alg: 'RS256', kid })
    }
    add(PUBLIC_KEY, JWT_KID)
    add(PUBLIC_KEY_NEXT, JWT_KID_NEXT)
    res.json({ keys })
  } catch {
    res.status(500).json({ error: 'Failed to export key' })
  }
})

// ── Widget registry (ORDECK v3 workshop) ────────────────────────────────────
// Admins publish declarative widget definitions suite-wide; every HUD reads them
// and can place them. Mirrors the /auth/apps registry pattern.

// Normalize an `allowed_roles` input (array of roles, comma string, or absent)
// to a stored comma list, or null for "all roles" (ARCH-7.1). Empty / falsy →
// null so an existing publish that omits the field stays visible to everyone.
function normalizeRoles(input) {
  const list = Array.isArray(input)
    ? input
    : (typeof input === 'string' ? input.split(',') : [])
  const roles = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))]
  return roles.length ? roles.join(',') : null
}

// A widget row's allowed_roles gate: null/'' = every role; else the role must be
// in the comma list. Admins always see every published widget (so the workshop can
// manage role-restricted defs it wouldn't otherwise list).
function roleMaySee(allowedRoles, role) {
  if (role === 'admin') return true
  if (!allowedRoles) return true
  return allowedRoles.split(',').map((s) => s.trim()).includes(role)
}

// GET /auth/widgets — published widget definitions the caller's ROLE may see
// (ARCH-7.1). A def can carry `allowed_roles` (set at publish); absent = all roles.
// ORDECK needs no change — it renders whatever it receives. `allowed_roles` is
// echoed back on each def so the admin workshop can display/round-trip the setting.
router.get('/auth/widgets', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  const widgets = []
  for (const r of all('SELECT def, allowed_roles FROM widget_registry ORDER BY label')) {
    if (!roleMaySee(r.allowed_roles, user.role)) continue
    try {
      const def = JSON.parse(r.def)
      widgets.push(r.allowed_roles ? { ...def, allowed_roles: r.allowed_roles.split(',') } : def)
    } catch { /* skip a corrupt row */ }
  }
  res.json({ widgets })
})

// POST /auth/widgets — publish (upsert) a widget definition. Admin only. Accepts
// an optional `allowed_roles` (array or comma string) that scopes which roles see
// it via GET /auth/widgets; omit for "all roles" (ARCH-7.1).
router.post('/auth/widgets', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  const def = req.body
  if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !def.id.trim()) {
    return res.status(400).json({ error: 'Invalid widget: a string id is required' })
  }
  const id = def.id.trim().slice(0, 64)
  const label = String(def.label || id).slice(0, 100)
  const allowedRoles = normalizeRoles(def.allowed_roles)
  // Keep allowed_roles out of the stored def blob — the column is the source of
  // truth (and what the GET filter reads); the GET re-attaches it for the client.
  const { allowed_roles: _dropped, ...defBody } = def
  const json = JSON.stringify({ ...defBody, id }).slice(0, 20000)
  run(`INSERT INTO widget_registry (id, label, def, allowed_roles, created_by, updated_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, def=excluded.def,
         allowed_roles=excluded.allowed_roles, updated_at=datetime('now')`,
    [id, label, json, allowedRoles, user.sub])
  res.json({ ok: true, id })
})

// DELETE /auth/widgets/:id — unpublish. Admin only.
router.delete('/auth/widgets/:id', (req, res) => {
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  run('DELETE FROM widget_registry WHERE id=?', [String(req.params.id).slice(0, 64)])
  res.json({ ok: true })
})

module.exports = router

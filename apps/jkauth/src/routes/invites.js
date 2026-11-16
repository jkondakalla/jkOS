'use strict'
// Registration invites, the admin's side: mint one, see them all, revoke an unspent one.
// Spending one is POST /auth/register (routes/auth.js); the rules live in src/invites.js
// and migration 025.
//
//   GET  /auth/invites          the page (a browser) or { invites } (Accept: application/json)
//   POST /auth/invites          { note? } → the invite and its link. The code is in this one
//                               response and nowhere afterwards: only its sha256 is stored.
//   POST /auth/invites/revoke   { id } → an unspent invite stops working
//
// Every route names the action `invites:manage` (policy.js). Minting and revoking each write
// an auth_events row; so does spending or being refused, in routes/auth.js.

const express = require('express')
const { get, logEvent } = require('../db')
const { isJsonReq } = require('../util')
const { resolveUser } = require('../tokens')
const { can } = require('../policy')
const { invitesPage } = require('../views')
const { mintInvite, listInvites, revokeInvite } = require('../invites')

const router = express.Router()

const wantsJson = (req) => isJsonReq(req) || req.accepts(['html', 'json']) === 'json'

/** The signed-in admin's row, or an answer already sent (401, 403 or the sign-in page). */
function inviter(req, res) {
  const json = wantsJson(req)
  const jwtUser = resolveUser(req)
  const u = jwtUser && get('SELECT * FROM users WHERE id=?', [jwtUser.sub])
  if (!u) {
    if (json) { res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' }); return null }
    res.redirect('/auth/login?redirect_to=' + encodeURIComponent('/auth/invites')); return null
  }
  if (!can(u, 'invites:manage')) {
    if (json) { res.status(403).json({ error: 'Not permitted', code: 'FORBIDDEN', action: 'invites:manage' }); return null }
    res.redirect('/auth/dashboard'); return null
  }
  return u
}

router.get('/auth/invites', (req, res) => {
  const u = inviter(req, res); if (!u) return
  if (wantsJson(req)) return res.json({ invites: listInvites() })
  res.send(invitesPage(u, listInvites()))
})

router.post('/auth/invites', (req, res) => {
  const u = inviter(req, res); if (!u) return
  const minted = mintInvite(u.id, req.body?.note)
  logEvent('invite_minted', u.id, req, { invite: minted.id, expires_at: minted.expires_at })
  if (wantsJson(req)) {
    const { code, url, ...invite } = minted
    return res.status(201).json({ invite, code, url })
  }
  res.send(invitesPage(u, listInvites(), { minted }))
})

router.post('/auth/invites/revoke', (req, res) => {
  const u = inviter(req, res); if (!u) return
  const id = Number(req.body?.id)
  if (!Number.isInteger(id) || !revokeInvite(id)) {
    if (wantsJson(req)) return res.status(404).json({ error: 'No such open invite' })
    return res.status(404).send(invitesPage(u, listInvites(), { error: 'That invite was already used, revoked or never existed.' }))
  }
  logEvent('invite_revoked', u.id, req, { invite: id })
  if (wantsJson(req)) return res.json({ ok: true })
  res.redirect('/auth/invites')
})

module.exports = router

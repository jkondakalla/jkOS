'use strict'
// Registration invites — the only way a `user` account comes to exist.
//
// An admin mints an invite; the code is shown once and stored only as a sha256. Registering
// spends it. What makes "spent once, while live, for one account" true is migration 025's
// triggers, not this file: the functions here are the one writer today, and the table
// refuses any other writer that tries to do less.
//
// The first-user bootstrap (an empty database's first registration becomes the admin) needs
// no invite: there is nobody to mint one. It closes with the first real account.

const crypto = require('crypto')
const { AUTH_ORIGIN, INVITE_TTL_MS } = require('./config')
const { db, get, all, run } = require('./db')

/** 256 random bits, base64url: 43 characters, the same shape as a native sign-in code. */
const CODE_RE = /^[A-Za-z0-9_-]{43}$/
const NOTE_MAX = 100

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const nowIso = () => new Date().toISOString()

/** True only while no real (non-guest) account exists: the next registration is the admin. */
function bootstrapOpen() {
  return get("SELECT COUNT(*) AS c FROM users WHERE role != 'guest'").c === 0
}

/** Mint an invite for `adminId`. Returns the row's public fields plus the code — the only
 *  time the code exists outside the person's hands. */
function mintInvite(adminId, note) {
  const code = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const label = typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_MAX) : null
  const r = run('INSERT INTO registration_invites (code_hash, created_by, note, expires_at) VALUES (?,?,?,?)',
    [sha256(code), adminId, label, expiresAt])
  return {
    id: Number(r.lastInsertRowid), note: label, expires_at: expiresAt, code,
    url: `${AUTH_ORIGIN}/auth/register?invite=${code}`,
  }
}

/** Why a presented code can't be spent right now, or null when it can. Reads only. */
function inviteProblem(code) {
  if (!code) return { why: 'missing' }
  if (!CODE_RE.test(String(code))) return { why: 'unknown' }
  const row = get('SELECT id, expires_at, revoked_at, used_at FROM registration_invites WHERE code_hash=?', [sha256(code)])
  if (!row) return { why: 'unknown' }
  if (row.used_at) return { why: 'used', id: row.id }
  if (row.revoked_at) return { why: 'revoked', id: row.id }
  if (row.expires_at <= nowIso()) return { why: 'expired', id: row.id }
  return null
}

/**
 * Create an account. One transaction decides the role, spends the invite when one is
 * needed, inserts the row and ties the invite to it, so a failure anywhere (a taken email,
 * a lost race for the invite) leaves the invite unspent and no account behind.
 *
 * Returns { user, invite } — `invite` is the spent invite's id, or null for the bootstrap —
 * or { refused: why } when the invite could not be spent.
 */
const createAccount = db.transaction(({ email, name, hash, algo, code }) => {
  const first = bootstrapOpen()
  let inviteId = null
  if (!first) {
    const now = nowIso()
    const claim = run(`UPDATE registration_invites SET used_at=?, used_email=?
                        WHERE code_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      [now, email, sha256(code || ''), now])
    if (claim.changes !== 1) return { refused: inviteProblem(code)?.why || 'unknown' }
    inviteId = get('SELECT id FROM registration_invites WHERE code_hash=?', [sha256(code)]).id
  }
  const r = run('INSERT INTO users (email, name, password_hash, hash_algo, role) VALUES (?,?,?,?,?)',
    [email, name, hash, algo, first ? 'admin' : 'user'])
  if (inviteId != null) run('UPDATE registration_invites SET used_by=? WHERE id=?', [r.lastInsertRowid, inviteId])
  return { user: get('SELECT * FROM users WHERE id=?', [r.lastInsertRowid]), invite: inviteId }
})

/** Every invite, newest first, with who made it and who spent it. Never the code. */
function listInvites() {
  const now = nowIso()
  return all(`SELECT i.id, i.note, i.created_at, i.expires_at, i.revoked_at, i.used_at, i.used_email,
                     i.used_by, c.email AS created_by_email
                FROM registration_invites i LEFT JOIN users c ON c.id = i.created_by
               ORDER BY i.id DESC LIMIT 200`).map((r) => ({
    ...r,
    state: r.used_at ? 'used' : r.revoked_at ? 'revoked' : r.expires_at <= now ? 'expired' : 'open',
  }))
}

/** Revoke an unspent invite. True when this call revoked it. */
function revokeInvite(id) {
  return run('UPDATE registration_invites SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL',
    [nowIso(), id]).changes === 1
}

module.exports = { bootstrapOpen, mintInvite, inviteProblem, createAccount, listInvites, revokeInvite }

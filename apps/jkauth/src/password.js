'use strict'
// Password hashing (U1, finishes S3). The current scheme SHA-256 pre-hashes the
// password to 64 hex chars *before* bcrypt, so any-length input lands well under
// bcrypt's 72-byte limit — which otherwise silently truncates, letting an
// attacker who knows the first 72 bytes authenticate. No new native dependency:
// crypto.sha256 + the existing bcryptjs.
//
// Legacy rows carry hash_algo NULL/'bcrypt' and were bcrypt'd on the raw
// password; verifyPassword still accepts them, and the login route rehashes them
// to the current scheme on the next successful sign-in (lazy migration).

const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { BCRYPT_COST } = require('./config')

const HASH_ALGO = 'sha256-bcrypt'   // value stored in users.hash_algo for new hashes

const sha256hex = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')

// Pre-hash to fold any input to a fixed 64-char value, then bcrypt that.
async function hashPassword(plain) {
  return { hash: await bcrypt.hash(sha256hex(plain), BCRYPT_COST), algo: HASH_ALGO }
}
function hashPasswordSync(plain) {
  return { hash: bcrypt.hashSync(sha256hex(plain), BCRYPT_COST), algo: HASH_ALGO }
}

// Compare a candidate against a stored hash for its recorded scheme. Current
// rows compare the SHA-256 pre-hash; legacy rows compare the raw password.
// Always runs bcrypt (the dominant cost) so timing doesn't reveal the scheme.
async function verifyPassword(plain, hash, algo) {
  if (!hash) return false
  const candidate = algo === HASH_ALGO ? sha256hex(plain) : String(plain ?? '')
  return bcrypt.compare(candidate, hash)
}

// Sync twin of verifyPassword, for boot-time seeding only (db.js keeps the guest
// row's hash in step with the GUEST_PASSWORD env var). Never on a request path —
// the async form exists so bcrypt doesn't block the event loop under load.
function verifyPasswordSync(plain, hash, algo) {
  if (!hash) return false
  const candidate = algo === HASH_ALGO ? sha256hex(plain) : String(plain ?? '')
  return bcrypt.compareSync(candidate, hash)
}

// True when a verified login should be transparently upgraded to the current scheme.
const needsRehash = algo => algo !== HASH_ALGO

module.exports = { HASH_ALGO, sha256hex, hashPassword, hashPasswordSync, verifyPassword, verifyPasswordSync, needsRehash }

'use strict'
// weave/server/idempotency.js — DEDUP AT THE WRITE DOOR. The owed half of
// RESET A2c.4 (Documentation/WEAVE.md §3.4, TODO.md §6).
//
// ⚠️ **IDEMPOTENCY IS A PROPERTY OF THE RECEIVER.** The trigger engine has always
// sent a DERIVED `idempotency_key` — same trigger + same event ⇒ same key, which
// is what makes a retry RECOGNISABLE as one — and the suite's docs once claimed
// that meant "a retried DO cannot double-write". It did not and could not: no
// capability declared the field, no route looked for it, nothing stored seen
// keys, and the collection writer dropped it as an unknown body key. The claim
// was struck from trigger.js and WEAVE.md rather than left standing. This module
// is the half that makes it true.
//
// ⚠️ **A KEY IS SCOPED BY (WRITE DOOR, USER), NEVER GLOBAL, AND THAT IS A
// SECURITY PROPERTY RATHER THAN TIDINESS.** The engine's key is derived from the
// trigger and the event, so a per-user delegated DO fans one trigger out to N
// users carrying THE SAME KEY (serverDispatch's G1 delegation does exactly this).
// A globally-keyed store would answer user B's write with user A's stored
// response — handing B a row from someone else's board, with a 200 and no error
// anywhere. The user id is in the primary key for that reason.
//
// ⚠️ **THE ROW AND THE KEY ARE WRITTEN IN ONE TRANSACTION.** Insert the row, then
// crash before recording the key, and the retry double-writes anyway — the exact
// outcome this exists to prevent, reached by a shorter path. `remember()` is
// therefore not a separate call the caller can forget: `withIdempotency()` owns
// the transaction and the caller hands it a function that does the write.
//
// CONCURRENCY. better-sqlite3 is synchronous, so two requests in one process
// cannot interleave inside a transaction; across processes SQLite's write lock
// serialises them. The second attempt therefore always finds the first's row
// committed, and replays it. There is no window to lose.
//
// WHAT A REPLAY RETURNS: the FIRST attempt's status and body, verbatim, plus an
// `Idempotent-Replay: true` header. Not a fresh 201 — a caller that retried and
// got a new-looking creation has no way to tell it did not create a second row,
// which is the confusion the key exists to remove.

const { idempotencyKeyOf } = require('../shared/idempotency')

/** How long a key is remembered. Long enough to cover any retry a human or a
 *  webhook would make, short enough that the table cannot grow without bound.
 *  ⚠️ A key that has EXPIRED reads as new, so this is a real ceiling on how late
 *  a redelivery may arrive and still be deduplicated — 30 days is well past every
 *  retry window in the suite and is stated rather than assumed. */
const RETENTION_DAYS = 30

const TABLE = 'weave_idempotency'

/** The table. Applied by every collection's `ddl()`, so an app that mounts one
 *  collection gets it and an app that mounts six gets it once. */
const DDL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  scope      TEXT NOT NULL,          -- '<app>.<collection>' — WHICH write door
  user_id    TEXT NOT NULL,          -- '' when the collection is unscoped
  key        TEXT NOT NULL,
  status     INTEGER NOT NULL,       -- what the first attempt answered
  body       TEXT NOT NULL,          -- and the body it answered with, verbatim
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, user_id, key)
);
CREATE INDEX IF NOT EXISTS ${TABLE}_created ON ${TABLE}(created_at);
`

function prune(db, days = RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString()
  return db.prepare(`DELETE FROM ${TABLE} WHERE created_at < ?`).run(cutoff).changes
}

/**
 * Run `write()` at most once per (scope, user, key).
 *
 * @param {object}   db       better-sqlite3 handle
 * @param {object}   o
 * @param {string}   o.scope  '<app>.<collection>' — the write door
 * @param {string|number|null} o.userId  the owner, or null for an unscoped collection
 * @param {string|null} o.key  the caller's idempotency key, or null for no dedup
 * @param {() => {status: number, body: any}} o.write  performs the write
 * @returns {{status: number, body: any, replayed: boolean}}
 */
function withIdempotency(db, { scope, userId, key, write }) {
  if (!key) return { ...write(), replayed: false }

  const owner = userId == null ? '' : String(userId)
  const seen = db.prepare(
    `SELECT status, body FROM ${TABLE} WHERE scope = ? AND user_id = ? AND key = ?`
  ).get(scope, owner, key)
  if (seen) {
    return { status: seen.status, body: JSON.parse(seen.body), replayed: true }
  }

  // ⚠️ ONE TRANSACTION, and the key is recorded INSIDE it. See the header: a row
  // written without its key is a retry that double-writes anyway.
  const run = db.transaction(() => {
    const result = write()
    db.prepare(
      `INSERT INTO ${TABLE} (scope, user_id, key, status, body, created_at) VALUES (?,?,?,?,?,?)`
    ).run(scope, owner, key, result.status, JSON.stringify(result.body ?? null),
      new Date().toISOString())
    return result
  })

  let result
  try {
    result = run()
  } catch (e) {
    // Another writer got there first (the PRIMARY KEY is the arbiter). Its row is
    // committed and ours rolled back whole, so replaying is correct and complete.
    if (String(e && e.code) === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      const other = db.prepare(
        `SELECT status, body FROM ${TABLE} WHERE scope = ? AND user_id = ? AND key = ?`
      ).get(scope, owner, key)
      if (other) return { status: other.status, body: JSON.parse(other.body), replayed: true }
    }
    throw e
  }
  return { ...result, replayed: false }
}

module.exports = { DDL, TABLE, RETENTION_DAYS, keyOf: idempotencyKeyOf, prune, withIdempotency }

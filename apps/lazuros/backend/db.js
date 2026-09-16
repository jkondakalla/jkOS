'use strict';
// db.js — the SQLite handle + the jobs schema. The State node owns the async job
// queue; the compute-node worker (Phase 2) drains it over the /internal API. Opened
// once on require (like the other jkOS backends). WAL so the worker's poll/claim
// writes don't block the portal's dataset reads.

const path = require('path');
const Database = require('better-sqlite3');
const { SQL_NOW, IDEMPOTENCY_DDL } = require('@jkos/weave/server');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'lazuros.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    capability TEXT NOT NULL,
    tier_id    INTEGER,
    status     TEXT NOT NULL DEFAULT 'PENDING',
    payload    TEXT NOT NULL,
    step_data  TEXT,
    result     TEXT,
    error      TEXT,
    -- XC-1: the canonical millisecond-ISO wire format. The jobs dataset declares
    -- a 'since' delta cursor over updated_at (docs.js), and the whole-second
    -- datetime('now') sorts BEFORE an ISO stamp of the same instant as a string,
    -- so that cursor would have returned the wrong window against any other
    -- app's. Interpolated from SQL_NOW rather than typed out: this expression was
    -- spelled by hand here while every other backend imported it, which is a fourth
    -- copy of a value whose entire point is that there is one.
    -- (No backticks in here: this comment lives inside a JS template literal,
    --  where a backtick would end the string. Same trap as a // comment inside
    --  SQL -- a comment has to speak the language of the line it sits on.)
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW})
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_user   ON jobs(user_id);
`);

/* ⭐ D5 + G1: the zone of the request that ASKED for the work.
 *
 * A job outlives its request, and its result is committed into a peer app minutes or
 * hours later by a service token. That write is a per-user write — the token carries
 * `act` — but it travels over weaveServerClient, which is not a browser and so stamps
 * no X-JKOS-TZ. `callerDay(req)` then fell back to the UTC day, which is the right
 * answer for a peer with no user and the wrong one here, where the user is named.
 * East of Greenwich that means a write-back between local and UTC midnight reconciles
 * the user's routine horizon against YESTERDAY — BB-10, on the one path D11 opened.
 *
 * The zone is captured at ENQUEUE because that is the only moment a browser is on the
 * other end of the connection. Nullable: a job created by a service caller genuinely
 * has no zone, and UTC remains the honest fallback for it.
 *
 * Added with a guarded ALTER rather than in the CREATE above, because CREATE TABLE IF
 * NOT EXISTS does nothing to a database that already has the table — the schema would
 * be right on a fresh checkout and silently absent everywhere the app had ever run. */
const jobCols = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name));
if (!jobCols.has('acting_zone')) db.exec('ALTER TABLE jobs ADD COLUMN acting_zone TEXT');

/* The write-door dedup store (RESET A2c.4) — @jkos/weave's table, applied from its one
 * definition. Every capability here ENQUEUES WORK, and a retried trigger DO that enqueued
 * twice would run the model twice and write its result back twice. See routes/capability.js. */
db.exec(IDEMPOTENCY_DDL);

// Status lifecycle: PENDING → (PENDING_WAKEUP) → IN_PROGRESS → DONE | FAILED.
// tier_id records which tier the job routed to — useful for debugging escalation
// behaviour across different deployment configs.

module.exports = db;

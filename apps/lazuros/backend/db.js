'use strict';
// db.js — the SQLite handle + the jobs schema. The State node owns the async job
// queue; the compute-node worker (Phase 2) drains it over the /internal API. Opened
// once on require (like the other jkOS backends). WAL so the worker's poll/claim
// writes don't block the portal's dataset reads.

const path = require('path');
const Database = require('better-sqlite3');

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
    -- app's. Changed in the DDL rather than by migration because LazurOS has
    -- never run against a live database; there are no rows to convert.
    -- (No backticks in here: this comment lives inside a JS template literal,
    --  where a backtick would end the string. Same trap as a // comment inside
    --  SQL -- a comment has to speak the language of the line it sits on.)
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_user   ON jobs(user_id);
`);

// Status lifecycle: PENDING → (PENDING_WAKEUP) → IN_PROGRESS → DONE | FAILED.
// tier_id records which tier the job routed to — useful for debugging escalation
// behaviour across different deployment configs.

module.exports = db;

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_user   ON jobs(user_id);
`);

// Status lifecycle: PENDING → (PENDING_WAKEUP) → IN_PROGRESS → DONE | FAILED.
// tier_id records which tier the job routed to — useful for debugging escalation
// behaviour across different deployment configs.

module.exports = db;

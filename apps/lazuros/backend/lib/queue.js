'use strict';
// queue.js — the job queue, as plain functions over the jobs table. The State node
// API creates jobs (PENDING / PENDING_WAKEUP); the compute-node worker claims and
// resolves them over /internal. Every mutation bumps updated_at — that's the polled-
// resource invalidation signal the `jobs` dataset's `since` cursor reads (there is no
// imperative invalidate() in weave; the bump IS the signal).

const { randomUUID } = require('crypto');
const db = require('../db');
const { SQL_NOW, sqlConvert } = require('@jkos/weave/server');

const createJob = ({ user_id, capability, payload, tier_id = null }) => {
  const id = randomUUID();
  db.prepare(`INSERT INTO jobs (id, user_id, capability, tier_id, status, payload)
              VALUES (?, ?, ?, ?, 'PENDING', ?)`)
    .run(id, user_id, capability, tier_id, JSON.stringify(payload));
  return id;
};

const setJobStatus = (id, status) =>
  db.prepare(`UPDATE jobs SET status = ?, updated_at = ${SQL_NOW} WHERE id = ?`).run(status, id);

const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

// A worker-claimable job is either freshly PENDING or PENDING_WAKEUP — a job routed
// to an offline backend that was best-effort woken (WoL). Both must drain: excluding
// PENDING_WAKEUP here would strand every job sent to a sleeping backend even after it
// boots, since nothing transitions PENDING_WAKEUP back to PENDING.
const CLAIMABLE = "status IN ('PENDING','PENDING_WAKEUP')";

const getPendingJobs = (limit = 1) =>
  db.prepare(`SELECT * FROM jobs WHERE ${CLAIMABLE} ORDER BY created_at LIMIT ?`).all(limit);

// Atomic claim: only the worker that flips a claimable job → IN_PROGRESS wins
// (changes === 1), so two workers polling the same job can't both run it.
const claimJob = (id) =>
  db.prepare(`UPDATE jobs SET status = 'IN_PROGRESS', updated_at = ${SQL_NOW}
              WHERE id = ? AND ${CLAIMABLE}`).run(id).changes === 1;

const setJobResult = (id, { status, result = null, error = null, step_data = null }) => {
  // step_data is a free-form breadcrumb (a string today, e.g. a writeback error). Guard
  // against a future caller handing an object — better-sqlite3 can only bind primitives.
  const stepText = step_data != null && typeof step_data === 'object' ? JSON.stringify(step_data) : step_data;
  db.prepare(`UPDATE jobs SET status = ?, result = ?, error = ?, step_data = ?, updated_at = ${SQL_NOW}
              WHERE id = ?`).run(status, result ? JSON.stringify(result) : null, error, stepText, id);
};

// Reaper: a worker that claimed a job (PENDING → IN_PROGRESS) then died (crash/restart)
// would otherwise leave it unclaimable forever — workers only poll claimable statuses.
// Reset jobs untouched past `timeoutSec` back to PENDING; the updated_at bump both marks
// progress-liveness (claim/result bump it) and makes the reset visible to the poll cursor.
const requeueStaleJobs = (timeoutSec = 900) => {
  // SQLite datetime modifiers must carry an explicit sign; build it so a negative
  // timeout (cutoff in the future, used by tests) stays a valid '+N seconds'.
  const modifier = `${timeoutSec >= 0 ? '-' : '+'}${Math.abs(timeoutSec)} seconds`;
  return db.prepare(`UPDATE jobs SET status = 'PENDING', updated_at = ${SQL_NOW}
              WHERE status = 'IN_PROGRESS' AND updated_at < ${sqlConvert("datetime('now', ?)")}`)
    .run(modifier).changes;
};

module.exports = { createJob, setJobStatus, getJob, getPendingJobs, claimJob, setJobResult, requeueStaleJobs };

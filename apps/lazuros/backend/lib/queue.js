'use strict';
// queue.js — the job queue, as plain functions over the jobs table. The State node
// API creates jobs (PENDING / PENDING_WAKEUP); the compute-node worker claims and
// resolves them over /internal. Every mutation bumps updated_at — that's the polled-
// resource invalidation signal the `jobs` dataset's `since` cursor reads (there is no
// imperative invalidate() in weave; the bump IS the signal).

const { randomUUID } = require('crypto');
const db = require('../db');

const createJob = ({ user_id, capability, payload, tier_id = null, expires_at = null }) => {
  const id = randomUUID();
  db.prepare(`INSERT INTO jobs (id, user_id, capability, tier_id, status, payload, expires_at)
              VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`)
    .run(id, user_id, capability, tier_id, JSON.stringify(payload), expires_at);
  return id;
};

const setJobStatus = (id, status) =>
  db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);

const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

const getPendingJobs = (limit = 1) =>
  db.prepare("SELECT * FROM jobs WHERE status = 'PENDING' ORDER BY created_at LIMIT ?").all(limit);

// Atomic claim: only the worker that flips PENDING → IN_PROGRESS wins (changes === 1),
// so two workers polling the same job can't both run it.
const claimJob = (id) =>
  db.prepare(`UPDATE jobs SET status = 'IN_PROGRESS', updated_at = datetime('now')
              WHERE id = ? AND status = 'PENDING'`).run(id).changes === 1;

const setJobResult = (id, { status, result = null, error = null, step_data = null }) =>
  db.prepare(`UPDATE jobs SET status = ?, result = ?, error = ?, step_data = ?, updated_at = datetime('now')
              WHERE id = ?`).run(status, result ? JSON.stringify(result) : null, error, step_data, id);

module.exports = { createJob, setJobStatus, getJob, getPendingJobs, claimJob, setJobResult };

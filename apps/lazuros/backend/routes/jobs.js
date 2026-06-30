'use strict';
// jobs.js — the `jobs` dataset (the read contract). Owner-scoped: a non-admin sees
// ONLY their own jobs (the user_id filter is pinned to their token sub, so they can't
// read another user's job even by guessing its id); an admin sees the whole queue, or
// one user's via ?user_id. The declared filters (job_id/status/user_id) come from
// docs.js DATASETS_DOC.

const { Router } = require('express');
const db = require('../db');

const router = Router();

router.get('/', (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  // Non-admins are pinned to their own sub; admins default to all, ?user_id narrows.
  const ownerPin = isAdmin
    ? (req.query.user_id != null ? String(req.query.user_id) : null)
    : String(req.user?.sub ?? '');

  let sql = `SELECT id, user_id, capability, tier_id, status, step_data, result, error, created_at, updated_at
             FROM jobs WHERE 1=1`;
  const params = [];
  if (req.query.job_id) { sql += ' AND id = ?'; params.push(String(req.query.job_id)); }
  if (req.query.status) { sql += ' AND status = ?'; params.push(String(req.query.status)); }
  if (ownerPin !== null) { sql += ' AND user_id = ?'; params.push(ownerPin); }
  sql += ' ORDER BY created_at DESC LIMIT 50';

  const jobs = db.prepare(sql).all(...params).map((j) => ({
    ...j,
    result: j.result ? JSON.parse(j.result) : null,
  }));
  res.json({ jobs });
});

module.exports = router;

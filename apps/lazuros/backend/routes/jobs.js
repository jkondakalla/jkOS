'use strict';
// jobs.js — the `jobs` dataset (the read contract). Owner-scoped: a non-admin sees
// ONLY their own jobs (the user_id filter is pinned to their token sub, so they can't
// read another user's job even by guessing its id); an admin sees the whole queue, or
// one user's via ?user_id. The declared filters (job_id/status/user_id/capability/
// since) come from docs.js DATASETS_DOC — job_id/status/capability/since are plain
// eq/gt filters enforced generically via @jkos/weave/server's buildItemFilters
// (declared == enforced, the same seam BeigeBoard's items.js and PapyrOS's books.js
// use); `user_id` is excluded from that generic spec because it isn't a plain eq
// filter HERE — it's the owner pin (see ownerPin below), not a caller-narrowable
// column, so its enforcement stays bespoke while it stays declared for the GUI/docs.

const { Router } = require('express');
const { buildItemFilters, filterSpec } = require('@jkos/weave/server');
const db = require('../db');
const { DATASETS_DOC } = require('../docs');

const router = Router();

const JOBS_DATASET = DATASETS_DOC.datasets.find((d) => d.id === 'jobs');
const JOB_FILTER_SPEC = filterSpec(JOBS_DATASET.filters.filter((f) => f.name !== 'user_id'));

router.get('/', (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  // Non-admins are pinned to their own sub; admins default to all, ?user_id narrows.
  const ownerPin = isAdmin
    ? (req.query.user_id != null ? String(req.query.user_id) : null)
    : String(req.user?.sub ?? '');

  const base = ownerPin !== null ? ['user_id = ?'] : [];
  const baseParams = ownerPin !== null ? [ownerPin] : [];
  // job_id/status/capability/since ride the shared filter builder; any OTHER query
  // param (not in JOB_FILTER_SPEC) is silently ignored — the suite convention (see
  // filters.js): only declared params are ever read off req.query.
  const { where, params } = buildItemFilters(req.query, JOB_FILTER_SPEC, { base, baseParams });

  const sql = `SELECT id, user_id, capability, tier_id, status, step_data, result, error, created_at, updated_at
             FROM jobs WHERE ${where || '1=1'} ORDER BY created_at DESC LIMIT 50`;

  const jobs = db.prepare(sql).all(...params).map((j) => ({
    ...j,
    result: j.result ? JSON.parse(j.result) : null,
  }));
  // Bare array, not { jobs } — the weave read contract (weaveClient.list /
  // useWeaveList coerce with Array.isArray, so an enveloped list reads as empty).
  // BB's items dataset sets the shape; every dataset endpoint matches it.
  res.json(jobs);
});

module.exports = router;

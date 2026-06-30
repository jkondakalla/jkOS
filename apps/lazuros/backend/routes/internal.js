'use strict';
// internal.js — the compute-node worker API. Mounted behind the LAZUROS_INTERNAL_TOKEN
// bearer gate (NOT jkAuth — the worker is a trusted peer, not a user). The worker
// polls for PENDING jobs, atomically claims one, runs inference, and posts the result.
// Every write goes through queue.js, which bumps updated_at → the `jobs` dataset's
// poll cursor sees the change (no imperative invalidate in weave).

const { Router } = require('express');
const { getPendingJobs, claimJob, setJobResult, getJob } = require('../lib/queue');
const { runWriteback } = require('../lib/writeback');

const router = Router();

// GET /internal/jobs?limit=N — the next N PENDING jobs (oldest first).
router.get('/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 1, 20);
  res.json({ jobs: getPendingJobs(limit) });
});

// PATCH /internal/jobs/:id/claim — atomically flip PENDING → IN_PROGRESS. 409 if a
// peer already claimed it (changes === 0), so two workers can't both run a job.
router.patch('/jobs/:id/claim', (req, res) =>
  claimJob(req.params.id) ? res.json({ ok: true }) : res.status(409).json({ error: 'ALREADY_CLAIMED' }));

// POST /internal/jobs/:id/result — terminal (DONE/FAILED) or an intermediate PENDING
// re-queue (e.g. a multi-step pipeline yielding back). A DONE result for a write-capable
// capability (parse-task/breakdown-goal) is committed into the target app AS the acting
// user via delegated write-back (G1) — best-effort: a write-back failure is recorded on
// the job (step_data) but never voids the result, which stays reviewable.
router.post('/jobs/:id/result', async (req, res) => {
  const { status, result, error, step_data } = req.body || {};
  if (!['DONE', 'FAILED', 'PENDING'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  setJobResult(req.params.id, { status, result, error, step_data });

  if (status === 'DONE') {
    const job = getJob(req.params.id);
    try {
      const wb = await runWriteback(job, result);
      if (wb.written) console.log(`[lazuros] job ${job.id} → ${wb.app} write-back ok`);
    } catch (e) {
      console.warn(`[lazuros] job ${req.params.id} write-back failed: ${e.message}`);
      setJobResult(req.params.id, { status, result, error, step_data: `writeback_error: ${e.message}` });
    }
  }
  res.json({ ok: true });
});

module.exports = router;

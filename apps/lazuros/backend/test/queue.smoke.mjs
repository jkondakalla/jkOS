// queue.smoke.mjs — Phase 1 regression guard for the job queue + tier resolution.
// In-process (no server, no network): points DB_PATH at a throwaway file, then drives
// the queue + resolveTier the way the capability handler and worker API do.
//   node test/queue.smoke.mjs   (also: pnpm --filter @jkos/lazuros-backend test)

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);

// db.js reads DB_PATH at require time — set it BEFORE requiring anything that pulls db.
const DB = join(tmpdir(), `lazuros-queue-smoke-${randomUUID()}.db`);
process.env.DB_PATH = DB;

const queue = require('../lib/queue');
const { resolveTier } = require('../routes/capability');

let pass = 0;
const ok = (label, cond) => { assert.ok(cond, label); console.log(`  ✓ ${label}`); pass++; };

try {
  // ── createJob → getJob round-trip, defaults ──────────────────────────────────
  const id = queue.createJob({ user_id: 'u1', capability: 'parse-task', payload: { text: 'x' }, tier_id: 2 });
  const j = queue.getJob(id);
  ok('createJob returns a uuid + getJob finds it', j && j.id === id);
  ok('new job is PENDING', j.status === 'PENDING');
  ok('tier_id + user_id + capability persisted', j.tier_id === 2 && j.user_id === 'u1' && j.capability === 'parse-task');
  ok('payload stored as JSON text', JSON.parse(j.payload).text === 'x');

  // ── PENDING_WAKEUP transition (what the handler does for an offline backend) ──
  queue.setJobStatus(id, 'PENDING_WAKEUP');
  ok('setJobStatus → PENDING_WAKEUP', queue.getJob(id).status === 'PENDING_WAKEUP');

  // ── getPendingJobs drains BOTH PENDING and PENDING_WAKEUP ─────────────────────
  // A PENDING_WAKEUP job (its backend woken via WoL) must be claimable once the node
  // answers; excluding it stranded every job routed to a sleeping backend forever.
  const id2 = queue.createJob({ user_id: 'u2', capability: 'query', payload: {} });
  const pend = queue.getPendingJobs(10);
  ok('getPendingJobs includes PENDING + PENDING_WAKEUP',
     pend.length === 2 && pend.some((p) => p.id === id) && pend.some((p) => p.id === id2));

  // ── atomic claim works on a woken job too; a second claim is a no-op ──────────
  ok('claimJob a PENDING_WAKEUP job → true', queue.claimJob(id) === true);
  ok('claimed woken job is IN_PROGRESS', queue.getJob(id).status === 'IN_PROGRESS');
  ok('claimJob first time → true', queue.claimJob(id2) === true);
  ok('claimJob second time → false (already IN_PROGRESS)', queue.claimJob(id2) === false);
  ok('claimed job is IN_PROGRESS', queue.getJob(id2).status === 'IN_PROGRESS');

  // ── reaper: a stale IN_PROGRESS job returns to PENDING (worker-crash recovery) ─
  // A negative timeout puts the cutoff in the future, so any IN_PROGRESS is "stale".
  ok('requeueStaleJobs resets a stuck IN_PROGRESS job', queue.requeueStaleJobs(-1) >= 1);
  ok('reaped job is claimable again (PENDING)', queue.getJob(id2).status === 'PENDING');

  // ── result round-trip ────────────────────────────────────────────────────────
  queue.setJobResult(id2, { status: 'DONE', result: { title: 'Buy milk' } });
  const done = queue.getJob(id2);
  ok('setJobResult → DONE + result JSON', done.status === 'DONE' && JSON.parse(done.result).title === 'Buy milk');

  // ── resolveTier against a 3-tier registry (data, not branches) ───────────────
  const tiers = [
    { id: 0, computeBackend: 'edge' },
    { id: 1, computeBackend: 'edge' },
    { id: 2, computeBackend: 'emily' },
  ];
  ok("resolveTier('highest') → last tier", resolveTier('highest', tiers).id === 2);
  ok("resolveTier('lowest') → first tier", resolveTier('lowest', tiers).id === 0);
  ok('resolveTier(numeric id) → that tier', resolveTier(1, tiers).id === 1);
  ok('resolveTier(unknown) → undefined', resolveTier(99, tiers) === undefined);

  // ── THE ACTIVITY CONTRACT (D6 / XC-2) ────────────────────────────────────────
  // ⚠️ LazurOS's ledger is a WORK QUEUE that happens to remember — not a play-history
  // table like papyros's and kouros's, and not two columns on an item like
  // BeigeBoard's. Four honest schemas, one declared answer. This is also the half of
  // the contract that carries the suite's AI action-audit trail: "what did the user
  // ask the AI to do, and did it work."
  //
  // In-process (this file boots no server), driving ACTIVITY.doc directly against the
  // real queue rows created above — the HTTP mount is asserted by the three app
  // smokes that do boot a server.
  const { ACTIVITY } = require('../docs');
  const { checkActivityDoc } = require('@jkos/weave/activity');
  const db = require('../db');

  const done1 = queue.createJob({ user_id: 'u9', capability: 'summarise', payload: {} });
  const fail1 = queue.createJob({ user_id: 'u9', capability: 'translate', payload: {} });
  const open1 = queue.createJob({ user_id: 'u9', capability: 'breakdown', payload: {} });
  queue.setJobStatus(done1, 'DONE');
  queue.setJobStatus(fail1, 'FAILED');

  const doc = ACTIVITY.doc(db, 'u9', { since: null, until: null, limit: 50 });
  ok('activity doc satisfies the shared contract', checkActivityDoc(doc) === null);
  ok('activity doc names its app', doc.app === 'lazuros');
  ok('ONE kind, not one per capability (capability is data, kinds are a closed vocabulary)',
    doc.kinds.length === 1 && doc.kinds[0].id === 'ai_job');
  ok('all three jobs surface', doc.activity.length === 3);

  const byRef = Object.fromEntries(doc.activity.map((e) => [e.ref, e]));
  ok('the capability rides in `label`', byRef[`lazuros:${done1}`].label === 'summarise');
  ok('DONE   → completed true',  byRef[`lazuros:${done1}`].completed === true);
  ok('FAILED → completed false', byRef[`lazuros:${fail1}`].completed === false);
  // The tri-state earning its keep: an in-flight job's outcome is genuinely not yet
  // known, which is a different claim from "it ran and did not finish".
  ok('PENDING → completed null, NOT false', byRef[`lazuros:${open1}`].completed === null);
  ok('ms stays null — queue wait is not time spent on the act',
    doc.activity.every((e) => e.ms === null));
  ok('another user sees none of it',
    ACTIVITY.doc(db, 'u-someone-else', { since: null, until: null, limit: 50 }).activity.length === 0);

  console.log(`\n✅ ALL PASS: ${pass} assertions`);
} catch (e) {
  console.error('\n❌ FAIL:', e.message);
  process.exitCode = 1;
} finally {
  for (const ext of ['', '-shm', '-wal']) { try { rmSync(DB + ext); } catch {} }
}

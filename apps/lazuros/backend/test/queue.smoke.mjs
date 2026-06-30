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

  // ── getPendingJobs sees only PENDING (not PENDING_WAKEUP) ─────────────────────
  const id2 = queue.createJob({ user_id: 'u2', capability: 'query', payload: {} });
  const pend = queue.getPendingJobs(10);
  ok('getPendingJobs returns PENDING only (excludes PENDING_WAKEUP)', pend.length === 1 && pend[0].id === id2);

  // ── atomic claim: first wins, second is a no-op ──────────────────────────────
  ok('claimJob first time → true', queue.claimJob(id2) === true);
  ok('claimJob second time → false (already IN_PROGRESS)', queue.claimJob(id2) === false);
  ok('claimed job is IN_PROGRESS', queue.getJob(id2).status === 'IN_PROGRESS');

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

  console.log(`\n✅ ALL PASS: ${pass} assertions`);
} catch (e) {
  console.error('\n❌ FAIL:', e.message);
  process.exitCode = 1;
} finally {
  for (const ext of ['', '-shm', '-wal']) { try { rmSync(DB + ext); } catch {} }
}

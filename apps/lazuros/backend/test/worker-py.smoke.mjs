// worker-py.smoke.mjs — git history item 1.1: wraps the Python worker smoke
// (apps/lazuros/worker/test/worker.smoke.py, 19 assertions covering the worker's
// poll → claim → render → infer → post loop: happy path, idle, lost-claim race,
// unconfigured capability → FAILED, infer-error → FAILED) into the node gate. Before
// this file the worker was the one LazurOS component with zero CI coverage — its smoke
// ran manually only, because it's Python and `pnpm --filter @jkos/lazuros-backend test`
// only chains node scripts. This wraps it rather than reimplementing it: it spawns the
// REAL python3 script unmodified and forwards its exit code, so the 19 assertions
// actually execute inside the gate.
//
// SKIPS cleanly (exit 0) instead of failing ONLY when python3 isn't on PATH — a
// machine with no Python must not go red for it. Once python3 exists, EVERY nonzero
// exit fails the gate, including ImportError: worker.py is stdlib-only by mandate
// (its own docstring — "no pip install on the compute node"), so a failed import is
// a regression to catch, not an environment gap to forgive.
//
//   node apps/lazuros/backend/test/worker-py.smoke.mjs
//   (also: pnpm --filter @jkos/lazuros-backend test)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/test → ../.. → apps/lazuros → worker/test/worker.smoke.py. Resolved from
// this file's own location, never the repo root, so it works regardless of cwd.
const WORKER_SMOKE = resolve(__dirname, '..', '..', 'worker', 'test', 'worker.smoke.py');
const PY = process.env.LAZUROS_TEST_PYTHON || 'python3';

// ── availability gate — SKIP (exit 0) rather than fail if python3 isn't on PATH ────
const probe = spawnSync(PY, ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.warn(`⚠ SKIP: worker-py.smoke — '${PY}' is not available on PATH.`);
  console.warn('  Install python3 to get worker (Python) coverage in this gate.');
  process.exit(0);
}

if (!existsSync(WORKER_SMOKE)) {
  console.error(`✗ worker-py.smoke: expected ${WORKER_SMOKE} to exist`);
  process.exit(1);
}

const run = spawnSync(PY, [WORKER_SMOKE], { encoding: 'utf8', cwd: dirname(WORKER_SMOKE) });
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);

if (run.error) {
  console.error(`✗ worker-py.smoke: failed to spawn '${PY}': ${run.error.message}`);
  process.exit(1);
}

if (run.status !== 0) {
  console.error(`✗ worker-py.smoke: worker.smoke.py exited ${run.status}`);
  process.exit(1);
}

const summary = /(\d+)\/\1 assertions passed/.exec(run.stdout || '');
if (!summary) {
  console.error('✗ worker-py.smoke: worker.smoke.py exited 0 but printed no "N/N assertions passed" summary — did its output format change?');
  process.exit(1);
}

console.log(`✓ worker-py.smoke: python3 worker.smoke.py — ${summary[0]} (wrapped into the node gate)`);

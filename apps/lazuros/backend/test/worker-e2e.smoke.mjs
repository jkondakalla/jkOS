// worker-e2e.smoke.mjs — TEST-13: the one seam the LazurOS suite was missing.
//
// Queue, providers, and write-back each have an in-process smoke; nothing drove the
// WHOLE loop through the real network contract with the REAL Python worker. This does:
// boot the actual State node (server.js) on a throwaway port + temp DB, POST a
// capability through the authed edge (weave dev-stub) → 202 job, then drive
// worker.py's `process_once` — the real daemon body — against the live bearer-gated
// /internal API, with only Ollama faked (an external runtime, correctly stubbed). It
// asserts the job lands DONE with the model's result and surfaces in the `jobs`
// dataset, then covers the two branches the happy path skips: an offline tier →
// PENDING_WAKEUP (still enqueued + claimable), and delegated write-back invoked with
// an injected client (no real BeigeBoard needed).
//
// Real code exercised: server.js, the capability handler, queue.js, internal routes,
// writeback.js, AND worker.py (get_pending → claim → run_inference → post_result).
// Faked: Ollama (a compute runtime) + the write-back peer client (a delegated HTTP
// call to BeigeBoard). Requires python3 (LazurOS's worker is Python; testing it needs
// the interpreter — the same one jkos-deploy + worker.smoke.py already assume).
//
//   node apps/lazuros/backend/test/worker-e2e.smoke.mjs
//   (also: pnpm --filter @jkos/lazuros-backend test)

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const WORKER_DIR = resolve(BACKEND, '../worker');
const INT_TOKEN = 'test-internal-token';

let pass = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { failed++; console.error(`  ✗ ${msg}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'lazuros-e2e-'));
const cleanups = [];
const cleanupAll = () => { for (const c of cleanups.reverse()) { try { c(); } catch {} } };

// Run a child ASYNCHRONOUSLY (never spawnSync): the fake Ollama is an in-process
// HTTP server, so blocking the event loop while the Python worker calls it would
// deadlock (the worker would wait out its 120s inference timeout for a reply this
// process can't send). Await the child while the loop keeps serving.
const run = (cmd, args, env) => new Promise((res) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.stderr.on('data', (d) => (stderr += d));
  p.on('close', (status) => res({ status, stdout, stderr }));
});

// ── Fake Ollama: answers POST /api/generate with a canned completion, recording
//    the prompt it was asked so we can assert the worker rendered the template. ──
function fakeOllama(response) {
  const seen = { prompts: [] };
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try { seen.prompts.push(JSON.parse(body).prompt); } catch {}
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response, done: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => {
    cleanups.push(() => srv.close());
    r({ url: `http://127.0.0.1:${srv.address().port}`, seen });
  }));
}

// ── Boot the real State node with a given deployment config on an ephemeral port ──
async function bootNode(deployment, label) {
  const cfgPath = join(tmp, `deployment-${label}.json`);
  const dbPath = join(tmp, `state-${label}.db`);
  writeFileSync(cfgPath, JSON.stringify(deployment));
  // Grab a free port by opening then closing a throwaway listener.
  const port = await new Promise((r) => {
    const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      LAZUROS_INTERNAL_TOKEN: INT_TOKEN,
      LAZUROS_DEPLOYMENT_CONFIG: cfgPath,
      NODE_ENV: 'test',
      // no JKOS_AUTH_* → weave dev-stub user { sub:1, role:'admin' }
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  cleanups.push(() => proc.kill('SIGKILL'));
  // Wait for health.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/lazuros/health`)).ok) return { base, dbPath, proc, logOf: () => log }; } catch {}
    if (proc.exitCode !== null) throw new Error(`node exited early (${proc.exitCode}):\n${log}`);
    await sleep(150);
  }
  throw new Error(`State node "${label}" never became healthy:\n${log}`);
}

const jsonReq = async (base, method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};

const ALWAYS_ON = {
  name: 'e2e-alwayson',
  computeBackends: { local: { kind: 'always-on', inference: { provider: 'ollama', baseUrl: 'http://127.0.0.1:1' } } },
  tiers: [{ id: 0, label: 'Local', computeBackend: 'local', triggers: ['*'], fallback: null }],
  models: { router: 'x', heavy: 'x' },
};
// A WoL tier whose health endpoint is unreachable → probe() is false → PENDING_WAKEUP.
// No MAC configured, so wake() logs-and-returns (no junk UDP broadcast in CI).
const OFFLINE_WOL = {
  name: 'e2e-wol',
  computeBackends: { emily: { kind: 'wol', healthUrl: 'http://127.0.0.1:1/health', inference: { provider: 'ollama', baseUrl: 'http://127.0.0.1:1' } } },
  tiers: [{ id: 0, label: 'Emily', computeBackend: 'emily', triggers: ['*'], fallback: null }],
  models: { router: 'x', heavy: 'x' },
};

async function main() {
  // ═══ Part A — full fake-worker loop, DONE path ══════════════════════════════
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (py.status !== 0) throw new Error('python3 not available — LazurOS worker is Python; cannot run the e2e');

  const CANNED = JSON.stringify({ title: 'Buy milk', answer: '42' });
  const ollama = await fakeOllama(CANNED);
  const node = await bootNode(ALWAYS_ON, 'a');

  // POST a capability through the authed edge (dev-stub) → 202 + job id.
  const enq = await jsonReq(node.base, 'POST', '/api/lazuros/query', { text: 'hello world' });
  ok(enq.status === 202 && typeof enq.json?.job_id === 'string', 'capability POST → 202 with job_id');
  const jobId = enq.json.job_id;

  // Write the worker's per-deployment config maps, then drive the REAL process_once.
  const modelMap = join(tmp, 'models.json');
  const promptMap = join(tmp, 'prompts.json');
  writeFileSync(modelMap, JSON.stringify({ query: 'test-model' }));
  writeFileSync(promptMap, JSON.stringify({ query: 'Q: {text}' }));
  const driver = join(tmp, 'drive_once.py');
  writeFileSync(driver, [
    'import os, sys, json',
    `sys.path.insert(0, ${JSON.stringify(WORKER_DIR)})`,
    'import worker',
    'mm = json.load(open(os.environ["MM"]))',
    'pm = json.load(open(os.environ["PM"]))',
    'jid = worker.process_once(mm, pm, state_url=os.environ["LAZUROS_STATE_URL"])',
    'print(jid if jid else "")',
  ].join('\n'));

  const driverEnv = { LAZUROS_STATE_URL: node.base, LAZUROS_INTERNAL_TOKEN: INT_TOKEN, LAZUROS_OLLAMA_URL: ollama.url, MM: modelMap, PM: promptMap };
  const run1 = await run('python3', [driver], driverEnv);
  if (run1.status !== 0) throw new Error(`worker driver failed:\n${run1.stdout}\n${run1.stderr}`);
  ok(run1.stdout.trim() === jobId, 'process_once claimed + processed exactly the enqueued job');
  ok(ollama.seen.prompts.includes('Q: hello world'), 'worker rendered the prompt template against the payload');

  // The DONE job surfaces in the jobs dataset (the read contract) with the model result.
  const ds = await jsonReq(node.base, 'GET', `/api/lazuros/jobs?job_id=${jobId}`);
  const row = Array.isArray(ds.json) ? ds.json.find((j) => j.id === jobId) : null;
  ok(row && row.status === 'DONE', 'jobs dataset shows the job DONE');
  ok(row && row.result && row.result.response === CANNED && row.result.model === 'test-model',
    'DONE job carries the worker result (response + model)');

  // A second process_once has nothing to claim (idempotent drain).
  const run2 = await run('python3', [driver], driverEnv);
  ok(run2.stdout.trim() === '', 'process_once with an empty queue claims nothing');

  // ═══ Part B — offline tier → PENDING_WAKEUP ════════════════════════════════
  const wolNode = await bootNode(OFFLINE_WOL, 'b');
  const enqW = await jsonReq(wolNode.base, 'POST', '/api/lazuros/query', { text: 'wake up' });
  ok(enqW.status === 202 && enqW.json?.job_id, 'offline-tier capability POST still → 202 (job queued, not rejected)');
  const wId = enqW.json.job_id;
  await sleep(100);
  const wds = await jsonReq(wolNode.base, 'GET', `/api/lazuros/jobs?job_id=${wId}`);
  const wRow = Array.isArray(wds.json) ? wds.json.find((j) => j.id === wId) : null;
  ok(wRow && wRow.status === 'PENDING_WAKEUP', 'offline backend → job marked PENDING_WAKEUP');
  // …and a woken worker can still claim it (the /internal drain includes PENDING_WAKEUP).
  const pend = await fetch(`${wolNode.base}/internal/jobs?limit=5`, { headers: { authorization: `Bearer ${INT_TOKEN}` } });
  const pj = await pend.json();
  ok(pend.ok && pj.jobs?.some((j) => j.id === wId), 'PENDING_WAKEUP job is claimable via /internal (drain includes it)');

  // ═══ Part C — delegated write-back invoked with an injected client ══════════
  const { runWriteback } = require('../lib/writeback');
  const calls = [];
  const fakeClient = (app, opts) => ({
    post: async (path, doc) => { calls.push({ app, opts, path, doc }); return { ok: true, status: 200 }; },
  });
  const wb = await runWriteback(
    { capability: 'parse-task', user_id: 'u42' },
    { response: JSON.stringify({ items: [{ title: 'From AI' }] }) },
    { makeClient: fakeClient },
  );
  ok(wb.written === true && calls.length === 1, 'write-capable job → runWriteback invokes the injected client once');
  ok(calls[0].opts?.actingUser === 'u42' && calls[0].app === 'beigeboard' && calls[0].doc.items?.[0].title === 'From AI',
    'write-back delegates as the acting user, to beigeboard, with the parsed doc');
  const skip = await runWriteback({ capability: 'query', user_id: 'u42' }, { response: '{}' }, { makeClient: fakeClient });
  ok(skip.skipped === true && calls.length === 1, 'a non-write capability (query) skips write-back');

  console.log(`\n✅ worker-e2e: ${pass} assertions`);
}

main()
  .catch((e) => { console.error('\n❌ FAIL:', e.message); failed++; })
  .finally(() => {
    cleanupAll();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (failed) process.exit(1);
  });

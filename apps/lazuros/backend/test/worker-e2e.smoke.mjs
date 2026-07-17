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
const Database = require('better-sqlite3');
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

  // ═══ Part D — the edge contract: routes live at their FULL declared paths ═══
  // LazurOS is the one peer whose Express routes carry the '/api/lazuros' prefix, so its
  // nginx block must NOT strip it (the others' do strip). That disagreement is invisible
  // to every in-process test — the server was fine, the conf was fine, and the edge 404'd
  // everything — so pin BOTH halves: the prober checks the conf against these declared
  // paths, and here we prove the server really only answers on them.
  const { CAPABILITIES_DOC } = require('../docs');
  for (const cap of CAPABILITIES_DOC.capabilities) {
    ok(cap.path.startsWith('/api/lazuros/'), `capability '${cap.id}' declares its full edge path (${cap.path})`);
  }
  const stripped = await fetch(`${node.base}/health`);          // what a prefix-stripping edge would send
  ok(stripped.status === 404, 'the STRIPPED path (/health) 404s — proof the routes are not mounted bare, so nginx must preserve the prefix');
  const full = await fetch(`${node.base}/api/lazuros/health`);  // what the fixed edge sends
  ok(full.ok, 'the FULL path (/api/lazuros/health) is the one the server answers');

  // Health reports COMPUTE state, not just process state: the State node is up whether or
  // not the machine that thinks is awake, and the HUD/console must be able to tell those
  // apart (ORDECK renders compute_online:false as "gpu asleep", a warn).
  const hbody = await full.json();
  ok(hbody.status === 'ok' && hbody.service === 'lazuros', 'health keeps the uniform weave payload');
  ok(hbody.compute_online === true && hbody.backends?.local === true,
    'an always-on backend reports compute_online:true, named per backend');
  const wolHealth = await (await fetch(`${wolNode.base}/api/lazuros/health`)).json();
  ok(wolHealth.status === 'ok' && wolHealth.compute_online === false,
    'a sleeping wol backend → still status:ok (the node is up) but compute_online:false (the GPU is not)');

  // The test console ships with the node and is served under the same authed prefix
  // (staging exposes it at /LazurOS).
  const con = await fetch(`${node.base}/api/lazuros/console/`);
  const conHtml = await con.text();
  ok(con.ok && /LazurOS/.test(conHtml), 'the test console is served at /api/lazuros/console/');

  // ═══ Part E — jobs dataset filters: capability (eq) + since (delta cursor over
  // updated_at, exclusive) + undeclared-param handling (ToDo §1a 1.3, docs.js/jobs.js).
  // Seed two rows DIRECTLY into the running node's SQLite file — a second connection
  // alongside the server's (same pattern as library.smoke.mjs), used here to WRITE
  // rows with exactly controlled capability/timestamps instead of racing wall-clock
  // POSTs. No background writer runs on the server between seed and read (queue.js's
  // requeueStaleJobs only fires inside an /internal poll this test never makes), so a
  // one-shot connection that inserts then closes before the next HTTP call is safe. ══
  const seedDb = new Database(node.dbPath);
  const seedJob = (id, capability, stamp) => seedDb.prepare(
    `INSERT INTO jobs (id, user_id, capability, tier_id, status, payload, created_at, updated_at)
     VALUES (?, '1', ?, NULL, 'PENDING', '{}', ?, ?)`,
  ).run(id, capability, stamp, stamp);
  seedJob('e2e-cap-old', 'seed-old', '2020-01-01 00:00:00');
  seedJob('e2e-cap-new', 'seed-new', '2099-01-01 00:00:00');
  seedDb.close();

  // capability: exact-match narrowing, independently in both directions (proves the
  // filter isn't hardcoded to one value — declared == enforced over the real column).
  const byOldCap = await jsonReq(node.base, 'GET', '/api/lazuros/jobs?capability=seed-old');
  ok(Array.isArray(byOldCap.json) && byOldCap.json.length === 1 && byOldCap.json[0].id === 'e2e-cap-old',
    '?capability= narrows to exactly the matching capability');
  const byNewCap = await jsonReq(node.base, 'GET', '/api/lazuros/jobs?capability=seed-new');
  ok(Array.isArray(byNewCap.json) && byNewCap.json.length === 1 && byNewCap.json[0].id === 'e2e-cap-new',
    '?capability= narrows to a DIFFERENT capability independently');

  // since: delta cursor over updated_at — matches the BB items / PapyrOS books
  // convention (`gt`, exclusive): a row strictly after the cursor is IN, a row exactly
  // ON the cursor is OUT.
  const sinceMid = await jsonReq(node.base, 'GET', `/api/lazuros/jobs?since=${encodeURIComponent('2050-01-01 00:00:00')}`);
  const sinceMidIds = (sinceMid.json || []).map((j) => j.id);
  ok(sinceMidIds.includes('e2e-cap-new') && !sinceMidIds.includes('e2e-cap-old'),
    '?since= returns only rows updated AFTER the cursor (newer row in, older row out)');

  const sinceExact = await jsonReq(node.base, 'GET', `/api/lazuros/jobs?since=${encodeURIComponent('2099-01-01 00:00:00')}`);
  const sinceExactIds = (sinceExact.json || []).map((j) => j.id);
  ok(!sinceExactIds.includes('e2e-cap-new'),
    '?since= is EXCLUSIVE — a row whose updated_at exactly equals the cursor is not returned');

  // An undeclared filter param is silently ignored (buildItemFilters only ever reads
  // params present in the declared spec), not rejected and not misapplied as a filter —
  // the row set is identical to the unfiltered read.
  const unfiltered = await jsonReq(node.base, 'GET', '/api/lazuros/jobs');
  const bogus = await jsonReq(node.base, 'GET', '/api/lazuros/jobs?definitely_not_a_declared_filter=xyz');
  ok(bogus.status === 200 && Array.isArray(bogus.json) && bogus.json.length === (unfiltered.json || []).length,
    'an undeclared query param is silently ignored (200, same row set as unfiltered)');

  console.log(`\n✅ worker-e2e: ${pass} assertions`);
}

main()
  .catch((e) => { console.error('\n❌ FAIL:', e.message); failed++; })
  .finally(() => {
    cleanupAll();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (failed) process.exit(1);
  });

// TEST-5 · Delta/cursor contract — pins the GET /api/items?since=<cursor> behaviour
// after BUG-6.1 moved `updated_at` to millisecond ISO stamps. This is the regression
// net for defect 11 (same-second writes silently dropped from the weave delta).
//
// Boots the real server.js on a throwaway DB (no auth key → weave dev-stub user
// sub=1), then asserts:
//   • updated_at is ISO-millisecond format and is stamped on INSERT
//   • two writes in the SAME second get DISTINCT, strictly-increasing stamps — the
//     collision that made a same-second write invisible to a cursor is gone
//   • ?since is strict `>` at millisecond resolution: it excludes the cursor row and
//     includes any strictly-newer row, and returns nothing once the cursor catches up
//   • a PATCH bumps updated_at (the touch trigger) so an EDITED row re-surfaces in the
//     delta past an older cursor
//
//   node apps/beigeboard/backend/test/delta.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
// Claimed in the suite-manifest port registry ('beigeboard:delta.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3986;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'beigeboard';

const tmp = mkdtempSync(join(tmpdir(), 'bb-delta-'));
const DB_PATH = join(tmp, 'test.db');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}
const since = async (cursor) => (await req('GET', `/api/items?since=${encodeURIComponent(cursor)}`)).json || [];

async function waitForHealth(ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited) return false; // the child is gone — polling the port can only find a stranger
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.service === SERVICE) return true;
        console.error(`  ✗ /health answered 200 but service=${JSON.stringify(body.service)} — ` +
                      `expected '${SERVICE}'. Another server owns this port.`);
        return false;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: { ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let exited = null; // fail fast: a child that dies pre-health must not be polled for
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
child.on('exit', (code, signal) => { exited = { code, signal }; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  // The child's own words, on ANY failure — not only when health never came up.
  if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\ndelta.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '')
      + ':\n' + serverLog);
    done();
  }

  // ── A. INSERT stamps updated_at in ISO-millisecond format ─────────────────────
  const r1 = await req('POST', '/api/items', { title: 'delta one' });
  ok(r1.status === 201, `A: create → 201 (got ${r1.status})`);
  ok(typeof r1.json?.updated_at === 'string' && ISO_MS.test(r1.json.updated_at),
    `A: updated_at is ISO-millisecond on insert (got ${JSON.stringify(r1.json?.updated_at)})`);

  // ── B. two writes in the same second get distinct, increasing stamps (defect 11)
  //     The 2ms gap keeps them in one wall-clock second while guaranteeing distinct
  //     milliseconds — at the OLD second resolution both would share a stamp and the
  //     second would be invisible to a cursor sitting on the first.
  await sleep(2);
  const r2 = await req('POST', '/api/items', { title: 'delta two' });
  ok(r2.status === 201 && ISO_MS.test(r2.json?.updated_at), `B: second create → 201 ISO-ms (got ${r2.status})`);
  ok(r2.json.updated_at > r1.json.updated_at,
    `B: the later write's stamp is strictly greater (${r1.json.updated_at} < ${r2.json.updated_at})`);
  ok(r2.json.updated_at !== r1.json.updated_at, 'B: the two stamps are distinct (no same-second collision)');

  // ── C. ?since is strict `>`: cursor at row1 excludes row1, includes row2 ───────
  const afterR1 = await since(r1.json.updated_at);
  const idsAfterR1 = afterR1.map((x) => x.id);
  ok(!idsAfterR1.includes(r1.json.id), 'C: ?since=<row1.updated_at> EXCLUDES row1 (strict >)');
  ok(idsAfterR1.includes(r2.json.id), 'C: ?since=<row1.updated_at> INCLUDES the newer row2');
  ok(afterR1.every((x) => x.updated_at > r1.json.updated_at), 'C: every delta row is strictly newer than the cursor');

  // ── D. cursor caught up: since=<latest> returns nothing at/before it ───────────
  const latest = r2.json.updated_at;
  const caught = await since(latest);
  ok(!caught.some((x) => x.id === r2.json.id), 'D: the cursor row itself is not re-returned');
  ok(caught.every((x) => x.updated_at > latest), 'D: ?since=<latest> returns only strictly-newer rows');

  // ── E. PATCH bumps updated_at (touch trigger) → edited row re-surfaces past a cursor
  await sleep(2);
  const patched = await req('PATCH', `/api/items/${r1.json.id}`, { title: 'delta one (edited)' });
  ok(patched.status === 200 && ISO_MS.test(patched.json?.updated_at), `E: PATCH → 200 ISO-ms updated_at (got ${patched.status})`);
  ok(patched.json.updated_at > r1.json.updated_at,
    `E: PATCH bumped updated_at (${r1.json.updated_at} → ${patched.json.updated_at})`);
  ok(patched.json.updated_at > latest, 'E: the edit is newer than the previous latest cursor');
  const afterEdit = await since(latest);
  ok(afterEdit.some((x) => x.id === r1.json.id), 'E: the edited row re-surfaces in the delta past the old cursor');
} catch (e) {
  console.error('harness error:', e);
  fail++;
} finally {
  done();
}

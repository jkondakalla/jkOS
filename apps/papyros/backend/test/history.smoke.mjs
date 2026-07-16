// history.smoke.mjs (task 17.4) — the append-only play-history smoke: boots the REAL
// server (throwaway port + temp DB, a REAL RS256 keypair so forged per-user tokens
// exercise cross-user scoping — same recipe as playback.smoke.mjs) with
// AUDIOBOOKS_DIR pointed at an EMPTY temp directory. Unlike playback/library/
// meta.smoke.mjs this needs no ffprobe/ffmpeg and never SKIPs: `history.item_ref` is
// a soft `ref` stud (TEXT column, no SQL FK — same convention as `progress.book_ref`,
// see discovery.js's long NOTE on PROGRESS), so a fake book id round-trips through
// the collection with no real scanned book required. The boot scan runs against the
// empty dir and completes as a no-op (0 books), which is all this smoke needs.
//
// Asserts (17.4's contract, `defineCollection(..., { only: ['create'] })`,
// packages/weave/src/server/collection.js):
//   1. unauthenticated POST/GET /api/history → 401 (same identity-gate pin every
//      other route in this app carries).
//   2. POST creates a row (201), append-only fields round-trip (item_ref canonical
//      string, ms_played, completed), scoped to the caller (user_id not on the wire
//      shape but enforced server-side — proven by the cross-user list check below).
//   3. A SECOND create for the same (user, item_ref) APPENDS a second row — no
//      upsert/collapse (the opposite contract from `progress`'s migration-8 unique
//      index + upsert-on-conflict trigger; history must accumulate every session).
//   4. PATCH /api/history/:id and DELETE /api/history/:id → 404 — not merely
//      auth-denied, the routes are NOT MOUNTED at all (defineCollection's `only`
//      option omits them entirely; server.js's /api/* catch-all is what answers).
//   5. GET /api/history lists only the caller's own rows (owner-scoped), and a
//      second user's rows never leak into it.
//   6. The served discovery docs (/api/capabilities, /api/datasets) reflect the
//      append-only contract: capabilities carries createHistory but NEITHER
//      updateHistory NOR deleteHistory; the `history` dataset's row shape is
//      exactly id/item_ref/started_at/ms_played/completed/updated_at.
//
//   node apps/papyros/backend/test/history.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');

const PORT = 3993;
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = 'jkos-auth';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

const tmp = mkdtempSync(join(tmpdir(), 'papyros-history-'));
const DB_PATH = join(tmp, 'test.db');
// Empty on purpose — see file header: no fixture library, no ffprobe needed. The
// boot scan runs against this and completes as a 0-book no-op.
const AUDIOBOOKS_DIR = join(tmp, 'empty-audiobooks');
mkdirSync(AUDIOBOOKS_DIR, { recursive: true });

// ── Forge suite tokens: RS256 over a throwaway keypair the server is told to trust —
//    same recipe as playback.smoke.mjs, needed because the dev-stub auth only ever
//    injects ONE identity, which can't exercise cross-user scoping.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mkToken(claims) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: '1' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, ...claims }));
  const input = `${header}.${payload}`;
  const sig = b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey));
  return `${input}.${sig}`;
}
const A = mkToken({ sub: 401, role: 'admin', scope: ['papyros:write'] });
const B = mkToken({ sub: 402, role: 'admin', scope: ['papyros:write'] });

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}
const listHistory = async (token) => (await req('GET', '/api/history', undefined, token)).json || [];

async function waitForHealth(ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE + '/health')).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: '',
    PORT: String(PORT),
    DB_PATH,
    AUDIOBOOKS_DIR,
    JKOS_AUTH_PUBLIC_KEY: publicKey,
    JKOS_AUTH_ISSUER: ISSUER,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\nhistory.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) { console.error('server never became healthy:\n' + serverLog); done(); }

  // ── 1. unauthenticated → 401 (identity-gate pin, same shape as every other route) ──
  const anonPost = await req('POST', '/api/history', { item_ref: 1, started_at: new Date().toISOString(), ms_played: 1000 });
  ok(anonPost.status === 401, `auth: unauthenticated POST /api/history → 401 (got ${anonPost.status})`);
  const anonGet = await req('GET', '/api/history');
  ok(anonGet.status === 401, `auth: unauthenticated GET /api/history → 401 (got ${anonGet.status})`);

  // ── 2. create appends a row, scoped to the caller ──────────────────────────────────
  const startedAt1 = '2026-07-15T10:00:00.000Z';
  const create1 = await req('POST', '/api/history',
    { item_ref: 7, started_at: startedAt1, ms_played: 90000, completed: false }, A);
  ok(create1.status === 201, `history: A creates a row → 201 (got ${create1.status} ${JSON.stringify(create1.json)})`);
  ok(String(create1.json?.item_ref) === '7',
    `history: ref-typed item_ref is stored/returned as its canonical string "7" (got ${JSON.stringify(create1.json?.item_ref)})`);
  ok(create1.json?.started_at === startedAt1, `history: started_at round-trips (got ${create1.json?.started_at})`);
  ok(create1.json?.ms_played === 90000, `history: ms_played round-trips (got ${create1.json?.ms_played})`);
  ok(create1.json?.completed === false, `history: completed round-trips (got ${create1.json?.completed})`);

  const aList1 = await listHistory(A);
  ok(aList1.length === 1 && aList1[0]?.id === create1.json?.id,
    `history: A sees exactly their own row (got ${JSON.stringify(aList1.map((r) => r.id))})`);

  // ── 3. a SECOND create for the same book APPENDS — no upsert/collapse ─────────────
  const startedAt2 = '2026-07-15T11:00:00.000Z';
  const create2 = await req('POST', '/api/history',
    { item_ref: 7, started_at: startedAt2, ms_played: 30000, completed: true }, A);
  ok(create2.status === 201, `history: A's second session also creates a row → 201 (got ${create2.status})`);
  ok(create2.json?.id !== create1.json?.id, 'history: the second row is a DISTINCT row (not an upsert of the first)');
  ok(create2.json?.completed === true, `history: completed=true round-trips on the finishing session (got ${create2.json?.completed})`);

  const aList2 = await listHistory(A);
  ok(aList2.length === 2, `history: A now has BOTH session rows — append accumulates, never collapses (got ${aList2.length})`);

  // ── 4. update/delete surface does not exist — 404, routes not mounted at all ──────
  const patchAttempt = await req('PATCH', `/api/history/${create1.json.id}`, { ms_played: 1 }, A);
  ok(patchAttempt.status === 404, `history: PATCH /api/history/:id → 404, no such route (got ${patchAttempt.status})`);
  const deleteAttempt = await req('DELETE', `/api/history/${create1.json.id}`, undefined, A);
  ok(deleteAttempt.status === 404, `history: DELETE /api/history/:id → 404, no such route (got ${deleteAttempt.status})`);
  const stillThere = await listHistory(A);
  ok(stillThere.length === 2, 'history: both rows survive the PATCH/DELETE attempts unchanged');

  // ── 5. owner-scoped list — a second user's rows never leak ────────────────────────
  const bList1 = await listHistory(B);
  ok(bList1.length === 0, `history: B's list is empty before B records anything (got ${bList1.length})`);
  const createB = await req('POST', '/api/history',
    { item_ref: 3, started_at: '2026-07-15T12:00:00.000Z', ms_played: 5000, completed: false }, B);
  ok(createB.status === 201, `history: B creates their own row → 201 (got ${createB.status})`);
  const bList2 = await listHistory(B);
  ok(bList2.length === 1 && bList2[0]?.id === createB.json?.id, 'history: B sees exactly their own row');
  ok(!bList2.some((r) => r.id === create1.json?.id || r.id === create2.json?.id),
    'history: B\'s list does NOT include either of A\'s rows');
  const aList3 = await listHistory(A);
  ok(aList3.length === 2 && !aList3.some((r) => r.id === createB.json?.id),
    'history: A\'s list does NOT include B\'s row (round trip holds both directions)');

  // ── 6. discovery docs reflect the append-only contract ────────────────────────────
  const caps = (await req('GET', '/api/capabilities')).json;
  const capIds = (caps?.capabilities || []).map((c) => c.id);
  ok(capIds.includes('createHistory'), `discovery: capabilities includes createHistory (got ${JSON.stringify(capIds)})`);
  ok(!capIds.includes('updateHistory'), 'discovery: capabilities does NOT include updateHistory');
  ok(!capIds.includes('deleteHistory'), 'discovery: capabilities does NOT include deleteHistory');

  const dsets = (await req('GET', '/api/datasets')).json;
  const historyDataset = (dsets?.datasets || []).find((d) => d.id === 'history');
  ok(!!historyDataset, 'discovery: datasets includes a `history` entry');
  ok(historyDataset?.item?.map((f) => f.name).join(',') === 'id,item_ref,started_at,ms_played,completed,updated_at',
    `discovery: history dataset row shape is exactly id/item_ref/started_at/ms_played/completed/updated_at (got ${JSON.stringify(historyDataset?.item?.map((f) => f.name))})`);
} catch (e) {
  console.error('history.smoke crashed:', e);
  fail++;
} finally {
  done();
}

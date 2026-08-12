// Integration smoke test for the ROUTINE CADENCE ENGINE (src/routines.js).
//
// Routines are the app's first recurrence, and the whole design rests on one bet:
// occurrences are REAL rows, so nothing downstream needs a new concept. That bet
// only holds if the mint is exactly right, because a wrong mint writes real,
// user-visible tasks. This drives the live server so the rules are tested through
// the same HTTP surface the app and any peer use, not against the module directly.
//
// Covered:
//   A. an active routine mints its horizon on the very first read
//   B. the mint is IDEMPOTENT — a second read writes nothing
//   C. RULE 1 — nothing is ever minted before today (a routine created on a
//      Wednesday does not conjure Monday's occurrence as already overdue)
//   D. occurrences are ORDINARY TASKS — kind/parent/accent/time, readable through
//      the plain `kind=task` dataset filter with no routine awareness
//   E. RULE 2 — narrowing the cadence withdraws the untouched future ONLY: a
//      completed occurrence and a moved one both survive
//   F. renaming the routine propagates to the future it still owns, and to nothing
//      the user has claimed
//   G. parking stops production; resuming restarts it
//   H. the cadence is validated at the door (bad days / out-of-range count → 400)
//   I. X-BB-Today is honoured, so the user's local day drives the mint, and a
//      filtered read never triggers a horizon write
//
//   node apps/beigeboard/backend/test/routines.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = 'jkos-auth';

const tmp = mkdtempSync(join(tmpdir(), 'bb-routines-'));
const DB_PATH = join(tmp, 'test.db');

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
  return `${input}.${b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey))}`;
}
const A = mkToken({ sub: 501, role: 'admin', scope: ['beigeboard:write'] });

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

/* Every request pins the same "today" so the expected dates are fixed rather than
   relative to when the suite happens to run. 2026-08-12 is a WEDNESDAY, which is
   the case RULE 1 is about: a routine born mid-week must not back-fill the week. */
const TODAY = '2026-08-12';
const MON = '2026-08-10', TUE = '2026-08-11', WED = '2026-08-12', FRI = '2026-08-14';
const NEXT_MON = '2026-08-17', NEXT_WED = '2026-08-19', NEXT_FRI = '2026-08-21';

async function req(method, path, body, { today = TODAY, token = A } = {}) {
  const headers = { 'X-BB-Today': today };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}
const list = async (opts) => (await req('GET', '/api/items', undefined, opts)).json || [];
const occurrencesOf = (rows, id) => rows
  .filter((r) => r.parent_id === id && String(r.ext_ref || '').startsWith('routine:'))
  .sort((a, b) => String(a.ext_ref).localeCompare(String(b.ext_ref)));
const dates = (rows, id) => occurrencesOf(rows, id).filter((o) => o.due_date).map((o) => o.due_date).sort();

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
    ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH,
    JKOS_AUTH_PUBLIC_KEY: publicKey, JKOS_AUTH_ISSUER: ISSUER,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\nroutines.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) { console.error('server never became healthy:\n' + serverLog); done(); }

  // ── H. the cadence is validated at the door ─────────────────────────────────
  for (const bad of ['7', '0,0', '-1', 'mon', '0,9']) {
    const r = await req('POST', '/api/items', { title: 'bad', kind: 'routine', cadence_days: bad });
    ok(r.status === 400 && r.json?.code === 'VALIDATION',
      `H: cadence_days='${bad}' → 400 VALIDATION (got ${r.status})`);
  }
  const bigCount = await req('POST', '/api/items', { title: 'bad', kind: 'routine', cadence_count: 99 });
  ok(bigCount.status === 400, `H: cadence_count=99 → 400 (got ${bigCount.status})`);

  // ── A. an active routine mints its horizon ──────────────────────────────────
  const made = await req('POST', '/api/items', {
    title: 'Lift', kind: 'routine', status: 'active',
    cadence_days: '0,2,4', cadence_count: 4, scheduled_time: '07:00', accent: '#B05040',
  });
  ok(made.status === 201 && made.json?.kind === 'routine', `A: routine created (got ${made.status})`);
  const rid = made.json.id;

  let rows = await list();
  const d1 = dates(rows, rid);
  ok(JSON.stringify(d1) === JSON.stringify([WED, FRI, NEXT_MON, NEXT_WED, NEXT_FRI]),
    `A: minted Wed+Fri this week and all three next week (got ${JSON.stringify(d1)})`);

  // ── C. RULE 1 — never behind today ──────────────────────────────────────────
  ok(!d1.includes(MON) && !d1.includes(TUE),
    'C: Monday of the current week is NOT minted for a routine created on Wednesday');

  // ── the float: target 4 over 3 committed days = 1 benched occurrence a week ──
  const floats = occurrencesOf(rows, rid).filter((o) => !o.due_date);
  ok(floats.length === 2, `float: one benched occurrence per horizon week (got ${floats.length})`);
  ok(floats.every((f) => f.week_start && !f.due_date),
    'float: benched on a week_start with no due_date — the shape the week bench already renders');

  // ── B. idempotent ───────────────────────────────────────────────────────────
  const before = rows.length;
  rows = await list();
  ok(rows.length === before, `B: a second read mints nothing (${before} → ${rows.length})`);

  // ── D. occurrences are ordinary tasks ───────────────────────────────────────
  const anOcc = occurrencesOf(rows, rid).find((o) => o.due_date === NEXT_MON);
  ok(anOcc?.kind === 'task', `D: an occurrence is kind:'task' (got ${anOcc?.kind})`);
  ok(anOcc?.scheduled_time === '07:00' && anOcc?.accent === '#B05040',
    'D: an occurrence inherits the routine time + accent');
  ok(anOcc?.ext_ref === `routine:${rid}:${NEXT_MON}`, `D: ext_ref names its routine and date (got ${anOcc?.ext_ref})`);
  const asTasks = await req('GET', '/api/items?kind=task');
  ok(asTasks.json.some((t) => t.id === anOcc.id),
    'D: a peer reading the plain kind=task dataset sees occurrences, no routine concept needed');
  const byPrefix = await req('GET', '/api/items?ext_ref_prefix=routine:');
  ok(byPrefix.json.length === occurrencesOf(rows, rid).length,
    'D: ?ext_ref_prefix=routine: lists exactly the occurrences');

  // ── I. a FILTERED read must not trigger a horizon write ─────────────────────
  //     (the filtered guard is what stops a peer polling one day from writing.)
  const filteredBefore = (await list()).length;
  await req('GET', '/api/items?kind=task');
  await req('GET', `/api/items?due_date=${NEXT_MON}`);
  ok((await list()).length === filteredBefore, 'I: filtered reads never mint');

  // ── E. RULE 2 — narrowing withdraws only the untouched future ───────────────
  const wedOcc = occurrencesOf(rows, rid).find((o) => o.due_date === WED);
  const friOcc = occurrencesOf(rows, rid).find((o) => o.due_date === FRI);
  await req('PATCH', `/api/items/${wedOcc.id}`, { completed: true });      // a record
  await req('PATCH', `/api/items/${friOcc.id}`, { due_date: '2026-08-15' }); // a decision
  await req('PATCH', `/api/items/${rid}`, { cadence_days: '0', cadence_count: 1 });

  rows = await list();
  const kept = occurrencesOf(rows, rid);
  ok(kept.some((o) => o.id === wedOcc.id && o.completed),
    'E: a COMPLETED occurrence survives a cadence change — it is a record of something done');
  ok(kept.some((o) => o.id === friOcc.id && o.due_date === '2026-08-15'),
    'E: a MOVED occurrence survives — the user claimed it');
  ok(kept.some((o) => o.due_date === NEXT_MON), 'E: next Monday survives (still in the cadence)');
  ok(!kept.some((o) => o.due_date === NEXT_WED || o.due_date === NEXT_FRI),
    'E: the untouched future the cadence dropped is withdrawn');

  // ── F. renaming propagates to what the engine still owns, and nothing else ──
  await req('PATCH', `/api/items/${rid}`, { title: 'Lift heavy', scheduled_time: '07:30' });
  rows = await list();
  const after = occurrencesOf(rows, rid);
  const nextMon = after.find((o) => o.due_date === NEXT_MON);
  ok(nextMon?.title === 'Lift heavy' && nextMon?.scheduled_time === '07:30',
    'F: the untouched future follows a rename/retime');
  ok(after.find((o) => o.id === wedOcc.id)?.title === 'Lift',
    'F: a completed occurrence keeps the name it was done under');
  ok(after.find((o) => o.id === friOcc.id)?.title === 'Lift',
    'F: a moved occurrence is never rewritten');

  // ── G. park stops production, resume restarts it ────────────────────────────
  await req('PATCH', `/api/items/${rid}`, { status: 'parked' });
  rows = await list();
  ok(!occurrencesOf(rows, rid).some((o) => o.due_date === NEXT_MON),
    'G: parking withdraws the untouched future');
  ok(occurrencesOf(rows, rid).some((o) => o.id === wedOcc.id),
    'G: parking never touches the past');
  await req('PATCH', `/api/items/${rid}`, { status: 'active' });
  rows = await list();
  ok(occurrencesOf(rows, rid).some((o) => o.due_date === NEXT_MON),
    'G: resuming mints the horizon again');

  // ── I. the horizon rolls forward with the caller's day ──────────────────────
  //     The horizon is two weeks wide, so reading a week later must mint the week
  //     that has just come into range (Mon 24th) and nothing beyond it (the 31st is
  //     still a week out). This is what makes the engine need no cron: the horizon
  //     advances on being looked at.
  ok(!dates(rows, rid).includes('2026-08-24'), 'I: the third week is out of range before the clock moves');
  const later = await list({ today: '2026-08-19' });
  ok(dates(later, rid).includes('2026-08-24'),
    `I: reading a week later mints the week that came into range (got ${JSON.stringify(dates(later, rid))})`);
  ok(!dates(later, rid).includes('2026-08-31'),
    'I: and stops at the horizon — it does not run away into the future');

  // A malformed header must fall back to the server date, not reach the date maths.
  const junk = await req('GET', '/api/items', undefined, { today: 'not-a-date' });
  ok(junk.status === 200, `I: a malformed X-BB-Today is ignored, not fatal (got ${junk.status})`);

  // ── cascade: deleting the routine takes its occurrences with it ─────────────
  await req('DELETE', `/api/items/${rid}`);
  rows = await list();
  ok(!rows.some((r) => r.id === rid), 'cascade: the routine is gone');
  ok(occurrencesOf(rows, rid).length === 0, 'cascade: its occurrences went with it');
} catch (e) {
  console.error('harness error:', e);
  fail++;
} finally {
  done();
}

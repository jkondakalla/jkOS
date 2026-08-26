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
//   K. migration 13's variance instrumentation — completed_at is stamped by the
//      TRIGGER on the 0→1 edge, is not moved by a later edit (the whole reason it
//      is not updated_at), is cleared on retraction and is not client-writable;
//      started_at is validated at the door; and the per-step at/seq survive the
//      engine's normaliser
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
// Claimed in the suite-manifest port registry ('beigeboard:routines.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'beigeboard';
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

/* Every request pins the same "today", so the expected dates are fixed relative to
   each other rather than to when the suite happens to run — but the pin is DERIVED
   FROM THE CLOCK, not written down.
 *
 * It used to be the literal '2026-08-12', and that was a time bomb that went off:
 * RULE 1 floors the mint at the routine's own creation date, which SQLite stamps in
 * UTC from the real clock, so once the real date passed the literal, every
 * occurrence the test expected was refused as "before the routine existed" and the
 * whole file failed. A pinned "today" therefore has to sit AHEAD of the run, not
 * behind it.
 *
 * Wednesday of NEXT week: always a Wednesday (the mid-week case RULE 1 is about — a
 * routine born mid-week must not back-fill Monday), and always 5–11 days ahead of
 * whenever the suite runs, so it clears the creation floor in any timezone. */
const isoOf = (d) => d.toISOString().slice(0, 10);
const shift = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
};
const nowIso = isoOf(new Date());
// This week's Monday (UTC, Monday-start like the rest of the suite), then +9 = next Wednesday.
const thisMon = shift(nowIso, -((new Date(`${nowIso}T00:00:00Z`).getUTCDay() + 6) % 7));
const TODAY = shift(thisMon, 9);

const MON = shift(TODAY, -2), TUE = shift(TODAY, -1), WED = TODAY, FRI = shift(TODAY, 2);
const NEXT_MON = shift(TODAY, 5), NEXT_WED = shift(TODAY, 7), NEXT_FRI = shift(TODAY, 9);
const SAT = shift(TODAY, 3);                       // the "moved to a decision" day in E
const WEEK3_MON = shift(TODAY, 12);                // out of the 2-week horizon from TODAY…
const WEEK4_MON = shift(TODAY, 19);                // …and still out of it a week later
const NEXT_WEEK = shift(TODAY, 7);                 // a later "today" that rolls the horizon

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
  env: {
    ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH,
    JKOS_AUTH_PUBLIC_KEY: publicKey, JKOS_AUTH_ISSUER: ISSUER,
  },
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
  console.log(`\nroutines.smoke: ${pass} passed, ${fail} failed`);
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
  await req('PATCH', `/api/items/${friOcc.id}`, { due_date: SAT });         // a decision
  await req('PATCH', `/api/items/${rid}`, { cadence_days: '0', cadence_count: 1 });

  rows = await list();
  const kept = occurrencesOf(rows, rid);
  ok(kept.some((o) => o.id === wedOcc.id && o.completed),
    'E: a COMPLETED occurrence survives a cadence change — it is a record of something done');
  ok(kept.some((o) => o.id === friOcc.id && o.due_date === SAT),
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
  ok(!dates(rows, rid).includes(WEEK3_MON), 'I: the third week is out of range before the clock moves');
  const later = await list({ today: NEXT_WEEK });
  ok(dates(later, rid).includes(WEEK3_MON),
    `I: reading a week later mints the week that came into range (got ${JSON.stringify(dates(later, rid))})`);
  ok(!dates(later, rid).includes(WEEK4_MON),
    'I: and stops at the horizon — it does not run away into the future');

  // A malformed header must fall back to the server date, not reach the date maths.
  const junk = await req('GET', '/api/items', undefined, { today: 'not-a-date' });
  ok(junk.status === 200, `I: a malformed X-BB-Today is ignored, not fatal (got ${junk.status})`);

  // ── J. THE SKIP LIST — deleting one occurrence has to STAY deleted ──────────
  //     The mint runs on every unfiltered read, so before migration 12 a delete
  //     was a no-op with a delay: the row left the view in front of you and the
  //     next read re-derived it from rules that still called for it. The whole
  //     point of this section is the SECOND read.
  const jMade = await req('POST', '/api/items', {
    title: 'Read', kind: 'routine', status: 'active', cadence_days: '0,2,4',
  });
  const jid = jMade.json.id;
  let jRows = await list();
  const jVictim = occurrencesOf(jRows, jid).find((o) => o.due_date && o.due_date > TODAY);
  ok(!!jVictim, 'J: a future occurrence to strike out');

  await req('DELETE', `/api/items/${jVictim.id}`);
  jRows = await list();
  ok(!dates(jRows, jid).includes(jVictim.due_date),
    `J: the deleted session is gone after the NEXT read, not re-minted (got ${JSON.stringify(dates(jRows, jid))})`);
  await list();                                          // and stays gone on the one after
  jRows = await list();
  ok(!dates(jRows, jid).includes(jVictim.due_date), 'J: still gone two reads later');
  ok(String(jRows.find((r) => r.id === jid)?.cadence_skips || '').includes(jVictim.due_date),
    'J: the exception is recorded ON THE ROUTINE, where the rules live');

  // Its neighbours are untouched — a skip is one date, not the weekday.
  ok(dates(jRows, jid).length > 0 && !dates(jRows, jid).includes(jVictim.due_date),
    'J: the rest of the cadence still mints — one exception, not a withdrawal');

  // Un-skip: clearing the entry puts that session back. This is the board's
  // struck-cell click, and it is the only way to undo a delete.
  await req('PATCH', `/api/items/${jid}`, { cadence_skips: '' });
  jRows = await list();
  ok(dates(jRows, jid).includes(jVictim.due_date), 'J: clearing the exception re-mints the session');

  // Validated at the door like every other value that steers the mint.
  for (const bad of ['nope', '2026-13-40', `${TODAY},junk`]) {
    const r = await req('PATCH', `/api/items/${jid}`, { cadence_skips: bad });
    ok(r.status === 400 && r.json?.code === 'VALIDATION',
      `J: cadence_skips='${bad}' → 400 VALIDATION (got ${r.status})`);
  }
  await req('DELETE', `/api/items/${jid}`);


  // ── K. VARIANCE INSTRUMENTATION (migration 13) ─────────────────────────────
  //     The two facts nothing in this schema could answer, and that no later code
  //     can recover — they exist only if they are recorded as they happen
  //     (Documentation/ALGORITHMS.md §3). Tested through HTTP like everything else
  //     here, because the stamp is a TRIGGER and the point of a trigger is that it
  //     fires for the routes that forgot about it.
  const kMade = await req('POST', '/api/items', {
    title: 'Instrumented', kind: 'routine', status: 'active', cadence_days: '0,2,4',
  });
  const kid = kMade.json.id;
  const kOcc = occurrencesOf(await list(), kid)[0];
  ok(!!kOcc && kOcc.completed_at === null, 'K: a fresh occurrence has no completion stamp');

  await req('PATCH', `/api/items/${kOcc.id}`, { completed: true });
  let kRow = (await list()).find((r) => r.id === kOcc.id);
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(kRow.completed_at)),
    `K: completing stamps completed_at in the millisecond-ISO the *_at family sorts on (got ${kRow.completed_at})`);

  // A LATER EDIT MUST NOT MOVE IT. This is the entire reason the column exists
  // rather than the analysis reading updated_at: renaming a task next week would
  // otherwise silently redate when it was finished, and skip clustering BY DATE
  // would be computed over the edit history instead of the completion history.
  const stampedAt = kRow.completed_at;
  await new Promise((r) => setTimeout(r, 5));
  await req('PATCH', `/api/items/${kOcc.id}`, { title: 'Instrumented (renamed)' });
  kRow = (await list()).find((r) => r.id === kOcc.id);
  ok(kRow.completed_at === stampedAt, 'K: a later edit does NOT move the completion stamp');
  ok(kRow.updated_at > stampedAt, 'K: …while updated_at does move — the two are different facts');

  // Un-ticking is the RETRACTION of a completion, not a completion at a later
  // time, so the stamp is cleared rather than left behind.
  await req('PATCH', `/api/items/${kOcc.id}`, { completed: false });
  kRow = (await list()).find((r) => r.id === kOcc.id);
  ok(kRow.completed_at === null, 'K: un-completing CLEARS the stamp');
  await req('PATCH', `/api/items/${kOcc.id}`, { completed: true });
  kRow = (await list()).find((r) => r.id === kOcc.id);
  ok(kRow.completed_at !== null && kRow.completed_at !== stampedAt,
    'K: re-completing stamps afresh — the second completion is a different event');

  // started_at is the one client-writable timestamp, so it is the one that can
  // arrive malformed. Hard 400 at the door: a drift statistic over a local-time
  // string with no zone is wrong in a way nothing downstream can detect.
  const kStart = new Date().toISOString();
  ok((await req('PATCH', `/api/items/${kOcc.id}`, { started_at: kStart })).status === 200,
    'K: a millisecond-ISO started_at is accepted');
  ok((await list()).find((r) => r.id === kOcc.id)?.started_at === kStart,
    'K: …and reads back verbatim');
  for (const bad of ['yesterday evening', '2026-08-18 09:30', '2026-08-18T09:30:00', '2026-13-40T09:30:00.000Z']) {
    const r = await req('PATCH', `/api/items/${kOcc.id}`, { started_at: bad });
    ok(r.status === 400 && r.json?.code === 'VALIDATION',
      `K: started_at='${bad}' → 400 VALIDATION (got ${r.status})`);
  }

  // completed_at is server-managed (client:false), so a caller cannot date its own
  // history — the write is DROPPED by the column allowlist, not honoured.
  await req('PATCH', `/api/items/${kOcc.id}`, { completed_at: '1999-01-01T00:00:00.000Z' });
  ok((await list()).find((r) => r.id === kOcc.id)?.completed_at !== '1999-01-01T00:00:00.000Z',
    'K: a client cannot write completed_at — it is the trigger\'s column');

  // The per-step half of the record: `at` and `seq` are written by the mirror and
  // must SURVIVE the engine's normaliser, which drops every field it does not know.
  await req('PATCH', `/api/items/${kOcc.id}`, {
    performed: { v: 1, steps: { squat: { done: true, met: true, at: kStart, seq: 1 } } },
  });
  const kPerf = JSON.parse((await list()).find((r) => r.id === kOcc.id)?.performed || '{}');
  ok(kPerf.steps?.squat?.at === kStart && kPerf.steps?.squat?.seq === 1,
    'K: performed.steps[k].at and .seq round-trip — the only record of the order steps were done in');
  await req('DELETE', `/api/items/${kid}`);

  // ── cascade: deleting the routine takes its occurrences with it ─────────────
  //     INCLUDING the ones that left the subtree. Re-parenting an occurrence into
  //     a goal moves the row out of the parent_id tree the cascade walks, while
  //     its ext_ref goes on naming the routine — so it used to survive the delete
  //     as a ghost session belonging to nothing.
  const strayGoal = await req('POST', '/api/items', { title: 'Somewhere else', kind: 'goal', scope: 'quarter' });
  const stray = occurrencesOf(await list(), rid).find((o) => o.due_date && o.due_date > TODAY);
  await req('PATCH', `/api/items/${stray.id}`, { parent_id: strayGoal.json.id });

  await req('DELETE', `/api/items/${rid}`);
  rows = await list();
  ok(!rows.some((r) => r.id === rid), 'cascade: the routine is gone');
  ok(occurrencesOf(rows, rid).length === 0, 'cascade: its occurrences went with it');
  ok(!rows.some((r) => String(r.ext_ref || '').startsWith(`routine:${rid}:`)),
    'cascade: an occurrence dragged out of the subtree goes too — matched on ext_ref, not on parentage');
} catch (e) {
  console.error('harness error:', e);
  fail++;
} finally {
  done();
}

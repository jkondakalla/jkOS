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
//   I. a pinned "today" drives the mint (X-JKOS-TODAY, test-harness only), and a
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
import { smoke, forgeTokens } from '../../../../test/lib/smoke.mjs';

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

const { tmp, ok, boot, crashed, done } = smoke('routines.smoke');
const DB_PATH = join(tmp, 'test.db');

const { publicKey, mkToken } = forgeTokens({ issuer: ISSUER });
const A = mkToken({ sub: 501, role: 'admin', scope: ['beigeboard:write'] });
/* A DELEGATED service token acting for A (G1). applyDelegation rewrites `sub` to
   `act` but deliberately LEAVES typ:'service', which is precisely why the old
   identity guard skipped the reconcile for it — see section I3. */
const DELEGATED = mkToken({ sub: 'svc:trigger', typ: 'service', act: 501, scope: ['beigeboard:write'] });
/* A plain service token acting for ITSELF — owns no routines, so its reconcile is a
   no-op, and it must never be seeded. */
const SVC = mkToken({ sub: 'svc:prober', typ: 'service', scope: ['beigeboard:write'] });

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
  /* Pinning "today" is the only way to assert the horizon rolls forward, and since
     D5 it needs the server's opt-in: X-JKOS-TODAY is read only when the process was
     started with JKOS_TIME_TRAVEL=1 outside production (see the spawn below and
     @jkos/weave/server's callerDay.js). In production this header is inert. */
  const headers = { 'X-JKOS-TODAY': today };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}
const list = async (opts) => (await req('GET', '/api/items', undefined, opts)).json || [];
/* ⚠️ Keyed on the REF, not parent_id — the same rule the engine is held to (BB-3).
   This helper used to filter on `r.parent_id === id`, which meant the test could not
   have observed a re-parented occurrence even if it had looked for one: the harness
   carried the identical bug as the code under test, so section L below would have
   passed against the broken engine. A test that reimplements the defect cannot see
   it. */
const occurrencesOf = (rows, id) => rows
  .filter((r) => String(r.ext_ref || '').startsWith(`routine:${id}:`))
  .sort((a, b) => String(a.ext_ref).localeCompare(String(b.ext_ref)));
const dates = (rows, id) => occurrencesOf(rows, id).filter((o) => o.due_date).map((o) => o.due_date).sort();

try {
  await boot({ cwd: BACKEND, port: PORT, service: SERVICE, env: {
    DB_PATH,
    JKOS_TIME_TRAVEL: '1',
    JKOS_AUTH_PUBLIC_KEY: publicKey, JKOS_AUTH_ISSUER: ISSUER,
  } });

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

  // ── I1. a filtered read is IDEMPOTENT, not disabled (BB-1) ──────────────────
  //     ⚠️ THIS SECTION ASSERTED THE OPPOSITE until 2026-08-27: "filtered reads
  //     never mint", written as though the guard were a feature. It was the defect.
  //     All seven of the items dataset's declared filters switched the cadence
  //     engine off, so a peer reading exactly the way the declaration tells it to
  //     was the one caller guaranteed never to roll the horizon — and ORDECK's
  //     unfiltered dashboard poll was the only thing keeping routines minting
  //     suite-wide.
  //
  //     What must still hold is that a filtered read does no WORK when there is
  //     none to do — which is now a property of the day marker rather than of who
  //     is asking. Section I2 below is the other half: on a day the marker has not
  //     seen, a filtered read DOES roll the horizon.
  const filteredBefore = (await list()).length;
  await req('GET', '/api/items?kind=task');
  await req('GET', `/api/items?due_date=${NEXT_MON}`);
  ok((await list()).length === filteredBefore,
    'I1: a filtered read on an already-reconciled day mints nothing — bounded, not disabled');

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

  // ── I2. the horizon rolls forward with the caller's day — THROUGH A FILTER ──
  //     The horizon is two weeks wide, so reading a week later must mint the week
  //     that has just come into range (Mon 24th) and nothing beyond it (the 31st is
  //     still a week out). This is what makes the engine need no cron: the horizon
  //     advances on being looked at.
  //
  //     ⚠️ THE READ THAT ROLLS IT IS DELIBERATELY FILTERED (BB-1). It used to be an
  //     unfiltered `list()`, which passed for the wrong reason — the old code only
  //     ever reconciled on unfiltered reads, so the test proved the horizon rolls
  //     without ever proving WHO can roll it. `?kind=task` is the shape a peer
  //     actually polls with, and against the pre-fix engine this mints nothing at
  //     all. The route re-reads after reconciling, so the filtered response itself
  //     carries the newly minted rows.
  ok(!dates(rows, rid).includes(WEEK3_MON), 'I2: the third week is out of range before the clock moves');
  const laterFiltered = (await req('GET', '/api/items?kind=task', undefined, { today: NEXT_WEEK })).json || [];
  const laterDates = laterFiltered
    .filter((r) => String(r.ext_ref || '').startsWith(`routine:${rid}:`))
    .map((o) => o.due_date).filter(Boolean).sort();
  ok(laterDates.includes(WEEK3_MON),
    `I2: ⭐ a FILTERED read a week later mints the week that came into range (got ${JSON.stringify(laterDates)})`);
  ok(!laterDates.includes(WEEK4_MON),
    'I2: and stops at the horizon — it does not run away into the future');
  await list({ today: NEXT_WEEK }); // the read itself rolls the horizon forward

  // A malformed header must fall back to the server's own answer, not reach the
  // date maths. Same guarantee as before, now enforced by callerDay's isDay().
  const junk = await req('GET', '/api/items', undefined, { today: 'not-a-date' });
  ok(junk.status === 200, `I2: a malformed X-JKOS-TODAY is ignored, not fatal (got ${junk.status})`);

  // ── I3. a DELEGATED service token rolls its acting user's horizon (BB-1) ────
  //     ⚠️ The old guard read `typ === 'service' || sub.startsWith('svc:')` and
  //     skipped. applyDelegation rewrites `sub` to the acting HUMAN but leaves
  //     typ:'service' on purpose — so a delegated token is a service token acting
  //     for a person, and the guard saw only the first half. LazurOS writing back on
  //     a user's behalf therefore never rolled that user's horizon.
  //     ⚠️ Verified through the DELEGATED response ITSELF, never through a
  //     follow-up unfiltered read as A — that read would roll the horizon under the
  //     old code too and the assertion would pass without testing anything. The
  //     route re-reads after reconciling, so a read that rolled the horizon carries
  //     the rows it just minted.
  const farDay = shift(NEXT_WEEK, 7);            // a day no earlier section has used
  const asDelegate = (await req('GET', '/api/items?kind=task', undefined,
    { today: farDay, token: DELEGATED })).json || [];
  const delegateDates = asDelegate
    .filter((r) => String(r.ext_ref || '').startsWith(`routine:${rid}:`))
    .map((o) => o.due_date).filter(Boolean).sort();
  ok(delegateDates.includes(WEEK4_MON),
    `I3: ⭐ a filtered read under a DELEGATED token rolls the ACTING USER's horizon (got ${JSON.stringify(delegateDates)})`);

  //     A plain service identity owns nothing, so its own reconcile is a harmless
  //     no-op — and it must still never be SEEDED. That guard was always about who
  //     is asking, and it stays.
  const svcRows = (await req('GET', '/api/items', undefined, { token: SVC })).json || [];
  ok(svcRows.length === 0,
    `I3: a service identity reading on its OWN behalf gets nothing conjured under svc: (got ${svcRows.length})`);

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

  // ── L. THE REF IS THE AUTHORITY, NOT parent_id (BB-3) ───────────────────────
  //    routines.js has said "THE REF IS THE AUTHORITY, not parent_id" in prose since
  //    it was written, while FIVE of its six occurrence readers keyed on parent_id.
  //    Dragging a session out from under its routine — into a goal, which is the
  //    whole reason the rule exists — kept its ext_ref but moved it out of every
  //    reader's view. It then became a ghost: never withdrawn, never re-rendered,
  //    absent from the tally, and re-INSERTed on every single reconcile forever, an
  //    insert the unique (user_id, ext_ref) index refuses and INSERT OR IGNORE
  //    swallows in silence while `minted` honestly reports 0.
  //
  //    The move must NOT change due_date: moving an occurrence off its minted date
  //    is what hands it to the user permanently (isEngineOwned). Re-parenting alone
  //    does not, so this row stays the engine's — which is exactly what makes it a
  //    test of the reader rather than of ownership.
  const lGoal = await req('POST', '/api/items', { title: 'A goal to drag into', kind: 'goal' });
  const lMade = await req('POST', '/api/items', {
    title: 'Drag me', kind: 'routine', status: 'active', cadence_days: '0,2', cadence_count: 2,
  });
  const lRid = lMade.json.id;
  let lRows = await list();
  const strayBefore = occurrencesOf(lRows, lRid).find((o) => o.due_date === NEXT_WED);
  ok(!!strayBefore, 'L: the routine minted next Wednesday to work with');

  const reparent = await req('PATCH', `/api/items/${strayBefore.id}`, { parent_id: lGoal.json.id });
  ok(reparent.status === 200, `L: an occurrence can be dragged under a goal (got ${reparent.status})`);
  lRows = await list();
  const lStray = lRows.find((r) => r.id === strayBefore.id);
  ok(lStray?.parent_id === lGoal.json.id, 'L: it really left the routine subtree');
  ok(lStray?.ext_ref === strayBefore.ext_ref, 'L: and it kept the ref that says what minted it');
  ok(lStray?.due_date === NEXT_WED, 'L: its date is unchanged, so it is still the engine\'s to move');

  // ⚠️ THE ASSERTION THAT FAILS AGAINST THE OLD CODE. Narrow the cadence so next
  //    Wednesday is no longer planned. Keyed on the ref the engine withdraws it;
  //    keyed on parent_id it cannot even see it, and the row survives as a ghost —
  //    a session on the calendar, carrying a prescription, belonging to nothing.
  await req('PATCH', `/api/items/${lRid}`, { cadence_days: '0', cadence_count: 1 });
  lRows = await list();
  ok(!lRows.some((r) => r.id === strayBefore.id),
    'L: ⭐ a re-parented occurrence the cadence dropped is WITHDRAWN — the reconcile follows the ref out of the subtree');

  // The same rule on the write path: ticking a dragged session must still move the
  // ladder. materializeForOccurrence keyed on parent_id AND bailed on a null one,
  // so an occurrence dragged to the top level moved nothing at all.
  const lKeep = occurrencesOf(await list(), lRid).find((o) => o.due_date === NEXT_MON);
  ok(!!lKeep, 'L: next Monday survived the narrowing');
  await req('PATCH', `/api/items/${lKeep.id}`, { parent_id: null });
  const tick = await req('PATCH', `/api/items/${lKeep.id}`, { completed: true });
  ok(tick.status === 200, `L: a top-level dragged occurrence still accepts a tick (got ${tick.status})`);
  const lAfter = occurrencesOf(await list(), lRid);
  ok(lAfter.some((o) => o.id === lKeep.id && o.completed),
    'L: and the engine still recognises it as that routine\'s occurrence afterwards');

  // Deleting the routine reaches the stray too — purgeRoutineOccurrences already
  // keyed on the ref, and now takes the SAME clause builder as everything else.
  await req('DELETE', `/api/items/${lRid}`);
  const lGone = await list();
  ok(!lGone.some((r) => String(r.ext_ref || '').startsWith(`routine:${lRid}:`)),
    'L: deleting the routine reaches every row it minted, wherever the user moved it to');

  // ── M. WHAT A ROUTINE MINTS (BB-16 / D12) ───────────────────────────────────
  //    routines.js hardcoded `'task'`, so a standing weekly MEETING could not be
  //    authored natively: the engine minted it as a task and every calendar surface
  //    filed it wrong. `mint_kind` on the routine row is read by the mint.
  const mMade = await req('POST', '/api/items', {
    title: 'Standup', kind: 'routine', status: 'active',
    cadence_days: '0,2', cadence_count: 2, mint_kind: 'event',
    scheduled_time: '09:00', scheduled_end: '09:15',
  });
  ok(mMade.status === 201, `M: a routine can declare what it mints (got ${mMade.status})`);
  const mRid = mMade.json.id;
  const mOccs = occurrencesOf(await list(), mRid);
  ok(mOccs.length > 0, 'M: it minted a horizon');
  ok(mOccs.every((o) => o.kind === 'event'),
    `M: ⭐ its occurrences are EVENTS, not tasks (got ${JSON.stringify([...new Set(mOccs.map((o) => o.kind))])})`);
  ok(mOccs.every((o) => o.scheduled_time === '09:00'), 'M: and they carry the routine\'s time like any occurrence');

  //    NULL means 'task' — every routine written before the column keeps its
  //    behaviour with no backfill.
  const mDefault = await req('POST', '/api/items', {
    title: 'Lift again', kind: 'routine', status: 'active', cadence_days: '0', cadence_count: 1,
  });
  const mDefOccs = occurrencesOf(await list(), mDefault.json.id);
  ok(mDefOccs.length > 0 && mDefOccs.every((o) => o.kind === 'task'),
    'M: a routine with no mint_kind still mints tasks — the old behaviour, unchanged');

  //    A hand-edited row cannot make the engine mint a `goal`: the value is checked
  //    against the same closed list item-fields declares.
  const mBad = await req('POST', '/api/items', {
    title: 'Bad', kind: 'routine', status: 'active', cadence_days: '0', cadence_count: 1, mint_kind: 'goal',
  });
  ok(mBad.status === 400, `M: an out-of-vocabulary mint_kind is refused at the door (got ${mBad.status})`);

  // ── K. VARIANCE INSTRUMENTATION (migration 13) ─────────────────────────────
  //     The two facts nothing in this schema could answer, and that no later code
  //     can recover — they exist only if they are recorded as they happen
  //     (Documentation/agents/ALGORITHMS.md §3). Tested through HTTP like everything else
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
  // …and the stray carries a CHILD (a per-set log, an added checklist). The purge
  // used to bare-DELETE the stray row, stranding this child as a parentless ghost
  // no view can reach (BB-12) — it must cascade instead.
  const strayChild = await req('POST', '/api/items', { title: 'set log', kind: 'task', parent_id: stray.id });

  await req('DELETE', `/api/items/${rid}`);
  rows = await list();
  ok(!rows.some((r) => r.id === rid), 'cascade: the routine is gone');
  ok(occurrencesOf(rows, rid).length === 0, 'cascade: its occurrences went with it');
  ok(!rows.some((r) => String(r.ext_ref || '').startsWith(`routine:${rid}:`)),
    'cascade: an occurrence dragged out of the subtree goes too — matched on ext_ref, not on parentage');
  ok(!rows.some((r) => r.id === strayChild.json.id),
    'cascade: the stray\'s CHILD goes too — the purge cascades, it does not bare-DELETE (BB-12)');
  ok(rows.some((r) => r.id === strayGoal.json.id),
    'cascade: the goal the stray was dragged into is untouched');
} catch (e) {
  crashed(e);
} finally {
  done();
}

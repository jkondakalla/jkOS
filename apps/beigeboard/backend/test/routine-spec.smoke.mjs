// Integration smoke test for the ROUTINE PRIMITIVE — the document, the library,
// and the progression the cadence engine renders from them (src/routine-spec.js,
// src/library.js, src/routines.js, src/routes/routines.js).
//
// routines.smoke.mjs covers WHEN a routine fires. This covers WHAT the session is
// and HOW IT GETS HARDER, and it drives the live server for the same reason that
// one does: a wrong render writes real numbers that a real person then acts on, so
// the rules have to be tested through the HTTP surface the app and any peer use.
//
// Covered:
//   A. the VOCABULARY endpoint serves the closed lists the validator enforces
//   B. the library seeds on first touch, and a step's `ref` resolves against it —
//      supplying unit/rest/ladder/progression while what the step SAYS still wins
//   C. import is idempotent by slug; ?dryRun=1 renders without writing
//   D. occurrences carry a rendered PRESCRIPTION and the cycle it rendered at
//   E. RULE 3 — completing a session re-renders the FUTURE and never the past
//   F. a MISSED session does not advance the ladder (you progress by doing)
//   G. today's prescription is frozen — a day in progress is not rewritten
//   H. a broken spec is rejected with MACHINE-READABLE errors; a thin one is
//      accepted with LINT
//   I. `performed` drives autoregulated progression
//   J. the preview renders N sessions ahead without writing anything
//   K. a routine with NO document behaves exactly as it did before — the whole
//      primitive is additive
//   L. WAVE 2 — cadence beyond the weekly grid (every_n_days / monthly / rolling /
//      the RRULE subset), and RRULE's unsupported parts REJECTED not half-honoured
//   M. WAVE 2 — deload on demand: renders light AND spends no rung, refuses the past
//   N. WAVE 2 — revisions: a spec edit archives the outgoing document, and every
//      session stamps the revision it followed
//   O. WAVE 2 — the goal metric + the prescribed/performed series
//   P. WAVE 2 — library export round-trips back through import
//   Q. WAVE 3 — the BUNDLE: one paste carrying a library and the routines that use
//      it. The ordering (entries first, so a step may `ref` what the same paste
//      teaches) and the atomicity (one bad routine writes nothing)
//   R. WAVE 3 — the authoring PROMPT: every closed list covered, personalised with
//      the caller's own library
//
//   node apps/beigeboard/backend/test/routine-spec.smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const PORT = 3992;
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = 'jkos-auth';

const tmp = mkdtempSync(join(tmpdir(), 'bb-routine-spec-'));
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
const A = mkToken({ sub: 601, role: 'admin', scope: ['beigeboard:write'] });

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

/* Same derived pin as routines.smoke.mjs, and for the same reason — RULE 1 floors
   the mint at the routine's UTC creation date, so a "today" written down as a
   literal drifts into the past and silently refuses every occurrence. Next
   Wednesday: always mid-week, always ahead of the run. */
const isoOf = (d) => d.toISOString().slice(0, 10);
const shift = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
};
const nowIso = isoOf(new Date());
const thisMon = shift(nowIso, -((new Date(`${nowIso}T00:00:00Z`).getUTCDay() + 6) % 7));
const TODAY = shift(thisMon, 9);                 // a Wednesday, 5–11 days out
const WED = TODAY, FRI = shift(TODAY, 2);
const NEXT_MON = shift(TODAY, 5), NEXT_WED = shift(TODAY, 7), NEXT_FRI = shift(TODAY, 9);

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
const occsOf = (rows, id) => rows
  .filter((r) => r.parent_id === id && String(r.ext_ref || '').startsWith('routine:'))
  .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
const on = (rows, id, date) => occsOf(rows, id).find((o) => o.due_date === date) || null;
const rx = (o) => { try { return JSON.parse(o.prescription); } catch { return null; } };
/** The rendered line for one step of one occurrence — what the user is told to do. */
const lineOf = (o, key) => rx(o)?.steps.find((s) => s.key === key)?.line ?? null;

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
  console.log(`\nroutine-spec.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) { console.error('server never became healthy:\n' + serverLog); done(); }

  // ── A. the vocabulary ───────────────────────────────────────────────────────
  //     Served FROM the constants the validator uses, so an author cannot be told
  //     a progression type exists that a write would then reject.
  const vocab = (await req('GET', '/api/routines/vocabulary')).json;
  ok(Array.isArray(vocab?.progressions?.types) && vocab.progressions.types.includes('double'),
    'A: vocabulary lists the progression types');
  ok(vocab?.days?.names?.[0] === 'mon' && vocab.days.encoding.includes('Monday'),
    'A: vocabulary pins the day encoding to Monday (the thing authors get wrong)');
  ok(vocab?.example?.spec?.steps?.length > 0, 'A: vocabulary carries a worked example, not just a field list');
  ok(vocab?.limits?.steps > 0, 'A: vocabulary carries the enforced limits');

  // ── B. the library ──────────────────────────────────────────────────────────
  const lib1 = (await req('GET', '/api/library')).json;
  ok(lib1?.count > 20, `B: the starter library seeds on first touch (got ${lib1?.count})`);
  const squat = lib1.entries.find((e) => e.slug === 'back-squat');
  ok(squat?.variants?.length >= 3, 'B: a library entry carries a difficulty LADDER, not just a name');
  ok(squat?.defaults?.progression?.type === 'double', 'B: …and a default progression');
  const lib2 = (await req('GET', '/api/library')).json;
  ok(lib2.count === lib1.count, 'B: seeding is idempotent — a second read adds nothing');
  const filtered = (await req('GET', '/api/library?collection=recipe')).json;
  ok(filtered.count > 0 && filtered.entries.every((e) => e.collection === 'recipe'),
    'B: the same mechanism holds a recipe box — nothing here is training-shaped');

  // ── C. import: resolution, idempotency, dry run ─────────────────────────────
  const DOC = {
    slug: 'lower-body',
    title: 'Lower Body',
    days: ['mon', 'wed', 'fri'],          // named days, not offsets
    time: '07:00',
    spec: {
      advance_on: 'completion',
      steps: [
        // Resolves against the library: unit, rest, ladder and progression all
        // arrive from `back-squat` — but the explicit sets/load win.
        { ref: 'back-squat', sets: 4, load: 100 },
        { ref: 'plank', block: 'cooldown' },
      ],
    },
  };

  const dry = await req('POST', '/api/routines/import?dryRun=1', DOC);
  ok(dry.status === 200 && dry.json?.dryRun === true, `C: dryRun returns a plan (got ${dry.status})`);
  ok(dry.json?.sessions?.length === 4, 'C: dryRun renders the first four sessions');
  ok((await list()).every((r) => r.kind !== 'routine'), 'C: dryRun wrote NOTHING');

  const imp = await req('POST', '/api/routines/import', DOC);
  ok(imp.status === 201 && imp.json?.created === true, `C: import creates (got ${imp.status})`);
  const rid = imp.json.routine.id;
  ok(imp.json.routine.cadence_days === '0,2,4', `C: named days → Monday offsets (got ${imp.json.routine.cadence_days})`);

  const imp2 = await req('POST', '/api/routines/import', { ...DOC, title: 'Lower Body A' });
  ok(imp2.status === 200 && imp2.json?.created === false && imp2.json.routine.id === rid,
    'C: re-importing the same slug UPDATES — a retry after a timeout cannot duplicate');
  ok((await list()).filter((r) => r.kind === 'routine').length === 1, 'C: …and there is still exactly one routine');

  // ── B (cont). ref resolution actually landed ────────────────────────────────
  let rows = await list();
  const wed = on(rows, rid, WED);
  ok(!!wed, 'B: the routine minted its horizon');
  const p0 = rx(wed);
  ok(p0?.steps?.length === 2, 'B: the occurrence carries the rendered steps');
  const sq0 = p0.steps.find((s) => s.key === 'back-squat');
  ok(sq0?.rest === 150 && sq0?.load_unit === 'lb' && sq0?.unit === 'reps',
    'B: unresolved fields came from the library entry (rest/units)');
  ok(sq0?.sets === 4 && sq0?.load === 100,
    `B: …but what the step SAID wins (got ${sq0?.sets} × @${sq0?.load})`);
  ok(sq0?.line === '4 × 5 @ 100 lb', `B: the rendered line is carried on the row (got ${sq0?.line})`);
  const plank0 = p0.steps.find((s) => s.key === 'plank');
  ok(plank0 && p0.steps.indexOf(plank0) === 1, 'B: block order puts the cooldown last');

  // ── D. the snapshot ─────────────────────────────────────────────────────────
  ok(wed.cycle_index === 0, `D: the first occurrence renders at cycle 0 (got ${wed.cycle_index})`);
  ok(on(rows, rid, FRI)?.cycle_index === 1, 'D: the next one at cycle 1');
  ok(on(rows, rid, NEXT_MON)?.cycle_index === 2, 'D: and the ladder keeps climbing across weeks');
  ok(p0.line.includes('session 1'), `D: the session line is human-readable (got ${p0.line})`);
  ok(lineOf(on(rows, rid, FRI), 'back-squat') === '4 × 6 @ 100 lb',
    `D: double progression climbs the rep range (got ${lineOf(on(rows, rid, FRI), 'back-squat')})`);

  // ── E. RULE 3 — completing re-renders the FUTURE, never the past ────────────
  const friBefore = lineOf(on(rows, rid, FRI), 'back-squat');
  const nextMonBefore = lineOf(on(rows, rid, NEXT_MON), 'back-squat');
  await req('PATCH', `/api/items/${wed.id}`, { completed: true });
  rows = await list();
  ok(lineOf(on(rows, rid, WED), 'back-squat') === '4 × 5 @ 100 lb',
    'E: the completed session keeps the numbers it was actually done at — it is a record');
  ok(lineOf(on(rows, rid, FRI), 'back-squat') === friBefore,
    'E: the session after it is unchanged — it already held that rung');
  ok(on(rows, rid, FRI).cycle_index === 1, 'E: …and its cycle is unchanged');
  ok(lineOf(on(rows, rid, NEXT_MON), 'back-squat') === nextMonBefore,
    'E: nothing further out moved either — completing on schedule advances nobody');

  // ── F. a MISSED session does not advance the ladder ─────────────────────────
  //     The whole reason a cycle counts sessions DONE and not weeks elapsed: being
  //     ill for a week must not march the load up past what you can lift.
  //     Reading with a later "today" makes Friday a past, unticked occurrence.
  const AFTER_FRI = shift(FRI, 1);
  const missed = await list({ today: AFTER_FRI });
  ok(on(missed, rid, FRI)?.completed === false, 'F: Friday is now a past, unticked occurrence');
  ok(on(missed, rid, NEXT_MON)?.cycle_index === 1,
    `F: the next session takes the rung the missed one vacated (got ${on(missed, rid, NEXT_MON)?.cycle_index})`);
  ok(lineOf(on(missed, rid, NEXT_MON), 'back-squat') === '4 × 6 @ 100 lb',
    'F: …so it prescribes what the missed session would have — you progress by doing');

  // ── G. today is frozen ──────────────────────────────────────────────────────
  //     A day already in progress, possibly already on screen, is not rewritten.
  const todayRows = await list({ today: NEXT_MON });
  const nm = on(todayRows, rid, NEXT_MON);
  const nmLine = lineOf(nm, 'back-squat');
  await req('PATCH', `/api/items/${rid}`, { scheduled_time: '18:00' }, { today: NEXT_MON });
  const afterEdit = await list({ today: NEXT_MON });
  ok(lineOf(on(afterEdit, rid, NEXT_MON), 'back-squat') === nmLine,
    'G: editing the routine does not rewrite today\'s prescription mid-day');
  ok(on(afterEdit, rid, NEXT_WED)?.scheduled_time === '18:00',
    'G: …but the future it still owns does take the edit');

  // ── H. validation: hard errors vs lint ──────────────────────────────────────
  const broken = await req('POST', '/api/routines/import', {
    slug: 'broken', title: 'Broken', days: ['mon'], spec: { steps: 'not an array' },
  });
  ok(broken.status === 400 && Array.isArray(broken.json?.errors) && broken.json.errors.length > 0,
    `H: a broken spec is rejected with a machine-readable list (got ${broken.status})`);
  ok(broken.json.errors[0].path === 'steps' && broken.json.errors[0].code === 'NOT_AN_ARRAY',
    `H: …with a path and a code the author can act on (got ${JSON.stringify(broken.json.errors[0])})`);

  const thin = await req('POST', '/api/routines/import', {
    slug: 'thin', title: 'Thin', days: ['tue'],
    spec: { steps: [{ title: 'Do the thing', target: 1 }] },
  });
  ok(thin.status === 201, `H: a valid-but-thin routine is ACCEPTED (got ${thin.status})`);
  ok(thin.json.warnings.some((w) => w.code === 'NO_PROGRESSION'),
    'H: …and told, by the only thing that can tell it, that nothing in it ever gets harder');

  const badRef = await req('POST', '/api/routines/import', {
    slug: 'badref', title: 'Bad Ref', days: ['tue'],
    spec: { steps: [{ ref: 'not-a-real-exercise', target: 5 }] },
  });
  ok(badRef.status === 201 && badRef.json.warnings.some((w) => w.code === 'REF_UNRESOLVED'),
    'H: an unresolved library ref warns and keeps working — lossy-safe, never fatal');

  // ── I. performed → autoregulated progression ────────────────────────────────
  const auto = await req('POST', '/api/routines/import', {
    slug: 'auto', title: 'Auto', days: ['mon', 'wed', 'fri'],
    spec: { steps: [{ key: 'press', title: 'Press', sets: 3, load: 100,
      progression: { type: 'autoregulated', range: [5, 6], increment: 10 } }] },
  });
  const aid = auto.json.routine.id;
  rows = await list();
  ok(lineOf(on(rows, aid, WED), 'press') === '3 × 5 @ 100 lb', 'I: autoregulated starts at the bottom of the range');

  // Complete it having explicitly NOT met the target — the rung is not earned.
  await req('PATCH', `/api/items/${on(rows, aid, WED).id}`, {
    completed: true,
    performed: { steps: { press: { done: true, met: false, sets: [{ value: 4, load: 100 }] } } },
  });
  rows = await list();
  ok(lineOf(on(rows, aid, FRI), 'press') === '3 × 5 @ 100 lb',
    `I: a session logged as MISSED holds the prescription (got ${lineOf(on(rows, aid, FRI), 'press')})`);

  // Now meet it — and the next session moves up the range.
  await req('PATCH', `/api/items/${on(rows, aid, FRI).id}`, {
    completed: true,
    performed: { steps: { press: { done: true, met: true, sets: [{ value: 5, load: 100 }] } } },
  });
  rows = await list();
  ok(lineOf(on(rows, aid, NEXT_MON), 'press') === '3 × 6 @ 100 lb',
    `I: meeting the target earns the next rung (got ${lineOf(on(rows, aid, NEXT_MON), 'press')})`);
  ok(on(rows, aid, WED).performed && JSON.parse(on(rows, aid, WED).performed).steps.press.met === false,
    'I: the log is stored on the occurrence, next to what was prescribed');

  // ── J. the preview ──────────────────────────────────────────────────────────
  const before = (await list()).length;
  const prev = (await req(`GET`, `/api/routines/${rid}/preview?cycles=6&from=0`)).json;
  ok(prev?.sessions?.length === 6, `J: the preview renders N sessions ahead (got ${prev?.sessions?.length})`);
  ok(prev.sessions[0].steps[0].line === '4 × 5 @ 100 lb' && prev.sessions[3].steps[0].line === '4 × 8 @ 100 lb',
    'J: …and it agrees with what the engine actually minted');
  ok((await list()).length === before, 'J: previewing writes nothing');

  const doc = (await req('GET', `/api/routines/${rid}`)).json;
  ok(doc?.document?.slug === 'lower-body' && doc.document.days.join(',') === 'mon,wed,fri',
    'J: a routine round-trips back out as the document import accepts');
  ok(doc.document.spec.steps[0].rest === 150,
    'J: …with library refs RESOLVED, which is what an editing agent needs to see');

  // ── K. a routine with no document is unchanged ──────────────────────────────
  const bare = await req('POST', '/api/items', {
    title: 'Bare', kind: 'routine', status: 'active', cadence_days: '4',   // Friday — still ahead of TODAY
  });
  rows = await list();
  const bareOccs = occsOf(rows, bare.json.id);
  ok(bareOccs.length === 2, `K: a bare cadence routine still mints its horizon (got ${bareOccs.length})`);
  ok(bareOccs.every((o) => o.prescription === null && o.title === 'Bare'),
    'K: …and writes no prescription — the whole primitive is additive');

  // ── L. cadence beyond the weekly grid ───────────────────────────────────────
  const everyN = await req('POST', '/api/routines/import', {
    slug: 'every-3', title: 'Every Three Days', cadence: 'every_n_days:3',
    spec: { steps: [{ title: 'Walk', unit: 'min', target: 20 }] },
  });
  ok(everyN.status === 201, `L: an every_n_days routine imports (got ${everyN.status})`);
  const enId = everyN.json.routine.id;
  ok(everyN.json.routine.cadence_rule === 'every_n_days:3', 'L: the rule round-trips onto the row');
  rows = await list();
  const enDates = occsOf(rows, enId).map((o) => o.due_date).filter(Boolean);
  const gaps = enDates.slice(1).map((d, i) => Math.round((Date.parse(d) - Date.parse(enDates[i])) / 86400000));
  ok(enDates.length >= 3 && gaps.every((g) => g === 3),
    `L: it mints on a 3-day interval, not on weekdays (${enDates.join(' ')})`);

  const monthly = await req('POST', '/api/routines/import', {
    slug: 'monthly', title: 'Monthly Review', cadence: 'monthly:last',
    spec: { steps: [{ title: 'Review', unit: 'min', target: 30 }] },
  });
  ok(monthly.status === 201 && monthly.json.routine.cadence_rule === 'monthly:last',
    'L: monthly:last is accepted');

  const rolling = await req('POST', '/api/routines/import', {
    slug: 'rolling', title: 'Three A Week', cadence: 'rolling:3',
    spec: { steps: [{ title: 'Move', unit: 'min', target: 20 }] },
  });
  rows = await list();
  const rollOccs = occsOf(rows, rolling.json.routine.id);
  ok(rollOccs.length > 0 && rollOccs.every((o) => !o.due_date && o.week_start),
    `L: rolling mints only FLOATS — the mode says how often, never which day (got ${rollOccs.length})`);

  const rrule = await req('POST', '/api/routines/import', {
    slug: 'rr', title: 'Fortnightly', cadence: 'rrule:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    spec: { steps: [{ title: 'Thing', target: 1 }] },
  });
  ok(rrule.status === 201, `L: a supported RRULE is accepted (got ${rrule.status})`);
  for (const bad of ['rrule:FREQ=YEARLY', 'rrule:FREQ=WEEKLY;BYSETPOS=1', 'rrule:FREQ=WEEKLY;BYDAY=2MO']) {
    const r = await req('PATCH', `/api/items/${rrule.json.routine.id}`, { cadence_rule: bad });
    ok(r.status === 400, `L: '${bad}' is REJECTED at the door, not half-honoured (got ${r.status})`);
  }

  // ── M. deload on demand ─────────────────────────────────────────────────────
  const dl = await req('POST', '/api/routines/import', {
    slug: 'dl', title: 'Deloadable', days: ['mon', 'wed', 'fri'],
    spec: { steps: [{ key: 'sq', title: 'Squat', sets: 4, load: 100,
      progression: { type: 'linear', drives: 'load', increment: 10 } }] },
  });
  const dlId = dl.json.routine.id;
  rows = await list();
  const dlWed = on(rows, dlId, WED);
  const dlFri = on(rows, dlId, FRI);
  const dlNextMon = on(rows, dlId, NEXT_MON);
  ok(lineOf(dlWed, 'sq') === '4 × 100 lb'.replace('4 × ', '4 sets @ ').replace('4 sets @ 100 lb', '4 sets @ 100 lb')
    || lineOf(dlWed, 'sq') === '4 sets @ 100 lb', `M: cycle 0 is the declared load (got ${lineOf(dlWed, 'sq')})`);
  ok(dlFri.cycle_index === 1 && dlNextMon.cycle_index === 2, 'M: the ladder starts out 0,1,2');

  const easy = await req('POST', `/api/items/${dlFri.id}/deload`, { deload: true });
  ok(easy.status === 200, `M: taking a session easy is accepted (got ${easy.status})`);
  rows = await list();
  const easyFri = on(rows, dlId, FRI);
  ok(rx(easyFri)?.deload === true && rx(easyFri)?.deload_forced === true,
    'M: it renders light, and is marked as FORCED so the card can say who asked');
  ok(lineOf(easyFri, 'sq') !== lineOf(dlFri, 'sq'), 'M: …which actually changes the numbers');
  ok(on(rows, dlId, NEXT_MON).cycle_index === 1,
    `M: a deloaded session spends NO RUNG — the one after it repeats rather than advancing (got ${on(rows, dlId, NEXT_MON).cycle_index})`);

  const undo = await req('POST', `/api/items/${easyFri.id}/deload`, { clear: true });
  ok(undo.status === 200, 'M: the override clears');
  rows = await list();
  ok(on(rows, dlId, NEXT_MON).cycle_index === 2, 'M: …and the ladder springs back');

  // The past is a record, not something to retroactively make easy.
  const pastRead = await list({ today: shift(FRI, 3) });
  const pastFri = on(pastRead, dlId, FRI);
  const refused = await req('POST', `/api/items/${pastFri.id}/deload`, { deload: true }, { today: shift(FRI, 3) });
  ok(refused.status === 400, `M: the PAST is refused — a record is not editable (got ${refused.status})`);

  // ── N. revisions ────────────────────────────────────────────────────────────
  const rev0 = (await req('GET', `/api/routines/${dlId}/revisions`)).json;
  ok(rev0.current === 1 && rev0.revisions.length === 1,
    `N: a fresh routine is at revision 1 with no history (got ${rev0.current}/${rev0.revisions.length})`);
  await req('PATCH', `/api/items/${dlId}`, {
    spec: { steps: [{ key: 'sq', title: 'Squat', sets: 5, load: 120, progression: { type: 'linear', drives: 'load', increment: 5, cap: 300 } }] },
    revision_note: 'switched to fives',
  });
  const rev1 = (await req('GET', `/api/routines/${dlId}/revisions`)).json;
  ok(rev1.current === 2 && rev1.revisions.length === 2, `N: a spec edit bumps the version and archives the old one (got ${rev1.current})`);
  ok(rev1.revisions[1].note === 'switched to fives', 'N: …with the note that was given for it');
  await req('PATCH', `/api/items/${dlId}`, { title: 'Deloadable II' });
  const rev2 = (await req('GET', `/api/routines/${dlId}/revisions`)).json;
  ok(rev2.current === 2, 'N: a RENAME is not a revision — only the document is');
  rows = await list();
  ok(rx(on(rows, dlId, NEXT_MON))?.sv === 2,
    `N: every session stamps the revision it followed (got ${rx(on(rows, dlId, NEXT_MON))?.sv})`);

  // ── O. the goal metric and the series ───────────────────────────────────────
  const goal = await req('POST', '/api/items', { title: 'Run 100km', kind: 'goal', scope: 'year' });
  const runner = await req('POST', '/api/routines/import', {
    slug: 'run', title: 'Runs', days: ['mon', 'wed', 'fri'], parent_id: goal.json.id,
    spec: {
      contributes: { measure: 'target', step: 'go', target: 100, window: 'month' },
      steps: [{ key: 'go', title: 'Run', unit: 'km', sets: 1, target: 5,
        progression: { type: 'linear', drives: 'target', increment: 1, cap: 15 } }],
    },
  });
  const runId = runner.json.routine.id;
  ok(runner.status === 201 && !runner.json.warnings.some((w) => w.code === 'STEP_MISSING'),
    'O: a contribution pointing at a real step is clean');
  rows = await list();
  await req('PATCH', `/api/items/${on(rows, runId, WED).id}`, { completed: true });
  const m0 = (await req('GET', `/api/routines/${runId}/metric`)).json;
  ok(m0.metric.value === 5 && m0.metric.target === 100 && m0.metric.unit === 'km',
    `O: one 5 km run counts 5 toward 100 (got ${m0.metric?.value})`);
  ok(m0.goal_id === goal.json.id, 'O: …and it names the goal it feeds');

  rows = await list();
  await req('PATCH', `/api/items/${on(rows, runId, FRI).id}`, {
    completed: true,
    performed: { steps: { go: { done: true, sets: [{ value: 3 }] } } },
  });
  const m1 = (await req('GET', `/api/routines/${runId}/metric`)).json;
  ok(m1.metric.value === 8, `O: a logged set OVERRIDES the prescription — it counts what you DID (got ${m1.metric.value})`);

  const series = (await req('GET', `/api/routines/${runId}/series?measure=target`)).json;
  const go = series.steps.find((s) => s.key === 'go');
  ok(go && go.points.length >= 3, 'O: the series covers every rendered session');
  ok(go.points[0].prescribed === 5 && go.points[0].performed === 5,
    'O: a session completed with no detail performed what it was prescribed');
  ok(go.points.some((p) => p.performed === 3 && p.prescribed !== 3),
    'O: …and a logged shortfall shows as a GAP between the two lines');

  // ── P. library export round-trips ───────────────────────────────────────────
  await req('POST', '/api/library', {
    collection: 'exercise', slug: 'zercher-squat', title: 'Zercher Squat',
    unit: 'reps', load_unit: 'lb', variants: ['Goblet', 'Zercher'],
    defaults: { sets: 3, target: 5, load: 95, progression: { type: 'double', range: [5, 8], increment: 10 } },
  });
  const exported = (await req('GET', '/api/library/export?mine=1')).json;
  ok(exported.kind === 'jkos.beigeboard.library' && Array.isArray(exported.entries),
    'P: the library exports as a document');
  ok(exported.entries.every((e) => e.slug && !('id' in e) && !('user_id' in e)),
    'P: …carrying only the authored fields — ids and ownership are this installation\'s business');
  const mine = exported.entries.find((e) => e.slug === 'zercher-squat');
  ok(mine && mine.variants.length === 2 && mine.defaults.progression.type === 'double',
    'P: …including the ladder and the default progression');
  const back = await req('POST', '/api/library/import', { entries: exported.entries });
  ok(back.status === 200 && back.json.created === 0 && back.json.updated === exported.count,
    `P: re-importing its own export UPDATES and never duplicates (created ${back.json.created})`);

  // ── Q. WAVE 3 — the BUNDLE: a library and the routines that use it, one paste ─
  //     The case a written-by-AI programme actually produces: a routine that needs
  //     a movement the library does not have yet. What is being tested is the
  //     ORDERING and the ATOMICITY, because those are what a client would get
  //     wrong doing it as two calls.
  const BUNDLE = {
    kind: 'jkos.beigeboard.bundle',
    library: [{
      collection: 'exercise', slug: 'nordic-curl', title: 'Nordic Curl',
      unit: 'reps', load_unit: 'bw',
      variants: ['Band-Assisted Nordic', 'Eccentric-Only Nordic', 'Nordic Curl'],
      defaults: { sets: 3, target: 5, rest: 120, variant_index: 1 },
    }],
    routines: [{
      slug: 'posterior-chain', title: 'Posterior Chain', days: ['tue'],
      spec: {
        intent: 'hamstrings that survive a sprint',
        steps: [
          // References an entry that does not exist yet — it is taught by this
          // same bundle, two keys up.
          { ref: 'nordic-curl', progression: { type: 'linear', drives: 'target', increment: 1, cap: 8 } },
        ],
      },
    }],
  };

  const bDry = await req('POST', '/api/routines/bundle?dryRun=1', BUNDLE);
  ok(bDry.status === 200 && bDry.json?.dryRun === true, `Q: the bundle dry-runs (got ${bDry.status})`);
  ok(bDry.json?.library?.created === 1 && bDry.json.library.entries[0].action === 'create',
    'Q: …reporting what the library half would do');
  ok(bDry.json?.routines?.[0]?.action === 'create' && bDry.json.routines[0].sessions?.length === 4,
    'Q: …and rendering the routine as NUMBERS before anything is written');
  ok(!bDry.json.warnings.some((w) => w.code === 'REF_UNRESOLVED'),
    'Q: a step may `ref` an entry the SAME bundle teaches — the resolver sees the pending entries');
  ok(!(await req('GET', '/api/library?q=nordic')).json.entries.some((e) => e.slug === 'nordic-curl'),
    'Q: …and the dry run wrote nothing');

  const bReal = await req('POST', '/api/routines/bundle', BUNDLE);
  ok(bReal.status === 201 && bReal.json?.library?.created === 1 && bReal.json.routines[0].created === true,
    `Q: the real import writes both halves (got ${bReal.status})`);
  const nordic = (await req('GET', '/api/library?q=nordic')).json.entries.find((e) => e.slug === 'nordic-curl');
  ok(nordic?.variants?.length === 3, 'Q: the entry landed with its ladder intact');
  const pcId = bReal.json.routines[0].id;
  const pcRows = await list();
  ok(occsOf(pcRows, pcId).length > 0, 'Q: …and the routine minted occurrences immediately');
  const pcStep = rx(occsOf(pcRows, pcId)[0])?.steps?.find((s) => s.key === 'nordic-curl');
  ok(pcStep?.variant === 'Eccentric-Only Nordic' && pcStep.line === '3 × 5 @ bodyweight',
    `Q: …prescribed from the entry the same bundle taught — rung, sets and reps all inherited (got ${JSON.stringify(pcStep?.line)} on ${JSON.stringify(pcStep?.variant)})`);

  const bAgain = await req('POST', '/api/routines/bundle', BUNDLE);
  ok(bAgain.json?.library?.created === 0 && bAgain.json.library.updated === 1
     && bAgain.json.routines[0].created === false && bAgain.json.routines[0].id === pcId,
    'Q: resending is idempotent on BOTH halves — an agent that times out and retries duplicates nothing');

  // A goal by NAME. An author cannot know an integer id, so it names the goal.
  const marathon = (await req('POST', '/api/items', { kind: 'goal', scope: 'year', title: 'Run A Marathon' })).json;
  const named = await req('POST', '/api/routines/bundle', {
    routines: [{ slug: 'long-run', title: 'Long Run', days: ['sun'], goal: 'run a marathon',
      spec: { steps: [{ ref: 'easy-run', target: 12 }] } }],
  });
  ok(named.json?.routines?.[0]?.routine?.parent_id === marathon.id,
    'Q: a routine files itself under a goal BY TITLE, case-insensitively');
  const orphan = await req('POST', '/api/routines/bundle', {
    routines: [{ slug: 'orphan-run', title: 'Orphan Run', days: ['sat'], goal: 'a goal that is not there',
      spec: { steps: [{ ref: 'easy-run' }] } }],
  });
  ok(orphan.json?.ok && orphan.json.warnings.some((w) => w.code === 'GOAL_UNRESOLVED'),
    'Q: …and an unresolved goal name is a WARNING — a mistyped name must not lose the routine');

  // ATOMICITY. One bad document in a paste of several fails the whole call, and
  // the good one beside it is NOT written — a half-applied paste is the outcome
  // the author who caused it is least equipped to unpick.
  const half = await req('POST', '/api/routines/bundle', {
    routines: [
      { slug: 'good-one', title: 'Good One', days: ['mon'], spec: { steps: [{ ref: 'plank' }] } },
      { slug: 'bad-one', title: 'Bad One', days: ['tue'], spec: { steps: 'not an array' } },
    ],
  });
  ok(half.status === 400 && half.json?.errors?.[0]?.path === 'routines[1].steps',
    `Q: one invalid routine fails the bundle, with the path SAYING WHICH ONE (got ${JSON.stringify(half.json?.errors?.[0])})`);
  ok(!(await list()).some((r) => r.ext_ref === 'routinedoc:good-one'),
    'Q: …and its valid neighbour was not written — the bundle validates before it writes');

  // A single routine document, sent straight to the bundle door — the shape
  // `GET /api/routines/:id` hands back, and therefore the shape a user is most
  // likely to have on the clipboard.
  const single = await req('POST', '/api/routines/bundle', {
    slug: 'evening-walk', title: 'Evening Walk', days: ['wed'],
    spec: { steps: [{ ref: 'easy-run', target: 2 }] },
  });
  ok(single.json?.ok && single.json.routines.length === 1 && single.json.routines[0].slug === 'evening-walk',
    'Q: a bare routine document is a valid bundle — the same thing said a shorter way');

  // The library export file, sent straight to the bundle door.
  const asBundle = await req('POST', '/api/routines/bundle', { entries: [
    { collection: 'recipe', slug: 'ful-medames', title: 'Ful Medames', unit: 'count' },
  ] });
  ok(asBundle.json?.ok && asBundle.json.library.created === 1 && asBundle.json.routines.length === 0,
    'Q: a library-only document is a valid bundle — one door, every shape');
  ok((await req('POST', '/api/routines/bundle', {})).status === 400,
    'Q: …but an empty one is refused rather than silently succeeding');

  // ── R. WAVE 3 — the authoring PROMPT ────────────────────────────────────────
  //     The vocabulary written as instructions. Its whole value is that it cannot
  //     promise something the validator refuses, so what is tested is coverage:
  //     every closed list, and the caller's own library.
  const prompt = (await req('GET', '/api/routines/prompt')).json;
  ok(typeof prompt?.text === 'string' && prompt.text.length > 3000, 'R: the prompt endpoint serves the text');
  ok(vocab.progressions.types.every((t) => prompt.text.includes(`\`${t}\``)),
    'R: …naming every progression type the validator accepts');
  ok(vocab.cadence.types.every((t) => prompt.text.includes(t)),
    'R: …every cadence mode');
  ok(prompt.text.includes('jkos.beigeboard.bundle') && prompt.text.includes('/api/routines/bundle'),
    'R: …and the exact output shape and endpoint it is asking for');
  ok(prompt.text.includes('`nordic-curl`') && prompt.text.includes('`back-squat`'),
    'R: the index is the CALLER\'S library — an agent that can see a slug writes a ref instead of six fields');
  ok(prompt.target === '/api/routines/bundle', 'R: …and names its own import target, so a client hardcodes nothing');
  const md = await fetch(`${BASE}/api/routines/prompt?format=md`, { headers: { Authorization: `Bearer ${A}` } });
  ok(md.headers.get('content-type')?.includes('text/markdown') && (await md.text()).startsWith('# BeigeBoard'),
    'R: ?format=md serves it as a file you can pipe somewhere');

  /* THE LOOP, CLOSED. check:routine proves the prompt's worked example VALIDATES;
     this proves it IMPORTS — refs resolving against the starter library, the entry
     it teaches itself, the multi-rule step, the percent rule against `vars`, and the
     goal named by title. The document we tell every agent to imitate is the one
     document that must not merely be legal. */
  const { EXAMPLE } = createRequire(import.meta.url)(join(BACKEND, 'src/routine-prompt.js'));
  await req('POST', '/api/items', { kind: 'goal', scope: 'year', title: 'Get stronger' });
  const worked = await req('POST', '/api/routines/bundle', EXAMPLE);
  ok(worked.json?.ok === true && worked.json?.routines?.[0]?.slug === 'lower-body',
    `R: the prompt's worked example IMPORTS (got ${worked.status} ${JSON.stringify(worked.json?.error || '')})`);
  ok(!worked.json.warnings.some((w) => w.code === 'REF_UNRESOLVED' || w.code === 'GOAL_UNRESOLVED'),
    `R: …with every ref and its goal resolving (${JSON.stringify(worked.json.warnings.map((w) => w.code))})`);
  /* The LAST occurrence, not the first: section C already owns the `lower-body`
     slug, so this is an update — and the sessions already on the board keep the
     document they were minted against (RULE 3). The future is what re-rendered. */
  const workedOccs = occsOf(await list(), worked.json.routines[0].id);
  const lb = rx(workedOccs[workedOccs.length - 1]);
  ok(lb?.steps?.length === 5 && lb.steps.every((s) => s.line && s.line !== '—'),
    `R: …and every step of a rendered session carries real numbers (${JSON.stringify(lb?.steps?.map((s) => s.line))})`);

  done();
} catch (e) {
  console.error('harness error:', e);
  done();
}

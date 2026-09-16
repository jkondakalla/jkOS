// "Today" conformance — keeps the suite on ONE definition of the current day,
// and on ONE notion of where the user is.
//
// Until 2026-08-27 there were four, none of them shared and none of them aware of
// where anybody was (XC-4 / D5):
//
//   · BeigeBoard's `X-BB-Today` header — a client-computed DAY, read by two
//     hand-copied `callerToday()` helpers in two route files
//   · routines.js's UTC `iso()`, and items-store.js's `toISOString().slice(0,10)`,
//     which put the first-run seed's "today" task on tomorrow for every user west
//     of Greenwich (BB-10)
//   · @jkos/cards' local-tz `isoDate()` — the right answer, frontend only
//
// So ORDECK and BeigeBoard could render different days from the same rows (BB-2),
// and calendar events were normalised in whatever zone the CONTAINER ran in
// (BB-15) — a fact about the deployment written into the user's data.
//
// There is now one header (X-JKOS-TZ, carrying the caller's IANA ZONE), one sender
// (authFetch, so no app opts in), one reader (callerDay/callerZone/zonedParts), and
// a locked dev-only override for the one caller that legitimately needs to move the
// clock. Nothing in the build forces any of that to stay true, so this asserts:
//
//   1. the reader exists and exports the three entry points
//   2. the header LITERAL is identical in the reader, the sender, and the CORS
//      allow-list — three files that cannot import each other (@jkos/weave depends
//      on @jkos/auth-client, so the reverse would be a cycle)
//   3. authFetch actually stamps it, on every call rather than per-call
//   4. no backend reinvents "ask the clock, take the day" — the shape all four of
//      the old notions had in common
//   5. no backend reads a wall-clock field off a bare Date (getHours/getFullYear/…),
//      which is exactly how BB-15 wrote the container's zone into items rows
//   6. the time-travel override carries BOTH locks and is enabled nowhere real
//
// Run:  node test/today.mjs        (wired as `pnpm check:today`, folded into
//                                   `pnpm test:contracts`)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const READER = 'packages/weave/src/server/callerDay.js';
const SENDER = 'packages/auth-client/src/client.ts';
const CORS   = 'packages/weave/src/server/cors.js';

const reader = read(READER);

/* Comment-strip before scanning for a forbidden shape. Every one of these files
   EXPLAINS the shape it must not contain — this gate would otherwise be failed by
   the prose describing the bug it guards. Line comments and block comments only;
   no attempt at strings, which none of the patterns below can appear inside. */
const decomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── 1. The reader exists and offers the three entry points ──────────────────
{
  const NEEDED = ['callerDay', 'callerZone', 'zonedParts'];
  const missing = NEEDED.filter((n) => !new RegExp(`function ${n}\\b`).test(reader));
  if (missing.length) fail(`${READER} no longer defines: ${missing.join(', ')}`);
  else ok(`the one reader defines callerDay / callerZone / zonedParts`);

  const barrel = read('packages/weave/src/server/index.js');
  const unexported = NEEDED.filter((n) => !new RegExp(`\\b${n}\\b`).test(barrel));
  if (unexported.length) fail(`@jkos/weave/server's barrel does not re-export: ${unexported.join(', ')}`);
  else ok('all three reach backends through the @jkos/weave/server barrel');
}

// ── 2. One header literal, in the three places that cannot import each other ─
{
  const m = reader.match(/const CALLER_ZONE_HEADER = '([^']+)'/);
  if (!m) {
    fail(`${READER} no longer declares CALLER_ZONE_HEADER`);
  } else {
    const HEADER = m[1];
    ok(`the header is declared once, as '${HEADER}'`);

    const sender = read(SENDER);
    const sm = sender.match(/export const CALLER_ZONE_HEADER = '([^']+)'/);
    if (!sm) fail(`${SENDER} no longer declares CALLER_ZONE_HEADER (the sending half)`);
    else if (sm[1] !== HEADER) fail(`the sender says '${sm[1]}' but the reader says '${HEADER}' — every request would carry a header nobody reads`);
    else ok(`the sender agrees on '${HEADER}'`);

    /* The preflight list. A cross-origin call (an app frontend hitting jkAuth) fails
       at the OPTIONS if this drifts, and it fails for EVERY request rather than for
       the date maths — a large, confusing blast radius for a one-word edit. */
    const allow = read(CORS).match(/Access-Control-Allow-Headers',\s*'([^']+)'/);
    if (!allow) fail(`${CORS} no longer sets Access-Control-Allow-Headers`);
    else if (!allow[1].split(',').map((h) => h.trim()).includes(HEADER))
      fail(`CORS does not allow '${HEADER}' (allows: ${allow[1]}) — every cross-origin suite call would fail its preflight`);
    else ok(`CORS preflight allows '${HEADER}'`);
  }
}

// ── 3. authFetch stamps it — once, for everyone ─────────────────────────────
{
  const sender = decomment(read(SENDER));
  if (!/function withZoneHeader\s*\(/.test(sender)) {
    fail(`${SENDER} no longer has withZoneHeader — the one place the header is attached`);
  } else if (!/authFetch[\s\S]{0,400}?withZoneHeader\(init\)/.test(sender)) {
    fail('authFetch no longer routes its init through withZoneHeader — apps would have to opt in one call site at a time, which is how the suite got four notions of "today" in the first place');
  } else {
    ok('authFetch stamps the zone on every suite request (no per-app opt-in)');
  }
  /* A Headers merge, not a spread: init.headers arrives as a plain object, a
     Headers, or an entries array, and a spread silently drops two of the three. */
  if (!/new Headers\(/.test(sender)) fail('withZoneHeader no longer merges through Headers — a caller passing a Headers object would lose Content-Type');
  else ok('the merge goes through Headers, so a caller’s own headers survive');
}

/* ── The backend scan ──────────────────────────────────────────────────────
   Server source only. The FRONTEND is allowed to ask the clock — that is where the
   browser's zone actually lives, and @jkos/cards' isoDate() is the correct local-tz
   answer for rendering. The defect being guarded is a SERVER deciding what day it is
   without being told where the user is. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'test']);

/* ⚠️ A MISSING ROOT IS A FAILURE, NOT AN EMPTY LIST. This swallowed its ENOENT and
   returned [] — and `apps/lazuros/backend/src` has never existed (LazurOS puts its
   server at `backend/`, not `backend/src/`). So a whole backend was scanned as zero
   files and the gate reported "no backend reinvents clock-to-day" about code it had
   never opened, with a file count that looked plausible because five other roots
   filled it in.
   This is the BUG-5 class that `95-env-conformance` was fixed for — a clean report
   about the apps a probe happens to know reads exactly like a clean report about the
   suite. The same fix belongs in every scanner that carries a hand-written root list;
   `99-wire-time`'s SCAN_ROOTS got it at the same time. */
function sources(pathRel) {
  const abs = resolve(root, pathRel);
  let ents;
  try { ents = readdirSync(abs, { withFileTypes: true }); }
  catch (e) {
    if (e.code === 'ENOTDIR') return /\.(js|mjs|cjs)$/.test(pathRel) ? [pathRel] : [];
    fail(`scan root '${pathRel}' does not exist — this gate was reporting on code it never read`);
    return [];
  }
  const out = [];
  for (const ent of ents) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(pathRel, ent.name);
    if (ent.isDirectory()) out.push(...sources(p));
    else if (/\.(js|mjs|cjs)$/.test(ent.name)) out.push(p);
  }
  return out;
}

/* SERVER source only — the frontend is allowed to ask the clock (see above).
   ⚠️ The root is each app's WHOLE backend, not its `src/`: `server.js`, `discovery.js`
   and `docs.js` sit beside `src/`, and those are where the activity reads, the
   collection mounts and the route registrations live. Naming `backend/src` left seven
   files unscanned across four apps on top of the LazurOS hole above. */
const BACKENDS = [
  'apps/beigeboard/backend',
  'apps/papyros/backend',
  'apps/kouros/backend',
  'apps/lazuros/backend',
  'apps/jkauth/src',
  'apps/jkauth/server.js',
  'packages/weave/src/server',
];
const backendFiles = BACKENDS.flatMap(sources);

// ── 4. Nothing else asks the clock and takes the day off it ─────────────────
{
  /* The shape all four old notions shared: a bare `new Date()` (or Date.now())
     turned straight into a YYYY-MM-DD. Calendar arithmetic on a date STRING is not
     this and is not flagged — util.js's shiftDay and the routine engine's UTC
     helpers operate on a `today` they were handed, which is the correct pattern. */
  const CLOCK_TO_DAY = [
    /new Date\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/,
    /new Date\(\s*Date\.now\(\)\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/,
    /\b(?:iso|isoOf|isoDate|isoDateStr|today)\s*\(\s*new Date\(\s*\)\s*\)/,
  ];
  const offenders = [];
  for (const rel of backendFiles) {
    if (rel === READER) continue;   // where the fallback legitimately lives
    const src = decomment(read(rel));
    for (const re of CLOCK_TO_DAY) {
      const m = src.match(re);
      if (m) offenders.push(`${rel} — ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  if (offenders.length) {
    fail(`${offenders.length} backend site(s) compute a day straight from the clock:`);
    for (const o of offenders) console.error(`      ${o}`);
    console.error('    Use callerDay(req) from @jkos/weave/server. A server that decides what');
    console.error('    day it is without being told where the caller is has picked a zone by');
    console.error('    accident — which is BB-2, BB-10 and BB-15.');
  } else {
    ok(`no backend reinvents clock-to-day (${backendFiles.length} server files scanned)`);
  }
}

// ── 5. No wall-clock field is read off a bare Date in backend source ────────
{
  /* `d.getHours()` is the container's zone, full stop. This is the exact shape
     isoDateStr/fmt24 had, and the reason a calendar event's time depended on which
     machine ran the sync. The UTC twins (getUTCHours etc.) are explicit about their
     frame and are fine. */
  const LOCAL_READ = /\.get(FullYear|Month|Date|Day|Hours|Minutes|Seconds)\(\s*\)/;
  const offenders = [];
  for (const rel of backendFiles) {
    const src = decomment(read(rel));
    for (const line of src.split('\n')) {
      const m = line.match(LOCAL_READ);
      if (m) offenders.push(`${rel} — .get${m[1]}()`);
    }
  }
  if (offenders.length) {
    fail(`${offenders.length} backend site(s) read a wall-clock field in the HOST's zone:`);
    for (const o of offenders.slice(0, 20)) console.error(`      ${o}`);
    console.error('    Use zonedParts(date, zone) — or the UTC twin if UTC is genuinely meant.');
    console.error('    This is BB-15: the deployment’s timezone written into the user’s data.');
  } else {
    ok('no backend reads a wall-clock field in the host’s zone (BB-15 stays closed)');
  }
}

// ── 6. Time travel keeps both locks, and is enabled nowhere real ────────────
{
  // The declaration wraps across lines — match to the end of the statement, not
  // to the first newline, or the second lock reads as missing.
  const guard = reader.match(/const TIME_TRAVEL_ENABLED\s*=([\s\S]*?)(?=\nif |\nconst |\nfunction )/);
  if (!guard) {
    fail(`${READER} no longer declares TIME_TRAVEL_ENABLED`);
  } else {
    const g = guard[1];
    const hasEnvLock = /JKOS_TIME_TRAVEL/.test(g);
    const hasProdLock = /NODE_ENV\s*!==\s*'production'/.test(g);
    if (!hasProdLock) fail('the time-travel override is no longer gated on NODE_ENV — a header could move the clock in production, and the routine engine WRITES relative to "today"');
    else if (!hasEnvLock) fail('the time-travel override is no longer opt-in via JKOS_TIME_TRAVEL — one lock is not two');
    else ok('the time-travel override keeps both locks (non-production AND opt-in)');
  }

  /* Evaluated at module load on purpose, so nothing at request time can flip it.
     A `process.env` read inside callerDay would defeat that. */
  const body = reader.slice(reader.indexOf('function callerDay'));
  if (/process\.env/.test(body)) fail('callerDay reads process.env at request time — the locks must be resolved once, at module load');
  else ok('the locks are resolved at module load, not per request');

  const composeFiles = ['docker-compose.yml', 'docker-compose.staging.yml'];
  const leaked = composeFiles.filter((f) => {
    try { return /JKOS_TIME_TRAVEL/.test(read(f)); } catch { return false; }
  });
  if (leaked.length) fail(`JKOS_TIME_TRAVEL appears in: ${leaked.join(', ')} — it belongs only in the test harness`);
  else ok('JKOS_TIME_TRAVEL appears in no compose file');
}

if (failed) {
  console.error(`\n✗ today conformance: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ today conformance: one header, one sender, one reader, no reinvented clocks');

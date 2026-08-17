// check:routine — the ROUTINE DOCUMENT conformance gate.
//
// BeigeBoard's routine spec exists twice: the authoritative CommonJS engine at
// apps/beigeboard/backend/src/routine-spec.js, which renders the prescription that
// is WRITTEN ONTO EVERY OCCURRENCE, and the TypeScript mirror at
// apps/beigeboard/src/lib/routine-spec.ts, which renders the live preview in the
// forge for a spec the user is editing and has not saved.
//
// The duplication is deliberate and is argued for at the top of the .ts file. THIS
// is the price of it. A mirror that has quietly drifted is worse than no mirror:
// the preview would promise one session and the engine would mint another, and the
// only symptom would be a user who thinks they are meant to squat 135 and finds 145
// on the board tomorrow. So this does not diff the SOURCE — text is not the
// contract — it drives BOTH implementations through the same matrix of documents ×
// cycles and compares what they actually produce.
//
// It is also a real unit test of the engine in its own right: the EXPECTATIONS
// block below pins the progression rules themselves, so a change that breaks
// double progression fails here even if both sides break identically.
//
// Run:  node test/routine-spec.mjs      (wired as `pnpm check:routine`)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-routine-spec-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

/* Transpile the TS mirror and import the REAL functions — the same trick
   test/cards-logic.mjs uses, and for the same reason: the repo has no TS test
   runner on Node 20, and testing a hand-copied JS translation of the mirror would
   test the copy rather than the file that ships. */
function importTs(relPath, outName) {
  const src = readFileSync(resolvePath(root, relPath), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
    fileName: relPath,
  });
  const outFile = join(tmp, outName);
  writeFileSync(outFile, outputText);
  return import(pathToFileURL(outFile).href);
}

const be = require(resolvePath(root, 'apps/beigeboard/backend/src/routine-spec.js'));
const fe = await importTs('apps/beigeboard/src/lib/routine-spec.ts', 'routine-spec.mjs');

/* ── 1. The vocabularies must be the same lists ───────────────────────────────
   Checked first and separately: a dropdown offering a value the validator rejects
   is a bug the render matrix would never catch, because the user can only pick it
   in the UI. */
for (const name of ['UNITS', 'LOAD_UNITS', 'PROGRESSIONS', 'DRIVES', 'ADVANCE_ON', 'PHASE_REPEAT', 'BLOCKS', 'COLLECTIONS',
  'CADENCES', 'MEASURES', 'WINDOWS']) {
  check(
    JSON.stringify(be[name]) === JSON.stringify(fe[name]),
    `${name} is the same closed list on both sides`,
  );
}
check(be.SPEC_VERSION === fe.SPEC_VERSION, 'SPEC_VERSION agrees');
check(
  JSON.stringify(be.LIMITS) === JSON.stringify(fe.LIMITS),
  'LIMITS agree — the editor cannot let a user build a document the door rejects',
);

/* ── 2. The corpus ────────────────────────────────────────────────────────────
   Every progression type, both phase-repeat modes, the deload, the variant ladder,
   `percent` against a var, the messy-author cases (bare strings, aliases, missing
   fields), and the degenerate ones (empty, null, garbage). */
const CORPUS = {
  empty: {},
  nullish: null,
  garbage: 'not a document at all',
  bare_strings: { steps: ['Push-Ups', 'Sit-Ups'] },

  fixed: { steps: [{ title: 'Meditate', unit: 'min', target: 10 }] },

  linear_load: {
    steps: [{ key: 'row', title: 'Row', sets: 3, target: 8, load: 65, load_unit: 'lb', progression: { type: 'linear', increment: 5 } }],
  },
  linear_capped: {
    steps: [{ key: 'run', title: 'Run', unit: 'km', target: 3, progression: { type: 'linear', drives: 'target', increment: 0.5, cap: 6 } }],
  },
  linear_every_3: {
    steps: [{ key: 'read', title: 'Read', unit: 'pages', target: 10, progression: { type: 'linear', drives: 'target', increment: 2, every: 3 } }],
  },
  linear_sets: {
    steps: [{ key: 'set', title: 'Sets', sets: 2, target: 10, progression: { type: 'linear', drives: 'sets', cap: 5 } }],
  },

  double: {
    steps: [{ key: 'sq', title: 'Squat', sets: 3, target: 5, load: 135, progression: { type: 'double', range: [5, 8], increment: 10 } }],
  },
  double_capped: {
    steps: [{ key: 'sq', title: 'Squat', sets: 3, load: 135, progression: { type: 'double', range: [5, 6], increment: 10, cap: 155 } }],
  },
  double_no_range: {   // the author forgot the range — normalised to [5,8], not fatal
    steps: [{ key: 'sq', title: 'Squat', sets: 3, load: 100, progression: { type: 'double', increment: 5 } }],
  },

  ladder_hold: {
    steps: [{ key: 'l', title: 'Ladder', sets: 1, target: 3, progression: { type: 'ladder', drives: 'target', values: [3, 5, 8, 13] } }],
  },
  ladder_loop: {
    steps: [{ key: 'l', title: 'Ladder', sets: 1, target: 3, progression: { type: 'ladder', drives: 'target', values: [3, 5, 8], repeat: 'loop' } }],
  },
  ladder_empty: {      // degenerate → falls back to fixed
    steps: [{ key: 'l', title: 'Ladder', target: 3, progression: { type: 'ladder', values: [] } }],
  },

  percent: {
    vars: { squat_max: 225 },
    steps: [{ key: 'sq', title: 'Squat', sets: 5, target: 3, load_unit: 'lb', progression: { type: 'percent', of: 'squat_max', start: 0.7, increment: 0.025 } }],
  },
  percent_missing_var: {
    steps: [{ key: 'sq', title: 'Squat', sets: 5, target: 3, progression: { type: 'percent', of: 'nothing', start: 0.7 } }],
  },

  autoregulated: {
    steps: [{ key: 'p', title: 'Press', sets: 3, load: 95, progression: { type: 'autoregulated', range: [5, 7], increment: 5 } }],
  },

  variants_clock: {
    steps: [{ key: 'pu', title: 'Push-Up', sets: 3, target: 8, load_unit: 'bw', variants: ['Knee', 'Push-Up', 'Decline', 'Archer'], variant_index: 1, variant_every: 3 }],
  },
  variants_driven: {
    steps: [{ key: 'pu', title: 'Push-Up', sets: 3, target: 8, variants: ['Knee', 'Push-Up', 'Decline'], progression: { type: 'linear', drives: 'variant', every: 2 } }],
  },

  phases_loop: {
    phases: [{ name: 'Base', cycles: 2 }, { name: 'Build', cycles: 2, intensity: 1.1 }],
    steps: [{ key: 'sq', title: 'Squat', sets: 3, target: 5, load: 100 }],
  },
  phases_hold: {
    phase_repeat: 'hold',
    phases: [{ name: 'Ramp', cycles: 2 }, { name: 'Plateau', cycles: 2, intensity: 1.2, sets_delta: 1 }],
    steps: [{ key: 'sq', title: 'Squat', sets: 3, target: 5, load: 100 }],
  },
  deload: {
    deload_every: 3, deload_factor: 0.5,
    steps: [{ key: 'sq', title: 'Squat', sets: 4, target: 5, load: 200, progression: { type: 'linear', increment: 10 } }],
  },

  blocks_order: {   // declaration order is deliberately wrong; render must sort it
    steps: [
      { key: 'c', title: 'Stretch', block: 'cooldown', unit: 'sec', target: 30 },
      { key: 'm', title: 'Squat', block: 'main', sets: 3, target: 5 },
      { key: 'w', title: 'Bike', block: 'warmup', unit: 'min', target: 5 },
    ],
  },
  duplicate_keys: {
    steps: [{ title: 'Squat', target: 5 }, { title: 'Squat', target: 3 }, { title: 'Squat', target: 1 }],
  },
  aliases: {   // the names an author reaches for without reading the schema
    goal: 'Get better', advance: 'calendar', rounding: 2.5,
    exercises: [{ name: 'Curl', reps: 12, load: 22.5, progression: { type: 'linear', by: 2.5 } }],
  },
  rounding: {
    round_load: 2.5,
    steps: [{ key: 'db', title: 'Dumbbell', sets: 3, target: 10, load: 22.5, progression: { type: 'linear', increment: 2.5 } }],
  },
  over_limit_steps: { steps: Array.from({ length: 60 }, (_, i) => ({ title: `S${i}`, target: i })) },

  /* ── Wave 2 ────────────────────────────────────────────────────────────── */

  // MULTI-RULE: reps climb every session, a fourth set arrives in the second month.
  multi_rule: {
    steps: [{ key: 'sq', title: 'Squat', sets: 3, target: 5, load: 100, progression: [
      { type: 'double', range: [5, 8], increment: 10 },
      { type: 'linear', drives: 'sets', increment: 1, every: 8, cap: 5 },
    ] }],
  },
  // Two rules on the same field — defined (last wins) and linted.
  multi_rule_collide: {
    steps: [{ key: 'sq', title: 'Squat', sets: 3, target: 5, load: 100, progression: [
      { type: 'linear', drives: 'load', increment: 5 },
      { type: 'linear', drives: 'load', increment: 20 },
    ] }],
  },
  // PROMOTE ON CAP: bodyweight, so the ladder IS the progression.
  promote: {
    steps: [{ key: 'pu', title: 'Push-Up', sets: 3, load: 0, load_unit: 'bw',
      variants: ['Knee', 'Push-Up', 'Decline', 'Archer'], promote_on_cap: true,
      progression: { type: 'double', range: [5, 8], increment: 1, cap: 3 } }],
  },
  // Promote on a LINEAR load rule.
  promote_linear: {
    steps: [{ key: 'db', title: 'Curl', sets: 3, target: 10, load: 20,
      variants: ['Two-arm', 'Alternating', 'Single-arm'], promote_on_cap: true,
      progression: { type: 'linear', drives: 'load', increment: 5, cap: 35 } }],
  },
  // Degenerate promote configs must pin, not divide by zero.
  promote_no_cap: {
    steps: [{ key: 'x', title: 'X', load: 10, variants: ['a', 'b'], promote_on_cap: true,
      progression: { type: 'linear', drives: 'load', increment: 5 } }],
  },
  promote_cap_below_base: {
    steps: [{ key: 'x', title: 'X', load: 100, variants: ['a', 'b'], promote_on_cap: true,
      progression: { type: 'double', range: [5, 6], increment: 5, cap: 50 } }],
  },
  // CONTRIBUTES.
  contributes: {
    contributes: { measure: 'target', step: 'run', target: 100, window: 'month', label: '100 km a month' },
    steps: [{ key: 'run', title: 'Run', unit: 'km', sets: 1, target: 5,
      progression: { type: 'linear', drives: 'target', increment: 0.5, cap: 12 } }],
  },
};

/* ── 3. The matrix — both implementations, every document, many cycles ─────── */
const CYCLES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 17, 23, 40, 51];
const EARNED = [undefined, {}, { p: 0 }, { p: 1 }, { p: 2 }, { p: 5 }];

let comparisons = 0;
let firstMismatch = null;
for (const [name, doc] of Object.entries(CORPUS)) {
  const beSpec = be.normalizeSpec(doc).spec;
  const feSpec = fe.normalizeSpec(doc);

  if (JSON.stringify(beSpec) !== JSON.stringify(feSpec)) {
    firstMismatch = firstMismatch || `normalise '${name}':\n  backend ${JSON.stringify(beSpec)}\n  mirror  ${JSON.stringify(feSpec)}`;
    continue;
  }
  for (const cycle of CYCLES) {
    for (const earned of EARNED) {
      const a = be.renderCycle(beSpec, cycle, earned ? { earned } : {});
      const b = fe.renderCycle(feSpec, cycle, earned ? { earned } : {});
      comparisons++;
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        firstMismatch = firstMismatch
          || `render '${name}' @ cycle ${cycle} earned=${JSON.stringify(earned)}:\n  backend ${JSON.stringify(a)}\n  mirror  ${JSON.stringify(b)}`;
      }
    }
  }
  // summarize() is what the board prints on a routine row — same string both sides.
  if (be.summarize(beSpec) !== fe.summarize(feSpec)) {
    firstMismatch = firstMismatch || `summarize '${name}': '${be.summarize(beSpec)}' vs '${fe.summarize(feSpec)}'`;
  }
}
check(!firstMismatch, `engine and mirror agree across ${Object.keys(CORPUS).length} documents × ${CYCLES.length} cycles (${comparisons} renders)`);
if (firstMismatch) console.error('  first mismatch — ' + firstMismatch);

/* ── 4. The rules themselves ──────────────────────────────────────────────────
   The matrix proves the two sides agree; these pin WHAT they agree ON, so a
   regression that breaks both identically still fails. Written against the backend
   because it is the authority. */
const lineAt = (doc, cycle, key, ctx) => {
  const { spec } = be.normalizeSpec(doc);
  const p = be.renderCycle(spec, cycle, ctx || {});
  return (p.steps.find((s) => s.key === key) || {}).line;
};

const EXPECTATIONS = [
  // DOUBLE — reps climb the range, then the load steps and the reps reset.
  ['double', 0, 'sq', '3 × 5 @ 135 lb', 'double: starts at the bottom of the range'],
  ['double', 3, 'sq', '3 × 8 @ 135 lb', 'double: climbs to the top of the range'],
  ['double', 4, 'sq', '3 × 5 @ 145 lb', 'double: tops the range → load steps, reps reset'],
  ['double_capped', 10, 'sq', '3 × 5 @ 155 lb', 'double: the load cap holds while the reps keep cycling'],

  // LINEAR — including the two things authors get wrong: `every` and `cap`.
  ['linear_load', 0, 'row', '3 × 8 @ 65 lb', 'linear: cycle 0 is the declared start'],
  ['linear_load', 4, 'row', '3 × 8 @ 85 lb', 'linear: +increment per cycle'],
  ['linear_capped', 20, 'run', '6 km', 'linear: the cap holds'],
  ['linear_every_3', 5, 'read', '12 pages', 'linear: `every` slows the clock'],

  // LADDER — hold at the end vs loop back to the start.
  ['ladder_hold', 3, 'l', '13', 'ladder: reaches the last value'],
  ['ladder_hold', 9, 'l', '13', 'ladder: holds there (repeat: hold)'],
  ['ladder_loop', 4, 'l', '5', 'ladder: loops back around (repeat: loop)'],
  ['ladder_empty', 3, 'l', '3', 'ladder: an empty table degrades to fixed, it does not break'],

  // PERCENT — a creeping fraction of a var, resolved and rounded.
  ['percent', 0, 'sq', '5 × 3 @ 160 lb', 'percent: 70% of 225, rounded to 5'],
  ['percent', 4, 'sq', '5 × 3 @ 180 lb', 'percent: the fraction creeps'],
  ['percent', 40, 'sq', '5 × 3 @ 215 lb', 'percent: capped at 95%'],
  ['percent_missing_var', 3, 'sq', '5 × 3', 'percent: a missing var renders no load rather than NaN'],

  // DELOAD — every Nth cycle is lighter AND shorter, and does not compound.
  ['deload', 1, 'sq', '4 × 5 @ 210 lb', 'deload: a normal cycle is untouched'],
  ['deload', 2, 'sq', '2 × 5 @ 110 lb', 'deload: every 3rd cycle drops load and volume'],
  ['deload', 3, 'sq', '4 × 5 @ 230 lb', 'deload: the cycle after resumes the full ladder — it does NOT compound'],

  // VARIANTS — the second axis of difficulty, the only one bodyweight work has.
  ['variants_clock', 0, 'pu', '3 × 8 @ bodyweight', 'variants: starts at variant_index'],
  ['variants_driven', 5, 'pu', '3 × 8', 'variants: a drives:variant rule climbs the ladder'],

  // PHASES — intensity scales the load, sets_delta shifts the volume.
  ['phases_loop', 2, 'sq', '3 × 5 @ 110 lb', 'phases: Build is 10% heavier'],
  ['phases_loop', 4, 'sq', '3 × 5 @ 100 lb', 'phases: past the end it loops back to Base'],
  ['phases_hold', 9, 'sq', '4 × 5 @ 120 lb', 'phases: repeat:hold stays in the final phase'],

  // AUTOREGULATION — the clock is advances EARNED, not cycles elapsed.
  ['autoregulated', 5, 'p', '3 × 7 @ 100 lb', 'autoregulated: with no log at all it behaves like double — usable on day one'],

  // MULTI-RULE — two independent clocks on one step.
  ['multi_rule', 0, 'sq', '3 × 5 @ 100 lb', 'multi-rule: both rules start where they start'],
  ['multi_rule', 4, 'sq', '3 × 5 @ 110 lb', 'multi-rule: the double rule tops the range and steps the load'],
  ['multi_rule', 8, 'sq', '4 × 5 @ 120 lb', 'multi-rule: …and the sets rule fires on its OWN clock'],
  ['multi_rule', 24, 'sq', '5 × 5 @ 160 lb', 'multi-rule: the sets rule respects its own cap'],
  ['multi_rule_collide', 3, 'sq', '3 × 5 @ 160 lb', 'multi-rule: two rules on one field — the later one wins'],

  // PROMOTE ON CAP — the two axes of difficulty, coupled.
  ['promote', 0, 'pu', '3 × 5 @ bodyweight', 'promote: starts on the first rung'],
  ['promote', 15, 'pu', '3 × 8 @ bodyweight', 'promote: still on the first rung at the top of its cap'],
  ['promote', 16, 'pu', '3 × 5 @ bodyweight', 'promote: capped → the ladder climbs and the load resets'],
  ['promote_linear', 0, 'db', '3 × 10 @ 20 lb', 'promote (linear): starts at the declared load'],
  ['promote_linear', 3, 'db', '3 × 10 @ 35 lb', 'promote (linear): climbs to the cap'],
  ['promote_linear', 4, 'db', '3 × 10 @ 20 lb', 'promote (linear): past the cap → next variant, load resets'],
  ['promote_no_cap', 6, 'x', '@ 40 lb', 'promote: no cap to reach → behaves exactly as before'],
  ['promote_cap_below_base', 4, 'x', '5 @ 50 lb', 'promote: a cap below the starting load pins rather than dividing by zero'],
];
for (const [doc, cycle, key, expected, msg] of EXPECTATIONS) {
  const got = lineAt(CORPUS[doc], cycle, key);
  check(got === expected, `${msg} (cycle ${cycle} → ${got})`);
}

// Autoregulation with a real tally: earning nothing must HOLD, which is the entire
// point of the type and the one behaviour a sparse tally silently destroyed once.
check(lineAt(CORPUS.autoregulated, 5, 'p', { earned: { p: 0 } }) === '3 × 5 @ 95 lb',
  'autoregulated: five sessions, none earned → still the bottom of the range');
check(lineAt(CORPUS.autoregulated, 5, 'p', { earned: { p: 3 } }) === '3 × 5 @ 100 lb',
  'autoregulated: three earned → the range topped once, load stepped');

/* Which VARIANT a promote-on-cap step is on — the assertion the `line` cannot make,
   because a bodyweight ladder's whole progression is the name. */
const titleAt = (doc, cycle, key) => {
  const { spec } = be.normalizeSpec(doc);
  return (be.renderCycle(spec, cycle).steps.find((s) => s.key === key) || {}).title;
};
check(titleAt(CORPUS.promote, 0, 'pu') === 'Knee', 'promote: cycle 0 is the easiest variant');
check(titleAt(CORPUS.promote, 16, 'pu') === 'Push-Up', 'promote: the cap buys the next rung of the ladder');
check(titleAt(CORPUS.promote, 32, 'pu') === 'Decline', 'promote: and the next');
check(titleAt(CORPUS.promote, 999, 'pu') === 'Archer',
  'promote: the ladder CLAMPS at the hardest variant — it never wraps back to the easiest');
check(titleAt(CORPUS.promote_linear, 4, 'db') === 'Alternating', 'promote (linear): climbs the same ladder');

/* ── 4b. The cadence — every mode, on both sides ─────────────────────────── */
const WINDOW = { from: '2026-08-17', to: '2026-09-14', anchor: '2026-08-13', days: [0, 2, 4] };
const CADENCE_CASES = [
  ['', 0, ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-24', '2026-08-26', '2026-08-28', '2026-08-31', '2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09', '2026-09-11', '2026-09-14'], 'weekly is the default and needs no rule'],
  ['every_n_days:3', 0, ['2026-08-19', '2026-08-22', '2026-08-25', '2026-08-28', '2026-08-31', '2026-09-03', '2026-09-06', '2026-09-09', '2026-09-12'], 'every_n_days counts from the ANCHOR, so its phase does not drift'],
  ['monthly:20', 0, ['2026-08-20'], 'monthly hits its day each month (September\'s is past the window)'],
  ['monthly:31', 0, ['2026-08-31'], 'monthly:31 clamps into a short month rather than spilling into the next'],
  // The anchor (2026-08-13) sits in the week of Mon 08-10, so the EVEN weeks are
  // 08-10 / 08-24 / 09-07 — the parity is the anchor's, not the window's.
  ['rrule:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 0, ['2026-08-25', '2026-08-27', '2026-09-08', '2026-09-10'], 'rrule: WEEKLY + INTERVAL keeps its parity against the ANCHOR week, not the window'],
  ['rrule:FREQ=DAILY;INTERVAL=4;COUNT=3', 0, ['2026-08-17', '2026-08-21', '2026-08-25'], 'rrule: COUNT stops it'],
];
let cadenceOk = true;
for (const [rule, floats, expected, msg] of CADENCE_CASES) {
  const a = be.expandCadence(be.parseCadence(rule), { ...WINDOW, floats });
  const b = fe.expandCadence(fe.parseCadence(rule), { ...WINDOW, floats });
  if (JSON.stringify(a) !== JSON.stringify(b)) { cadenceOk = false; console.error(`  cadence '${rule}' DIVERGED between engine and mirror`); }
  const dated = a.filter((x) => x.date).map((x) => x.date);
  // monthly:31 in a 30-day month — the expected list above is what the rule means,
  // not what a naive Date rollover would give.
  check(JSON.stringify(dated) === JSON.stringify(expected), `${msg} (${dated.join(' ')})`);
}
check(cadenceOk, 'every cadence mode expands identically in the engine and the mirror');

// Floats: undated, keyed to a window, and the only thing `rolling` produces.
const weeklyFloats = be.expandCadence(be.parseCadence(''), { ...WINDOW, floats: 1 }).filter((x) => x.float);
check(weeklyFloats.length === 5 && weeklyFloats.every((f) => f.date === null),
  `weekly floats are undated and one per week (got ${weeklyFloats.length})`);
const rolling = be.expandCadence(be.parseCadence('rolling:3'), { ...WINDOW, floats: 0 });
check(rolling.length > 0 && rolling.every((x) => x.float && x.date === null),
  'rolling produces ONLY floats — the mode says how often, never which day');
check(rolling.filter((x) => x.week === '2026-08-20').length === 3,
  'rolling anchors its windows on the routine start weekday, not on Monday');

// RRULE rejects rather than half-honours.
for (const [rule, why] of [
  ['rrule:FREQ=YEARLY', 'FREQ=YEARLY'],
  ['rrule:FREQ=WEEKLY;BYSETPOS=1', 'BYSETPOS'],
  ['rrule:FREQ=WEEKLY;BYDAY=2MO', 'ordinal BYDAY'],
]) {
  const a = be.parseCadence(rule); const b = fe.parseCadence(rule);
  check(!!a.rrule_error && a.type === 'weekly' && a.rrule_error === b.rrule_error,
    `rrule: '${why}' is REJECTED, not silently dropped (${a.rrule_error})`);
}
check(be.formatCadence(be.parseCadence('every_n_days:3')) === 'every_n_days:3'
  && be.formatCadence(be.parseCadence('monthly:last')) === 'monthly:last',
  'cadence round-trips through parse → format');
check(be.describeCadence(be.parseCadence('rolling:3')) === fe.describeCadence(fe.parseCadence('rolling:3')),
  'describeCadence reads the same on both sides');

/* ── 4c. The deload override ─────────────────────────────────────────────── */
const dl = be.normalizeSpec(CORPUS.deload).spec;
check(be.renderCycle(dl, 0).deload === false && be.renderCycle(dl, 2).deload === true,
  'deload: the programme\'s own cadence still decides by default');
check(be.renderCycle(dl, 0, { deload: true }).deload === true
  && be.renderCycle(dl, 0, { deload: true }).deload_forced === true,
  'deload on demand: forcing one light marks it as FORCED, so the card can say who asked');
check(be.renderCycle(dl, 2, { deload: false }).deload === false,
  'deload on demand: it forces NORMAL too — the same gesture in the other direction');
check(be.renderCycle(dl, 2, { deload: true }).deload_forced === false,
  'deload on demand: forcing a session the programme already deloaded is not "forced"');
check(JSON.stringify(be.renderCycle(dl, 0, { deload: true })) === JSON.stringify(fe.renderCycle(dl, 0, { deload: true })),
  'the deload override renders identically in the mirror');
check(be.renderCycle(dl, 0, { spec_version: 7 }).sv === 7,
  'the revision that produced a snapshot is stamped on it');

/* ── 4d. The goal metric and the progression series ──────────────────────── */
const cSpec = be.normalizeSpec(CORPUS.contributes).spec;
check(cSpec.contributes?.measure === 'target' && cSpec.contributes.target === 100,
  'contributes: normalised off the document');
check(be.validateSpec({ contributes: { measure: 'target', target: 100, step: 'nope' }, steps: [{ key: 'run', title: 'Run' }] })
  .warnings.some((w) => w.code === 'STEP_MISSING'),
  'contributes: pointing at a step that is not there is linted');
check(be.normalizeSpec({ contributes: { measure: 'target' } }).spec.contributes === null,
  'contributes: no target measures nothing — dropped');

/* Two completed 5 km runs and one missed → 10 km toward 100. */
const mkOcc = (date, cycle, completed, target, performedSets) => ({
  due_date: date, completed,
  prescription: JSON.stringify(be.renderCycle(cSpec, cycle)),
  performed: performedSets ? JSON.stringify({ steps: { run: { done: true, sets: performedSets } } }) : null,
});
const occs = [
  mkOcc('2026-08-03', 0, 1, 5, null),
  mkOcc('2026-08-05', 1, 1, 5.5, null),
  mkOcc('2026-08-07', 2, 0, 6, null),
];
const m = be.metricOf(cSpec, occs, '2026-08-10');
check(m && m.value === 10.5 && m.target === 100 && m.unit === 'km',
  `metric: only COMPLETED sessions count, in the routine's own unit (got ${m && m.value})`);
check(JSON.stringify(m) === JSON.stringify(fe.metricOf(cSpec, occs, '2026-08-10')),
  'metric: engine and mirror agree');
check(be.metricOf(cSpec, occs, '2026-09-10').value === 0,
  'metric: the window resets — September does not count August');
const logged = [mkOcc('2026-08-03', 0, 1, 5, [{ value: 3, load: null }])];
check(be.metricOf(cSpec, logged, '2026-08-10').value === 3,
  'metric: a logged set OVERRIDES the prescription — it counts what you did');

const series = be.seriesFor(cSpec, occs, 'run', 'target');
check(series.length === 3 && series[0].prescribed === 5 && series[0].performed === 5,
  'series: a completed session with no detail performed what it was prescribed');
check(series[2].performed === null && series[2].prescribed === 6,
  'series: an uncompleted session has a prescription and no performance');
check(JSON.stringify(series) === JSON.stringify(fe.seriesFor(cSpec, occs, 'run', 'target')),
  'series: engine and mirror agree');

/* ── 4e. Per-set logging ─────────────────────────────────────────────────── */
const rendered = { sets: 3, target: 5, load: 100 };
check(be.blankSets(rendered).length === 3 && be.blankSets(rendered)[0].value === 5,
  'blankSets: pre-filled with the prescription, so "as prescribed" is a tap not transcription');
check(be.metFromSets(rendered, []) === null,
  'metFromSets: nothing logged is NOT a failure — it is nothing to judge');
check(be.metFromSets(rendered, [{ value: 5 }, { value: 5 }, { value: 5 }]) === true,
  'metFromSets: every logged set reaching the target is a hit');
check(be.metFromSets(rendered, [{ value: 5 }, { value: 3 }]) === false,
  'metFromSets: one short set is a miss');
check(be.metFromSets(rendered, [{ value: 5 }]) === true,
  'metFromSets: a partially-filled sheet is judged on what IS there');
check(be.metFromSets({ sets: 1 }, [{ value: 1 }]) === true,
  'metFromSets: nothing to fall short of → a hit');
check(be.metFromSets(rendered, [{ value: 5 }, { value: 3 }]) === fe.metFromSets(rendered, [{ value: 5 }, { value: 3 }]),
  'metFromSets: engine and mirror agree');

/* ── 5. Lossy-safe: no document, however bad, may throw or emit NaN ───────────
   The load-bearing promise of the whole format — "every field optional, every
   default defensible" — is what lets a weak author produce something plainer
   rather than something broken. */
const HOSTILE = [
  null, undefined, 0, '', '[]', '{"steps":', [], [1, 2, 3],
  { steps: [null, undefined, 0, '', [], {}] },
  { steps: [{ progression: { type: 'nonsense' } }] },
  { steps: [{ sets: -5, target: 'abc', load: {}, unit: 'furlongs' }] },
  { steps: [{ progression: { type: 'double', range: [10, 2] } }] },
  { steps: [{ progression: { type: 'linear', increment: Infinity, cap: NaN } }] },
  { vars: { x: 'not a number' }, steps: [{ progression: { type: 'percent', of: 'x' } }] },
  { phases: [{ cycles: -1 }], steps: [{ title: 'x' }] },
  { steps: [{ variants: [], variant_index: 99, variant_every: -3 }] },
  // Wave 2 hostility
  { steps: [{ progression: [] }] },
  { steps: [{ progression: [null, 'nonsense', { type: 'linear' }] }] },
  { steps: [{ progression: Array.from({ length: 40 }, () => ({ type: 'linear', increment: 1 })) }] },
  { steps: [{ promote_on_cap: true, load: 10, progression: { type: 'linear', drives: 'load', increment: 0, cap: 5 } }] },
  { steps: [{ promote_on_cap: true, variants: ['a'], load: 0, progression: { type: 'double', increment: -5, cap: -10 } }] },
  { contributes: { measure: 'nope', target: 'abc' }, steps: [{ title: 'x' }] },
  { contributes: [], steps: [] },
];
let hostileOk = true;
for (const doc of HOSTILE) {
  try {
    const { spec } = be.normalizeSpec(doc);
    const feSpec = fe.normalizeSpec(doc);
    if (JSON.stringify(spec) !== JSON.stringify(feSpec)) {
      hostileOk = false;
      console.error(`  hostile input diverged: ${JSON.stringify(doc)}`);
    }
    for (const c of [0, 1, 7, 30]) {
      const a = be.renderCycle(spec, c);
      const b = fe.renderCycle(feSpec, c);
      if (JSON.stringify(a) !== JSON.stringify(b)) { hostileOk = false; console.error(`  hostile render diverged @${c}: ${JSON.stringify(doc)}`); }
      const bad = a.steps.find((s) => Number.isNaN(s.load) || Number.isNaN(s.target) || Number.isNaN(s.sets));
      if (bad) { hostileOk = false; console.error(`  hostile render produced NaN: ${JSON.stringify(bad)}`); }
      if (typeof a.line !== 'string') { hostileOk = false; console.error('  hostile render produced no line'); }
    }
  } catch (e) {
    hostileOk = false;
    console.error(`  hostile input THREW (${e.message}): ${JSON.stringify(doc)}`);
  }
}
check(hostileOk, `${HOSTILE.length} hostile documents normalise and render without throwing or emitting NaN`);

/* ── 6. Validation is server-side, and its two tiers must stay distinct ───────
   Not mirrored (see the .ts header), but pinned here because the SPLIT is the
   contract an AI author depends on: a broken document must be rejected with a
   path+code it can act on, and a thin one must be ACCEPTED and flagged. */
const broken = be.validateSpec({ steps: 'nope' });
check(!broken.ok && broken.errors[0]?.path === 'steps' && broken.errors[0]?.code === 'NOT_AN_ARRAY',
  'validate: a structural error is machine-readable (path + code)');

const thin = be.validateSpec({ steps: [{ title: 'Do it', target: 1 }] });
check(thin.ok && thin.warnings.some((w) => w.code === 'NO_PROGRESSION'),
  'validate: a routine where nothing ever gets harder is ACCEPTED and linted');

const noVar = be.validateSpec({ steps: [{ title: 'Squat', progression: { type: 'percent', of: 'missing' } }] });
check(noVar.ok && noVar.warnings.some((w) => w.code === 'PERCENT_NO_VAR' || w.code === 'VAR_MISSING'),
  'validate: a percentage with nothing to be a percentage of is linted');

/* promote-on-cap: `double` normalises `drives` to 'target' but steps the LOAD too,
   so a cap on it is exactly the cap the flag waits for. Asking the narrow
   `drives === 'load'` question told a correctly-configured bodyweight ladder it had
   no cap to reach. */
const promoteOk = be.validateSpec({ steps: [{ title: 'Push-Up', load: 0, variants: ['a', 'b', 'c'],
  promote_on_cap: true, progression: { type: 'double', range: [8, 12], increment: 1, cap: 2 } }] });
check(!promoteOk.warnings.some((w) => w.code === 'PROMOTE_NO_CAP'),
  'validate: a capped DOUBLE rule counts as a load cap for promote-on-cap');
const promoteNoCap = be.validateSpec({ steps: [{ title: 'Push-Up', load: 0, variants: ['a', 'b'],
  promote_on_cap: true, progression: { type: 'double', range: [8, 12], increment: 1 } }] });
check(promoteNoCap.warnings.some((w) => w.code === 'PROMOTE_NO_CAP'),
  'validate: …but promoting with no cap anywhere is still linted');
check(be.validateSpec({ steps: [{ title: 'Push-Up', promote_on_cap: true,
  progression: { type: 'double', cap: 5 } }] }).warnings.some((w) => w.code === 'PROMOTE_NO_LADDER'),
  'validate: promoting with no ladder to be promoted ONTO is linted');
check(be.validateSpec({ steps: [{ title: 'Plank', unit: 'sec', target: 30,
  progression: { type: 'linear', drives: 'target', increment: 5 } }] }).warnings.some((w) => w.code === 'UNCAPPED'),
  'validate: an uncapped COUNT is linted — +5s a session is a five-minute plank by next spring');
check(!be.validateSpec({ steps: [{ title: 'Squat', load: 100,
  progression: { type: 'linear', drives: 'load', increment: 5 } }] }).warnings.some((w) => w.code === 'UNCAPPED'),
  'validate: …but an uncapped LOAD is not — a barbell\'s ceiling is the person, not the document');
check(be.validateSpec({ steps: [{ title: 'Squat', load: 100, progression: [
  { type: 'linear', drives: 'load', increment: 5 }, { type: 'linear', drives: 'load', increment: 9 }] }] })
  .warnings.some((w) => w.code === 'RULES_COLLIDE'),
  'validate: two rules on one field is defined but linted — the later one wins');

const noLadder = be.validateSpec({ steps: [{ title: 'Push', progression: { type: 'linear', drives: 'variant' } }] });
check(noLadder.ok && noLadder.warnings.some((w) => w.code === 'NO_LADDER'),
  'validate: progressing by variant with no ladder to climb is linted');

check(be.validateSpec(null).ok && be.validateSpec('').ok,
  'validate: an absent document is valid — a routine with no content yet is not an error');

const tooBig = be.validateSpec('x'.repeat(be.LIMITS.spec + 1));
check(!tooBig.ok && tooBig.errors[0]?.code === 'TOO_LARGE', 'validate: the size cap is enforced before parsing');

/* ── 7. The performed log, and what the engine reads back out of it ───────── */
check(be.stepWasMet(null, 'x') === true,
  'performed: a completed session with NO log counts as met — logging every set is a habit people drop');
check(be.stepWasMet({ steps: { x: { done: true, met: false } } }, 'x') === false,
  'performed: an explicit miss is honoured');
check(be.stepWasMet({ steps: { x: { done: false } } }, 'x') === false,
  'performed: an explicitly skipped step did not earn the advance');
check(be.normalizePerformed('not json') === null && be.normalizePerformed({ steps: { a: true } })?.steps?.a?.done === true,
  'performed: normalises loosely and fails soft');

console.log(failed ? `\ncheck:routine — ${failed} FAILED` : '\ncheck:routine — all checks passed');
process.exit(failed ? 1 : 0);

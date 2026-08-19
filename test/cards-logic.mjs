// Cards/UI pure-logic unit tests (TEST-9) — the calendar kit's date/grid math and
// the suite's withAlpha() colour helper were entirely untested; a silent regression
// in lane packing or time↔fraction conversion would corrupt every calendar render.
//
// The kit is authored in TypeScript and the suite has no TS test runner on Node 20,
// so this transpiles the two self-contained pure modules in-memory with the
// `typescript` compiler the repo already depends on (ts.transpileModule strips the
// type annotations — the modules import only `type`s, so they stand alone), writes
// the JS to a temp file, and imports the REAL functions. No new dependency.
//
// Run:  node test/cards-logic.mjs   (wired as `pnpm test:cards`, folded into
//                                     `pnpm test:contracts`).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-cards-logic-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

/* Transpile a .ts module to ESM and import it.
 *
 * `rewrite` maps a bare import specifier to another module ALREADY emitted into
 * the same temp dir, so a module that is pure logic but not import-free can still
 * be tested for real. It is deliberately a per-call map rather than a resolver:
 * every rewritten edge has to be written down here, which keeps this from quietly
 * turning into a second module resolver that could disagree with the bundler. */
async function importTs(relPath, outName, rewrite = {}) {
  let src = readFileSync(resolve(root, relPath), 'utf8');
  for (const [from, to] of Object.entries(rewrite)) {
    src = src.replaceAll(`'${from}'`, `'./${to}'`);
  }
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

const color = await importTs('packages/design/utils/color.ts', 'color.mjs');
const dt = await importTs('packages/cards/src/datetime.ts', 'datetime.mjs');
const mediaGrid = await importTs('packages/design/responsive/mediaGrid.ts', 'mediaGrid.mjs');
const motion = await importTs('packages/design/theme/motion.ts', 'motion.mjs');

/* ── withAlpha ─────────────────────────────────────────────────────────── */
const { withAlpha } = color;

// Bare hex → hex-concat, byte-identical to the legacy `${c}NN` it replaced.
check(withAlpha('#33aaff', 0.4) === '#33aaff66', 'withAlpha bare hex → appends 66 for 0.4');
check(withAlpha('#33aaff', 0.2) === '#33aaff33', 'withAlpha bare hex → 33 for 0.2');
check(withAlpha('#33aaff', 0.8) === '#33aaffcc', 'withAlpha bare hex → cc for 0.8');
check(withAlpha('#33aaff', 0.6) === '#33aaff99', 'withAlpha bare hex → 99 for 0.6');
check(withAlpha('#33aaff', 0.533) === '#33aaff88', 'withAlpha bare hex → 88 for 0.533');
check(withAlpha('#33aaff', 0.333) === '#33aaff55', 'withAlpha bare hex → 55 for 0.333');
check(withAlpha('#33aaff', 0.267) === '#33aaff44', 'withAlpha bare hex → 44 for 0.267');
check(withAlpha('#33aaff', 0.133) === '#33aaff22', 'withAlpha bare hex → 22 for 0.133');
// #rgb shorthand expands to 6 digits before the alpha byte lands.
check(withAlpha('#3af', 0.4) === '#33aaff66', 'withAlpha expands #rgb → #rrggbb');
// The bug this fixes: a CSS var must NOT hex-concat (that yields invalid CSS).
check(
  withAlpha('var(--color-accent)', 0.4) === 'color-mix(in srgb, var(--color-accent) 40%, transparent)',
  'withAlpha CSS var → color-mix, never a hex-concat',
);
check(
  withAlpha('var(--color-muted)', 0.133) === 'color-mix(in srgb, var(--color-muted) 13%, transparent)',
  'withAlpha CSS var rounds fraction → percent',
);
// Clamped + non-hex passthrough.
check(withAlpha('#000000', 2) === '#000000ff', 'withAlpha clamps alpha > 1 to ff');
check(withAlpha('#ffffff', -1) === '#ffffff00', 'withAlpha clamps alpha < 0 to 00');
check(withAlpha('  #abcabc  ', 0.4).startsWith('#abcabc'), 'withAlpha trims whitespace');

/* ── time ↔ fraction ───────────────────────────────────────────────────── */
const { timeToFrac, fracToTime, snapFrac } = dt;
check(timeToFrac('14:30') === 14.5, 'timeToFrac 14:30 → 14.5');
check(timeToFrac('00:00') === 0, 'timeToFrac midnight → 0');
check(fracToTime(14.5) === '14:30', 'fracToTime 14.5 → 14:30');
check(fracToTime(9) === '09:00', 'fracToTime pads hours');
check(fracToTime(25) === '23:00', 'fracToTime clamps overflow to 23:00');
check(fracToTime(-1) === '00:00', 'fracToTime clamps negative to 00:00');
check(snapFrac(14.4) === 14.5, 'snapFrac rounds to nearest 15 min');
check(snapFrac(14.05) === 14, 'snapFrac rounds down within step');
check(snapFrac(14.2, 0.5) === 14, 'snapFrac honours a custom step');
// Round-trip on the quarter-hour grid the UI actually uses.
for (const f of [6, 6.25, 8.5, 13.75, 21]) {
  check(timeToFrac(fracToTime(f)) === f, `time↔frac round-trips at ${f}`);
}

/* ── date helpers (local-tz ISO) ───────────────────────────────────────── */
const { addDays, weekStart, monthStart, monthEnd, buildMonthGrid } = dt;
check(addDays('2026-07-06', 1) === '2026-07-07', 'addDays +1');
check(addDays('2026-07-01', -1) === '2026-06-30', 'addDays crosses a month boundary backwards');
check(addDays('2026-02-28', 1) === '2026-03-01', 'addDays respects Feb (non-leap 2026)');
// 2026-07-06 is a Monday → its own week start.
check(weekStart('2026-07-06') === '2026-07-06', 'weekStart of a Monday is itself');
check(weekStart('2026-07-08') === '2026-07-06', 'weekStart snaps Wed back to Monday');
check(weekStart('2026-07-05') === '2026-06-29', 'weekStart treats Sunday as the week end');
check(monthStart('2026-07-06') === '2026-07-01', 'monthStart');
check(monthEnd('2026-07-06') === '2026-07-31', 'monthEnd (31-day month)');
check(monthEnd('2026-02-15') === '2026-02-28', 'monthEnd (Feb non-leap)');
const grid = buildMonthGrid('2026-07-06');
check(grid.length === 42, 'buildMonthGrid yields a 6×7 grid');
check(grid[0].iso === '2026-06-29' && !grid[0].inMonth, 'month grid leads with the trailing days of June');
check(grid.some((c) => c.iso === '2026-07-01' && c.inMonth), 'month grid flags in-month days');

/* ── the month grid's entrance ring ────────────────────────────────────── */
// The month view's cells enter starting on TODAY, run to the end of the month,
// wrap to the 1st and close on the day before — the cascade is how the view says
// where "now" is. Get the wrap wrong and the pointer aims at the wrong date, in a
// way no typecheck and no eyeball on one month would catch.
const { ringOrder, MO_RING_STEP } = motion;
check(ringOrder(14, 14, 31) === 0, 'ringOrder: the anchor day goes first');
check(ringOrder(15, 14, 31) === 1, 'ringOrder: the day after the anchor is next');
check(ringOrder(31, 14, 31) === 17, 'ringOrder: the last day of the month closes the forward run');
check(ringOrder(1, 14, 31) === 18, 'ringOrder: the 1st picks up immediately after the month end');
check(ringOrder(13, 14, 31) === 30, 'ringOrder: the day BEFORE the anchor lands last');
// Every day is used exactly once — the ring is a permutation, so no two cells
// share a beat and none is left holding its pre-delay frame forever.
const ranks = Array.from({ length: 31 }, (_, i) => ringOrder(i + 1, 14, 31)).sort((a, b) => a - b);
check(ranks.every((r, i) => r === i), 'ringOrder over a 31-day month is a permutation of 0..30');
// Anchoring on the 1st (a month that doesn't contain today) degrades to plain
// reading order rather than to a special case.
check(ringOrder(1, 1, 30) === 0 && ringOrder(30, 1, 30) === 29, 'ringOrder anchored on the 1st is reading order');
// Short months and out-of-range input clamp instead of producing negative delays
// (a negative animation-delay starts the animation mid-flight — the cell would
// appear already half-arrived).
check(ringOrder(28, 28, 28) === 0, 'ringOrder handles a 28-day February');
check(ringOrder(40, 14, 31) === 17 && ringOrder(0, 14, 31) === 18, 'ringOrder clamps out-of-range days');
check(ringOrder(5, 5, 0) === 0, 'ringOrder tolerates a zero-length month');
// The sweep has to be over fast enough that the page is usable while it arrives.
check(MO_RING_STEP * 31 < 600, `a 31-day sweep costs under 600ms (${MO_RING_STEP * 31}ms)`);

/* ── timed-event slot packing ──────────────────────────────────────────── */
const { layoutTimedEvents } = dt;
const noOverlap = layoutTimedEvents([
  { id: 1, kind: 'event', title: 'a', scheduled_time: '09:00', scheduled_end: '10:00' },
  { id: 2, kind: 'event', title: 'b', scheduled_time: '10:00', scheduled_end: '11:00' },
]);
check(noOverlap.every((l) => l.totalCols === 1), 'sequential events share one column');
const overlap = layoutTimedEvents([
  { id: 1, kind: 'event', title: 'a', scheduled_time: '09:00', scheduled_end: '10:30' },
  { id: 2, kind: 'event', title: 'b', scheduled_time: '10:00', scheduled_end: '11:00' },
]);
check(overlap.every((l) => l.totalCols === 2), 'overlapping events split into 2 columns');
check(new Set(overlap.map((l) => l.slot)).size === 2, 'overlapping events get distinct slots');
const many = layoutTimedEvents(
  Array.from({ length: 6 }, (_, i) => ({ id: i, kind: 'event', title: `e${i}`, scheduled_time: '09:00', scheduled_end: '10:00' })),
);
check(many.every((l) => l.slot <= 3 && l.totalCols <= 4), 'slot packing caps at 4 columns');

/* ── all-day multi-day lane packing ────────────────────────────────────── */
const { layoutBars } = dt;
const week = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];
const bars = layoutBars(
  [
    { id: 1, kind: 'event', title: 'trip', due_date: '2026-07-07', end_date: '2026-07-09' },
    { id: 2, kind: 'event', title: 'spillL', due_date: '2026-07-04', end_date: '2026-07-07' },
    { id: 3, kind: 'event', title: 'spillR', due_date: '2026-07-11', end_date: '2026-07-14' },
    { id: 4, kind: 'event', title: 'outside', due_date: '2026-08-01', end_date: '2026-08-02' },
  ],
  week,
);
check(!bars.some((b) => b.ev.id === 4), 'layoutBars drops events outside the week');
const trip = bars.find((b) => b.ev.id === 1);
check(trip.startCol === 1 && trip.endCol === 3, 'layoutBars maps a mid-week span to the right columns');
const spillL = bars.find((b) => b.ev.id === 2);
check(spillL.startCol === 0 && spillL.continuesLeft, 'layoutBars flags a left-spilling event');
const spillR = bars.find((b) => b.ev.id === 3);
check(spillR.endCol === 6 && spillR.continuesRight, 'layoutBars flags a right-spilling event');
// spillL (ends Tue) and trip (starts Tue) touch on col 1 → must not share a lane.
check(spillL.lane !== trip.lane, 'touching bars occupy separate lanes');

/* ── equal-width lanes, never shingled ─────────────────────────────────── */
// The chip-inset numbers in constants.ts all derive from lanes being exactly
// 100/totalCols wide. If packing ever became shingled (overlapping, offset
// cards) every inset would silently become wrong, so pin the invariant here.
{
  const three = layoutTimedEvents([
    { id: 1, kind: 'event', title: 'a', scheduled_time: '09:00', scheduled_end: '11:00' },
    { id: 2, kind: 'event', title: 'b', scheduled_time: '09:30', scheduled_end: '11:00' },
    { id: 3, kind: 'event', title: 'c', scheduled_time: '10:00', scheduled_end: '11:00' },
  ]);
  check(three.every((l) => l.totalCols === 3), 'three concurrent events split into 3 equal lanes');
  check(new Set(three.map((l) => l.slot)).size === 3, 'each concurrent event gets its own lane');
  // Equal width means left edges land on exact multiples of 100/totalCols.
  const lefts = three.map((l) => (l.slot / l.totalCols) * 100).sort((a, b) => a - b);
  check(
    lefts.every((v, i) => Math.abs(v - (i * 100) / 3) < 1e-9),
    'lane left edges are exact multiples of 100/totalCols (equal width, not shingled)',
  );
}

/* ── chipState — the clock decides, not the call site ──────────────────── */
{
  const { chipState, chipStateClass } = dt;
  // A fixed clock: 2026-07-18, 10:30 local.
  const now = new Date(2026, 6, 18, 10, 30);
  const at = (over) => ({ id: 1, kind: 'task', title: 't', due_date: '2026-07-18', ...over });

  check(chipState(at({ completed: true, scheduled_time: '09:00' }), now) === 'done',
    'completed wins over the clock → done');
  check(chipState(at({ scheduled_time: '10:00', scheduled_end: '11:00' }), now) === 'live',
    'started and not finished → live');
  check(chipState(at({ scheduled_time: '08:00', scheduled_end: '09:00' }), now) === 'spent',
    'ended and not struck off → spent');
  check(chipState(at({ scheduled_time: '14:00', scheduled_end: '15:00' }), now) === 'upcoming',
    'not started yet → upcoming');
  check(chipState(at({ scheduled_time: '10:00' }), now) === 'live',
    'an item with no end runs an hour → still live at +30min');
  check(chipState(at({}), now) === 'upcoming',
    'an untimed item on today has not ended → upcoming');
  check(chipState(at({ due_date: '2026-07-17' }), now) === 'spent',
    'a whole past day is spent');
  check(chipState(at({ due_date: '2026-07-19' }), now) === 'upcoming',
    'a whole future day is upcoming');
  check(chipState({ id: 2, kind: 'task', title: 'x' }, now) === 'upcoming',
    'an item with no date at all is upcoming, not spent');

  check(chipStateClass('upcoming') === '', 'upcoming is the base chip — no modifier class');
  check(chipStateClass('live') === 'jk-chip-live', 'live → .jk-chip-live');
  check(chipStateClass('spent') === 'jk-chip-spent', 'spent → .jk-chip-spent');
  check(chipStateClass('done') === 'jk-chip-done', 'done → .jk-chip-done');
}

/* ── timeline geometry rides the density axis ──────────────────────────── */
{
  const geo = await importTs('packages/cards/src/constants.ts', 'cards-constants.mjs');
  const { rowHeight, labelW, minBlockH, gridHeight, chipInset, gridRules, GRID_HOURS } = geo;

  check(rowHeight('comfortable') === 60, 'comfortable row is the prototype 60px');
  check(rowHeight('compact') === 48, "compact row stays 48px — ORDECK's HUD must not grow 20%");
  check(rowHeight() === 60, 'rowHeight defaults to comfortable');
  check(minBlockH('comfortable') === 26 && minBlockH('compact') === 18, 'block floor follows density');
  check(labelW('comfortable') === 52 && labelW('compact') === 60, 'gutter width follows density');
  check(GRID_HOURS === 17, '06:00–22:00 inclusive is 17 rows');
  check(gridHeight('comfortable') === 1020, '17 rows x 60px = 1020px of timeline');
  check(gridHeight('compact') === 816, 'compact timeline is 17 x 48');

  check(String(chipInset('comfortable', 'week')) === '5,10', 'Week chip inset is +5 / -10');
  check(String(chipInset('comfortable', 'day')) === '6,12', 'Today chip inset is +6 / -12');

  // Hour rules are the faint ledger, never --color-line-strong.
  const weekRules = gridRules('comfortable');
  check(weekRules.includes('var(--hub-line)'), 'grid rules paint --hub-line');
  check(!weekRules.includes('--color-line-strong'), 'grid rules never paint --color-line-strong');
  check(weekRules.split('repeating-linear-gradient').length - 1 === 1,
    'Week gets the hour rule only — one gradient');
  const dayRules = gridRules('comfortable', { halfHour: true });
  check(dayRules.split('repeating-linear-gradient').length - 1 === 2,
    'Today layers the half-hour ghost rule — two gradients');
  check(dayRules.includes('30px'), "the ghost rule sits at the row's half-height");
}

/* ── media-grid density ladder (ToDo.md §3 20.2) ───────────────────────── */
const { MEDIA_GRID_COLUMNS } = mediaGrid;
check(MEDIA_GRID_COLUMNS.compact === 2, 'MEDIA_GRID_COLUMNS.compact is 2 (the original .lib-grid ladder)');
check(MEDIA_GRID_COLUMNS.cozy === 3, 'MEDIA_GRID_COLUMNS.cozy is 3');
check(MEDIA_GRID_COLUMNS.comfortable === 4, 'MEDIA_GRID_COLUMNS.comfortable is 4');
check(
  Object.keys(MEDIA_GRID_COLUMNS).length === 3,
  'MEDIA_GRID_COLUMNS has exactly the three density tiers (no drift)',
);

/* ── <MatchPanel> class + wiring parity (ToDo.md §3 20.4) ─────────────────
 * @jkos/ui's generic <MatchPanel> (packages/ui/src/MatchPanel.tsx) owns a set
 * of `.jk-match-*` classes that must actually be styled in hub.css (moved
 * there, verbatim, from papyros's old `.match-panel`/`.match-candidate*`
 * rules) — the same "component classes vs. hub.css drift" class of bug 20.2's
 * media-grid check above guards against. Plus a few structural invariants:
 * papyros's binding stays THIN (imports the generic panel rather than
 * re-implementing it) and its old bespoke CSS rules are actually gone, not
 * just unreferenced. */
const matchPanelSrc = readFileSync(resolve(root, 'packages/ui/src/MatchPanel.tsx'), 'utf8');
const hubCss = readFileSync(resolve(root, 'packages/design/tokens/hub.css'), 'utf8');

const jkMatchClasses = [...new Set((matchPanelSrc.match(/jk-match[\w-]*/g) || []))];
check(jkMatchClasses.length >= 10, `MatchPanel.tsx references at least 10 jk-match-* classes (found ${jkMatchClasses.length})`);

function hubHasSelector(cls) {
  const escaped = cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  // Negative lookahead for a word char OR hyphen — a bare `\b` would also match
  // inside a LONGER class name sharing this one's prefix (e.g. `.jk-match-panel`
  // would falsely "find" `.jk-match-panel-head`'s selector, since `-` is not a
  // \w char and so still trips a \b boundary there).
  return new RegExp(`\\.${escaped}(?![\\w-])`).test(hubCss);
}
const missingInHub = jkMatchClasses.filter((c) => !hubHasSelector(c));
check(missingInHub.length === 0,
  missingInHub.length === 0
    ? 'every jk-match-* class MatchPanel.tsx uses has a hub.css selector'
    : `hub.css is missing selectors for: ${missingInHub.join(', ')}`);

// @jkos/ui stays transport-agnostic (the <AppShell> decoupling rule, 20.1) —
// the generic panel takes injected search/apply functions, never its own fetch.
// (Matches an actual `import … from '@jkos/weave'` — prose mentioning the
// package names to EXPLAIN the rule, as this file's own header comment does,
// is fine and shouldn't trip the check.)
check(
  !/from\s*['"]@jkos\/(weave|auth-client)['"]/.test(matchPanelSrc),
  'MatchPanel.tsx does not import @jkos/weave or @jkos/auth-client (stays transport-agnostic)',
);

// The panel is exported from the @jkos/ui barrel (so a consumer besides papyros
// can actually reach it).
const uiIndex = readFileSync(resolve(root, 'packages/ui/src/index.ts'), 'utf8');
check(/export\s*\{\s*MatchPanel\s*\}\s*from\s*['"]\.\/MatchPanel['"]/.test(uiIndex),
  '@jkos/ui barrel exports MatchPanel');
check(/MatchCandidate/.test(uiIndex) && /MatchPanelProps/.test(uiIndex),
  '@jkos/ui barrel exports the MatchCandidate/MatchPanelProps types');

// connectorPair (the weave-side binding helper) is barreled from @jkos/weave.
const weaveIndex = readFileSync(resolve(root, 'packages/weave/src/index.ts'), 'utf8');
check(/export \* from '\.\/connectorPair'/.test(weaveIndex), '@jkos/weave barrel exports connectorPair');

// papyros's own binding stays a THIN wrapper (imports the generic panel; doesn't
// re-implement the search/candidate-list/apply flow itself).
const papyrosBinding = readFileSync(
  resolve(root, 'apps/papyros/src/views/book-detail/MatchPanel.tsx'), 'utf8',
);
check(/import\s*\{\s*MatchPanel as GenericMatchPanel\s*\}\s*from\s*['"]@jkos\/ui['"]/.test(papyrosBinding),
  "papyros's MatchPanel.tsx binds @jkos/ui's generic <MatchPanel> rather than re-implementing it");
const papyrosBindingLines = papyrosBinding.split('\n').length;
check(papyrosBindingLines <= 60,
  `papyros's MatchPanel.tsx stays a thin binding (${papyrosBindingLines} lines, expected <= 60 — a `
  + 'much bigger file would mean the search/apply flow got re-implemented locally again)');

// The old bespoke `.match-panel`/`.match-candidate*` rules are actually deleted
// from papyros's book-detail.css, not just shadowed by hub.css's new classes.
const bookDetailCss = readFileSync(resolve(root, 'apps/papyros/src/views/book-detail.css'), 'utf8');
check(
  !/^\.match-panel\b|^\.match-candidate/m.test(bookDetailCss),
  "book-detail.css no longer defines its own .match-panel/.match-candidate* rules (moved to hub.css's .jk-match-*)",
);

/* ── Routines: the cadence, the meters, and the streak ───────────────────────
 * The mint rules are covered end-to-end against a live server
 * (apps/beigeboard/backend/test/routines.smoke.mjs). What is tested HERE is the
 * reading side — the pure functions the board renders from — because they encode
 * three judgement calls that are easy to regress silently and impossible to see
 * in a screenshot: what a cell state means, what counts toward a week, and
 * whether today can break a streak. */
const routines = await importTs(
  'apps/beigeboard/src/lib/routines.ts', 'routines.mjs',
  { '@jkos/cards': 'datetime.mjs' },   // the only import; datetime.mjs is emitted above
);
const {
  cadenceDays, weeklyTarget, floatCount, toggleDay,
  weekCells, attainment, streakOf, getRoutines,
  firesAtAll, cadencePatch,
} = routines;

// The cadence encoding: offsets from Monday, sorted, de-duped, and TOLERANT — it
// drives a render, so a stray value must never place a cell in column 9.
check(JSON.stringify(cadenceDays({ cadence_days: '0,2,4' })) === '[0,2,4]', 'cadenceDays parses offsets');
check(JSON.stringify(cadenceDays({ cadence_days: '4,0,2' })) === '[0,2,4]', 'cadenceDays sorts');
check(JSON.stringify(cadenceDays({ cadence_days: '2,2' })) === '[2]', 'cadenceDays de-dupes');
check(JSON.stringify(cadenceDays({ cadence_days: '9,x,3' })) === '[3]', 'cadenceDays drops out-of-range junk');
check(JSON.stringify(cadenceDays({})) === '[]', 'cadenceDays of an unset routine is empty');

// toggleDay is the frontend's ONLY writer of that string — round-trip it.
check(toggleDay({ cadence_days: '0,2' }, 4) === '0,2,4', 'toggleDay adds a day in order');
check(toggleDay({ cadence_days: '0,2,4' }, 2) === '0,4', 'toggleDay removes a committed day');
check(toggleDay({ cadence_days: '' }, 6) === '6', 'toggleDay seeds an empty cadence');

// The target, and the float that is the surplus over the committed days.
check(weeklyTarget({ cadence_days: '0,2,4' }) === 3, 'weeklyTarget falls back to the committed days');
check(weeklyTarget({ cadence_days: '0,2,4', cadence_count: 5 }) === 5, 'weeklyTarget prefers the explicit count');
check(floatCount({ cadence_days: '0,2', cadence_count: 3 }) === 1, 'floatCount is the surplus over committed days');
check(floatCount({ cadence_days: '0,2,4', cadence_count: 2 }) === 0, 'floatCount never goes negative');

/* One routine, one week (Mon 2026-08-10 …), read on Wednesday the 12th. */
const R = { id: 7, kind: 'routine', title: 'Lift', cadence_days: '0,2,4', cadence_count: 4 };
const occ = (date, completed, extra = {}) => ({
  id: Math.random(), kind: 'task', parent_id: 7, completed,
  due_date: date, week_start: '2026-08-10', ext_ref: `routine:7:${date}`, ...extra,
});
const items = [
  R,
  occ('2026-08-10', true),    // Mon — kept
  occ('2026-08-12', false),   // Wed — today, still running
  occ('2026-08-14', false),   // Fri — future
  { id: 99, kind: 'task', parent_id: 7, completed: false, due_date: '2026-08-13', ext_ref: null },
];
const cells = weekCells(R, items, '2026-08-10', '2026-08-12');
check(cells.length === 7, 'weekCells is always seven cells');
check(cells[0].state === 'done', 'weekCells: a completed past occurrence is done');
check(cells[2].state === 'open', "weekCells: today's unticked occurrence is open, not missed");
check(cells[4].state === 'planned', 'weekCells: a future occurrence is planned');
check(cells[1].state === 'off', 'weekCells: an uncommitted empty day is off');
check(cells[3].state === 'off', 'weekCells: a hand-filed task under the routine is NOT an occurrence');
check(cells[2].isToday && !cells[2].isPast, 'weekCells marks today');
// A committed day whose occurrence was withdrawn reads as idle, not as missed —
// it was never scheduled, so nothing was missed.
const idle = weekCells({ ...R, cadence_days: '0,2,4,5' }, items, '2026-08-10', '2026-08-12');
check(idle[5].state === 'idle', 'weekCells: committed with nothing minted is idle');

// A past occurrence never ticked IS missed.
const missed = weekCells(R, [R, occ('2026-08-10', false)], '2026-08-10', '2026-08-12');
check(missed[0].state === 'missed', 'weekCells: an unticked past occurrence is missed');

// The week meter counts against the TARGET (4), not against the committed days.
const att = attainment(R, items, '2026-08-10');
check(att.done === 1 && att.target === 4, `attainment counts ticks over the weekly target (got ${att.done}/${att.target})`);
check(att.pct === 25, `attainment percent (got ${att.pct})`);
// A benched float that was done still counts — it is the routine being kept.
const withFloat = [...items, { id: 55, kind: 'task', parent_id: 7, completed: true, due_date: null, week_start: '2026-08-10', ext_ref: 'routine:7:2026-08-10#0' }];
check(attainment(R, withFloat, '2026-08-10').done === 2, 'attainment counts a completed float');

/* THE STREAK RULE: an open occurrence TODAY is a day still running, not a day
   missed. Getting this wrong makes every streak collapse each morning and rebuild
   each evening, which is the single thing that would make the meter useless. */
const streakItems = [R, occ('2026-08-10', true), occ('2026-08-11', true), occ('2026-08-12', false)];
check(streakOf(R, streakItems, '2026-08-12') === 2, "streakOf: today's open occurrence does not break the streak");
check(streakOf(R, [...streakItems.slice(0, 3), occ('2026-08-12', true)], '2026-08-12') === 3,
  'streakOf: ticking today extends it');
check(streakOf(R, [R, occ('2026-08-10', true), occ('2026-08-11', false), occ('2026-08-12', false)], '2026-08-12') === 0,
  'streakOf: a missed YESTERDAY does break it');
check(streakOf(R, [R], '2026-08-12') === 0, 'streakOf: no occurrences is no streak');

check(getRoutines(items).length === 1 && getRoutines(items)[0].id === 7, 'getRoutines picks only kind:routine');

/* ── PARKED BY ARITHMETIC ────────────────────────────────────────────────────
 * Emptying the schedule parks the routine and filling it resumes it, and the two
 * are the same rule read in two directions. The traps are both about what counts
 * as "empty": a FLOAT (an explicit count above the committed days) is a real plan
 * with no weekday in it, and every non-weekly rule fires without weekdays at all.
 * Parking either of those would silently stop a routine the user never touched. */
check(firesAtAll({ cadence_days: '0,2' }) === true, 'firesAtAll: committed weekdays fire');
check(firesAtAll({ cadence_days: '' }) === false, 'firesAtAll: no days and no count fires nothing');
check(firesAtAll({ cadence_days: '', cadence_count: 3 }) === true,
  'firesAtAll: a float — "3× a week, any day" — is a plan, not an empty schedule');
check(firesAtAll({ cadence_days: '', cadence_rule: 'every_n_days:3' }) === true,
  'firesAtAll: a non-weekly rule needs no weekday');

check(cadencePatch({ cadence_days: '0,2' }, { cadence_days: '' }).status === 'parked',
  'cadencePatch: dropping the last weekday parks the routine');
check(cadencePatch({ cadence_days: '', status: 'parked' }, { cadence_days: '3' }).status === 'active',
  'cadencePatch: committing a weekday resumes it');
check(cadencePatch({ cadence_days: '0,2', status: 'parked' }, { cadence_days: '0,2,4' }).status === undefined,
  'cadencePatch: a routine parked BY HAND stays parked — nothing about that edit changed whether it fires');
check(cadencePatch({ cadence_days: '0,2' }, { cadence_days: '0' }).status === undefined,
  'cadencePatch: writes status only when the answer flips');
check(cadencePatch({ cadence_days: '', cadence_count: 3 }, { cadence_count: 0 }).status === 'parked',
  'cadencePatch: the target stepper parks a float routine on the way to zero');
check(cadencePatch({ cadence_days: '' }, { cadence_rule: 'monthly:1' }).status === 'active',
  'cadencePatch: switching to a rule that fires resumes an empty weekly routine');
check(cadencePatch({ cadence_days: '' }, { cadence_days: '' }).cadence_days === '',
  'cadencePatch: passes the changes through untouched');

if (failed) {
  console.error(`\n✗ cards-logic: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ cards-logic: all assertions passed');

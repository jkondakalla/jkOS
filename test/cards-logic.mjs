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

// Transpile a self-contained .ts module to ESM and import it.
async function importTs(relPath, outName) {
  const src = readFileSync(resolve(root, relPath), 'utf8');
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

if (failed) {
  console.error(`\n✗ cards-logic: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ cards-logic: all assertions passed');

// pulsarmap.mjs — the pure math under the pulsarmap renderer (ALGORITHMS.md §9,
// TODO.md §2 block 8).
//
// ⚠️ WHY THIS GATE EXISTS. Every failure mode in `pulsarmap.ts` is SILENT. A
// reveal driven off a rounded row duration drifts 3 ms per row and is a whole row
// out by minute ten — which looks like a stylistic choice, not a bug. A pan that
// clamps wrong shows blank space below the newest row, and the picture appears to
// have stopped. A seek backwards that appends instead of repainting draws the
// second half of the song over the first. None of these throw, none log, and the
// only symptom is a picture that is subtly not about the song that is playing.
//
// The module is authored in TypeScript with no runtime imports, so this
// transpiles it in-memory with the repo's own `typescript` dep and drives the
// REAL functions — the house pattern, copied from test/cards-logic.mjs.
//
// Run:  node test/pulsarmap.mjs   (wired as `pnpm check:pulsarmap`, folded into
//                                   `pnpm test:contracts`).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-pulsarmap-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

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

const pm = await importTs('apps/kouros/src/components/pulsarmap.ts', 'pulsarmap.mjs');
const {
  MIN_ROW_PITCH, rowPitch, revealIndex, rowsRevealed, planReveal, emptyReveal,
  canvasHeight, rowBaseline, panOffset, rowPoints, toRows,
} = pm;

/* The mesh music/mesh.py actually builds at the baseline configuration. The row
   duration is DERIVED (86 frames of 512 samples at 22.05 kHz), not the 2.0 s
   target — and the gap between them is what this file exists to keep honest. */
const ROW_SECONDS = 1.9969160997732427;

/* ── revealIndex ──────────────────────────────────────────────────────────── */
check(revealIndex(0, ROW_SECONDS, 100) === 0,
  'revealIndex: row 0 is present from t=0, not 2 s in');
check(revealIndex(1.99, ROW_SECONDS, 100) === 0,
  'revealIndex: still row 0 just before the boundary');
check(revealIndex(2.0, ROW_SECONDS, 100) === 1,
  'revealIndex: row 1 has arrived just after 1.9969 s');
check(revealIndex(60, ROW_SECONDS, 100) === Math.floor(60 / ROW_SECONDS),
  'revealIndex: floor(currentTime / rowSeconds), plainly');

// ⚠️ THE DRIFT ASSERTION, and the reason `row_seconds` ships in the mesh at all.
// A renderer that used the 2.0 s TARGET instead of the derived duration agrees
// with this one for nine minutes and is a whole row out after ten.
{
  // The two disagree for a window after every row boundary, and the window is
  // proportional to elapsed time: 2 ms at row 1, and 1.85 SECONDS by row 600 —
  // most of a whole row, on a 20-minute track.
  check(revealIndex(1.998, ROW_SECONDS, 10000) === 1 && revealIndex(1.998, 2.0, 10000) === 0,
    'revealIndex: at 1.998 s the derived duration has already turned row 1 over and the ' +
    '2.0 s target has not — a 2 ms disagreement, one row in');
  check(revealIndex(1199, ROW_SECONDS, 10000) === 600 && revealIndex(1199, 2.0, 10000) === 599,
    'revealIndex: by 20 minutes the same disagreement is 1.85 s wide — nearly a whole row, ' +
    'which is why the mesh SHIPS row_seconds instead of the renderer assuming 2.0');
  // And the drift is one-directional, so it accumulates rather than averaging out.
  let ahead = 0;
  for (let t = 0; t < 1200; t += 0.25) {
    if (revealIndex(t, ROW_SECONDS, 10000) < revealIndex(t, 2.0, 10000)) ahead++;
  }
  check(ahead === 0,
    'revealIndex: the derived duration is never BEHIND the 2.0 s target — the error is ' +
    'one-directional and accumulates, which is what makes it invisible');
}

check(revealIndex(9999, ROW_SECONDS, 10) === 9,
  'revealIndex: clamps to the last row rather than running off the mesh');
check(revealIndex(-5, ROW_SECONDS, 100) === 0,
  'revealIndex: a negative time is row 0, not a negative index');
check(revealIndex(NaN, ROW_SECONDS, 100) === 0,
  'revealIndex: NaN is row 0 — an <audio> element reports it before metadata loads, ' +
  'which is a normal frame and not a fault');
check(revealIndex(10, ROW_SECONDS, 0) === -1,
  'revealIndex: a mesh with no rows reveals nothing');
check(revealIndex(10, 0, 100) === -1 && revealIndex(10, -1, 100) === -1,
  'revealIndex: a non-positive row duration reveals nothing rather than dividing by zero');
check(rowsRevealed(0, ROW_SECONDS, 100) === 1 && rowsRevealed(10, ROW_SECONDS, 0) === 0,
  'rowsRevealed: revealIndex + 1, and 0 for an empty mesh');

/* ── planReveal ───────────────────────────────────────────────────────────── */
const frame = (over) => ({ trackId: 7, currentTime: 0, rowSeconds: ROW_SECONDS, rows: 100, ...over });

{
  const plan = planReveal(emptyReveal(), frame({ currentTime: 0 }));
  check(plan.action === 'reset' && plan.clear === true && plan.from === 0 && plan.to === 1,
    'planReveal: a first frame is a reset — there is no canvas to append to');
}
{
  const state = { trackId: 7, painted: 4 };
  const plan = planReveal(state, frame({ currentTime: 4 * ROW_SECONDS + 0.1 }));
  check(plan.action === 'append' && plan.from === 4 && plan.to === 5 && plan.clear === false,
    'planReveal: time moving forward APPENDS the new rows only');
  check(plan.next.painted === 5, 'planReveal: …and carries the new count forward');
}
{
  // ⚠️ THE PAUSE CASE, and it is not special-cased. A paused element's
  // currentTime does not move, so the target does not move. A `paused` flag here
  // would be a second source of truth about whether time is passing.
  const state = { trackId: 7, painted: 5 };
  const plan = planReveal(state, frame({ currentTime: 4 * ROW_SECONDS + 0.1 }));
  check(plan.action === 'idle' && plan.from === plan.to && plan.clear === false,
    'planReveal: a paused frame draws nothing, without anything having to know it is paused');
  check(plan.next === state, 'planReveal: …and does not churn the state object');
}
{
  const state = { trackId: 7, painted: 40 };
  const plan = planReveal(state, frame({ currentTime: 5 * ROW_SECONDS }));
  check(plan.action === 'repaint' && plan.clear === true && plan.from === 0 && plan.to === 6,
    'planReveal: a seek BACKWARDS clears and repaints from row 0 — a canvas cannot un-draw');
}
{
  const state = { trackId: 7, painted: 40 };
  const plan = planReveal(state, frame({ trackId: 8, currentTime: 0 }));
  check(plan.action === 'reset' && plan.clear === true && plan.to === 1,
    'planReveal: a different track RESETS — the previous mesh is no longer the picture');
}
{
  // A track change to the same position must not be mistaken for a pause: the
  // rows are different rows even when the count is identical.
  const state = { trackId: 7, painted: 5 };
  const plan = planReveal(state, frame({ trackId: 8, currentTime: 4 * ROW_SECONDS + 0.1 }));
  check(plan.action === 'reset',
    'planReveal: a track change at the same offset is a reset, never an idle');
}
{
  // The append path must be exact: replaying a whole track one frame at a time
  // must paint every row exactly once and never repaint.
  let state = emptyReveal();
  let painted = 0, repaints = 0;
  for (let t = 0; t <= 100 * ROW_SECONDS; t += 0.05) {
    const plan = planReveal(state, frame({ currentTime: t }));
    if (plan.clear) repaints++;
    painted += plan.to - plan.from;
    state = plan.next;
  }
  check(repaints === 1 && painted === 100,
    `planReveal: a whole track paints each of its 100 rows exactly once after one initial ` +
    `clear (got ${painted} rows, ${repaints} clears) — this is the append-only property ` +
    `the whole renderer's cost model rests on`);
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */
check(rowPitch(4) === MIN_ROW_PITCH && rowPitch(20) === 20 && rowPitch(NaN) === MIN_ROW_PITCH,
  `rowPitch: clamps up to ${MIN_ROW_PITCH} px — below it M2 measured the stack collapsing ` +
  'into a uniform hatch, which reads as "the transform is broken"');
check(canvasHeight(0, 12, 40) === 80 && canvasHeight(1, 12, 40) === 80,
  'canvasHeight: one row still needs its own excursion room above and below');
check(canvasHeight(600, 9, 40) === 40 + 599 * 9 + 40,
  'canvasHeight: a 20-minute track is 5,471 px tall, which is why it pans rather than fits');
check(rowBaseline(0, 12, 40) === 40 && rowBaseline(3, 12, 40) === 76,
  'rowBaseline: row 0 sits one amplitude down, each later row one pitch further');

{
  // Early in a track the stack is shorter than the viewport: the offset must not
  // go negative and drag the picture off the top.
  check(panOffset(1, 600, 9, 40, 400, 320) === 0,
    'panOffset: clamps at 0 early on rather than pulling the picture off the top');
  // Mid-track the newest row sits exactly at the anchor.
  const mid = panOffset(200, 600, 9, 40, 400, 320);
  check(mid === rowBaseline(199, 9, 40) - 320,
    'panOffset: mid-track the newest row sits exactly at the anchor');
  // At the end it must not scroll past the canvas — blank space below the newest
  // row is the frame in which the picture appears to have stopped.
  const end = panOffset(600, 600, 9, 40, 400, 320);
  check(end === canvasHeight(600, 9, 40) - 400,
    'panOffset: clamps at the canvas end rather than scrolling into blank space');
  check(end >= mid, 'panOffset: is monotonic as the reveal advances');
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */
{
  const bytes = new Uint8Array(3 * 4).map((_, i) => i * 10);
  const rows = toRows(bytes, 3, 4);
  check(rows.length === 3 && rows[1][0] === 40,
    'toRows: row-major, so row 1 starts at byte 4');
  let threw = false;
  try { toRows(new Uint8Array(5), 3, 4); } catch { threw = true; }
  check(threw,
    'toRows: a length that does not match the declared shape THROWS — reshaping a short ' +
    'buffer against a remembered row count is a picture with a wrapped time axis');
}
{
  const pts = rowPoints(new Uint8Array([0, 255, 0]), 100, 200, 40);
  check(pts.length === 6, 'rowPoints: two numbers per band');
  check(pts[0] === 0 && pts[2] === 100 && pts[4] === 200,
    'rowPoints: bands span the full width, first at 0 and last at width');
  check(pts[1] === 100 && pts[3] === 60,
    'rowPoints: 0 sits on the baseline and 255 is a full amplitude above it');

  // ⚠️ THE THIRD PLACE A PER-TRACK NORMALISER COULD ENTER — after the builder and
  // the quantiser, and the only one that leaves the stored bytes correct. A quiet
  // row and a loud row must draw at different heights against the SAME span.
  const quiet = rowPoints(new Uint8Array([60, 60]), 100, 200, 40);
  const loud = rowPoints(new Uint8Array([200, 200]), 100, 200, 40);
  check(quiet[1] > loud[1],
    'rowPoints: a quiet row draws lower than a loud one — nothing here rescales per row, ' +
    'which is the one edit that would make the whole picture meaningless');
  check(rowPoints(new Uint8Array([]), 100, 200, 40).length === 0,
    'rowPoints: an empty row is an empty polyline, not a crash');
}

/* ── The purity contract ──────────────────────────────────────────────────────
   The module is transpiled and imported in isolation above, so a runtime import
   would already have failed. This asserts the OTHER half: that nothing in it
   reaches for a clock. `setInterval` desynchronises on buffering, on seek, and on
   a playback-rate change, and packages/player has a rate module — so this is not
   a hypothetical. */
{
  const src = readFileSync(resolve(root, 'apps/kouros/src/components/pulsarmap.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['setInterval', 'setTimeout', 'Date.now', 'performance.now',
                        'requestAnimationFrame']) {
    check(!src.includes(banned),
      `purity: pulsarmap.ts holds no ${banned} — the reveal is driven by currentTime, ` +
      'per animation frame, by its caller');
  }
  check(!/^import\s/m.test(src) || /^import type\s/m.test(src),
    'purity: no runtime imports, so this gate can transpile the one file in isolation');
}

if (failed) {
  console.error(`\n✗ pulsarmap: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ pulsarmap: all assertions passed');

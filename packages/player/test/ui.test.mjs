// ui.test.mjs — unit tests for @jkos/player/ui's PURE layer (Wave 16, item 16.6).
// Covers:
//   1. src/ui/scrub.ts — the math under the kit components: segmentFraction
//      (BookDetail.tsx's chapterFraction lifted verbatim), segmentWindow (the
//      PlayerBar chapter-bracketing math), formatRate, and the QueuePanel drop-index
//      pair (insertionSlot/reorderTarget, whose output feeds core/queue's reorder).
//   2. a token-hygiene scan of src/ui/player-ui.css — the kit sheet must follow the
//      design-factory rule (no hardcoded hex colours, every font-family a --hub
//      token) and must not leak app-specific selectors back in.
//
// Node has no TS runner here, so this transpiles the ONE self-contained pure module
// in-memory with the repo's own `typescript` dep (scrub.ts's only import is
// type-only, erased by transpileModule) and imports the REAL functions — the house
// pattern, copied from test/core.test.mjs.
//
// Run:  node packages/player/test/ui.test.mjs
//       (auto-enumerated by packages/player/scripts/run-tests.mjs → `pnpm --filter
//        @jkos/player test`, chained into the root `pnpm test:contracts`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-ui-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

const { segmentFraction, segmentWindow, formatRate, insertionSlot, reorderTarget } =
  await importTs('src/ui/scrub.ts', 'scrub.mjs');

/* ── segmentFraction (chapterFraction verbatim) ────────────────────────────── */
check(segmentFraction(10, 20, 5) === 0, 'segmentFraction: position before the segment → 0');
check(segmentFraction(10, 20, 10) === 0, 'segmentFraction: position exactly at start → 0');
check(segmentFraction(10, 20, 15) === 0.5, 'segmentFraction: mid-segment → fractional');
check(segmentFraction(10, 20, 20) === 1, 'segmentFraction: position exactly at end → 1');
check(segmentFraction(10, 20, 99) === 1, 'segmentFraction: position past the segment → 1');
check(segmentFraction(10, 10, 10) === 0, 'segmentFraction: zero-length segment never divides (start-check wins → 0)');
check(segmentFraction(10, 10, 11) === 1, 'segmentFraction: zero-length segment, position past → 1');
check(segmentFraction(10, 10, 9) === 0, 'segmentFraction: zero-length segment, position before → 0');

/* ── segmentWindow (the PlayerBar chapter-bracketing math) ─────────────────── */
const pts = [
  { start: 0, end: 100, title: 'Ch 1' },
  { start: 100, end: 250, title: 'Ch 2' },
  { start: 250, end: 400, title: 'Ch 3' },
];

check(deepEq(segmentWindow(pts, 1, 400, 160), { start: 100, length: 150, pos: 60 }),
  'segmentWindow: brackets the current segment (start/length) with a segment-local pos');
check(deepEq(segmentWindow(pts, 0, 400, 0), { start: 0, length: 100, pos: 0 }),
  'segmentWindow: first segment at position 0');
check(segmentWindow(pts, 1, 400, 50).pos === 0,
  'segmentWindow: position before the segment clamps its local pos to 0');
check(segmentWindow(pts, 1, 400, 300).pos === 150,
  'segmentWindow: position past the segment clamps its local pos to the length');
check(deepEq(segmentWindow(pts, -1, 400, 160), { start: 0, length: 400, pos: 160 }),
  'segmentWindow: currentIndex -1 falls back to the whole [0, total] timeline');
check(deepEq(segmentWindow(pts, 7, 400, 160), { start: 0, length: 400, pos: 160 }),
  'segmentWindow: out-of-range currentIndex falls back to the whole timeline');
check(deepEq(segmentWindow([], 0, 400, 160), { start: 0, length: 400, pos: 160 }),
  'segmentWindow: no points falls back to the whole timeline');
check(deepEq(segmentWindow([], -1, 0, 5), { start: 0, length: 0, pos: 0 }),
  'segmentWindow: empty timeline (total 0) yields a zero window with pos clamped');
check(segmentWindow(pts, 2, 400, 400).pos === 150,
  'segmentWindow: end-of-book position sits at the last segment\'s full length');

/* ── formatRate (the rate button's face, verbatim) ─────────────────────────── */
check(formatRate(1) === '1×', "formatRate(1) === '1×'");
check(formatRate(2) === '2×', "formatRate(2) === '2×'");
check(formatRate(1.25) === '1.25×', "formatRate(1.25) === '1.25×'");
check(formatRate(0.75) === '0.75×', "formatRate(0.75) === '0.75×'");

/* ── insertionSlot / reorderTarget (QueuePanel drop math → core/queue.reorder) ── */
const rows = [
  { top: 0, bottom: 40 },    // mid 20
  { top: 40, bottom: 80 },   // mid 60
  { top: 80, bottom: 120 },  // mid 100
];
check(insertionSlot(rows, -50) === 0, 'insertionSlot: above every row → slot 0');
check(insertionSlot(rows, 19) === 0, 'insertionSlot: above the first midpoint → slot 0');
check(insertionSlot(rows, 21) === 1, 'insertionSlot: just below the first midpoint → slot 1');
check(insertionSlot(rows, 99) === 2, 'insertionSlot: above the last midpoint → slot 2');
check(insertionSlot(rows, 500) === 3, 'insertionSlot: below every row → slot n (append)');
check(insertionSlot(rows, 60) === 2, 'insertionSlot: dead on a midpoint resolves after it (strict <)');
check(insertionSlot([], 10) === 0, 'insertionSlot: no rows → slot 0');

check(reorderTarget(0, 3) === 2, 'reorderTarget: slot past the dragged row shifts down one');
check(reorderTarget(2, 0) === 0, 'reorderTarget: slot before the dragged row is used as-is');
check(reorderTarget(1, 1) === 1, 'reorderTarget: slot at the dragged row → no-move (=== from)');
check(reorderTarget(1, 2) === 1, 'reorderTarget: slot immediately after the dragged row → no-move');

// The pair must speak core/queue.reorder's remove-then-insert indexing: dragging
// row 0 to the very bottom of 3 rows must land on canonical index 2 (not 3).
check(reorderTarget(0, insertionSlot(rows, 500)) === 2,
  'insertionSlot∘reorderTarget: drag first row below everything → last canonical index');
check(reorderTarget(2, insertionSlot(rows, -50)) === 0,
  'insertionSlot∘reorderTarget: drag last row above everything → index 0');

/* ── player-ui.css token hygiene (the design-factory header rule) ──────────── */
const css = readFileSync(resolve(root, 'src/ui/player-ui.css'), 'utf8');
const decls = css.replace(/\/\*[\s\S]*?\*\//g, ''); // comments may mention anything

check(!/#[0-9a-fA-F]{3,8}\b/.test(decls), 'player-ui.css: no hardcoded hex colours (tokens only)');
const fontDecls = [...decls.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]);
check(fontDecls.length > 0 && fontDecls.every((v) => v.includes('var(--hub-font-')),
  'player-ui.css: every font-family reads a --hub-font token');
check(!/papyros/i.test(decls), 'player-ui.css: no app-specific selectors leaked into the kit sheet');
check(/\.player-bar\s*\{/.test(decls) && /\.pb-btn\s*\{/.test(decls) && /\.pb-scrubber\s*\{/.test(decls),
  'player-ui.css: ships the shell, button, and scrubber rules the kit components class against');

/* ── summary ───────────────────────────────────────────────────────────────── */
console.log('─'.repeat(40));
if (failed) {
  console.error(`✗ ui.test.mjs: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ ui.test.mjs: all assertions passed');

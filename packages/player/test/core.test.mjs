// core.test.mjs — unit tests for @jkos/player/core (Wave 15, item 15.1). Covers:
//   1. the timeline math lifted VERBATIM from apps/papyros/src/player/position.ts
//      (renamed BookFile→MediaSource, BookChapter→Segment, FileMap→Timeline) — the
//      float-boundary edge cases the original module's comments call out by name.
//   2. every pure Queue reducer (next/prev/shuffle/repeat/reorder/insertNext/append),
//      including the shuffle-stability property (same seed ⇒ same order, and a skip
//      never re-rolls it) and the repeat-mode edges.
//
// Node has no TS runner here, so this transpiles the two self-contained pure
// modules in-memory with the repo's own `typescript` dep (ts.transpileModule strips
// types; both modules are self-contained TS with no runtime imports) and imports
// the REAL functions — the house pattern, copied from test/cards-logic.mjs.
//
// Run:  node packages/player/test/core.test.mjs
//       (wired via packages/player/scripts/run-tests.mjs → `pnpm --filter @jkos/player test`,
//        chained into the root `pnpm test:contracts`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-core-'));

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

const timeline = await importTs('src/core/timeline.ts', 'timeline.mjs');
const queueMod = await importTs('src/core/queue.ts', 'queue.mjs');

/* ── buildTimeline ─────────────────────────────────────────────────────── */
const { buildTimeline, EMPTY_TIMELINE, locate, toGlobal, navPoints, currentNav, clamp, fmtClock } = timeline;

check(deepEq(buildTimeline([]), EMPTY_TIMELINE), 'buildTimeline([]) === EMPTY_TIMELINE shape');

const src3 = [
  { index: 2, duration: 30 },
  { index: 0, duration: 10 },
  { index: 1, duration: 20 },
];
const t3 = buildTimeline(src3);
check(t3.sources.map((s) => s.index).join(',') === '0,1,2', 'buildTimeline sorts defensively by .index');
check(deepEq(t3.starts, [0, 10, 30]), 'buildTimeline computes cumulative starts');
check(t3.total === 60, 'buildTimeline total sums all durations');

const tNeg = buildTimeline([{ index: 0, duration: -5 }, { index: 1, duration: 10 }]);
check(tNeg.starts[0] === 0 && tNeg.starts[1] === 0 && tNeg.total === 10, 'buildTimeline clamps a negative duration to 0');

const tMissing = buildTimeline([{ index: 0 }, { index: 1, duration: 10 }]);
check(tMissing.total === 10, 'buildTimeline treats a missing duration as 0');

/* ── locate ────────────────────────────────────────────────────────────── */
const emptyLoc = locate(EMPTY_TIMELINE, 5);
check(deepEq(emptyLoc, { arrayIndex: 0, sourceIndex: 0, offset: 0 }), 'locate on an empty timeline is the zero position');

check(deepEq(locate(t3, -100), { arrayIndex: 0, sourceIndex: 0, offset: 0 }), 'locate clamps a negative position to 0');
check(deepEq(locate(t3, 15), { arrayIndex: 1, sourceIndex: 1, offset: 5 }), 'locate finds the mid-source offset');
// Boundary rule: exactly on a start belongs to the LATER source at offset 0.
check(deepEq(locate(t3, 10), { arrayIndex: 1, sourceIndex: 1, offset: 0 }), 'locate at an exact boundary lands on the later source, offset 0');
check(deepEq(locate(t3, 30), { arrayIndex: 2, sourceIndex: 2, offset: 0 }), 'locate at the second boundary lands on source 2, offset 0');
// Past total clamps to the last source at offset === its own duration.
check(deepEq(locate(t3, 999), { arrayIndex: 2, sourceIndex: 2, offset: 30 }), 'locate past total clamps to the last source at its own duration');
check(deepEq(locate(t3, 0), { arrayIndex: 0, sourceIndex: 0, offset: 0 }), 'locate at 0 lands on the first source');

/* ── toGlobal (inverse of locate) ──────────────────────────────────────── */
check(toGlobal(t3, 1, 5) === 15, 'toGlobal is the inverse of locate for a mid-source offset');
check(toGlobal(t3, 0, 0) === 0, 'toGlobal at the first source, offset 0, is 0');
check(toGlobal(t3, -1, 5) === 0, 'toGlobal rejects a negative arrayIndex');
check(toGlobal(t3, 99, 5) === 0, 'toGlobal rejects an out-of-range arrayIndex');
check(toGlobal(t3, 1, -50) === 10, 'toGlobal clamps a negative offset to 0');

/* ── navPoints / currentNav ────────────────────────────────────────────── */
const segs = [
  { start: 20, end: 60, title: 'Ch2' },
  { start: 0, end: 20, title: 'Ch1' },
];
const withSegs = navPoints(t3, segs);
check(withSegs[0].title === 'Ch1' && withSegs[1].title === 'Ch2', 'navPoints sorts real segments by start');

const noSegs = navPoints(t3, []);
check(noSegs.length === 3 && noSegs[1].title === 'Track 2', 'navPoints falls back to one entry per source, titled by source.index+1');
check(deepEq(noSegs.map((p) => p.start), [0, 10, 30]), 'navPoints per-source fallback is gap-free across sources');

check(currentNav(withSegs, 0) === 0, 'currentNav at 0 is the first point');
check(currentNav(withSegs, 25) === 1, 'currentNav mid-second-segment is index 1');
check(currentNav(withSegs, 19.998) === 0, 'currentNav respects the 1e-3 epsilon just before a boundary');
check(currentNav(withSegs, 19.9995) === 1, 'currentNav respects the 1e-3 epsilon just after a boundary (pos + 1e-3 already crosses)');
check(currentNav([], 5) === 0, 'currentNav on an empty point list is 0');

/* ── clamp / fmtClock ──────────────────────────────────────────────────── */
check(clamp(5, 0, 10) === 5 && clamp(-5, 0, 10) === 0 && clamp(50, 0, 10) === 10, 'clamp bounds correctly');
check(fmtClock(65) === '1:05', 'fmtClock under an hour omits the hour digit');
check(fmtClock(3661) === '1:01:01', 'fmtClock past an hour includes it');
check(fmtClock(59) === '0:59', 'fmtClock seconds under a minute');
check(fmtClock(-10) === '0:00', 'fmtClock clamps a negative input to 0:00');
check(fmtClock(NaN) === '0:00', 'fmtClock treats NaN as 0:00');

/* ══════════════════════════════════════════════════════════════════════ *
 * Queue reducers
 * ══════════════════════════════════════════════════════════════════════ */
const { createQueue, EMPTY_QUEUE, next, prev, shuffle, repeat, reorder, insertNext, append } = queueMod;

/* ── createQueue / empty-queue invariant ──────────────────────────────── */
check(EMPTY_QUEUE.items.length === 0 && EMPTY_QUEUE.cursor === -1, 'EMPTY_QUEUE has no items and cursor -1');
const q0 = createQueue([]);
check(q0.cursor === -1, 'createQueue([]) starts at cursor -1');
const q1 = createQueue(['a']);
check(q1.cursor === 0, 'createQueue with one item starts at cursor 0');

/* ── next / prev: empty queue ─────────────────────────────────────────── */
check(next(EMPTY_QUEUE).cursor === -1, 'next() on an empty queue is a no-op');
check(prev(EMPTY_QUEUE).cursor === -1, 'prev() on an empty queue is a no-op');

/* ── next / prev: single item ─────────────────────────────────────────── */
check(next(q1).cursor === 0, 'next() on a single-item queue (repeat off) stays put');
check(prev(q1).cursor === 0, 'prev() on a single-item queue (repeat off) stays put');
const q1all = repeat(q1, 'all');
check(next(q1all).cursor === 0, 'next() on a single-item queue (repeat all) wraps to itself');
check(prev(q1all).cursor === 0, 'prev() on a single-item queue (repeat all) wraps to itself');

/* ── next / prev: multi-item, cursor-at-ends ──────────────────────────── */
const q5 = createQueue(['a', 'b', 'c', 'd', 'e']);
check(next(q5).cursor === 1, 'next() advances the cursor by one');
check(prev({ ...q5, cursor: 3 }).cursor === 2, 'prev() retreats the cursor by one');
const atStart = q5; // cursor 0
check(prev(atStart).cursor === 0, 'prev() at the start (repeat off) stays on the first item');
const atEnd = { ...q5, cursor: 4 };
check(next(atEnd).cursor === 4, 'next() at the end (repeat off) stays on the last item');

/* ── repeat-all wraparound ────────────────────────────────────────────── */
const q5all = repeat(q5, 'all');
check(next({ ...q5all, cursor: 4 }).cursor === 0, 'repeat-all next() at the end wraps to the first item');
check(prev({ ...q5all, cursor: 0 }).cursor === 4, 'repeat-all prev() at the start wraps to the last item');

/* ── repeat-one ────────────────────────────────────────────────────────── */
const q5one = repeat(q5, 'one');
check(next({ ...q5one, cursor: 2 }).cursor === 2, 'repeat-one next() stays on the same item');
check(prev({ ...q5one, cursor: 2 }).cursor === 2, 'repeat-one prev() stays on the same item');

/* ── shuffle: stability property ──────────────────────────────────────── */
const base5 = createQueue(['a', 'b', 'c', 'd', 'e']);
const sh1 = shuffle(base5, true, 42);
const sh2 = shuffle(base5, true, 42);
check(deepEq(sh1.policy.shuffleOrder, sh2.policy.shuffleOrder), 'shuffle: same seed on the same queue ⇒ identical order');
check(sh1.policy.shuffleOrder.length === 5, 'shuffle order length matches item count');
check(
  deepEq([...sh1.policy.shuffleOrder].sort((a, b) => a - b), [0, 1, 2, 3, 4]),
  'shuffle order is a true permutation of every canonical index',
);

const shOther = shuffle(base5, true, 7);
check(!deepEq(sh1.policy.shuffleOrder, shOther.policy.shuffleOrder) || sh1.policy.shuffleOrder.length <= 1, 'shuffle: a different seed (usually) yields a different order');

// Skip must NOT re-roll: several next()/prev() calls leave shuffleOrder untouched.
let walked = sh1;
const orderBefore = [...walked.policy.shuffleOrder];
walked = next(walked);
walked = next(walked);
walked = prev(walked);
check(deepEq(walked.policy.shuffleOrder, orderBefore), 'shuffle: repeated skips never re-roll the permutation');
check(walked.policy.shuffleSeed === 42, 'shuffle: seed is preserved across skips');

// Re-enabling shuffle with the SAME seed while already on is idempotent (no re-roll).
const reEnabled = shuffle(walked, true, 42);
check(deepEq(reEnabled.policy.shuffleOrder, orderBefore), 'shuffle: re-enabling with the same seed does not re-roll');

// A NEW seed explicitly re-rolls.
const reseeded = shuffle(walked, true, 99);
check(reseeded.policy.shuffleSeed === 99, 'shuffle: an explicit new seed updates policy.shuffleSeed');

/* ── shuffle off restores canonical order, keeps cursor ───────────────── */
let sq = shuffle(base5, true, 5);
sq = next(sq);
sq = next(sq); // cursor now somewhere in the shuffled walk, NOT necessarily 2
const cursorUnderShuffle = sq.cursor;
const itemsUnderShuffle = [...sq.items];
const off = shuffle(sq, false);
check(off.policy.shuffle === false, 'shuffle(off) flips policy.shuffle to false');
check(off.cursor === cursorUnderShuffle, 'shuffle(off) keeps the current item as cursor (no translation needed)');
check(deepEq(off.items, itemsUnderShuffle), 'shuffle(off) never touched canonical item order');

/* ── shuffle: single-item and empty queue don't blow up ───────────────── */
check(deepEq(shuffle(EMPTY_QUEUE, true, 1).policy.shuffleOrder, []), 'shuffle on an empty queue yields an empty order');
check(deepEq(shuffle(createQueue(['solo']), true, 1).policy.shuffleOrder, [0]), 'shuffle on a single-item queue is [0]');

/* ── reorder ───────────────────────────────────────────────────────────── */
const rq = createQueue(['a', 'b', 'c', 'd', 'e']); // cursor 0 ('a')

// cursor === from: cursor follows the moved item.
const r1 = reorder(rq, 0, 3);
check(deepEq(r1.items, ['b', 'c', 'd', 'a', 'e']), 'reorder moves the item from index 0 to 3');
check(r1.cursor === 3, 'reorder: cursor follows its own item when the moved item IS the cursor');

// from < cursor <= to (forward move passes over the cursor): cursor shifts down by 1.
const r2 = reorder({ ...rq, cursor: 2 }, 1, 3); // move 'b'(1) to 3; cursor was on 'c'(2)
check(deepEq(r2.items, ['a', 'c', 'd', 'b', 'e']), 'reorder forward move shifts intervening items');
check(r2.cursor === 1, 'reorder: cursor shifts down by 1 when a forward move passes over it');

// to <= cursor < from (backward move passes over the cursor): cursor shifts up by 1.
const r3 = reorder({ ...rq, cursor: 1 }, 3, 0); // move 'd'(3) to 0; cursor was on 'b'(1)
check(deepEq(r3.items, ['d', 'a', 'b', 'c', 'e']), 'reorder backward move shifts intervening items');
check(r3.cursor === 2, 'reorder: cursor shifts up by 1 when a backward move passes over it');

// cursor unrelated to the move: unchanged.
const r4 = reorder({ ...rq, cursor: 4 }, 0, 1); // move 'a' to 1; cursor on 'e'(4), untouched
check(r4.cursor === 4, 'reorder: cursor unaffected when the move does not cross it');

// out-of-range / no-op.
check(deepEq(reorder(rq, 0, 0).items, rq.items), 'reorder(from === to) is a no-op');
check(deepEq(reorder(rq, -1, 2).items, rq.items), 'reorder rejects an out-of-range "from"');
check(deepEq(reorder(rq, 1, 99).items, rq.items), 'reorder rejects an out-of-range "to"');

// reorder resyncs shuffleOrder to stay a valid permutation of the new length.
const rShuffled = shuffle(rq, true, 3);
const rReordered = reorder(rShuffled, 0, 4);
check(rReordered.policy.shuffleOrder.length === 5, 'reorder resyncs shuffleOrder length after a structural change');
check(
  deepEq([...rReordered.policy.shuffleOrder].sort((a, b) => a - b), [0, 1, 2, 3, 4]),
  'reorder-resynced shuffleOrder is still a true permutation',
);

/* ── insertNext ────────────────────────────────────────────────────────── */
check(deepEq(insertNext(EMPTY_QUEUE, 'x'), createQueue(['x'])), 'insertNext into an empty queue makes it the sole item and cursor');

const iq = createQueue(['a', 'b', 'c']); // cursor 0
const iq2 = insertNext(iq, 'X');
check(deepEq(iq2.items, ['a', 'X', 'b', 'c']), 'insertNext inserts right after the cursor');
check(iq2.cursor === 0, 'insertNext never moves the cursor (insertion is strictly after it)');

const iqMid = { ...iq, cursor: 2 }; // cursor on 'c' (last)
const iqMid2 = insertNext(iqMid, 'Y');
check(deepEq(iqMid2.items, ['a', 'b', 'c', 'Y']), 'insertNext after the last item appends');
check(iqMid2.cursor === 2, 'insertNext keeps the cursor when inserting after the last item');

/* ── append ────────────────────────────────────────────────────────────── */
check(deepEq(append(EMPTY_QUEUE, 'x'), createQueue(['x'])), 'append to an empty queue makes it the sole item and cursor');
const aq = createQueue(['a', 'b']);
const aq2 = append(aq, 'Z');
check(deepEq(aq2.items, ['a', 'b', 'Z']), 'append adds to the end of canonical order');
check(aq2.cursor === 0, 'append never moves the cursor');

/* ── repeat() ──────────────────────────────────────────────────────────── */
check(repeat(rq, 'all').policy.repeat === 'all', 'repeat() sets the policy mode');
check(deepEq(repeat(rq, 'all').items, rq.items) && repeat(rq, 'all').cursor === rq.cursor, 'repeat() does not touch items/cursor');

if (failed) {
  console.error(`\n✗ player/core: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ player/core: all assertions passed');

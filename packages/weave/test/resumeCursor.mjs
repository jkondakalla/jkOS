// packages/weave/test/resumeCursor.mjs — unit tests for createResumeCursor
// (src/resumeCursor.ts, ToDo.md §3 Wave 16 item 16.4): the debounced find-or-create
// upsert extracted from the player engine's [INVARIANT d]. Every rule here was a real
// production bug once, which is why each gets its own assertion:
//   debounce-one-window · fresh-snapshot-at-write · skip-unchanged ·
//   serialized single-flight + queued-latest · find-or-create row tracking ·
//   the OUTGOING-KEY guard (a late write for a swapped-away key is dropped) ·
//   swallowed failures retry · invalidateLastWritten (the seek idiom) · dispose.
//
// House pattern: transpile the REAL .ts in-memory and drive the real function
// (copied from test/cards-logic.mjs / packages/player/test/engine.test.mjs).
// resumeCursor.ts is import-free (pure setTimeout logic), so no stubs are needed.
//
// Run:  node "packages/weave/test/resumeCursor.mjs"   (chained into
//       `pnpm --filter @jkos/weave test` → root `pnpm test:contracts`).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-weave-resumecursor-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const { createResumeCursor } = await importTs('src/resumeCursor.ts', 'resumeCursor.mjs');
check(typeof createResumeCursor === 'function', 'createResumeCursor transpiles and exports');

// A recording store. Rows are { rowId, itemId, position, finished } — itemIdOf reads
// .itemId, mirroring how a real adapter owns its own column names. `nextResult` lets a
// test hand back a pending promise (single-flight tests) or a rejection (retry tests).
function makeStore() {
  let rowSeq = 0;
  const calls = [];   // { op: 'create'|'update', row?, write }
  const store = {
    calls,
    nextResult: null,   // when set, the next create/update returns it INSTEAD (then clears)
    find: async () => null,   // the core never calls find(); the caller resolves rows itself
    create(write) { calls.push({ op: 'create', write }); return store._result(write); },
    update(row, write) { calls.push({ op: 'update', row, write }); return store._result(write); },
    itemIdOf: (row) => row.itemId,
    _result(write) {
      if (store.nextResult) { const r = store.nextResult; store.nextResult = null; return r; }
      return Promise.resolve({ rowId: ++rowSeq, itemId: write.itemId, position: write.position, finished: write.finished });
    },
  };
  return store;
}

const DEBOUNCE = 25;   // short real-timer window; every wait leaves a 2x+ margin

/* ══════════════════════════════════════════════════════════════════════ *
 * 1 · debounce window + fresh-snapshot pull
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 10, duration: 100 };
  const cursor = createResumeCursor(store, () => ({ ...snap }), { debounceMs: DEBOUNCE });

  cursor.schedule();
  snap.position = 42;          // moves DURING the window
  cursor.schedule();           // second call mid-window must be a no-op
  await sleep(DEBOUNCE * 3);
  check(store.calls.length === 1, 'one armed window → exactly one write despite two schedule() calls');
  check(store.calls[0].op === 'create', 'first write with no tracked row is a create');
  check(store.calls[0].write.position === 42, 'the write reads the snapshot FRESH at fire time (42, not 10)');
  check(store.calls[0].write.itemId === 'A' && store.calls[0].write.duration === 100, 'write carries itemId + duration from the snapshot');
  check(!Number.isNaN(Date.parse(store.calls[0].write.playedAt)), 'playedAt is a parseable ISO timestamp');

  // The created row was adopted (same live key at completion) → next write UPDATEs.
  snap.position = 50;
  cursor.flush();
  await sleep(DEBOUNCE);
  check(store.calls.length === 2 && store.calls[1].op === 'update', 'after a successful create the row is adopted → next write updates');
  check(store.calls[1].row.rowId === 1, 'the update targets the row the create returned');
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 2 · skip-unchanged + invalidateLastWritten (the seek idiom)
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 7, duration: 100 };
  const cursor = createResumeCursor(store, () => ({ ...snap }), { debounceMs: DEBOUNCE });

  cursor.flush();
  await sleep(DEBOUNCE);
  cursor.flush();              // same floor(position) + finished → must skip
  await sleep(DEBOUNCE);
  check(store.calls.length === 1, 'a write with unchanged floor(position)+finished is skipped');

  snap.position = 7.9;         // same integer second
  cursor.flush();
  await sleep(DEBOUNCE);
  check(store.calls.length === 1, 'skip-unchanged compares FLOOR seconds (7.9 ≡ 7)');

  cursor.invalidateLastWritten();
  cursor.flush();
  await sleep(DEBOUNCE);
  check(store.calls.length === 2, 'invalidateLastWritten forces the same position to persist again');

  cursor.flush(true);          // same position but finished flips → not "unchanged"
  await sleep(DEBOUNCE);
  check(store.calls.length === 3 && store.calls[2].write.finished === true, 'a changed finished-flag is never skipped; flush(true) writes finished');
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 3 · flush cancels the pending window (no double write)
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 3, duration: 100 };
  const cursor = createResumeCursor(store, () => ({ ...snap }), { debounceMs: DEBOUNCE });

  cursor.schedule();
  cursor.flush();              // immediate write, timer cancelled
  await sleep(DEBOUNCE * 3);   // well past where the armed window would have fired
  check(store.calls.length === 1, 'flush() mid-window writes once — the armed timer is cancelled, not doubled');
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 4 · serialized single-flight + queued-latest finished-flag
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 11, duration: 100 };
  const cursor = createResumeCursor(store, () => ({ ...snap }), { debounceMs: DEBOUNCE });

  let release;
  store.nextResult = new Promise((r) => { release = () => r({ rowId: 99, itemId: 'A', position: 11, finished: false }); });
  cursor.flush();              // write #1 hangs in flight
  snap.position = 60;
  cursor.flush(false);         // queued
  cursor.flush(true);          // re-queued — only the LATEST finished-flag survives
  check(store.calls.length === 1, 'a write requested mid-flight is queued, not raced (one call so far)');

  release();
  await sleep(DEBOUNCE);
  check(store.calls.length === 2, 'the queued write runs exactly once after the in-flight one resolves');
  check(store.calls[1].write.finished === true, 'the queued write carries the LATEST finished-flag (true)');
  check(store.calls[1].write.position === 60, 'the queued write re-pulls the snapshot (fresh position 60)');
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 5 · OUTGOING-KEY guard — a late write for a swapped-away key is dropped
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 20, duration: 100 };
  const cursor = createResumeCursor(store, () => (snap.itemId == null ? null : { ...snap }), { debounceMs: DEBOUNCE });

  let release;
  store.nextResult = new Promise((r) => { release = () => r({ rowId: 7, itemId: 'A', position: 20, finished: false }); });
  cursor.flush();              // create for key A, in flight
  snap.itemId = 'B';           // the caller moved on BEFORE the store resolved
  snap.position = 5;
  release();
  await sleep(DEBOUNCE);
  check(store.calls.length === 1, 'no immediate extra write while swapping');

  cursor.flush();              // now writing for B
  await sleep(DEBOUNCE);
  const last = store.calls[store.calls.length - 1];
  check(store.calls.length === 2 && last.op === 'create', "A's late row was NOT adopted — B's first write is a create, not an update of A's row");
  check(last.write.itemId === 'B', "the new write is keyed to B");
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 6 · null snapshot is a no-op; resetItem clears row + last-written; setRow adopts
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: null, position: 0, duration: 0 };
  const cursor = createResumeCursor(store, () => (snap.itemId == null ? null : { ...snap }), { debounceMs: DEBOUNCE });

  cursor.flush();
  await sleep(DEBOUNCE);
  check(store.calls.length === 0, 'a null snapshot (no live key) makes the write a silent no-op');

  snap.itemId = 'A'; snap.position = 9; snap.duration = 100;
  cursor.setRow({ rowId: 55, itemId: 'A', position: 2, finished: false });
  cursor.flush();
  await sleep(DEBOUNCE);
  check(store.calls.length === 1 && store.calls[0].op === 'update' && store.calls[0].row.rowId === 55,
    'setRow adopts an externally-resolved row — the first write UPDATEs it');

  cursor.resetItem();
  cursor.flush();              // same position — but resetItem cleared last-written too
  await sleep(DEBOUNCE);
  const last = store.calls[store.calls.length - 1];
  check(store.calls.length === 2 && last.op === 'create',
    'resetItem clears the tracked row AND last-written — the next write creates and is not skipped');
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 7 · a failed store call is swallowed and the next attempt retries
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 33, duration: 100 };
  const cursor = createResumeCursor(store, () => ({ ...snap }), { debounceMs: DEBOUNCE });

  store.nextResult = Promise.reject(new Error('network down'));
  store.nextResult.catch(() => {});   // pre-observed so node never sees it unhandled
  cursor.flush();
  await sleep(DEBOUNCE);
  check(store.calls.length === 1, 'the failing write was attempted once');

  cursor.flush();              // same position — but the failure never set last-written
  await sleep(DEBOUNCE);
  check(store.calls.length === 2 && store.calls[1].op === 'create',
    'a swallowed failure leaves last-written unset — the same position retries (still create: no row adopted)');
  cursor.dispose();
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 8 · dispose cancels a pending window without writing
 * ══════════════════════════════════════════════════════════════════════ */
{
  const store = makeStore();
  const snap = { itemId: 'A', position: 12, duration: 100 };
  const cursor = createResumeCursor(store, () => ({ ...snap }), { debounceMs: DEBOUNCE });

  cursor.schedule();
  cursor.dispose();
  await sleep(DEBOUNCE * 3);
  check(store.calls.length === 0, 'dispose() cancels the armed window — teardown never fires a write');
}

/* ══════════════════════════════════════════════════════════════════════ */
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${'='.repeat(40)}`);
if (failed) {
  console.error(`✗ weave resumeCursor: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ weave resumeCursor: all assertions passed');

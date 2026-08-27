// services.test.mjs — unit tests for @jkos/player/services' offline write queue
// (git history item 16.5 / PapyrOS §2 7.2). Two halves:
//   1. the PURE policies in src/services/writeQueue.ts — coalescing (repeated
//      progress ticks collapse to the latest; delete cancels a queued create),
//      replay ordering (seq is first-queued and survives coalescing), last-write-
//      wins on updated_at (strict `>`, creates never drop, NaN fails open), and
//      the SQLite⇄epoch timestamp bridge (space-separated UTC stamps must NOT be
//      parsed as local time).
//   2. the RUNTIME in src/services/createWriteQueue.ts, run against
//      memoryQueueStorage + a scripted adapter — replay is serialized and
//      in-order, reconciliation drops server-newer writes, a transient push
//      failure halts and keeps the remainder, a permanent one drops just that
//      write, a write re-coalesced mid-push survives, and hydration restores a
//      persisted queue.
//
// Node has no TS runner here, so this transpiles the modules in-memory with the
// repo's own `typescript` dep and imports the REAL functions — the house pattern,
// copied from test/core.test.mjs (createWriteQueue's relative imports are
// rewritten to the transpiled .mjs names).
//
// Run:  node packages/player/test/services.test.mjs
//       (auto-enumerated by packages/player/scripts/run-tests.mjs →
//        `pnpm --filter @jkos/player test`, chained into `pnpm test:contracts`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-player-services-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function importTs(relPath, outName, rewrites = {}) {
  const src = readFileSync(resolve(root, relPath), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
    fileName: relPath,
  });
  let out = outputText;
  for (const [from, to] of Object.entries(rewrites)) out = out.replaceAll(`'${from}'`, `'${to}'`);
  const outFile = join(tmp, outName);
  writeFileSync(outFile, out);
  return import(pathToFileURL(outFile).href);
}

const wq = await importTs('src/services/writeQueue.ts', 'writeQueue.mjs');
const storageMod = await importTs('src/services/queueStorage.ts', 'queueStorage.mjs');
const runtimeMod = await importTs('src/services/createWriteQueue.ts', 'createWriteQueue.mjs', {
  './writeQueue': './writeQueue.mjs',
  './queueStorage': './queueStorage.mjs',
});

const {
  coalesceWrite, clearKey, removeIfUnchanged, planReplay,
  oldestQueuedAt, resolveWrite, nextSeq, parseServerTimestamp, toSqliteUtc,
} = wq;
const { memoryQueueStorage } = storageMod;
const { createWriteQueue, permanentWriteError, isOfflineFetchError } = runtimeMod;

/* ════ 1. Pure policies ═══════════════════════════════════════════════════ */

/* ── coalesceWrite rule A: new keys append with fresh seqs ─────────────── */
let r = coalesceWrite([], { collection: 'progress', key: 'ref:1', op: 'upsert', payload: { position: 10 } }, 1000);
check(r.queue.length === 1 && r.entry !== null, 'A: a new key appends one entry');
check(r.entry.seq === 1 && r.entry.queuedAt === 1000, 'A: first entry takes seq 1 and the intent moment');
r = coalesceWrite(r.queue, { collection: 'progress', key: 'ref:2', op: 'upsert', payload: { position: 5 } }, 1001);
check(r.queue.length === 2 && r.entry.seq === 2, 'A: a second key appends with the next seq');
r = coalesceWrite(r.queue, { collection: 'bookmarks', key: 'ref:1', op: 'create', payload: {} }, 1002);
check(r.queue.length === 3, 'A: the same key in a DIFFERENT collection is a distinct entry');
const baseQueue = r.queue;

/* ── rule F: upsert/update lattice merges payloads, keeps position ─────── */
r = coalesceWrite(baseQueue, { collection: 'progress', key: 'ref:1', op: 'upsert', payload: { position: 99 } }, 2000);
check(r.queue.length === 3, 'F: coalescing does not grow the queue');
check(r.entry.payload.position === 99 && r.entry.queuedAt === 2000, 'F: upsert+upsert keeps the LATEST payload + moment');
check(r.entry.seq === 1, 'F: a coalesced entry keeps its ORIGINAL seq (first-queued order)');
r = coalesceWrite(r.queue, { collection: 'progress', key: 'ref:1', op: 'update', payload: { finished: true } }, 2001);
check(r.entry.op === 'upsert', 'F: update onto a queued upsert stays an upsert (payload is still full state)');
check(r.entry.payload.position === 99 && r.entry.payload.finished === true, 'F: update onto upsert MERGES fields');
r = coalesceWrite([], { collection: 'p', key: 'id:5', op: 'update', payload: { a: 1 } }, 1);
r = coalesceWrite(r.queue, { collection: 'p', key: 'id:5', op: 'update', payload: { b: 2 } }, 2);
check(r.entry.op === 'update' && deepEq(r.entry.payload, { a: 1, b: 2 }), 'F: update+update merges and stays an update');
r = coalesceWrite(r.queue, { collection: 'p', key: 'id:5', op: 'upsert', payload: { c: 3 } }, 3);
check(r.entry.op === 'upsert' && deepEq(r.entry.payload, { a: 1, b: 2, c: 3 }), 'F: upsert onto update promotes to upsert');

/* ── the brief's literal scenario: 500 progress ticks → ONE queued write ── */
let ticks = [];
for (let i = 1; i <= 500; i++) {
  ticks = coalesceWrite(ticks, { collection: 'progress', key: 'ref:7', op: 'upsert', payload: { position: i } }, 10_000 + i).queue;
}
check(ticks.length === 1, '500 progress ticks for one book coalesce to a single entry');
check(ticks[0].payload.position === 500 && ticks[0].queuedAt === 10_500, 'the coalesced entry carries the LATEST position + moment');
check(ticks[0].seq === 1, 'the coalesced entry never moved from its first-queued position');

/* ── rules B/C: delete semantics ───────────────────────────────────────── */
r = coalesceWrite([], { collection: 'bookmarks', key: 'tmp:a', op: 'create', payload: { title: 'x' } }, 1);
r = coalesceWrite(r.queue, { collection: 'bookmarks', key: 'tmp:a', op: 'delete' }, 2);
check(r.queue.length === 0 && r.entry === null, 'B: delete CANCELS a still-queued create (net zero)');
r = coalesceWrite([], { collection: 'progress', key: 'id:9', op: 'update', payload: { position: 1 } }, 1);
r = coalesceWrite(r.queue, { collection: 'progress', key: 'id:9', op: 'delete' }, 2);
check(r.queue.length === 1 && r.entry.op === 'delete', 'C: delete REPLACES a queued update');
check(deepEq(r.entry.payload, {}) && r.entry.seq === 1, 'C: the delete drops the payload and keeps the seq');

/* ── rules D/E ─────────────────────────────────────────────────────────── */
r = coalesceWrite([], { collection: 'bookmarks', key: 'tmp:b', op: 'create', payload: { title: 'x', position: 1 } }, 1);
r = coalesceWrite(r.queue, { collection: 'bookmarks', key: 'tmp:b', op: 'update', payload: { title: 'y' } }, 2);
check(r.entry.op === 'create', 'D: update onto a queued create stays a create');
check(r.entry.payload.title === 'y' && r.entry.payload.position === 1, 'D: the eventual POST carries the merged fields');
r = coalesceWrite([], { collection: 'p', key: 'id:3', op: 'delete' }, 1);
r = coalesceWrite(r.queue, { collection: 'p', key: 'id:3', op: 'upsert', payload: { position: 4 } }, 2);
check(r.entry.op === 'upsert' && r.entry.payload.position === 4 && r.entry.seq === 1, 'E: a non-delete after a queued delete wins (latest intent), seq kept');

/* ── clearKey / removeIfUnchanged / planReplay / oldestQueuedAt ────────── */
check(clearKey(baseQueue, 'progress', 'ref:1').length === 2, 'clearKey drops exactly the named entry');
check(clearKey(baseQueue, 'progress', 'ref:404').length === 3, 'clearKey on an absent key is a no-op');

const snap = baseQueue[0];
check(removeIfUnchanged(baseQueue, snap).length === 2, 'removeIfUnchanged removes an untouched snapshot');
const bumped = coalesceWrite(baseQueue, { collection: 'progress', key: 'ref:1', op: 'upsert', payload: { position: 1 } }, 9999).queue;
check(removeIfUnchanged(bumped, snap).length === 3, 'removeIfUnchanged KEEPS an entry re-coalesced since the snapshot');

let plan = coalesceWrite([], { collection: 'p', key: 'a', op: 'upsert', payload: {} }, 1);
plan = coalesceWrite(plan.queue, { collection: 'p', key: 'b', op: 'upsert', payload: {} }, 2);
plan = coalesceWrite(plan.queue, { collection: 'p', key: 'a', op: 'upsert', payload: { v: 2 } }, 3);
check(deepEq(planReplay(plan.queue).map((w) => w.key), ['a', 'b']), 'planReplay: re-coalescing a never reorders it past b');

check(oldestQueuedAt(baseQueue, 'progress') === 1000, 'oldestQueuedAt: the min queuedAt for the collection');
check(oldestQueuedAt(baseQueue, 'nope') === null, 'oldestQueuedAt: null when the collection has nothing queued');
check(nextSeq([]) === 1 && nextSeq(baseQueue) === 4, 'nextSeq: 1 on empty, max+1 otherwise');

/* ── resolveWrite: last-write-wins on updated_at ───────────────────────── */
check(resolveWrite({ op: 'upsert', queuedAt: 1000 }, 2000) === 'drop', 'LWW: server strictly newer → DROP the local write');
check(resolveWrite({ op: 'upsert', queuedAt: 1000 }, 500) === 'push', 'LWW: server older → push');
check(resolveWrite({ op: 'upsert', queuedAt: 1000 }, 1000) === 'push', 'LWW: a tie pushes (strict >, mirrors the delta contract)');
check(resolveWrite({ op: 'upsert', queuedAt: 1000 }, null) === 'push', 'LWW: no server row in the delta → push');
check(resolveWrite({ op: 'upsert', queuedAt: 1000 }, NaN) === 'push', 'LWW: unparseable server stamp fails OPEN to push');
check(resolveWrite({ op: 'create', queuedAt: 1000 }, 99_999) === 'push', 'LWW: a create ALWAYS pushes (no server counterpart to lose to)');
check(resolveWrite({ op: 'delete', queuedAt: 1000 }, 2000) === 'drop', 'LWW: a queued delete drops when the server edited after it');

/* ── timestamp bridge ──────────────────────────────────────────────────── */
const utc = Date.UTC(2026, 6, 14, 18, 23, 45);
check(parseServerTimestamp('2026-07-14 18:23:45') === utc, "parse: SQLite datetime('now') stamps are UTC, never local");
check(parseServerTimestamp('2026-07-14T18:23:45') === utc, 'parse: a T-separated stamp with no zone is treated as UTC');
check(parseServerTimestamp('2026-07-14T18:23:45.123Z') === utc + 123, 'parse: ISO-millisecond (the BeigeBoard BUG-6.1 shape)');
check(parseServerTimestamp('2026-07-14 18:23:45.5') === utc + 500, 'parse: fractional seconds pad to ms');
check(parseServerTimestamp('2026-07-14T20:23:45+02:00') === utc, 'parse: an explicit offset is honored');
check(Number.isNaN(parseServerTimestamp('garbage')), 'parse: garbage → NaN');
check(Number.isNaN(parseServerTimestamp('')), 'parse: empty → NaN');
check(toSqliteUtc(Date.UTC(2026, 6, 14, 18, 23, 45, 678)) === '2026-07-14 18:23:45', 'toSqliteUtc: space-separated UTC, truncated to the second');
check(parseServerTimestamp(toSqliteUtc(utc)) === utc, 'round-trip: parse(toSqliteUtc(ms)) === ms at second resolution');

/* ════ 2. Runtime (memory storage + scripted adapter) ═════════════════════ */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(10); }
  return fn();
}
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

function makeAdapter() {
  const state = {
    pushed: [],                 // every successfully-scripted push, in call order
    deltas: {},                 // collection → rows fetchSince returns
    fetches: [],                // [collection, sinceMs] per fetchSince call
    failWith: null,             // key → error to throw on push
  };
  const adapter = {
    async push(w) {
      if (state.failWith && state.failWith.key === w.key) throw state.failWith.err;
      state.pushed.push(`${w.collection}|${w.key}@${JSON.stringify(w.payload)}`);
    },
    async fetchSince(collection, sinceMs) {
      state.fetches.push([collection, sinceMs]);
      return state.deltas[collection] ?? [];
    },
    keysOf(collection, row) {
      const keys = [];
      if (typeof row.book_ref === 'number') keys.push(`ref:${row.book_ref}`);
      if (typeof row.id === 'number') keys.push(`id:${row.id}`);
      return keys;
    },
    updatedAtOf(_c, row) { return parseServerTimestamp(String(row.updated_at ?? '')); },
  };
  return { adapter, state };
}

/* ── reconciliation: server-newer drops, everything else pushes in order ── */
{
  const { adapter, state } = makeAdapter();
  const online = { value: false };
  let clock = 5_000;
  const q = createWriteQueue({
    adapter, storage: memoryQueueStorage(),
    isOnline: () => online.value, now: () => clock,
  });
  await q.enqueue({ collection: 'progress', key: 'ref:1', op: 'upsert', payload: { book_ref: 1, position: 10 } });
  clock = 6_000;
  await q.enqueue({ collection: 'progress', key: 'ref:2', op: 'upsert', payload: { book_ref: 2, position: 20 } });
  clock = 7_000;
  await q.enqueue({ collection: 'bookmarks', key: 'tmp:x', op: 'create', payload: { title: 'bm' } });
  check(q.size() === 3 && state.pushed.length === 0, 'offline: writes queue durably, nothing pushes');

  // Server edited book 1 AFTER our write (7s > 5s) but book 2 BEFORE (4s < 6s).
  state.deltas.progress = [
    { id: 11, book_ref: 1, updated_at: toSqliteUtc(7_000) },
    { id: 12, book_ref: 2, updated_at: toSqliteUtc(4_000) },
  ];
  online.value = true;
  await q.flush();
  check(q.size() === 0, 'reconnect flush drains the queue');
  check(state.pushed.length === 2, 'LWW dropped exactly the server-newer write');
  check(!state.pushed.some((p) => p.includes('ref:1')), 'the stale local write for book 1 was NOT replayed');
  check(state.pushed[0].includes('ref:2') && state.pushed[1].includes('tmp:x'), 'replay preserves first-queued order');
  check(state.fetches.some(([c, s]) => c === 'progress' && s === 5_000), 'the ?since= cursor is the collection\'s OLDEST queuedAt');
  check(state.fetches.filter(([c]) => c === 'progress').length === 1, 'one delta fetch per collection per flush');
}

/* ── partial failure: transient halts + keeps; permanent drops + continues ── */
{
  const { adapter, state } = makeAdapter();
  const online = { value: false };
  const q = createWriteQueue({ adapter, storage: memoryQueueStorage(), isOnline: () => online.value, now: () => 1 });
  await q.enqueue({ collection: 'p', key: 'a', op: 'upsert', payload: { v: 1 } });
  await q.enqueue({ collection: 'p', key: 'b', op: 'upsert', payload: { v: 2 } });
  online.value = true;

  state.failWith = { key: 'a', err: new Error('ECONNREFUSED-ish') };
  await q.flush();
  check(q.size() === 2, 'transient push failure keeps the failed write AND everything after it');
  check(state.pushed.length === 0, 'transient failure halts the replay (b never attempted out of order)');

  state.failWith = { key: 'a', err: permanentWriteError('server said 400') };
  await q.flush();
  check(q.size() === 0, 'permanent failure drops just that write and the flush continues');
  check(state.pushed.length === 1 && state.pushed[0].includes('|b@'), 'the write after a permanent failure still replays');
}

/* ── a write re-coalesced mid-push survives for the next flush ──────────── */
{
  const { adapter, state } = makeAdapter();
  const online = { value: false };
  let clock = 100;
  const gate = deferred();
  adapter.push = async (w) => { await gate.p; state.pushed.push(`${w.key}@${w.payload.v}`); };
  const q = createWriteQueue({ adapter, storage: memoryQueueStorage(), isOnline: () => online.value, now: () => clock });
  await q.enqueue({ collection: 'p', key: 'a', op: 'upsert', payload: { v: 1 } });
  online.value = true;
  const flushP = q.flush();                    // push(v:1) now parked on the gate
  await sleep(20);
  clock = 200;
  await q.enqueue({ collection: 'p', key: 'a', op: 'upsert', payload: { v: 2 } });   // re-coalesce mid-flight
  gate.res();
  await flushP;
  check(state.pushed[0] === 'a@1', 'the in-flight snapshot pushed its own payload');
  check(q.size() === 1 && q.pending()[0].payload.v === 2, 'the mid-flight re-coalesce SURVIVED the snapshot\'s settle');
  adapter.push = async (w) => { state.pushed.push(`${w.key}@${w.payload.v}`); };
  await q.flush();
  check(q.size() === 0 && state.pushed[1] === 'a@2', 'the newer write replays on the next flush');
}

/* ── enqueue while online auto-flushes; hydration restores persistence ──── */
{
  const { adapter, state } = makeAdapter();
  const storage = memoryQueueStorage();
  const q = createWriteQueue({ adapter, storage, isOnline: () => true, now: () => 1 });
  await q.enqueue({ collection: 'p', key: 'auto', op: 'upsert', payload: { v: 9 } });
  check(await until(() => state.pushed.length === 1 && q.size() === 0), 'an online enqueue flushes without an explicit flush() call');

  // Persistence round-trip: park a write in storage via an OFFLINE queue, then
  // hydrate a brand-new queue instance over the same storage (a "reload").
  const offlineQ = createWriteQueue({ adapter: makeAdapter().adapter, storage, isOnline: () => false, now: () => 50 });
  await offlineQ.enqueue({ collection: 'p', key: 'kept', op: 'upsert', payload: { v: 5 } });
  const reborn = createWriteQueue({ adapter: makeAdapter().adapter, storage, isOnline: () => false, now: () => 60 });
  await reborn.start();
  check(reborn.size() === 1 && reborn.pending()[0].key === 'kept', 'a new queue instance hydrates persisted writes (reload survival)');
  check(reborn.pending()[0].payload.v === 5 && reborn.pending()[0].queuedAt === 50, 'hydration preserves payload + queuedAt (the LWW moment)');
  reborn.stop();

  // clearKey — the direct-write-success guard — erases the persisted row too.
  await reborn.clearKey('p', 'kept');
  const reborn2 = createWriteQueue({ adapter: makeAdapter().adapter, storage, isOnline: () => false, now: () => 70 });
  await reborn2.start();
  check(reborn2.size() === 0, 'clearKey erases the write from persistence (a direct write landed)');
  reborn2.stop();
}

/* ── flush is serialized; offline flush is a no-op ─────────────────────── */
{
  const { adapter, state } = makeAdapter();
  const online = { value: false };
  const gate = deferred();
  adapter.fetchSince = async (c, s) => { state.fetches.push([c, s]); await gate.p; return []; };
  const q = createWriteQueue({ adapter, storage: memoryQueueStorage(), isOnline: () => online.value, now: () => 1 });
  await q.enqueue({ collection: 'p', key: 'x', op: 'upsert', payload: {} });
  await q.flush();
  check(state.fetches.length === 0 && q.size() === 1, 'flushing while offline is a no-op (nothing fetched, nothing lost)');
  online.value = true;
  const f1 = q.flush();
  const f2 = q.flush();                        // second call while the first is parked
  gate.res();
  await Promise.all([f1, f2]);
  check(state.fetches.length === 1, 'two overlapping flush() calls share ONE replay run (serialized)');
  check(q.size() === 0, 'the shared run drained the queue');
}

/* ── isOfflineFetchError ───────────────────────────────────────────────── */
check(isOfflineFetchError(new TypeError('Failed to fetch')) === true, 'isOfflineFetchError: a fetch TypeError is offline-shaped');
const httpErr = new Error('POST /api/progress failed: 500');
check(isOfflineFetchError(httpErr) === false, 'isOfflineFetchError: an HTTP-status error is a server verdict, not offline');
check(permanentWriteError('nope').permanent === true, 'permanentWriteError marks the error for drop-not-retry');

if (failed) {
  console.error(`\n✗ player/services: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ player/services: all assertions passed');

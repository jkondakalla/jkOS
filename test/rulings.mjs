// The four contract rules (WEAVE.md §3).
//
// ⚠️ A RULING NOTHING ENFORCES IS PROSE. Four holes in the weave contract were
// settled in RESET as decisions; a decision that lives only in a document is a
// decision the ninth agent re-litigates from scratch. This is each one, as a check.
//
//   1. ASYNC RESULTS — a capability declares `resolves` alongside `returns`.
//      Enforced by the `async-contract` prober probe (landed with D13); asserted here
//      only for the binder's half: `validateTriggerTypes` must bind against
//      `resolves`, never `returns`.
//   2. PAGINATION — the `since` cursor, no `offset`, ONE shared default and maximum
//      for `limit`. Three hand-rolled clamps disagreed: (120, 600) and (300, 2000) in
//      one KourOS file, plus jkAuth's `Math.min(limit || 50, 200)`. Three conventions
//      is not a style problem — it is what makes a cross-app fan-out unmergeable,
//      because "give me 100" means three different windows.
//   3. DECLARATION VERSIONING — a consumer reading a version HIGHER than it knows
//      fails closed with a named code. A declaration is a contract, and a consumer
//      that half-understands one is worse than one that refuses.
//   4. PEER-DOWN + IDEMPOTENCY — a fan-out always returns an explicit per-app status
//      list, and every write a trigger fires carries a derived idempotency key.
//
// Run:  node test/rulings.mjs      (wired as `pnpm check:rulings`, folded into
//                                   `pnpm test:contracts`)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(join(root, 'packages/weave/package.json'));
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const paging = await import(resolve(root, 'packages/weave/src/shared/paging.js'));
const docShape = await import(resolve(root, 'packages/weave/src/shared/docShape.js'));
const activity = await import(resolve(root, 'packages/weave/src/shared/activity.js'));
const trigger = require(resolve(root, 'packages/weave/src/server/trigger.js'));

// ── RULE 1 · the binder reads `resolves`, never `returns` ───────────────────
{
  const async = {
    whenReturns: [{ name: 'job_id', type: 'string' }],
    whenResolves: [{ name: 'title', type: 'string' }],
    doBody: [{ name: 'title', type: 'string', required: true }],
  };
  const bindHandle = { when: { app: 'l', capability: 'c' }, do: { app: 'b', capability: 'createItem', body: { title: { from: 'job_id' } } } };
  const bindResult = { when: { app: 'l', capability: 'c' }, do: { app: 'b', capability: 'createItem', body: { title: { from: 'title' } } } };
  check(trigger.validateTriggerTypes(bindHandle, async).length === 1,
    'binding an async capability\'s HANDLE is refused — it type-checks (string→string) and would title a task with a UUID');
  check(trigger.validateTriggerTypes(bindResult, async).length === 0,
    'binding what the work RESOLVES to is accepted');
  // A synchronous capability still composes on `returns`, unchanged.
  check(trigger.validateTriggerTypes(bindResult, { whenReturns: [{ name: 'title', type: 'string' }], doBody: async.doBody }).length === 0,
    'a synchronous capability still composes on `returns`');
}

// ── RULE 2 · one paging contract ────────────────────────────────────────────
{
  check(paging.pageLimit(undefined) === paging.PAGE_DEFAULT, 'no limit ⇒ the one shared default');
  check(paging.pageLimit('99999') === paging.PAGE_MAX, 'an absurd limit is capped at the one shared maximum');
  check(paging.pageLimit('0') === paging.PAGE_DEFAULT && paging.pageLimit('-5') === paging.PAGE_DEFAULT,
    'a nonsense limit falls back rather than returning nothing');
  /* An app may NARROW where its rows are expensive… */
  check(paging.pageLimit('400', { max: 20 }) === 20, 'an app may narrow the maximum');
  /* …and may not widen it, which is the half that actually needs enforcing. */
  check(paging.pageLimit('9999', { max: 100000 }) === paging.PAGE_MAX,
    'an app may NOT widen it past PAGE_MAX — otherwise "give me 100" means three different windows again');
  check(activity.ACTIVITY_DEFAULT_LIMIT === paging.PAGE_DEFAULT && activity.ACTIVITY_MAX_LIMIT === paging.PAGE_MAX,
    'the activity fan-out uses the shared numbers, not two more of its own');

  /* No hand-rolled clamp regrows. ⚠️ Matched on a CALLER-SUPPLIED page limit
     specifically (`req.query.limit`), not on any `Math.min` mentioning a variable
     called limit — the first version of this scan flagged libraryScanner's
     `Math.min(limit, items.length)`, which is a CONCURRENCY LANE COUNT and has
     nothing to do with paging. A false positive here would be self-defeating: this
     probe exists to make one convention stick, and it cannot do that while telling
     people to ignore two of its three findings. */
  const SKIP = new Set(['node_modules', 'dist', 'build', '.turbo']);
  const files = [];
  const walk = (dir) => {
    const abs = resolve(root, dir);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs)) {
      if (SKIP.has(e)) continue;
      const p = join(dir, e);
      if (statSync(resolve(root, p)).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e)) files.push(p);
    }
  };
  walk('apps'); walk('packages');
  const CANON = new Set(['packages/weave/src/shared/paging.js', 'packages/weave/src/shared/paging.d.ts']);
  const offenders = [];
  for (const rel of files) {
    if (CANON.has(rel) || rel.startsWith('test/')) continue;
    const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const line of src.split('\n')) {
      if (/Math\.min\([^)]*req\.query\.limit|req\.query\.limit[^)]*Math\.min/i.test(line) && !/pageLimit/.test(line)) {
        offenders.push(`${rel} — ${line.trim().slice(0, 90)}`);
      }
    }
  }
  if (offenders.length) {
    fail(`${offenders.length} hand-rolled limit clamp(s) outside the paging contract:`);
    for (const o of offenders.slice(0, 8)) console.error(`      ${o}`);
    console.error('    Use pageLimit() from @jkos/weave. Three clamps that disagreed is what');
    console.error('    made a cross-app fan-out unmergeable in the first place.');
  } else {
    ok(`no hand-rolled limit clamp anywhere (${files.length} files scanned)`);
  }
}

// ── RULE 3 · unknown declaration version fails CLOSED ───────────────────────
{
  const future = { app: 'x', version: docShape.MAX_DOC_VERSION + 1, datasets: [] };
  const err = docShape.checkDocShape(future, 'datasets');
  check(!!err && err.includes(docShape.DOC_VERSION_UNSUPPORTED),
    'a doc from the future is REFUSED, with a named code — never half-read');
  check(docShape.checkDocShape({ app: 'x', version: docShape.MAX_DOC_VERSION, datasets: [] }, 'datasets') === null,
    'the version this consumer knows is accepted');
  /* A LOWER version must still pass: this code understands every dialect it has ever
     spoken, and refusing an older peer would be failing closed in the wrong direction. */
  check(docShape.checkDocShape({ app: 'x', version: 0, datasets: [] }, 'datasets') === null,
    'an OLDER version still passes — failing closed means refusing the future, not the past');
  const aErr = activity.checkActivityDoc({ app: 'x', version: 99, kinds: [{ id: 'k', label: 'K' }], activity: [] });
  check(!!aErr && aErr.includes(docShape.DOC_VERSION_UNSUPPORTED),
    'the activity doc obeys the same rule — one ruling, every declaration');
}

// ── RULE 4 · peer-down status list, and idempotency ─────────────────────────
{
  const src = read('packages/weave/src/fetchActivity.ts');
  /* ⚠️ Read the INTERFACE BODY, not the file. A first pass matched
     `/sources: ActivitySource\[\]/` anywhere in the source — which the local
     `const sources: ActivitySource[] = …` inside the function satisfies, so deleting
     the field from the returned type sailed straight past. The shape of the ANSWER is
     what the ruling is about. */
  const feed = src.match(/export interface ActivityFeed \{([\s\S]*?)\n\}/);
  check(!!feed, 'the fan-out declares an ActivityFeed answer type');
  const fields = feed ? feed[1] : '';
  check(/\bsources\s*:/.test(fields),
    'the fan-out returns an explicit per-app status list, not a bare array');
  check(/\bpartial\s*:\s*boolean/.test(fields),
    '…and a `partial` flag, so a caller who ignores `sources` still cannot mistake a short feed for a complete one');
  check(/'unauthorized'/.test(src) && /'unreachable'/.test(src) && /'malformed'/.test(src),
    'a dead peer, a refused peer and an unreadable peer are DIFFERENT answers');

  /* The engine sends a key on every DO, and the same event twice gets the SAME key —
     the only property that makes a retry recognisable as one. */
  const seen = [];
  const eng = trigger.createTriggerEngine({
    triggers: [{ id: 't1', when: { app: 'l', capability: 'c' }, do: { app: 'b', capability: 'createItem', body: { title: { from: 'title' } } } }],
    dispatch: async (_d, b, ctx) => { seen.push({ key: ctx.idempotencyKey, body: b }); return { ok: true }; },
  });
  await eng.emit('l', 'c', { title: 'x', a: 1, b: 2 });
  await eng.emit('l', 'c', { b: 2, a: 1, title: 'x' });   // same facts, different key order
  await eng.emit('l', 'c', { title: 'y' });
  check(!!seen[0].key, 'every trigger DO carries an idempotency key');
  check(seen[0].key === seen[1].key,
    'the SAME event produces the SAME key — even reserialised with its keys in another order, which a peer will do');
  check(seen[0].key !== seen[2].key, 'a different event produces a different key');
  /* ⚠️ AND IT IS WIDE ENOUGH THAT "DIFFERENT" HOLDS. A receiving door answers a matching
     key with the FIRST write's stored response, so a collision is a write that silently
     never happens. The key was a 32-bit FNV-1a until 2026-09-16 — ~1% odds by ten thousand
     writes to one door for one user. 128 bits is the floor; this pins the width, because
     a narrower hash passes every sameness check above. */
  const digestHex = String(seen[0].key).replace(/^trg_/, '');
  check(/^[0-9a-f]+$/.test(digestHex) && digestHex.length * 4 >= 128,
    `the key carries at least 128 bits (got ${digestHex.length * 4}) — a collision is a lost write, not a cosmetic clash`);
  /* ⚠️ A random key would satisfy "has a key" and defeat the entire mechanism, by
     making every retry look like a new write. That is why sameness is the assertion. */

  /* ── …and the RECEIVING half, declared where a caller can see it. ──────────────
     Everything above proves the SENDER. For a long time that was all this ruling
     checked, and the receiving half did not exist: no capability declared the field and
     no door read it, so "a retried DO cannot double-write" was prose with a green tick
     beside it. `defineCollection` closed it for generated doors (2026-09-10); the
     hand-rolled ones — BeigeBoard's createItem and importItems, LazurOS's job doors —
     stayed open until 2026-09-16.
     ⚠️ This checks the DECLARATION, and only for doors that are never idempotent by
     construction. It cannot see a route honour the key; each app's smoke writes twice
     and COUNTS ROWS for that. What it stops is the cheaper regression: a new hand-rolled
     create, or a new async job door, that nobody remembered to key. */
  const { BACKEND_DOCS } = await import(resolve(root, 'packages/suite-prober/src/sources.mjs'));
  const IDEM = 'idempotency_key';
  const declares = (cap) => (cap.body || []).some((f) => f && f.name === IDEM);
  const caps = [];
  for (const b of BACKEND_DOCS) {
    const mod = require(resolve(root, b.module));
    const doc = mod.CAPABILITIES || mod.CAPABILITIES_DOC;
    for (const c of (doc && doc.capabilities) || []) caps.push({ app: b.app, ...c });
  }
  check(caps.length > 20, `the capability docs were actually read (${caps.length} capabilities across ${BACKEND_DOCS.length} backends)`);

  const creates = caps.filter((c) => c.method === 'POST' && /^create[A-Z]/.test(c.id));
  const unkeyedCreates = creates.filter((c) => !declares(c)).map((c) => `${c.app}.${c.id}`);
  check(creates.length > 0 && unkeyedCreates.length === 0,
    `every create* door declares ${IDEM} — a create is never idempotent by construction (${creates.length} checked${unkeyedCreates.length ? `; UNKEYED: ${unkeyedCreates.join(', ')}` : ''})`);

  // An async door ENQUEUES WORK: a retried enqueue runs the model twice and writes its result twice.
  const asyncDoors = caps.filter((c) => Array.isArray(c.resolves));
  const unkeyedAsync = asyncDoors.filter((c) => !declares(c)).map((c) => `${c.app}.${c.id}`);
  check(asyncDoors.length > 0 && unkeyedAsync.length === 0,
    `every async (resolves-declaring) door declares ${IDEM} (${asyncDoors.length} checked${unkeyedAsync.length ? `; UNKEYED: ${unkeyedAsync.join(', ')}` : ''})`);

  /* The write-back's targets, DERIVED from its own routing table rather than listed —
     a job can finish twice (the reaper requeues one that outran its timeout), so the door
     a result lands in must dedup, and a new routing entry must not escape this check. */
  const { WRITEBACK } = require(resolve(root, 'apps/lazuros/backend/lib/writeback.js'));
  const targets = Object.values(WRITEBACK);
  const unkeyedTargets = [...new Set(targets
    .filter((t) => !caps.some((c) => c.app === t.app && c.id === t.capability && declares(c)))
    .map((t) => `${t.app}.${t.capability}`))];
  check(targets.length > 0 && unkeyedTargets.length === 0,
    `every door LazurOS writes a job result into declares ${IDEM} (${[...new Set(targets.map((t) => `${t.app}.${t.capability}`))].join(', ')}${unkeyedTargets.length ? `; UNKEYED: ${unkeyedTargets.join(', ')}` : ''})`);
}

if (failed) {
  console.error(`\n✗ contract rulings: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ contract rulings: all four are enforced, not merely written down');

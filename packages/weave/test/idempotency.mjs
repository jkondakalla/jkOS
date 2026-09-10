// @jkos/weave idempotency tests — DEDUP AT THE WRITE DOOR (RESET A2c.4, the owed
// half; Documentation/WEAVE.md §3.4).
//
// ⚠️ WHY THIS FILE EXISTS AND WHAT MADE IT NECESSARY. The trigger engine has always
// sent a DERIVED `idempotency_key`, and the suite's docs claimed for a long time
// that this meant "a retried DO cannot double-write". It did not: idempotency is a
// property of the RECEIVER, and nothing in the suite read the key. The claim was
// struck from trigger.js and WEAVE.md rather than left standing.
//
// The reason it survived so long is the shape of the test that covered it.
// `check:rulings` exercises the SENDING half against an injected dispatcher, and
// proves the key is derived and stable — never that anything acts on it. So every
// assertion below writes through the REAL generated route into REAL SQLite and
// then COUNTS ROWS. A test that only inspected responses would pass against a door
// that wrote twice and answered identically both times.
//
// Run: node test/idempotency.mjs   (chained by `pnpm --filter @jkos/weave test`).

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { defineCollection } = require('../src/server/collection.js')
const { IDEMPOTENCY_FIELD, idempotencyKeyOf, IDEMPOTENCY_MAX_LEN } = require('../src/shared/idempotency.js')
const { withIdempotency, prune, TABLE, DDL } = require('../src/server/idempotency.js')

let pass = 0
const ok = (label, cond, detail = '') => { assert.ok(cond, `${label} ${detail}`); pass++; console.log(`  ✓ ${label}`) }
const section = (t) => console.log(`\n${t}`)

function loadSqlite() {
  for (const base of ['apps/beigeboard/backend', 'apps/jkauth']) {
    try { return createRequire(join(HERE, '..', '..', '..', base, 'x.js'))('better-sqlite3') } catch { /* next */ }
  }
  return null
}

/* ── The reader, in isolation ─────────────────────────────────────────────── */
section('idempotency · reading a key')
ok('the field has ONE name, shared with the trigger engine', IDEMPOTENCY_FIELD === 'idempotency_key')
ok('a real key reads back trimmed', idempotencyKeyOf({ [IDEMPOTENCY_FIELD]: '  k1  ' }) === 'k1')
// ⚠️ EVERY ONE OF THESE MEANS "NO DEDUP", NOT "ERROR". The field is optional by
// declaration and every hand-made GUI write arrives without one; a door that
// rejected those would break every app in the suite to protect a path with no
// call sites yet.
ok('an absent key is null', idempotencyKeyOf({}) === null)
ok('a blank key is null', idempotencyKeyOf({ [IDEMPOTENCY_FIELD]: '   ' }) === null)
ok('a non-string key is null, not stringified',
  idempotencyKeyOf({ [IDEMPOTENCY_FIELD]: { a: 1 } }) === null,
  '— a store keyed on "[object Object]" would silently collapse unrelated writes')
ok('a key past the length ceiling is null',
  idempotencyKeyOf({ [IDEMPOTENCY_FIELD]: 'x'.repeat(IDEMPOTENCY_MAX_LEN + 1) }) === null,
  '— the key becomes half a primary key, so its size cannot be the caller\'s choice')

/* ── The declaration ──────────────────────────────────────────────────────── */
section('idempotency · the declaration')
const notes = defineCollection({
  app: 'demo', id: 'notes', label: 'Note', scoped: true,
  fields: [{ name: 'title', type: 'string', label: 'Title', required: true }],
})
const createCap = notes.capabilities.find((c) => c.id === 'createNote')
const declared = createCap.body.find((f) => f.name === IDEMPOTENCY_FIELD)
ok('the create capability DECLARES the field', !!declared,
  '— until it did, a GUI or an AI reading the contract could not know the door dedups')
ok('…as optional', declared && !declared.required)
ok('…and typed as a string with the ceiling on it', declared.type === 'string' && declared.max === IDEMPOTENCY_MAX_LEN)
ok('update does NOT declare it', !notes.capabilities.find((c) => c.id === 'updateNote').body.some((f) => f.name === IDEMPOTENCY_FIELD),
  '— a PATCH is already idempotent by construction; declaring a key there would promise a dedup nothing performs')

/* ── The write door, over real SQLite ─────────────────────────────────────── */
const Database = loadSqlite()
if (!Database) {
  console.log('  ⤼ SKIP live-route tests (better-sqlite3 not resolvable in this env)')
} else {
  section('idempotency · the write door, counting rows')
  const db = new Database(':memory:')
  db.exec(notes.ddl())

  ok('the collection DDL brings the dedup table with it',
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(TABLE))

  const routes = {}
  const router = {
    get: (p, h) => { routes[`GET ${p}`] = h },
    post: (p, h) => { routes[`POST ${p}`] = h },
    patch: (p, h) => { routes[`PATCH ${p}`] = h },
    delete: (p, h) => { routes[`DELETE ${p}`] = h },
  }
  notes.mount(router, db)

  const res = () => ({
    code: 200, body: undefined, headers: {},
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
    set(k, v) { this.headers[k] = v; return this },
  })
  const post = (body, user = { sub: 7 }) => {
    const r = res(); routes['POST /api/notes']({ user, body, query: {}, params: {} }, r); return r
  }
  const rows = (userId) => db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = ?').get(userId).n

  // The claim, stated as the count it is about.
  const a1 = post({ title: 'from a trigger', [IDEMPOTENCY_FIELD]: 'trig:1:evt:9' })
  const a2 = post({ title: 'from a trigger', [IDEMPOTENCY_FIELD]: 'trig:1:evt:9' })
  ok('a retried write creates ONE row, not two', rows(7) === 1, `(got ${rows(7)})`)
  ok('…and the retry gets the SAME row back', a2.body.id === a1.body.id)
  ok('…with the first attempt\'s status, not a fresh 201 for nothing',
    a1.code === 201 && a2.code === 201)
  ok('…and says it was a replay', a2.headers['Idempotent-Replay'] === 'true',
    '— a caller that retried and got a new-looking creation cannot tell it did not create a second row')
  ok('the first response was NOT marked a replay', a1.headers['Idempotent-Replay'] === undefined)

  // ⚠️ THE SECURITY PROPERTY. The engine's key is derived from the trigger and the
  // event, so a per-user delegated DO fans ONE trigger out to N users carrying the
  // SAME key. A globally-keyed store answers user B's write with user A's row —
  // with a 200 and no error anywhere.
  const b1 = post({ title: 'someone else\'s board', [IDEMPOTENCY_FIELD]: 'trig:1:evt:9' }, { sub: 9 })
  ok('the SAME key from another user writes that user\'s own row', rows(9) === 1)
  ok('…and never hands back the first user\'s row', b1.body.id !== a1.body.id,
    '— this is the whole reason the user id is in the primary key')
  ok('…and is not a replay', b1.headers['Idempotent-Replay'] === undefined)

  // Different keys are different writes; no key is no dedup.
  post({ title: 'a second real event', [IDEMPOTENCY_FIELD]: 'trig:1:evt:10' })
  ok('a different key writes a new row', rows(7) === 2)
  post({ title: 'hand-made' })
  post({ title: 'hand-made' })
  ok('two writes with NO key both land — the field is optional and unchanged behaviour',
    rows(7) === 4, `(got ${rows(7)})`)

  // ⚠️ ONE TRANSACTION. Insert the row, then fail before recording the key, and the
  // retry double-writes anyway — the exact outcome this exists to prevent, reached
  // by a shorter path. A rollback must take BOTH.
  section('idempotency · atomicity')
  const before = rows(7)
  let threw = false
  try {
    withIdempotency(db, {
      scope: 'demo.notes', userId: 7, key: 'boom',
      write: () => {
        db.prepare('INSERT INTO notes (user_id, title) VALUES (?, ?)').run(7, 'half-written')
        throw new Error('crash after the insert, before the key')
      },
    })
  } catch { threw = true }
  ok('a write that throws propagates', threw)
  ok('…and its row is rolled back with it', rows(7) === before, `(got ${rows(7)} vs ${before})`)
  ok('…and its key was not recorded, so a genuine retry can still write',
    !db.prepare(`SELECT 1 FROM ${TABLE} WHERE key = ?`).get('boom'))

  // Two doors, one key. A trigger's key is derived from the trigger and event, not
  // from the target, so two DOs of one event can legitimately carry the same key.
  section('idempotency · scoping')
  const other = defineCollection({
    app: 'demo', id: 'tags', label: 'Tag', scoped: true,
    fields: [{ name: 'name', type: 'string', required: true }],
  })
  db.exec(other.ddl())
  const routes2 = {}
  other.mount({ get: (p, h) => { routes2[`GET ${p}`] = h }, post: (p, h) => { routes2[`POST ${p}`] = h },
                patch: (p, h) => { routes2[`PATCH ${p}`] = h }, delete: (p, h) => { routes2[`DELETE ${p}`] = h } }, db)
  const r2 = res()
  routes2['POST /api/tags']({ user: { sub: 7 }, body: { name: 'x', [IDEMPOTENCY_FIELD]: 'trig:1:evt:9' }, query: {}, params: {} }, r2)
  ok('the same key at a DIFFERENT door writes there too',
    db.prepare('SELECT COUNT(*) n FROM tags').get().n === 1,
    '— a trigger key is derived from the event, not the target, so two DOs of one event share it')
  ok('…and is not a replay of the first door\'s row', r2.headers['Idempotent-Replay'] === undefined)

  // Unscoped collections use '' as the owner rather than colliding on null.
  const glob = defineCollection({
    app: 'demo', id: 'shared_notes', label: 'SharedNote', scoped: false,
    fields: [{ name: 'title', type: 'string', required: true }],
  })
  db.exec(glob.ddl())
  const routes3 = {}
  glob.mount({ get: (p, h) => { routes3[`GET ${p}`] = h }, post: (p, h) => { routes3[`POST ${p}`] = h },
               patch: (p, h) => { routes3[`PATCH ${p}`] = h }, delete: (p, h) => { routes3[`DELETE ${p}`] = h } }, db)
  const g = (u) => { const r = res(); routes3['POST /api/shared_notes']({ user: { sub: u }, body: { title: 't', [IDEMPOTENCY_FIELD]: 'k' }, query: {}, params: {} }, r); return r }
  g(7); const g2 = g(9)
  ok('an UNSCOPED collection dedups across users — there is one row to be idempotent about',
    db.prepare('SELECT COUNT(*) n FROM shared_notes').get().n === 1)
  ok('…and says so', g2.headers['Idempotent-Replay'] === 'true')

  // Retention. A key that has expired reads as NEW, which is a real ceiling on how
  // late a redelivery may arrive and still be deduplicated — stated, not assumed.
  section('idempotency · retention')
  db.prepare(`UPDATE ${TABLE} SET created_at = ? WHERE key = ?`)
    .run(new Date(Date.now() - 400 * 86400_000).toISOString(), 'trig:1:evt:9')
  const removed = prune(db, 30)
  ok('prune drops keys past the retention window', removed >= 1, `(removed ${removed})`)
  ok('…and leaves the recent ones', !!db.prepare(`SELECT 1 FROM ${TABLE} WHERE key = ?`).get('trig:1:evt:10'))

  ok('the DDL is idempotent itself (IF NOT EXISTS)', (() => {
    db.exec(DDL); db.exec(DDL); return true
  })())
}

console.log(`\n✓ idempotency: ${pass} assertions passed`)

// @jkos/weave lego-kit tests — Layer D primitives (collection / connector / trigger).
//
// These prove each NEW brick (ToDo D1/D2/D3 + F4) inherits the Layer-A contract:
// a spec expands into valid, typed, self-describing capabilities/datasets AND the
// runtime behaves. The collection test runs the GENERATED routes over a real
// in-memory SQLite (the strongest proof — the same wiring a scaffolded backend gets).
//
// Run: node test/lego.mjs   (chained after weave.mjs by `pnpm --filter @jkos/weave test`).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { checkDocShape } = require('../src/shared/docShape.js')

let pass = 0, skip = 0
const ok = (label, cond, detail = '') => { assert.ok(cond, `${label} ${detail}`); pass++; console.log(`  ✓ ${label}`) }
const section = (t) => console.log(`\n${t}`)

// better-sqlite3 lives in the backends' node_modules (not weave's — it's a backend
// concern). Resolve it from a workspace package that depends on it; skip the live
// route test if it isn't installed (CI/deploy always has it).
function loadSqlite() {
  for (const base of ['apps/beigeboard/backend', 'apps/jkauth']) {
    try { return createRequire(join(HERE, '..', '..', '..', base, 'x.js'))('better-sqlite3') } catch { /* next */ }
  }
  return null
}

/* ═══ D1 · Collection primitive ═══════════════════════════════════════════════ */
section('D1 · collection primitive (defineCollection)')
const { defineCollection } = require('../src/server/collection.js')

// A faithful `items`-style collection — the shape the scaffolder dogfoods.
const items = defineCollection({
  app: 'demo', id: 'items', label: 'Items',
  fields: [
    { name: 'title',   type: 'string',  label: 'Title', required: true, max: 200 },
    { name: 'notes',   type: 'text',    label: 'Notes' },
    { name: 'done',    type: 'boolean', label: 'Done', filter: 'eq' },
    { name: 'tags',    type: 'string',  label: 'Tags', list: true, filter: 'tags' },
    { name: 'ext_ref', type: 'string',  label: 'External ref', filter: 'prefix' },
  ],
})

ok('derives the resource key from app+id', items.key === 'demo.items')
ok('emits create/update/delete capabilities', items.capabilities.map((c) => c.id).join(',') === 'createItem,updateItem,deleteItem')
ok('every capability returns the row shape (typed OUTPUT stud)', items.capabilities.slice(0, 2).every((c) => c.returns === items.item))
ok('every capability carries the app write scope', items.capabilities.every((c) => c.scopes[0] === 'demo:write'))
ok('every capability invalidates the one resource key', items.capabilities.every((c) => c.invalidates[0] === 'demo.items'))
ok('create body requires the required field only', (() => {
  const b = items.capabilities[0].body
  return b.find((f) => f.name === 'title').required === true && !b.find((f) => f.name === 'notes').required
})())
ok('update body is partial (id required, fields optional)', (() => {
  const b = items.capabilities[1].body
  return b[0].name === 'id' && b[0].required === true && !b.find((f) => f.name === 'title').required
})())

// The derived docs are Layer-A valid (the same gate the scaffolder + peers run).
ok('derived CapabilityDoc passes checkDocShape',
  checkDocShape({ app: 'demo', version: 1, capabilities: items.capabilities }, 'capabilities') === null)
ok('derived DatasetDoc passes checkDocShape',
  checkDocShape({ app: 'demo', version: 1, datasets: [items.dataset] }, 'datasets') === null)

// The dataset filters are single-sourced (each carries its own column/op → enforced SQL).
ok('dataset exposes the opted-in filters + the universal since cursor, each with column/op', (() => {
  const f = items.dataset.filters
  return f.length === 4 && f.every((x) => x.column && x.op) &&
    f.find((x) => x.name === 'tags').op === 'tags' && f.find((x) => x.name === 'ext_ref').op === 'prefix' &&
    f.find((x) => x.name === 'since').column === 'updated_at' && f.find((x) => x.name === 'since').op === 'gt'
})())
ok('row shape = id + fields + updated_at', items.item.map((f) => f.name).join(',') === 'id,title,notes,done,tags,ext_ref,updated_at')

// DDL derives the table, indexes and the weave delta triggers.
const ddl = items.ddl()
for (const frag of ['CREATE TABLE IF NOT EXISTS items', 'user_id    INTEGER', 'title TEXT NOT NULL',
  "tags TEXT DEFAULT '[]'", 'done INTEGER DEFAULT 0', 'idx_items_updated', 'items_stamp_inserted', 'items_touch_updated']) {
  ok(`ddl() contains: ${frag}`, ddl.includes(frag))
}

// Column ⇄ wire transforms.
ok('coerce: boolean true → 1', items.coerce('done', true) === 1)
ok('coerce: list "a, b" → JSON array text', items.coerce('tags', 'a, b') === '["a","b"]')
ok('toRow: 0/1 → boolean, JSON text → array', (() => {
  const r = items.toRow({ id: 1, done: 1, tags: '["x","y"]', title: 't' })
  return r.done === true && Array.isArray(r.tags) && r.tags[0] === 'x'
})())

// Reserved-column + identifier guards fail loud.
ok('rejects a reserved field name', (() => { try { defineCollection({ app: 'a', id: 'c', label: 'C', fields: [{ name: 'updated_at', type: 'string' }] }); return false } catch { return true } })())
ok('rejects a non-identifier field name', (() => { try { defineCollection({ app: 'a', id: 'c', label: 'C', fields: [{ name: 'Bad-Name', type: 'string' }] }); return false } catch { return true } })())
ok('rejects a non-identifier collection id', (() => { try { defineCollection({ app: 'a', id: 'Bad Id', label: 'C', fields: [{ name: 'x', type: 'string' }] }); return false } catch { return true } })())

// ── Live routes over real SQLite — the generated CRUD actually works + scopes. ──
const Database = loadSqlite()
if (!Database) {
  skip++; console.log('  ⤼ SKIP live-route test (better-sqlite3 not resolvable in this env)')
} else {
  const db = new Database(':memory:')
  db.exec(items.ddl())

  // A minimal Express-shaped router that records handlers by "METHOD path".
  const routes = {}
  const router = {
    get: (p, h) => { routes[`GET ${p}`] = h },
    post: (p, h) => { routes[`POST ${p}`] = h },
    patch: (p, h) => { routes[`PATCH ${p}`] = h },
    delete: (p, h) => { routes[`DELETE ${p}`] = h },
  }
  items.mount(router, db)
  ok('mount wired all four CRUD routes', ['GET /api/items', 'POST /api/items', 'PATCH /api/items/:id', 'DELETE /api/items/:id'].every((k) => typeof routes[k] === 'function'))

  // Tiny req/res doubles.
  const res = () => { const r = { code: 200, body: undefined, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }; return r }
  const call = (key, { user = { sub: 7 }, body = {}, query = {}, params = {} } = {}) => {
    const r = res(); routes[key]({ user, body, query, params }, r); return r
  }

  // create two rows for user 7, one for user 9
  let r = call('POST /api/items', { body: { title: 'first', tags: 'a,b', done: false } })
  ok('POST creates a row (201) with parsed tags + boolean', r.code === 201 && r.body.title === 'first' && r.body.done === false && r.body.tags[0] === 'a')
  const firstId = r.body.id
  call('POST /api/items', { body: { title: 'second', done: true } })
  call('POST /api/items', { user: { sub: 9 }, body: { title: 'other-user' } })

  ok('POST without the required field → 400', call('POST /api/items', { body: { notes: 'no title' } }).code === 400)

  // list is scoped to the owner
  r = call('GET /api/items')
  ok('GET lists only the caller’s rows (scoped)', Array.isArray(r.body) && r.body.length === 2)
  // filter: done=true
  r = call('GET /api/items', { query: { done: '1' } })
  ok('GET ?done=1 filters via the declared dataset filter', r.body.length === 1 && r.body[0].title === 'second')

  // update (partial) — toggles done
  r = call('PATCH /api/items/:id', { params: { id: String(firstId) }, body: { done: true } })
  ok('PATCH updates the row for the owner', r.code === 200 && r.body.done === true)
  // cross-user update is a 404 (ownership enforced)
  ok('PATCH another user’s row → 404', call('PATCH /api/items/:id', { user: { sub: 9 }, params: { id: String(firstId) }, body: { done: false } }).code === 404)

  // delete
  ok('DELETE removes the owner’s row', call('DELETE /api/items/:id', { params: { id: String(firstId) } }).body.ok === true)
  ok('DELETE a missing row → 404', call('DELETE /api/items/:id', { params: { id: '99999' } }).code === 404)
  ok('list reflects the delete', call('GET /api/items').body.length === 1)
}

/* ═══ D2 · Connector primitive ═══════════════════════════════════════════════ */
section('D2 · connector primitive (defineConnector)')
const { defineConnector } = require('../src/server/connector.js')

// A connector wrapping a fictional upstream calendar API as a suite peer.
const cal = defineConnector({
  app: 'demo', id: 'cal', label: 'Example Calendar', base: 'https://api.example.com/v1',
  auth: { kind: 'bearer', env: 'EXAMPLE_CAL_TOKEN' },
  reads: [{
    id: 'events', label: 'Events',
    upstream: { path: '/calendar/events', query: { expand: 'true' } },
    collection: 'data.items',                       // the array is nested at data.items
    map: { id: 'uid', title: 'summary.text', when: 'start.dateTime' },
    item: [
      { name: 'id', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'when', type: 'string' },
    ],
    filters: [{ name: 'q', type: 'string', label: 'Search' }],
  }],
  actions: [{
    id: 'createEvent', label: 'Add event', method: 'POST',
    upstream: { path: '/calendar/events' },
    map: { title: 'summary' },                      // wire 'title' → upstream 'summary'
    body: [
      { name: 'title', type: 'string', required: true },
      { name: 'when', type: 'string' },
    ],
    returns: [{ name: 'id', type: 'string' }],
    scopes: ['demo:write'],
  }],
})

// The SERVED docs are clean Layer-A (no upstream/map leakage) and valid.
ok('serves clean datasets (no upstream/map keys)', (() => {
  const d = cal.datasets[0]
  return d.path === '/events' && d.item && !('upstream' in d) && !('map' in d)
})())
ok('serves clean capabilities (no upstream/map keys)', (() => {
  const c = cal.capabilities[0]
  return c.id === 'createEvent' && c.method === 'POST' && !('upstream' in c) && !('map' in c) && c.scopes[0] === 'demo:write'
})())
ok('connector datasetDoc passes checkDocShape', checkDocShape({ app: 'demo', version: 1, datasets: cal.datasets }, 'datasets') === null)
ok('connector capabilityDoc passes checkDocShape', checkDocShape({ app: 'demo', version: 1, capabilities: cal.capabilities }, 'capabilities') === null)

// A mock fetch records the request and returns canned upstream JSON.
let lastReq = null
const mockFetch = async (url, init = {}) => {
  lastReq = { url: url.toString(), method: init.method, headers: init.headers || {}, body: init.body }
  if (url.toString().includes('/calendar/events') && (init.method || 'GET') === 'GET') {
    return { ok: true, status: 200, json: async () => ({ data: { items: [
      { uid: 'e1', summary: { text: 'Standup' }, start: { dateTime: '2026-07-01T09:00' } },
      { uid: 'e2', summary: { text: 'Review' }, start: { dateTime: '2026-07-02T15:00' } },
    ] } }) }
  }
  return { ok: true, status: 201, json: async () => ({ id: 'created-1' }) }
}

const routes2 = {}
const router2 = {
  get: (p, h) => { routes2[`GET ${p}`] = h },
  post: (p, h) => { routes2[`POST ${p}`] = h },
  patch: (p, h) => { routes2[`PATCH ${p}`] = h },
  delete: (p, h) => { routes2[`DELETE ${p}`] = h },
}
cal.mount(router2, { fetch: mockFetch, token: 'secret-tok' })
ok('mount wired the read GET + action POST', typeof routes2['GET /api/events'] === 'function' && typeof routes2['POST /api/createEvent'] === 'function')

const res2 = () => ({ code: 200, body: undefined, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } })
const call2 = async (key, { body = {}, query = {} } = {}) => { const r = res2(); await routes2[key]({ body, query, params: {} }, r); return r }

// READ — maps the nested upstream collection to the declared rows via the dotted map.
let rr = await call2('GET /api/events', { query: { q: 'rev' } })
ok('GET maps the nested upstream collection → declared rows', rr.body.length === 2 && rr.body[0].id === 'e1' && rr.body[0].title === 'Standup' && rr.body[0].when === '2026-07-01T09:00')
ok('GET applies bearer auth to the upstream request', (lastReq.headers['Authorization'] === 'Bearer secret-tok'))
ok('GET passes the declared filter + static query through to the upstream', lastReq.url.includes('q=rev') && lastReq.url.includes('expand=true'))

// ACTION — maps the wire body to the upstream body and returns the upstream result.
rr = await call2('POST /api/createEvent', { body: { title: 'New', when: 'x' } })
ok('POST returns the upstream result (201)', rr.code === 201 && rr.body.id === 'created-1')
ok('POST maps wire field → upstream key (title → summary)', (() => { const b = JSON.parse(lastReq.body); return b.summary === 'New' && b.when === 'x' && !('title' in b) })())

/* ═══ G1 · On-behalf-of delegation seam ═══════════════════════════════════════ */
section('G1 · delegation (applyDelegation + weaveWriteGate)')
const { applyDelegation } = require('../src/server/delegation.js')
const { weaveWriteGate } = require('../src/server/index.js')

// applyDelegation rewrites a delegated service token's effective subject to the act user.
ok('delegated service token → effective sub becomes the acting user', (() => {
  const u = { typ: 'service', sub: 'svc:trigger', act: '42', scope: ['demo:write'] }
  applyDelegation(u)
  return u.sub === '42' && u.delegated === true && u.svc === 'svc:trigger'
})())
ok('a normal user token is untouched', (() => {
  const u = { sub: '7', role: 'user' }
  applyDelegation(u)
  return u.sub === '7' && !u.delegated && u.svc === undefined
})())
ok('a non-delegated service token is untouched (no act)', (() => {
  const u = { typ: 'service', sub: 'svc:cron', scope: ['demo:read'] }
  applyDelegation(u)
  return u.sub === 'svc:cron' && !u.delegated
})())
ok('applyDelegation is idempotent', (() => {
  const u = { typ: 'service', sub: 'svc:t', act: '9' }
  applyDelegation(u); applyDelegation(u)
  return u.sub === '9' && u.svc === 'svc:t'
})())

// The write-gate now lifts NO_USER_CONTEXT for a delegated token, still enforcing scope.
const gate = weaveWriteGate({ scope: 'demo:write' })
const gateRes = () => ({ code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } })
const runGate = (user, method = 'POST') => {
  const res = gateRes(); let passed = false
  gate({ method, user }, res, () => { passed = true })
  return { passed, code: res.code, errCode: res.body && res.body.code }
}
ok('write with no identity → 401 NO_AUTH', runGate(undefined).errCode === 'NO_AUTH')
ok('guest write → 403 READ_ONLY', runGate({ role: 'guest' }).errCode === 'READ_ONLY')
ok('plain service write → 403 NO_USER_CONTEXT', runGate({ typ: 'service', sub: 'svc:cron', scope: ['demo:write'] }).errCode === 'NO_USER_CONTEXT')
ok('DELEGATED service write with the scope → passes', runGate({ typ: 'service', sub: '42', delegated: true, scope: ['demo:write'] }).passed === true)
ok('delegated service write WITHOUT the scope → 403 INSUFFICIENT_SCOPE', runGate({ typ: 'service', sub: '42', delegated: true, scope: ['other:write'] }).errCode === 'INSUFFICIENT_SCOPE')
ok('reads need no extra gate (GET passes through)', runGate({ role: 'guest' }, 'GET').passed === true)

/* ═══ D3 · Trigger primitive (+ F4 typed flow) ════════════════════════════════ */
section('D3 · trigger primitive (engine + bindings + F4 stud-fit)')
const { resolveBindings, validateTriggerTypes, createTriggerEngine, triggerWebhook, serverDispatch } = require('../src/server/trigger.js')

// resolveBindings — F4's flow: pull event-payload fields into the DO body; literals pass.
ok('resolveBindings maps bindings (incl. dotted) + keeps literals', (() => {
  const r = resolveBindings({ title: { from: 'title' }, n: { from: 'nested.n' }, lit: 'fixed' }, { title: 'Hi', nested: { n: 3 } })
  return r.title === 'Hi' && r.n === 3 && r.lit === 'fixed'
})())

// validateTriggerTypes — the typed-stud fit between the WHEN returns and the DO body.
const whenReturns = items.item                       // beigeboard.items row (id/title/done/…)
const doBody = items.capabilities[0].body            // createItem body (title required, …)
const mkTrigger = (body) => ({ id: 't', label: 'l', when: { app: 'bb', capability: 'createItem' }, do: { app: 'demo', capability: 'createItem', body } })

ok('a well-typed trigger has no issues (string → string)', validateTriggerTypes(mkTrigger({ title: { from: 'title' } }), { whenReturns, doBody }).length === 0)
ok('type mismatch is caught (boolean → string)', (() => {
  const issues = validateTriggerTypes(mkTrigger({ title: { from: 'done' } }), { whenReturns, doBody })
  return issues.length === 1 && /type mismatch/.test(issues[0].msg)
})())
ok('binding from a non-existent WHEN field is caught', (() => {
  const issues = validateTriggerTypes(mkTrigger({ title: { from: 'ghost' } }), { whenReturns, doBody })
  return issues.some((i) => /no such field/.test(i.msg))
})())
ok('a DO field that does not exist is caught', (() => {
  const issues = validateTriggerTypes(mkTrigger({ nope: 'x', title: { from: 'title' } }), { whenReturns, doBody })
  return issues.some((i) => /no body field 'nope'/.test(i.msg))
})())
ok('a required DO field left unbound is caught', (() => {
  const issues = validateTriggerTypes(mkTrigger({}), { whenReturns, doBody })
  return issues.some((i) => /required DO field 'title' is unbound/.test(i.msg))
})())

// The engine — what fires, with what resolved body, under whose authority.
const calls = []
const engine = createTriggerEngine({
  dispatch: async (doSpec, body, ctx) => { calls.push({ app: doSpec.app, body, actingUser: ctx.actingUser }); return { ok: true } },
  triggers: [
    { id: 't1', label: 'mirror to demo', when: { app: 'beigeboard', capability: 'createItem' }, do: { app: 'demo', capability: 'createItem', body: { title: { from: 'title' }, ext_ref: 'bb' } } },
    { id: 't2', label: 'disabled', enabled: false, when: { app: 'beigeboard', capability: 'createItem' }, do: { app: 'demo', capability: 'createItem', body: {} } },
    { id: 't3', label: 'fixed user', when: { app: 'beigeboard', capability: 'createItem' }, do: { app: 'demo', capability: 'createItem', actingUser: '99', body: { title: { from: 'title' } } } },
  ],
})
const fired = await engine.emit('beigeboard', 'createItem', { title: 'Buy milk', id: 5 }, { actingUser: '7' })
ok('emit fires the matching ENABLED triggers (skips disabled)', fired.length === 2 && fired.every((f) => f.ok))
ok('the DO body is resolved (binding + literal)', calls[0].body.title === 'Buy milk' && calls[0].body.ext_ref === 'bb')
ok("actingUser defaults to the event's user", calls[0].actingUser === '7')
ok('do.actingUser pins a fixed user (overrides the event user)', calls[1].actingUser === '99')
ok('a non-matching event fires nothing', (await engine.emit('other', 'x', {})).length === 0)

// A dispatch that throws is captured per-trigger, never crashes the emit.
const boomEngine = createTriggerEngine({
  dispatch: async () => { throw new Error('peer down') },
  triggers: [{ id: 'b', label: 'b', when: { app: 'a', capability: 'c' }, do: { app: 'd', capability: 'e' } }],
})
const boomResult = await boomEngine.emit('a', 'c', {})
ok('a failing dispatch is captured (ok:false + error), not thrown', boomResult[0].ok === false && /peer down/.test(boomResult[0].error))

// triggerWebhook — a peer pushes an event.
const wh = triggerWebhook(engine)
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } })
let wr = mkRes(); await wh({ body: { app: 'beigeboard', capability: 'createItem', payload: { title: 'Z' } }, user: { sub: '7' } }, wr)
ok('triggerWebhook fires on a pushed event', wr.body.fired.length === 2)
wr = mkRes(); await wh({ body: { capability: 'createItem' } }, wr)
ok('triggerWebhook rejects a malformed event (400)', wr.code === 400)

ok('serverDispatch requires a resolve()', (() => { try { serverDispatch({}); return false } catch { return true } })())

/* ═══ Calendar primitive · updateItem contract + source-hook mapping ══════════ */
// The @jkos/cards calendar primitive plugs onto a peer's `items` collection via
// useCalendarSource, whose reschedule path REQUIRES a general `updateItem`
// capability (completeItem only flips `completed`). These assert the declared
// contract is wide enough to drive cross-app drag, and that the source hook maps
// each callback onto the matching capability — the load-bearing seam of the plan.
section('Calendar · updateItem capability + useCalendarSource mapping')
const ROOT = resolve(HERE, '..', '..', '..')
const disc = require(join(ROOT, 'apps', 'beigeboard', 'backend', 'discovery.js'))
const caps = disc.CAPABILITIES.capabilities
const upd = caps.find((c) => c.id === 'updateItem')
ok('discovery declares an updateItem capability', !!upd)
ok('updateItem is PATCH /items/:id', upd.method === 'PATCH' && upd.path === '/items/:id')
ok('updateItem body requires id, fields optional', (() => {
  const id = upd.body.find((f) => f.name === 'id')
  return id?.required === true && upd.body.filter((f) => f.name !== 'id').every((f) => !f.required)
})())
ok('updateItem patches the schedulable fields (date/time/end)', (() => {
  const n = new Set(upd.body.map((f) => f.name))
  return ['due_date', 'end_date', 'scheduled_time', 'scheduled_end'].every((k) => n.has(k))
})())
ok('updateItem returns the row shape + invalidates the items key', upd.returns === disc.ITEM_SHAPE && upd.invalidates[0] === 'beigeboard.items')
ok('updateItem carries the write scope', upd.scopes[0] === 'beigeboard:write')
ok('ITEM_SHAPE widened to the full calendar field set', (() => {
  const n = new Set(disc.ITEM_SHAPE.map((f) => f.name))
  return ['scope', 'parent_id', 'accent', 'source', 'end_date', 'scheduled_end'].every((k) => n.has(k))
})())

const hookSrc = readFileSync(join(ROOT, 'packages', 'cards', 'src', 'useCalendarSource.ts'), 'utf8')
const MAPPING = [
  ['onAddItem', 'createItem'],
  ['onUpdateItem', 'updateItem'],
  ['onToggle', 'completeItem'],
  ['onDelete', 'deleteItem'],
]
for (const [cb, cap] of MAPPING) {
  ok(`useCalendarSource maps ${cb} → ${cap}`, new RegExp(`${cb}[\\s\\S]{0,120}command\\(\\s*['"]${cap}['"]`).test(hookSrc))
}
ok('useCalendarSource subscribes the read to the resource key (live reschedule)', /invalidateOn:\s*\[key\]/.test(hookSrc))

console.log(`\nPASS: ${pass} passed, 0 failed${skip ? `, ${skip} skipped` : ''}`)

// @jkos/weave server tests — the cross-boundary contract guards.
//
//  1. CJS ⇄ ESM export parity: every CommonJS face in package.json's `exports` is
//     `import`ed straight from its .js file (there are no hand-kept .mjs twins), so
//     this asserts Node's own CJS lexer sees every name `require` sees. A face whose
//     module.exports it can't read statically would give `import` callers a smaller API.
//  2. doc-shape validator: the single rule (shared/docShape.js) the producer
//     (contracts.js, throw) and the peer reader (fetchCapabilities/fetchDatasets,
//     return null) both run — proven to accept a good doc and reject each defect.
//  3. AppId union ⇄ APPS parity.
//  4. dataset answers vs declarations (shared/datasetShape.js): the check every app's
//     smoke runs against its real endpoints — proven to pass a faithful answer and to
//     name each way an answer can betray its declaration.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
let pass = 0
const ok = (label, cond, detail = '') => {
  assert.ok(cond, `${label} ${detail}`)
  pass++
  console.log(`  ✓ ${label}`)
}

// ── 1. server entry parity ──────────────────────────────────────────────────────
console.log('1 · CJS/ESM server export parity')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const cjsFaces = Object.entries(pkg.exports).filter(([, target]) => /\/server\/.*\.js$/.test(target))
ok('package.json declares the CJS server faces', cjsFaces.length >= 6, `(${cjsFaces.length})`)
for (const [sub, target] of cjsFaces) {
  const spec = `@jkos/weave${sub.slice(1)}`
  const c = require(spec)
  const e = await import(spec)
  const missing = Object.keys(c).filter((k) => e[k] !== c[k])
  ok(`import('${spec}') exposes every name require() does, as the same reference`, missing.length === 0,
    `\n    ${target}: missing or different under import: ${missing}`)
  ok(`  its default is the CJS module`, e.default === c)
}
const cjs = require('@jkos/weave/server')

// ── 2. doc-shape validator ───────────────────────────────────────────────────────
console.log('2 · shared doc-shape validator')
const { checkDocShape, isValidDoc } = require('../src/shared/docShape.js')
const { serveDatasets, serveCapabilities } = cjs

const goodDs = { app: 'beigeboard', version: 1, datasets: [{ id: 'items' }] }
ok('valid dataset doc passes', checkDocShape(goodDs, 'datasets') === null)
ok('isValidDoc agrees', isValidDoc(goodDs, 'datasets') === true)
ok('missing app rejected', !!checkDocShape({ version: 1, datasets: [] }, 'datasets'))
ok('non-numeric version rejected', !!checkDocShape({ app: 'x', version: '1', datasets: [] }, 'datasets'))
ok('non-array list rejected', !!checkDocShape({ app: 'x', version: 1, datasets: {} }, 'datasets'))
ok('entry without string id rejected', !!checkDocShape({ app: 'x', version: 1, datasets: [{ name: 'no-id' }] }, 'datasets'))
// Paths are relative to apiBase — consumers build `${apiBase}${path}`, so a declared
// '/api/lazuros/query' became '/api/lazuros/api/lazuros/query' at the edge.
ok('relative entry path passes', checkDocShape({ app: 'x', version: 1, capabilities: [{ id: 'a', method: 'POST', path: '/items/:id' }] }, 'capabilities') === null)
ok('entry path repeating the edge prefix rejected', /edge prefix/.test(checkDocShape({ app: 'x', version: 1, capabilities: [{ id: 'a', method: 'POST', path: '/api/x/a' }] }, 'capabilities') || ''))
ok('entry path without a leading slash rejected', !!checkDocShape({ app: 'x', version: 1, datasets: [{ id: 'd', path: 'items' }] }, 'datasets'))

// the producer (serve handlers) throws on a bad doc, returns a handler on a good one
assert.throws(() => serveDatasets({ app: 'x', version: 1, datasets: [{}] }), /needs a string id/)
ok('serveDatasets throws on a malformed doc (producer fails loud)', true)
ok('serveDatasets returns a handler for a good doc', typeof serveDatasets(goodDs) === 'function')
ok('serveCapabilities validates against the capabilities list', typeof serveCapabilities(
  { app: 'beigeboard', version: 1, capabilities: [{ id: 'createItem' }] }) === 'function')

// ── 3. AppId union ⇄ APPS parity ────────────────────────────────────────────────
// The `AppId` literal tuple in suite-manifest's apps.d.ts is the ONE typed mirror
// of the runtime APPS rows (a .d.ts cannot derive literals from CJS). Weave's
// public app-addressing signatures are typed on it, so if the two lists drift a
// registered app becomes unaddressable (or a ghost id typechecks). Fail red here;
// `pnpm new-app` patches both files.
console.log('3 · AppId union ⇄ APPS parity')
const { APPS, APP_IDS } = require('@jkos/suite-manifest')
ok('APP_IDS derives from APPS (same ids, same order)',
  JSON.stringify(APP_IDS) === JSON.stringify(APPS.map((a) => a.id)))
const dts = readFileSync(new URL('../../suite-manifest/apps.d.ts', import.meta.url), 'utf8')
const tuple = dts.match(/export declare const APP_IDS: readonly \[([^\]]*)\]/)
ok('apps.d.ts declares the APP_IDS literal tuple', !!tuple)
const dtsIds = tuple[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
ok('apps.d.ts AppId union matches the runtime APPS ids',
  JSON.stringify(dtsIds) === JSON.stringify([...APP_IDS]),
  `\n    d.ts:    ${dtsIds}\n    runtime: ${[...APP_IDS]}`)

// ── 4. dataset answers vs declarations ─────────────────────────────────────────
console.log('4 · dataset answers vs declarations')
const { checkDatasetAnswer, cardinalityOf } = await import('../src/shared/datasetShape.js')
ok('a cardinality other than many/one is refused by the doc shape',
  /cardinality/.test(checkDocShape({ app: 'x', version: 1, datasets: [{ id: 'd', cardinality: 'single' }] }, 'datasets') || ''))
ok('cardinality one passes the doc shape', checkDocShape({ app: 'x', version: 1, datasets: [{ id: 'd', cardinality: 'one' }] }, 'datasets') === null)
ok('cardinality defaults to many', cardinalityOf({ id: 'd' }) === 'many' && cardinalityOf({ id: 'd', cardinality: 'one' }) === 'one')

const ROWS = { id: 'jobs', item: [
  { name: 'id', type: 'string' }, { name: 'n', type: 'number' }, { name: 'done', type: 'boolean' },
  { name: 'day', type: 'date' }, { name: 'at', type: 'time' }, { name: 'status', type: 'enum', enum: ['A', 'B'] },
  { name: 'result', type: 'json' }, { name: 'task', type: 'ref' },
] }
const row = { id: 'x', n: 1, done: false, day: '2026-09-29', at: '09:41', status: 'A', result: { a: 1 }, task: 4 }
ok('a faithful list answer has no problems', checkDatasetAnswer(ROWS, [row, { ...row, result: null, n: null }]).length === 0)
ok('an empty list is a faithful answer', checkDatasetAnswer(ROWS, []).length === 0)
ok('an enveloped list is named (the library / discover defect)',
  /answered an object/.test(checkDatasetAnswer(ROWS, { count: 1, entries: [row] }).join()))
ok('an undeclared field is named', /'extra'.*does not declare/.test(checkDatasetAnswer(ROWS, [{ ...row, extra: 1 }]).join()))
ok('a declared field the row lacks is named', /'day' and row 0 does not carry it/.test(checkDatasetAnswer(ROWS, [(({ day, ...r }) => r)(row)]).join()))
for (const [field, bad] of [['n', '1'], ['done', 1], ['day', '29/09/2026'], ['at', '9am'], ['status', 'C'], ['result', '{"a":1}'], ['task', true], ['id', 3]]) {
  ok(`a ${field} of the wrong type is named`, checkDatasetAnswer(ROWS, [{ ...row, [field]: bad }]).some((p) => p.includes(`.${field} is declared`)))
}
const ONE = { id: 'stats', cardinality: 'one', item: [{ name: 'total', type: 'number' }] }
ok('a faithful one-document answer has no problems', checkDatasetAnswer(ONE, { total: 3 }).length === 0)
ok('a list where one document is declared is named', /one document.*an array/.test(checkDatasetAnswer(ONE, [{ total: 3 }]).join()))
ok('a declared field named twice is named', /twice/.test(checkDatasetAnswer({ id: 'd', item: [{ name: 'a', type: 'json' }, { name: 'a', type: 'string' }] }, []).join()))
ok('an undeclared item checks only the envelope', checkDatasetAnswer({ id: 'd' }, [{ anything: 1 }]).length === 0)
// `of` — a json field that is a list of scalars (tags, genres)
const TAGS = { id: 't', item: [{ name: 'tags', type: 'json', of: 'string' }] }
ok('a json `of: string` field passes a string[]', checkDatasetAnswer(TAGS, [{ tags: ['a', 'b'] }, { tags: [] }]).length === 0)
ok('…and names a number inside it', /tags is declared 'json' of 'string'/.test(checkDatasetAnswer(TAGS, [{ tags: ['a', 2] }]).join()))
ok('…and names a bare string where the list belongs', checkDatasetAnswer(TAGS, [{ tags: 'a,b' }]).length === 1)
// nested `item` — a one-document answer that carries rows ({ basis, results })
const DOCROWS = { id: 'similar', cardinality: 'one', item: [
  { name: 'basis', type: 'string' },
  { name: 'results', type: 'json', item: [{ name: 'id', type: 'number' }, { name: 'title', type: 'string' }] },
] }
ok('a document with declared rows passes', checkDatasetAnswer(DOCROWS, { basis: 'mesh', results: [{ id: 1, title: 'a' }] }).length === 0)
ok('…its rows are held to their own item (an undeclared row field is named with its path)',
  /'similar\.results' answers the field 'extra'/.test(checkDatasetAnswer(DOCROWS, { basis: 'mesh', results: [{ id: 1, title: 'a', extra: 1 }] }).join()))
ok('…and a row field of the wrong type is named', /'similar\.results'\.id is declared 'number'/.test(checkDatasetAnswer(DOCROWS, { basis: 'x', results: [{ id: '1', title: 'a' }] }).join()))

console.log(`\nPASS: ${pass} passed, 0 failed`)

// @jkos/weave server tests — the cross-boundary contract guards.
//
//  1. CJS ⇄ ESM export parity: index.mjs hand-re-exports each name from index.js,
//     so a name added to one but not the other silently gives `import` consumers a
//     different API than `require` consumers. This fails the build if they drift.
//  2. doc-shape validator: the single rule (shared/docShape.js) the producer
//     (contracts.js, throw) and the peer reader (fetchCapabilities/fetchDatasets,
//     return null) both run — proven to accept a good doc and reject each defect.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let pass = 0
const ok = (label, cond, detail = '') => {
  assert.ok(cond, `${label} ${detail}`)
  pass++
  console.log(`  ✓ ${label}`)
}

// ── 1. server entry parity ──────────────────────────────────────────────────────
console.log('1 · CJS/ESM server export parity')
const cjs = require('../src/server/index.js')
const esm = await import('../src/server/index.mjs')

const cjsKeys = Object.keys(cjs).sort()
const esmKeys = Object.keys(esm).filter((k) => k !== 'default').sort()
ok('index.mjs exports exactly index.js\'s names', JSON.stringify(cjsKeys) === JSON.stringify(esmKeys),
  `\n    cjs: ${cjsKeys}\n    esm: ${esmKeys}`)
for (const k of cjsKeys) {
  ok(`  ${k} is the same reference across CJS and ESM`, esm[k] === cjs[k])
}
ok('esm default is the CJS module', esm.default === cjs)

// The lean subpath twins (@jkos/weave/collection · /connector) — each .mjs must
// surface its .js default + named factory, same drift guard as the server entry.
for (const [sub, fn] of [['collection', 'defineCollection'], ['connector', 'defineConnector'], ['libraryScanner', 'defineLibraryScanner']]) {
  const c = require(`../src/server/${sub}.js`)
  const e = await import(`../src/server/${sub}.mjs`)
  ok(`${sub}.mjs default === ${sub}.js`, e.default === c)
  ok(`${sub}.mjs re-exports ${fn} (same ref)`, e[fn] === c[fn] && typeof c[fn] === 'function')
}

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
const { readFileSync } = await import('node:fs')
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

console.log(`\nPASS: ${pass} passed, 0 failed`)

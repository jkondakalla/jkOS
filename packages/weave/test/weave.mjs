// @jkos/weave server tests — the cross-boundary contract guards.
//
//  1. CJS ⇄ ESM export parity: every CommonJS face in package.json's `exports` is
//     `import`ed straight from its .js file (there are no hand-kept .mjs twins), so
//     this asserts Node's own CJS lexer sees every name `require` sees. A face whose
//     module.exports it can't read statically would give `import` callers a smaller API.
//  2. doc-shape validator: the single rule (shared/docShape.js) the producer
//     (contracts.js, throw) and the peer reader (fetchCapabilities/fetchDatasets,
//     return null) both run — proven to accept a good doc and reject each defect.

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

console.log(`\nPASS: ${pass} passed, 0 failed`)

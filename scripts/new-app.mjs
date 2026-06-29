#!/usr/bin/env node
// new-app.mjs — scaffold a Layer-A-conformant jkOS app from ONE id (ToDo C1).
//
// The container half of the lego-kit: "add an app" is one command, not a dozen
// hand-edited files. From `<id>` it emits a backend wired with @jkos/weave/server, a
// frontend wired with @jkos/{auth-client,design,ui}, a root-context Dockerfile + the
// prod/staging compose files, AND registers the app in the ONE source of truth
// (@jkos/suite-manifest APPS) — from which the jkAuth registry seed, Weave's SUITE_APPS,
// the nginx peer proxy, and the suite-prober all derive. So the new app appears in
// GET /auth/apps and the ORDECK launcher with zero portal edits.
//
// The emitted capabilities are Layer-A-conformant (typed `returns`, no raw json escape)
// and validated here with the suite's own checkDocShape. BeigeBoard stays the reference.
//
//   pnpm new-app <id> [--name "Display Name"] [--port 3010]
//   pnpm new-app <id> --remove          # undo: deregister + delete apps/<id>
//
// After creating: `pnpm install` (links the new workspace packages), fill apps/<id>/.env,
// add the app's nginx server block (C2 / standalone.conf), then deploy. The weave peer
// proxy + the registry/manifest are already wired. nginx confs are bind-mounts → RESTART.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { checkDocShape } from '../packages/weave/src/shared/docShape.js'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TEMPLATES = join(HERE, 'templates', 'new-app')
const APPS_FILE = join(ROOT, 'packages', 'suite-manifest', 'apps.js')
const COMPOSE_FILE = join(ROOT, 'docker-compose.yml')
const NGINX_GEN = join(ROOT, 'infra', 'nginx', 'gen-nginx-weave.mjs')

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', off: '\x1b[0m' }
const ok = (m) => console.log(`${C.grn}✓${C.off} ${m}`)
const info = (m) => console.log(`${C.cyn}·${C.off} ${m}`)
const die = (m) => { console.error(`${C.red}✗ ${m}${C.off}`); process.exit(1) }

/* ── args ──────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--remove') flags.remove = true
  else if (a === '--name') flags.name = argv[++i]
  else if (a === '--port') flags.port = argv[++i]
  else if (a.startsWith('--')) die(`unknown flag: ${a}`)
  else positional.push(a)
}
const id = positional[0]
if (!id) die('usage: pnpm new-app <id> [--name "Name"] [--port 3010] [--remove]')
if (!/^[a-z][a-z0-9]*$/.test(id)) die(`invalid id '${id}' — lowercase letters/digits, leading letter (it becomes the edge slug, scope namespace, and bus-key prefix)`)

const sm = require(APPS_FILE)
const exists = sm.APPS.some((a) => a.id === id)
const appDir = join(ROOT, 'apps', id)

if (flags.remove) { remove(); process.exit(0) }

/* ── create ────────────────────────────────────────────────────────────── */
const NAME = flags.name || (id[0].toUpperCase() + id.slice(1))
const PORT = String(flags.port || 3010)
if (!/^\d+$/.test(PORT)) die(`invalid --port '${PORT}'`)
const DB = `${id}.db`
const IDUP = id.toUpperCase()

if (exists) die(`'${id}' is already in @jkos/suite-manifest APPS — pick another id (or --remove first)`)
if (existsSync(appDir)) die(`apps/${id}/ already exists — refusing to overwrite`)

const tokens = { __ID__: id, __NAME__: NAME, __PORT__: PORT, __DB__: DB, __IDUP__: IDUP }
const render = (text) => Object.entries(tokens).reduce((s, [k, v]) => s.split(k).join(v), text)

// template file → destination (relative to apps/<id>/)
const FILES = [
  ['backend.package.json',        'backend/package.json'],
  ['backend.server.js',           'backend/server.js'],
  ['backend.discovery.js',        'backend/discovery.js'],
  ['backend.env.example',         '.env.example'],
  ['frontend.package.json',       'package.json'],
  ['frontend.vite.config.ts',     'vite.config.ts'],
  ['frontend.index.html',         'index.html'],
  ['frontend.tsconfig.json',      'tsconfig.json'],
  ['frontend.main.tsx',           'src/main.tsx'],
  ['frontend.App.tsx',            'src/App.tsx'],
  ['frontend.app.css',            'src/app.css'],
  ['Dockerfile',                  'Dockerfile'],
  ['docker-compose.yml',          'docker-compose.yml'],
  ['docker-compose.staging.yml',  'docker-compose.staging.yml'],
  ['dockerignore',                '.dockerignore'],
  ['gitignore',                   '.gitignore'],
]

console.log(`\n${C.cyn}Scaffolding ${C.off}${NAME} ${C.dim}(id '${id}', port ${PORT})${C.off}\n`)

for (const [tpl, dest] of FILES) {
  const out = join(appDir, dest)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, render(readFileSync(join(TEMPLATES, tpl), 'utf8')))
}
ok(`wrote apps/${id}/ (${FILES.length} files)`)

registerApp()
addComposeInclude()
regenNginx()
validateDoc()

console.log(`\n${C.grn}Done.${C.off} apps/${id} is registered + wired — APPS row, compose include, nginx server block + peer routes all derive from the one APPS entry. Next:\n`)
console.log(`  ${C.dim}1.${C.off} pnpm install               ${C.dim}# link the new @jkos/${id}[-backend] workspace packages${C.off}`)
console.log(`  ${C.dim}2.${C.off} cp apps/${id}/.env.example apps/${id}/.env   ${C.dim}# fill identity + origins${C.off}`)
console.log(`  ${C.dim}3.${C.off} add the ${id}.jkos.net DNS record (Cloudflare), deploy, then RESTART nginx ${C.dim}(bind-mount — reload won't re-read)${C.off}`)
console.log(`\n  ${C.dim}verify:${C.off} pnpm test:contracts   ${C.dim}# the registry/manifest/nginx/prober all check against that APPS row${C.off}\n`)

/* ── steps ─────────────────────────────────────────────────────────────── */

function registerApp() {
  const text = readFileSync(APPS_FILE, 'utf8')
  const ANCHOR = '\n]\n\n/* ── derivations'
  if (!text.includes(ANCHOR)) die('could not find the APPS array close in apps.js — has its format changed?')
  const row =
`  {
    id: '${id}', name: '${NAME}', origin: 'https://${id}.jkos.net',
    allowedRoles: ['user', 'admin'],
    upstream: '${id}-app:${PORT}', health: true, api: true,
    capabilities: true, datasets: true,
    edge: 'standard', // GENERATED nginx server block + staging subpath (gen-nginx-weave.mjs)
  },`
  const next = text.replace(ANCHOR, `\n${row}${ANCHOR}`)
  writeFileSync(APPS_FILE, next)
  ok(`registered '${id}' in @jkos/suite-manifest APPS`)
}

function addComposeInclude() {
  let text = readFileSync(COMPOSE_FILE, 'utf8')
  const line = `  - path: apps/${id}/docker-compose.yml`
  if (text.includes(line)) return
  if (!text.endsWith('\n')) text += '\n'
  writeFileSync(COMPOSE_FILE, text + line + '\n')
  ok(`added apps/${id} to the root docker-compose.yml include list`)
}

function regenNginx() {
  // Regenerate all four nginx includes from the now-updated APPS: the peer routes
  // (weave-proxy{,-staging}.conf) AND, for an edge:'standard' app, its server block +
  // staging subpath (apps-generated{,-staging}.conf) — both already wired into standalone.conf.
  execFileSync('node', [NGINX_GEN], { cwd: ROOT, stdio: 'pipe' })
  ok('regenerated nginx peer routes + server block (RESTART nginx to apply — bind-mount)')
}

function validateDoc() {
  // Require the emitted discovery.js and run the suite's own checkDocShape on the real
  // objects. The new app has no node_modules yet, so intercept its bare requires and
  // resolve them against this checkout: @jkos/suite-manifest (already loaded as `sm`)
  // and @jkos/weave/collection (discovery derives its docs from defineCollection — load
  // the real module by absolute path; its own internal requires fall through this hook,
  // so its `@jkos/suite-manifest` resolves to `sm` too).
  const COLLECTION = join(ROOT, 'packages', 'weave', 'src', 'server', 'collection.js')
  const origLoad = Module._load
  Module._load = function (request, ...rest) {
    if (request === '@jkos/suite-manifest') return sm
    if (request === '@jkos/weave/collection') return origLoad.call(this, COLLECTION, ...rest)
    return origLoad.call(this, request, ...rest)
  }
  try {
    const { CAPABILITIES, DATASETS } = require(join(appDir, 'backend', 'discovery.js'))
    const ec = checkDocShape(CAPABILITIES, 'capabilities')
    const ed = checkDocShape(DATASETS, 'datasets')
    if (ec) die(`emitted CapabilityDoc invalid: ${ec}`)
    if (ed) die(`emitted DatasetDoc invalid: ${ed}`)
    const rawJson = CAPABILITIES.capabilities.filter(
      (c) => (c.returns || []).some((f) => f.type === 'json') || (c.body || []).some((f) => f.type === 'json'),
    )
    ok(`discovery docs valid — ${CAPABILITIES.capabilities.length} capabilities, ${DATASETS.datasets.length} dataset(s), all typed${rawJson.length ? `, ${C.yel}${rawJson.length} json-escape${C.off}` : ', no json escape'}`)
  } finally {
    Module._load = origLoad
  }
}

/* ── remove (undo) ─────────────────────────────────────────────────────── */
function remove() {
  if (!exists && !existsSync(appDir)) die(`'${id}' is not registered and apps/${id}/ does not exist — nothing to remove`)
  // 1. APPS row
  const text = readFileSync(APPS_FILE, 'utf8')
  const re = new RegExp(`\\n {2}\\{\\n {4}id: '${id}',[\\s\\S]*?\\n {2}\\},`)
  if (re.test(text)) { writeFileSync(APPS_FILE, text.replace(re, '')); ok(`deregistered '${id}' from APPS`) }
  else info(`no APPS row for '${id}' (already removed)`)
  // 2. compose include
  let cmp = readFileSync(COMPOSE_FILE, 'utf8')
  const line = `  - path: apps/${id}/docker-compose.yml\n`
  if (cmp.includes(line)) { writeFileSync(COMPOSE_FILE, cmp.replace(line, '')); ok('removed the docker-compose.yml include') }
  // 3. app dir
  if (existsSync(appDir)) { rmSync(appDir, { recursive: true, force: true }); ok(`deleted apps/${id}/`) }
  // 4. nginx
  regenNginx()
  console.log(`\n${C.grn}Removed '${id}'.${C.off} Run ${C.dim}pnpm install${C.off} to drop the workspace links.\n`)
}

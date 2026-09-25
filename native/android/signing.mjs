#!/usr/bin/env node
// signing.mjs — create (or read) the jkOS Android release key and put its fingerprint where
// every TWA's link verification will actually look.
//
//   pnpm android:signing              # create the key if absent, then sync assetlinks.json
//   pnpm android:signing -- --show    # print the fingerprint, change nothing
//
// This exists because the step it replaces is the single most common way a TWA ends up with a
// permanent URL bar. The fingerprint has to travel from a keystore, through `keytool`'s output,
// into infra/nginx/assetlinks.json, through the nginx generator, onto EVERY origin a TWA trusts
// — and each hop is silent when it goes wrong. Android reports a failed verification by
// simply... showing the browser chrome.
//
// ONE KEY SIGNS EVERY jkOS APP (alias `jkos`): jkOS, KourOS and jkOS Home. Separate keys in one
// keystore file behind one password would look like isolation without being any; one key is
// the honest shape, and one thing to back up. The TWA packages written into assetlinks.json
// come from native/shells.js, so a new TWA shell is covered by re-running this.
//
// ⚠️ THE KEYSTORE IS NOT IN THIS REPO, AND MUST NOT BE. It lives at
// ~/.jkos/android-release.keystore. It is the apps' permanent identity: lose it and you
// cannot ship an upgrade to the same apps — a differently-signed APK cannot install over the
// old one, its fingerprint differs, verification fails, and the URL bar comes back for good.
// Back it up somewhere that is not this machine.
//
// After running this, regenerate + deploy:
//   node infra/nginx/gen-nginx-weave.mjs && pnpm check:nginx
//   …deploy staging (it owns the nginx config), then RESTART nginx — not reload:
//   the confs are bind-mounts and a reload will not re-read a replaced inode.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const ASSETLINKS = join(ROOT, 'infra/nginx/assetlinks.json')
const { androidShells } = createRequire(import.meta.url)('../shells.js')

// Overridable so the path can be pointed elsewhere (a different machine layout, or a
// throwaway keystore when exercising this script) without editing it. build.mjs reads the
// same variable.
const KEYSTORE = process.env.JKOS_ANDROID_KEYSTORE || join(homedir(), '.jkos', 'android-release.keystore')
const ALIAS = 'jkos'
const VALIDITY_DAYS = 10000     // ~27 years; an app signing key should outlive the phone
const KEYTOOL = process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'keytool'))
  ? join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool'

// Only the TWAs need asset links: they are what Chrome verifies. jkOS Home is our own
// WebView and claims no origin.
const PACKAGES = androidShells().filter((s) => s.android === 'twa').map((s) => s.package)

const show = process.argv.includes('--show')

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }

/** The SHA-256 line out of `keytool -list`, normalised to AA:BB:… */
function fingerprintOf(keystore) {
  let out
  try {
    out = execFileSync(KEYTOOL, ['-list', '-v', '-keystore', keystore, '-alias', ALIAS], {
      encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
    })
  } catch (err) {
    die(`keytool could not read ${keystore}\n  ${(err.stderr || err.message || '').trim()}`)
  }
  const m = /SHA256:\s*([0-9A-Fa-f:]{95})/.exec(out)
  if (!m) die(`no SHA-256 fingerprint in keytool's output for alias "${ALIAS}"`)
  return m[1].toUpperCase()
}

if (!existsSync(KEYSTORE)) {
  if (show) die(`no keystore at ${KEYSTORE} — run without --show to create one`)
  console.log(`\nNo keystore at ${KEYSTORE} — creating one.`)
  console.log('keytool will ask for a password. CHOOSE YOUR OWN and record it in your')
  console.log('password manager: it is needed for every future build of these apps, and')
  console.log('there is no recovery.\n')
  mkdirSync(dirname(KEYSTORE), { recursive: true, mode: 0o700 })
  try {
    execFileSync(KEYTOOL, [
      '-genkeypair', '-v',
      '-storetype', 'PKCS12',
      '-keystore', KEYSTORE,
      '-alias', ALIAS,
      '-keyalg', 'RSA', '-keysize', '3072',
      '-validity', String(VALIDITY_DAYS),
      '-dname', 'CN=jkOS, O=jkOS, C=US',
    ], { stdio: 'inherit' })
  } catch {
    die('keytool failed — no keystore was created')
  }
}

const fingerprint = fingerprintOf(KEYSTORE)
console.log(`\nkeystore    ${KEYSTORE}`)
console.log(`alias       ${ALIAS}`)
console.log(`packages    ${PACKAGES.join(', ')}`)
console.log(`SHA-256     ${fingerprint}`)

if (show) process.exit(0)

const doc = JSON.parse(readFileSync(ASSETLINKS, 'utf8'))
const ours = (t) => /^net\.jkos\./.test(t?.target?.package_name || '')
// Every net.jkos.* entry is rewritten from shells.js, so a retired shell's package cannot
// linger here still claiming the origins. Anyone else's entries are left alone.
doc.targets = [
  ...(doc.targets || []).filter((t) => !ours(t)),
  ...PACKAGES.map((package_name) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name, sha256_cert_fingerprints: [fingerprint] },
  })),
]
writeFileSync(ASSETLINKS, JSON.stringify(doc, null, 2) + '\n')
console.log(`\n✓ ${PACKAGES.join(', ')} written into infra/nginx/assetlinks.json`)
console.log('\nNext:')
console.log('  node infra/nginx/gen-nginx-weave.mjs && pnpm check:nginx')
console.log('  deploy staging (it owns the nginx config), then RESTART nginx (bind-mounts)')
console.log(`  export JKOS_ANDROID_KEYSTORE=${KEYSTORE}`)
console.log('  read -rs JKOS_ANDROID_KEYSTORE_PASSWORD && export JKOS_ANDROID_KEYSTORE_PASSWORD')
console.log('  pnpm android:build -- assembleRelease')

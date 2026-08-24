#!/usr/bin/env node
// android-signing.mjs — create (or read) the KourOS release signing key and put its
// fingerprint where a TWA's link verification will actually look.
//
// This exists because the step it replaces is the single most common way a TWA ends
// up with a permanent URL bar. The fingerprint has to travel from a keystore, through
// `keytool`'s output, into infra/nginx/assetlinks.json, through the nginx generator,
// onto TWO origins — and every one of those hops is silent when it goes wrong. Android
// reports a failed verification by simply... showing the browser chrome.
//
//   node scripts/android-signing.mjs            # create if absent, then sync assetlinks
//   node scripts/android-signing.mjs --show     # print the fingerprint, change nothing
//
// ⚠️ THE KEYSTORE IS NOT IN THIS REPO, AND MUST NOT BE. It lives at
// ~/.jkos/kouros-release.keystore. It is the app's permanent identity: lose it and you
// cannot ship an upgrade to the same app — a differently-signed APK has a different
// fingerprint, verification fails, and the URL bar comes back for good. Back it up
// somewhere that is not this machine.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETLINKS = join(ROOT, 'infra/nginx/assetlinks.json')
// Overridable so the path can be pointed elsewhere (a different machine layout, or
// a throwaway keystore when exercising this script) without editing it.
const KEYSTORE = process.env.JKOS_KOUROS_KEYSTORE || join(homedir(), '.jkos', 'kouros-release.keystore')
const ALIAS = 'kouros'
const PACKAGE = 'net.jkos.kouros'
const VALIDITY_DAYS = 10000     // ~27 years; an app signing key should outlive the phone

const show = process.argv.includes('--show')

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }

/** The SHA-256 line out of `keytool -list`, normalised to AA:BB:… */
function fingerprintOf(keystore) {
  let out
  try {
    out = execFileSync('keytool', ['-list', '-v', '-keystore', keystore, '-alias', ALIAS], {
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
  console.log('password manager: it is needed for every future build of this app, and')
  console.log('there is no recovery.\n')
  mkdirSync(dirname(KEYSTORE), { recursive: true })
  try {
    execFileSync('keytool', [
      '-genkeypair', '-v',
      '-keystore', KEYSTORE,
      '-alias', ALIAS,
      '-keyalg', 'RSA', '-keysize', '2048',
      '-validity', String(VALIDITY_DAYS),
      '-dname', 'CN=KourOS, O=jkOS, C=US',
    ], { stdio: 'inherit' })
  } catch {
    die('keytool failed — no keystore was created')
  }
}

const fingerprint = fingerprintOf(KEYSTORE)
console.log(`\nkeystore    ${KEYSTORE}`)
console.log(`alias       ${ALIAS}`)
console.log(`package     ${PACKAGE}`)
console.log(`SHA-256     ${fingerprint}`)

if (show) process.exit(0)

const doc = JSON.parse(readFileSync(ASSETLINKS, 'utf8'))
const entry = {
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: [fingerprint] },
}
const others = (doc.targets || []).filter((t) => t?.target?.package_name !== PACKAGE)
doc.targets = [...others, entry]
writeFileSync(ASSETLINKS, JSON.stringify(doc, null, 2) + '\n')
console.log(`\n✓ ${PACKAGE} written into infra/nginx/assetlinks.json`)
console.log('\nNext:')
console.log('  node infra/nginx/gen-nginx-weave.mjs && pnpm check:nginx')
console.log('  deploy staging (it owns the nginx config), then RESTART nginx (bind-mounts)')
console.log('  npx @bubblewrap/cli init --manifest https://kouros.jkos.net/manifest.webmanifest')
console.log(`     …point it at the EXISTING keystore (${KEYSTORE}, alias ${ALIAS}),`)
console.log('     and set additional_trusted_origins: ["https://auth.jkos.net"]')
console.log('  npx @bubblewrap/cli build && adb install app-release-signed.apk')

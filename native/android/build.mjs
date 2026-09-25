#!/usr/bin/env node
// build.mjs — build the Android shells, in Docker or against a local SDK. Same toolchain,
// same caches, same debug key either way.
//
//   pnpm android:build                         # staging APKs (assembleDebug)
//   pnpm android:build -- assembleRelease      # production APKs — signed only if the keystore env is set
//   pnpm android:build -- --docker test        # force Docker; any Gradle task/args pass through
//   pnpm android:build -- --local  test        # force the local SDK
//
// WHICH ONE: --local / --docker if given; otherwise the local SDK when JAVA_HOME and
// ANDROID_HOME are both set, else Docker. A local SDK is one command away:
//   node native/android/toolchain.mjs install ~/Android/jkos --adb
//   eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"
//
// Both paths use GRADLE_USER_HOME=native/android/.gradle-home and
// ANDROID_USER_HOME=native/android/.android-home (both gitignored). The second holds the DEBUG
// signing key, so a staging APK built in Docker and one built locally are signed alike and
// install over each other — switching paths never forces an uninstall.
//
// RELEASE SIGNING: export JKOS_ANDROID_KEYSTORE (the file native/android/signing.mjs made) and
// JKOS_ANDROID_KEYSTORE_PASSWORD. Docker receives the password by NAME (`-e VAR`), so it never
// appears on a command line or in `ps`. Without them, release APKs come out explicitly unsigned.
//
// Every APK the run produced is copied to native/android/out/ as <shell>-<version>-<env>.apk.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const OUT = join(HERE, 'out')
const SHELLS = JSON.parse(readFileSync(join(HERE, 'shells.json'), 'utf8'))

const argv = process.argv.slice(2).filter((a) => a !== '--')
const force = argv.find((a) => a === '--docker' || a === '--local')
const gradleArgs = argv.filter((a) => a !== '--docker' && a !== '--local')
if (!gradleArgs.length) gradleArgs.push('assembleDebug')

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) die(`${cmd}: ${r.error.message}`)
  return r.status
}

const localReady = !!(process.env.JAVA_HOME && process.env.ANDROID_HOME)
const mode = force ? force.slice(2) : (localReady ? 'local' : 'docker')
if (mode === 'local' && !localReady) {
  die('--local needs JAVA_HOME and ANDROID_HOME. Install the pinned toolchain with:\n' +
      '    node native/android/toolchain.mjs install ~/Android/jkos --adb\n' +
      '    eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"')
}

const keystore = process.env.JKOS_ANDROID_KEYSTORE
if (keystore && !existsSync(keystore)) die(`JKOS_ANDROID_KEYSTORE points at ${keystore}, which does not exist`)
if (keystore && !process.env.JKOS_ANDROID_KEYSTORE_PASSWORD) {
  die('JKOS_ANDROID_KEYSTORE is set but JKOS_ANDROID_KEYSTORE_PASSWORD is not.\n' +
      '    read -rs JKOS_ANDROID_KEYSTORE_PASSWORD && export JKOS_ANDROID_KEYSTORE_PASSWORD')
}

const shared = {
  GRADLE_USER_HOME: join(HERE, '.gradle-home'),
  ANDROID_USER_HOME: join(HERE, '.android-home'),
}
const started = Date.now()
let status

if (mode === 'local') {
  console.log(`→ local SDK (JAVA_HOME=${process.env.JAVA_HOME})`)
  status = run(join(HERE, 'gradlew'), gradleArgs, { cwd: HERE, env: { ...process.env, ...shared } })
} else {
  // The image is named after the hash of everything that defines it, so a toolchain bump
  // builds a new image rather than reusing a stale one.
  const h = createHash('sha256')
  for (const f of ['Dockerfile', 'toolchain.json', 'toolchain.mjs']) h.update(readFileSync(join(HERE, f)))
  const image = `jkos-android-build:${h.digest('hex').slice(0, 12)}`
  const probe = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' })
  if (probe.error || (probe.status !== 0 && spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0)) {
    die('Docker is not usable from this account (on Emily, `jag` is not in the docker group).\n' +
        '  Either use a local SDK — no sudo, nothing outside the directory you name:\n' +
        '    node native/android/toolchain.mjs install ~/Android/jkos --adb\n' +
        '    eval "$(node native/android/toolchain.mjs env ~/Android/jkos)"\n' +
        '  or give this account Docker access (root-equivalent — your call).')
  }
  if (probe.status !== 0) {
    console.log(`→ building ${image} (once per toolchain change)`)
    if (run('docker', ['build', '-t', image, HERE]) !== 0) die('docker build failed')
  }
  // Paths inside the container mirror the repo at /repo.
  const inRepo = (p) => '/repo/' + p.slice(REPO.length + 1)
  const args = ['run', '--rm',
    '-u', `${process.getuid()}:${process.getgid()}`,
    '-e', 'HOME=/tmp',
    '-v', `${REPO}:/repo`,
    '-w', inRepo(HERE),
    '-e', `GRADLE_USER_HOME=${inRepo(shared.GRADLE_USER_HOME)}`,
    '-e', `ANDROID_USER_HOME=${inRepo(shared.ANDROID_USER_HOME)}`]
  if (keystore) {
    args.push('-v', `${dirname(keystore)}:/keys:ro`,
      '-e', `JKOS_ANDROID_KEYSTORE=/keys/${basename(keystore)}`,
      '-e', 'JKOS_ANDROID_KEYSTORE_PASSWORD') // by name: docker copies the value from our env
  }
  console.log(`→ docker (${image})`)
  status = run('docker', [...args, image, './gradlew', ...gradleArgs])
}

if (status !== 0) die(`gradle ${gradleArgs.join(' ')} failed (exit ${status})`)

// ── collect ───────────────────────────────────────────────────────────────────
// AGP names outputs <module>-[<flavor>-]<buildType>[-unsigned].apk.
const shellOf = (module, flavor) => module === 'home' ? SHELLS.home.id : flavor
const found = []
const walk = (d) => {
  if (!existsSync(d)) return
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.apk') && statSync(p).mtimeMs >= started - 1000) found.push(p)
  }
}
for (const module of ['twa', 'home']) walk(join(HERE, module, 'build', 'outputs', 'apk'))

if (found.length) {
  mkdirSync(OUT, { recursive: true })
  console.log('')
  for (const p of found) {
    const m = /^(twa|home)-(?:([a-z0-9]+)-)?(debug|release)(-unsigned)?\.apk$/.exec(basename(p))
    if (!m) continue
    const [, module, flavor, type, unsigned] = m
    const name = `${shellOf(module, flavor)}-${SHELLS.version}-${type === 'debug' ? 'staging' : 'release'}${unsigned || ''}.apk`
    copyFileSync(p, join(OUT, name))
    console.log(`✓ native/android/out/${name}`)
  }
  if (found.some((p) => p.endsWith('-unsigned.apk'))) {
    console.log('\n  -unsigned: release APKs need JKOS_ANDROID_KEYSTORE + _PASSWORD (see signing.mjs) to install.')
  }
}

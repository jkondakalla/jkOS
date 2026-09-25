#!/usr/bin/env node
// toolchain.mjs — install the pinned Android build toolchain (toolchain.json) into one directory.
//
//   node native/android/toolchain.mjs install <dir> [--adb] [--accept-licenses]
//   node native/android/toolchain.mjs env <dir>       # print the two exports a build needs
//
// <dir>/jdk  — Temurin JDK        (JAVA_HOME)
// <dir>/sdk  — Android SDK        (ANDROID_HOME): cmdline-tools, one platform, one build-tools
//
// No sudo, nothing outside <dir>. The Docker image runs this same script inside itself, so a
// container build and a local build use the same bytes — moving from one to the other is
// `install ~/Android/jkos` and nothing else.
//
// --adb              also install platform-tools (adb) — needed to push an APK to a phone,
//                    never needed to build one.
// --accept-licenses  answer "y" to the Android SDK licences. Without it sdkmanager shows each
//                    licence and asks you; the Dockerfile passes it because an image build
//                    cannot answer, and building the image is your acceptance.
//
// Every download is sha256-verified BEFORE it is unpacked, and a mismatch deletes the file.
// Re-running is cheap: a verified archive is not fetched twice.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
const TC = JSON.parse(readFileSync(join(HERE, 'toolchain.json'), 'utf8'))

const [cmd, dirArg] = process.argv.slice(2)
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')))

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }
if (!['install', 'env'].includes(cmd) || !dirArg || dirArg.startsWith('--')) {
  die('usage: toolchain.mjs install <dir> [--adb] [--accept-licenses]  |  toolchain.mjs env <dir>')
}
const DIR = resolve(dirArg)
const JDK = join(DIR, 'jdk')
const SDK = join(DIR, 'sdk')
const SDKMANAGER = join(SDK, 'cmdline-tools', 'latest', 'bin', 'sdkmanager')

if (cmd === 'env') {
  console.log(`export JAVA_HOME=${JSON.stringify(JDK)}`)
  console.log(`export ANDROID_HOME=${JSON.stringify(SDK)}`)
  process.exit(0)
}

async function sha256(file) {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}

/** Fetch `url` to `dest` unless a file with the right hash is already there. */
async function fetchVerified(label, url, want, dest) {
  if (existsSync(dest) && await sha256(dest) === want) {
    console.log(`✓ ${label}: cached, sha256 ok`)
    return
  }
  console.log(`… ${label}: downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) die(`${label}: HTTP ${res.status} from ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  const got = await sha256(dest)
  if (got !== want) {
    rmSync(dest, { force: true })
    die(`${label}: sha256 MISMATCH — refusing to unpack it\n  want ${want}\n  got  ${got}`)
  }
  console.log(`✓ ${label}: sha256 ok`)
}

/** Unpack into a scratch dir, then move its single top-level entry to `dest`. */
function unpackInto(archive, dest, unpack) {
  const tmp = `${dest}.unpacking`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  unpack(archive, tmp)
  const top = readdirSync(tmp)
  if (top.length !== 1) die(`${archive}: expected one top-level entry, found ${top.length}`)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  renameSync(join(tmp, top[0]), dest)
  rmSync(tmp, { recursive: true, force: true })
}

const STAMP = join(DIR, '.toolchain.json')
const stamp = existsSync(STAMP) ? JSON.parse(readFileSync(STAMP, 'utf8')) : {}
const DL = join(DIR, '.downloads')
mkdirSync(DL, { recursive: true })

// ── JDK ────────────────────────────────────────────────────────────────────────
if (stamp.jdk !== TC.jdk.sha256 || !existsSync(join(JDK, 'bin', 'java'))) {
  const a = join(DL, 'jdk.tar.gz')
  await fetchVerified(`JDK ${TC.jdk.version}`, TC.jdk.url, TC.jdk.sha256, a)
  unpackInto(a, JDK, (f, to) => execFileSync('tar', ['-xzf', f, '-C', to]))
  stamp.jdk = TC.jdk.sha256
  writeFileSync(STAMP, JSON.stringify(stamp, null, 2))
} else console.log(`✓ JDK ${TC.jdk.version}: installed`)

// ── Android command-line tools (sdkmanager) ────────────────────────────────────
if (stamp.cmdlineTools !== TC.cmdlineTools.sha256 || !existsSync(SDKMANAGER)) {
  const a = join(DL, 'cmdline-tools.zip')
  await fetchVerified(`cmdline-tools ${TC.cmdlineTools.version}`, TC.cmdlineTools.url, TC.cmdlineTools.sha256, a)
  // sdkmanager insists on living at <sdk>/cmdline-tools/latest/.
  unpackInto(a, join(SDK, 'cmdline-tools', 'latest'), (f, to) => execFileSync('unzip', ['-q', f, '-d', to]))
  stamp.cmdlineTools = TC.cmdlineTools.sha256
  writeFileSync(STAMP, JSON.stringify(stamp, null, 2))
} else console.log(`✓ cmdline-tools ${TC.cmdlineTools.version}: installed`)

// ── SDK packages ───────────────────────────────────────────────────────────────
const env = { ...process.env, JAVA_HOME: JDK, ANDROID_HOME: SDK }
const sdk = (args, opts = {}) => spawnSync(SDKMANAGER, [`--sdk_root=${SDK}`, ...args], { env, ...opts })

if (flags.has('--accept-licenses')) {
  const r = sdk(['--licenses'], { input: 'y\n'.repeat(32), stdio: ['pipe', 'ignore', 'inherit'] })
  if (r.status !== 0) die('sdkmanager --licenses failed')
} else {
  const r = sdk(['--licenses'], { stdio: 'inherit' })
  if (r.status !== 0) die('sdkmanager --licenses failed (licences must be accepted to install the SDK)')
}

const packages = [`platforms;android-${TC.compileSdk}`, `build-tools;${TC.buildTools}`]
if (flags.has('--adb')) packages.push('platform-tools')
console.log(`… sdkmanager ${packages.join(' ')}`)
const r = sdk(packages, { stdio: ['ignore', 'inherit', 'inherit'] })
if (r.status !== 0) die('sdkmanager could not install the SDK packages')

console.log(`\n✓ toolchain ready in ${DIR}\n`)
console.log(`  export JAVA_HOME=${JSON.stringify(JDK)}`)
console.log(`  export ANDROID_HOME=${JSON.stringify(SDK)}`)

#!/usr/bin/env node
// dist.mjs — package the desktop shells for Linux as .deb, one per desktop shell in
// native/shells.js, into native/desktop/out/<shell>/.
//
// ⚠️ .deb ONLY — NO AppImage, on purpose. Ubuntu 24.04+ sets
// kernel.apparmor_restrict_unprivileged_userns=1, so Chromium's renderer sandbox cannot start
// unless the binary has an AppArmor profile granting it user namespaces (or a setuid-root
// chrome-sandbox). The .deb's postinst installs exactly that profile. An AppImage can carry
// neither, so on this machine it only runs with --no-sandbox — which switches off the renderer
// sandbox for a window on the open web. Measured on Emily, 2026-09-24: an AppImage-style run
// dies with SIGSEGV at the first window.
//
//   pnpm dist                  # every desktop shell
//   pnpm dist -- --shell kouros
//
// Each package is the same code with the shell baked in (extraMetadata.jkosShell) — packaged
// apps point at production; `pnpm start` runs unpackaged against staging.
//
// The .deb's Maintainer is read from your git identity at build time, so no address is
// committed. Hardening that is not a runtime switch is set as Electron FUSES (flipped in the
// binary itself, so no flag or environment variable can turn them back on): no running as
// plain Node, no NODE_OPTIONS, no --inspect, only the app's own integrity-checked asar, and
// cookies encrypted at rest with the OS keyring.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(HERE, '..', '..')
const require = createRequire(import.meta.url)

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`\n✗ Electron's tooling needs Node >= 22.12 (this is ${process.version}). The suite runs Node 20;` +
    '\n  run this package with the newer one, e.g.  PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" pnpm dist\n')
  process.exit(1)
}

const { build, Platform } = require('electron-builder')
const SHELLS = JSON.parse(readFileSync(join(HERE, 'src', 'shells.json'), 'utf8'))
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))
if (PKG.version !== SHELLS.version) {
  console.error(`\n✗ package.json version ${PKG.version} ≠ native/shells.js VERSION ${SHELLS.version}\n`)
  process.exit(1)
}

const git = (k) => { try { return execFileSync('git', ['config', k], { encoding: 'utf8' }).trim() } catch { return '' } }
const maintainer = git('user.name') && git('user.email') ? `${git('user.name')} <${git('user.email')}>` : null
if (!maintainer) {
  console.error('\n✗ a .deb needs a Maintainer, read from your git identity: set git user.name and user.email\n')
  process.exit(1)
}

const only = process.argv.includes('--shell') ? process.argv[process.argv.indexOf('--shell') + 1] : null
const ids = Object.keys(SHELLS.shells).filter((id) => !only || id === only)
if (!ids.length) { console.error(`\n✗ no desktop shell '${only}'\n`); process.exit(1) }

for (const id of ids) {
  const s = SHELLS.shells[id]
  const name = s.release.name
  const exe = `jkos-${id}`
  console.log(`\n→ ${name} (${s.package})`)
  await build({
    targets: Platform.LINUX.createTarget(['deb']),
    publish: 'never',
    config: {
      appId: s.package,
      productName: name,
      directories: { output: join('out', id) },
      files: ['src/**/*', 'package.json'],
      asar: true,
      // desktopName is the Wayland app_id: without it KDE cannot tie the running window to
      // its .desktop entry (no icon, a generic taskbar item).
      extraMetadata: { jkosShell: id, name: exe, homepage: s.release.startUrl, desktopName: `${exe}.desktop` },
      linux: {
        executableName: exe,
        icon: join(REPO, s.icon),
        category: id === 'kouros' ? 'AudioVideo' : 'Network',
        synopsis: s.release.name,
        maintainer,
        syncDesktopName: true,
        desktop: { entry: { StartupWMClass: exe } },
      },
      electronFuses: {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false,
      },
    },
  })
}

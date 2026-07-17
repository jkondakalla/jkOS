// Dockerfile inject-sync conformance — keeps every SPA app's image build healthy.
//
// jkOS runs pnpm with `inject-workspace-packages=true` (.npmrc): a workspace dep
// that declares peerDependencies (e.g. @jkos/weave and @jkos/cards — both peer on
// react) is HARDLINK-COPIED into its consumer's store, not symlinked. The app
// Dockerfiles install deps in a manifest-only layer first (`COPY --parents
// **/package.json` then `pnpm install`) so that layer caches across source edits —
// but that freezes each injected copy with only its package.json and no src/. The
// frontend `COPY . .` then brings the real source into the repo tree, yet the
// injected store copy stays stale, so `tsc -b` fails with
// `TS2307 Cannot find module '@jkos/weave'` at build time.
//
// The fix (beigeboard/ordeck/sylibos already carry it) is a second `pnpm install`
// AFTER `COPY . .` and BEFORE the frontend build: it re-injects from the now-present
// source (the store is warm, so it only re-hardlinks — seconds). papyros shipped
// without it and its wave-6 deploy failed exactly this way. This asserts the
// invariant so it cannot silently regrow — in any app Dockerfile OR the new-app
// template that seeds them:
//
//   A Dockerfile with `COPY . .` followed by a frontend `pnpm --filter @jkos/<id>
//   build` MUST run `pnpm install` between the two.
//
// Backend-only / static images (jkauth, lazuros) have no such frontend build, so the
// pattern doesn't match them and they're exempt automatically.
//
// ── Check 2: deploy-bundle source closure ────────────────────────────────────
// The backend images run `pnpm --filter <pkg> deploy --prod /out` BEFORE `COPY . .`
// (so the expensive bundle caches across frontend edits), and the runtime image ships
// /out. That means every workspace package the bundle pulls in must have its SOURCE
// copied in ahead of the deploy — `pnpm deploy` copies what's on disk, so a package
// whose source is absent lands in /out as a bare package.json with no entrypoint and
// the container crash-loops at boot with MODULE_NOT_FOUND.
//
// Each Dockerfile lists those copies by hand, which silently rots the moment a shared
// package gains a new workspace dep: 2026-07-16 @jkos/weave gained @jkos/files (its
// server/mediaRoutes.js requires it at module load), no Dockerfile learned about it,
// and bb-app + papyros + kouros all crash-looped on deploy — while this gate stayed
// green, because check 1 only polices the re-install.
//
// The invariant asserted here is CLOSURE, which needs no per-app knowledge and works
// on the `__ID__` template too:
//
//   The set of packages/* copied before the deploy must be closed under workspace
//   dependencies — if you COPY a package, you COPY everything it depends on.
//
// A whole-directory `COPY packages/ packages/` (jkauth) is trivially closed and exempt.
//
// Run:  node test/dockerfile-inject.mjs   (wired as `pnpm check:docker`, folded
//                                           into `pnpm test:contracts`)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// sylibos is outside the maintained suite scope (leave-alone standing decision); its
// Dockerfile already satisfies the invariant, but this gate does not police it.
const SKIP = new Set(['sylibos']);

// Every app Dockerfile + the template that seeds new ones (so the protocol source
// itself can't regress).
const targets = [];
const appsDir = resolve(root, 'apps');
for (const name of readdirSync(appsDir)) {
  if (SKIP.has(name)) continue;
  const df = resolve(appsDir, name, 'Dockerfile');
  if (existsSync(df)) targets.push([`apps/${name}/Dockerfile`, df]);
}
targets.push([
  'scripts/templates/new-app/Dockerfile',
  resolve(root, 'scripts/templates/new-app/Dockerfile'),
]);

const COPY_ALL = /^COPY\s+\.\s+\.\s*$/;             // `COPY . .` — the full-source copy
const FE_BUILD = /pnpm\s+--filter\s+@jkos\/\S+\s+build\b/; // frontend build (not `-backend … deploy`)
const INSTALL = /pnpm\s+install\b/;

for (const [label, path] of targets) {
  const lines = readFileSync(path, 'utf8').split('\n');

  let copyIdx = -1;
  for (let i = 0; i < lines.length; i++) if (COPY_ALL.test(lines[i].trim())) copyIdx = i; // last one
  let buildIdx = -1;
  for (let i = copyIdx + 1; i < lines.length; i++) if (FE_BUILD.test(lines[i])) { buildIdx = i; break; }

  if (copyIdx === -1 || buildIdx === -1) {
    ok(`${label} — no 'COPY . .' + frontend build (exempt)`);
    continue;
  }

  const between = lines.slice(copyIdx + 1, buildIdx);
  if (between.some((l) => INSTALL.test(l))) {
    ok(`${label} — re-injects (pnpm install) after 'COPY . .' before the frontend build`);
  } else {
    fail(
      `${label} — 'COPY . .' → frontend build with NO 'pnpm install' between them. ` +
      `Injected workspace deps (peerDep packages like @jkos/weave) stay frozen manifest-only ` +
      `→ tsc TS2307 at build. Add 'RUN pnpm install --frozen-lockfile --filter @jkos/<id>...' ` +
      `after 'COPY . .' and before the build (see apps/beigeboard/Dockerfile).`,
    );
  }
}

// ── Check 2: every packages/* copied before `pnpm deploy` brings its deps along ──
// name → directory basename, for the workspace packages that can be COPY'd.
const pkgDirByName = new Map();
const pkgsDir = resolve(root, 'packages');
for (const dir of readdirSync(pkgsDir)) {
  const manifest = resolve(pkgsDir, dir, 'package.json');
  if (!existsSync(manifest)) continue;
  pkgDirByName.set(JSON.parse(readFileSync(manifest, 'utf8')).name, dir);
}

/** The workspace packages `dir` depends on (prod deps only — `deploy --prod`). */
const workspaceDepsOf = (dir) => {
  const { dependencies = {} } = JSON.parse(
    readFileSync(resolve(pkgsDir, dir, 'package.json'), 'utf8'),
  );
  return Object.keys(dependencies)
    .filter((n) => pkgDirByName.has(n))
    .map((n) => [n, pkgDirByName.get(n)]);
};

// Anchored to RUN so the prose above each deploy stage ("`pnpm deploy` materializes
// the backend …") can't be mistaken for the step itself — that would put deployIdx
// above the COPY lines and pass vacuously on zero packages.
const DEPLOY = /^RUN\s+.*\bpnpm\b.*\bdeploy\b/;
const COPY_PKG = /^COPY\s+packages\/([^/\s]+)\s+packages\//;
const COPY_PKGS_ALL = /^COPY\s+packages\/\s+packages\/\s*$/;

for (const [label, path] of targets) {
  const lines = readFileSync(path, 'utf8').split('\n');

  const deployIdx = lines.findIndex((l) => DEPLOY.test(l.trim()));
  if (deployIdx === -1) {
    ok(`${label} — no 'pnpm deploy' bundle (exempt)`);
    continue;
  }

  const before = lines.slice(0, deployIdx).map((l) => l.trim());
  if (before.some((l) => COPY_PKGS_ALL.test(l))) {
    ok(`${label} — copies all of packages/ before deploy (closed by construction)`);
    continue;
  }

  const copied = new Set();
  for (const l of before) {
    const m = l.match(COPY_PKG);
    if (m && pkgDirByName.has(`@jkos/${m[1]}`)) copied.add(m[1]);
  }

  const missing = [];
  for (const dir of copied) {
    for (const [depName, depDir] of workspaceDepsOf(dir)) {
      if (!copied.has(depDir)) missing.push({ dir, depName, depDir });
    }
  }

  if (missing.length === 0) {
    ok(`${label} — deploy-bundle copies are closed under workspace deps (${copied.size} pkgs)`);
  } else {
    for (const { dir, depName, depDir } of missing) {
      fail(
        `${label} — copies packages/${dir} before 'pnpm deploy' but NOT its workspace dep ` +
        `${depName}. The bundle would ship ${depName}/package.json with no source → ` +
        `MODULE_NOT_FOUND crash-loop at boot. Add 'COPY packages/${depDir} packages/${depDir}' ` +
        `before the deploy line.`,
      );
    }
  }
}

console.log('');
if (failed) {
  console.error(`Dockerfile inject-sync: ${failed} failure(s).`);
  process.exit(1);
}
console.log('Dockerfile inject-sync: images re-inject before the frontend build, and every');
console.log('deploy bundle copies its workspace deps\' source.');

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

console.log('');
if (failed) {
  console.error(`Dockerfile inject-sync: ${failed} failure(s).`);
  process.exit(1);
}
console.log('Dockerfile inject-sync: all app images re-inject before the frontend build.');

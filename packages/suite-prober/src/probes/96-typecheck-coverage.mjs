/**
 * TEST-11 · Typecheck coverage — every TypeScript package in the workspace is actually
 * reachable from `pnpm typecheck`.
 *
 * The failure this exists to catch already happened (fixed 2026-07-30, `9c06267`/`49b8e1f`):
 * root `pnpm typecheck` is `turbo run typecheck`, which silently skips any package that
 * doesn't define that script. Six packages did; the four React apps and @jkos/ui and
 * @jkos/cards did not — some spelled the same `tsc --noEmit` under a `lint` script
 * instead, so whether a package was typechecked depended on which of two names it had
 * happened to pick. `turbo run` reports "6 successful" either way, so the command looked
 * green while covering barely half the workspace. Nothing failed; coverage just quietly
 * wasn't there.
 *
 * That is invisible by construction — a skipped package produces no output at all — so it
 * needs an external assertion. For each workspace package with TypeScript sources this
 * checks that a `typecheck` script exists; a package that typechecks only as a side effect
 * of `build` (`tsc -b && vite build`) is reported, because `pnpm typecheck` still won't
 * cover it.
 *
 * Reports, never fails (level `gap`), matching 95-env-conformance: a missing script is a
 * missing enforcement, not two sources that MUST agree disagreeing.
 *
 * sylibos is intentionally excluded (off-limits; its own React 19 + Tailwind toolchain).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';

/** Does this directory tree hold any .ts/.tsx source (ignoring node_modules/dist)? */
function hasTsSources(dir, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    if (e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) return true;
    if (e.isDirectory() && hasTsSources(join(dir, e.name), depth + 1)) return true;
  }
  return false;
}

function workspacePackages() {
  const out = [];
  for (const group of ['apps', 'packages']) {
    const base = join(REPO_ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      if (name === 'sylibos') continue;                       // off-limits
      const dir = join(base, name);
      let st; try { st = statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      let pkg; try { pkg = JSON.parse(readFileSync(manifest, 'utf8')); } catch { continue; }
      out.push({ rel: `${group}/${name}`, pkg, dir });
    }
  }
  return out;
}

export default {
  id: 'typecheck-coverage',
  title: 'Typecheck coverage — every TS package is reachable from `pnpm typecheck`',

  run() {
    const out = [];
    let covered = 0;

    for (const { rel, pkg, dir } of workspacePackages()) {
      const scripts = pkg.scripts ?? {};
      // Only TS packages are in scope — a pure-CJS backend has nothing for tsc to do.
      const tsSrc = hasTsSources(join(dir, 'src')) || hasTsSources(dir);
      if (!tsSrc) continue;

      if (scripts.typecheck) { covered++; continue; }

      const buildTypechecks = typeof scripts.build === 'string' && /\btsc\b/.test(scripts.build);
      const aliased = Object.entries(scripts)
        .filter(([k, v]) => k !== 'typecheck' && typeof v === 'string' && /\btsc\b[^&|]*--noEmit|\btsc\s+-b\b/.test(v))
        .map(([k]) => k);

      out.push({
        level: 'gap',
        msg:
          `'${pkg.name || rel}' has TypeScript sources but no \`typecheck\` script — ` +
          `\`turbo run typecheck\` SKIPS it silently and still reports success` +
          (buildTypechecks
            ? `. Its \`build\` does run tsc, so errors surface at build time, but not from \`pnpm typecheck\``
            : ``) +
          (aliased.length ? `. A tsc invocation is present under: ${aliased.join(', ')}` : ``) +
          `.`,
        where: [`${rel}/package.json`],
      });
    }

    if (!out.length) {
      out.push({
        level: 'ok',
        msg: `all ${covered} TypeScript package(s) define a \`typecheck\` script — \`pnpm typecheck\` covers the workspace (sylibos excluded).`,
        where: ['package.json', 'turbo.json'],
      });
    }
    return out;
  },
};

/**
 * Shared-shape conformance — the activity contract (RESET Stage E item 4, XC-2 / D6).
 *
 * ⭐ THE QUESTION: does an app whose data is ACTIVITY-SHAPED declare the activity
 * contract? Conformance to a declared shape — NEVER code sharing.
 *
 * The finding this exists to prevent from recurring is precise and already happened
 * once: two apps' `history` tables were field-for-field identical and
 * were invented independently, months apart. Neither author was careless. The suite
 * simply had no word for "this app keeps a per-user record of what happened", so each
 * one coined a private one, and nothing anywhere could notice.
 *
 * ⚠️ THIS IS NOT AN "IS ANYONE CONSUMING IT?" PROBE — RESET forbids that one, because
 * an unconsumed contract is the correct steady state and the only way to satisfy such
 * a probe is to invent consumers. This asks the opposite and answerable question:
 * given data of a known shape, is the shape DECLARED?
 *
 * Three checks:
 *
 *   1. REGROWTH. A `defineCollection({ scoped: true, only: ['create'] })` IS an
 *      append-only per-user ledger — that is exactly the shape two apps
 *      both reached for. An app with one and no ACTIVITY declaration is the finding,
 *      happening again.
 *
 *   2. CONFORMANCE. Every app that declares ACTIVITY must actually serve it: the
 *      declaration exported as data, `activity: true` in @jkos/suite-manifest (which
 *      is what derives its edge path), and a `.mount(` in the server so the route
 *      exists. A declaration nothing serves is worse than none — a peer discovers the
 *      path from the manifest and gets a 404.
 *
 *   3. ⭐ NO SHARED IMPLEMENTATION. The rule is "declare one shape, do not share an
 *      implementation", and this is its negative half — the part a shape validator
 *      cannot check. If one app's discovery doc ever imports from apps/kouros/, the
 *      contract has quietly become the thing it was built to replace. Reported as
 *      DRIFT rather than a gap: every other check here is an opportunity, but this
 *      one is the design being violated.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '../topology.mjs';
import { BACKEND_DOCS } from '../sources.mjs';

const require = createRequire(import.meta.url);

/* An append-only, per-user collection — the ledger shape, spelled the way
   defineCollection spells it. Matched across newlines because a collection def is
   formatted over several lines. */
const APPEND_ONLY_RE = /defineCollection\s*\(\s*\{[^}]*?only\s*:\s*\[\s*['"]create['"]\s*\]/s;

/** An app's ACTIVITY export, or null. Loaded as DATA — the same property that lets
 *  the prober read capability/dataset docs without booting anything. */
function activityOf(entry) {
  try {
    const mod = require(join(REPO_ROOT, entry.module));
    return mod.ACTIVITY ?? null;
  } catch {
    return null;
  }
}

const readIf = (rel) => {
  const p = join(REPO_ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

/* ⚠️ The mount is wherever the app wires Express, which is NOT always the file that
   serves the discovery docs: BeigeBoard's lives in src/app.js while its docs are
   served from server.js. Scanning only the nominated docsFile reported BeigeBoard as
   unmounted when it was mounted three lines from its sibling declarations — a false
   drift, which is the one kind of finding that teaches people to ignore a probe. */
function backendSources(entry) {
  const root = join(REPO_ROOT, dirname(entry.module));
  const out = [];
  const walk = (dir) => {
    let ents;
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      if (e === 'node_modules' || e === 'test' || e === 'dist') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.js')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out.join('\n');
}

export default {
  id: 'activity-conformance',
  title: 'Activity contract — is activity-shaped data declared?',
  run(model) {
    const out = [];
    let conforming = 0;

    for (const entry of BACKEND_DOCS) {
      const app = model.apps.get(entry.app);
      const declaredInManifest = !!(app?.manifest?.activityPath);
      const ACTIVITY = activityOf(entry);
      const moduleSrc = readIf(entry.module);
      const serverSrc = backendSources(entry);
      const where = [entry.module, entry.docsFile];

      // ── 1. regrowth: an append-only per-user ledger with nothing declared ──────
      if (!ACTIVITY && APPEND_ONLY_RE.test(moduleSrc)) {
        out.push({
          level: 'gap',
          msg: `'${entry.app}' has an append-only per-user collection (only:['create']) but declares no ACTIVITY — `
            + 'that is the exact shape two apps once each invented privately (XC-2). Declare it with defineActivity.',
          where,
        });
        continue;
      }
      if (!ACTIVITY) continue;

      // ── 2. conformance: declared AND actually served ──────────────────────────
      if (!declaredInManifest) {
        out.push({
          level: 'drift',
          msg: `'${entry.app}' exports an ACTIVITY declaration but @jkos/suite-manifest does not set activity:true — `
            + 'so no activityPath is derived and nothing can discover it.',
          where: [...where, 'packages/suite-manifest/apps.js'],
        });
      }
      if (!/ACTIVITY\.mount\s*\(/.test(serverSrc)) {
        out.push({
          level: 'drift',
          msg: `'${entry.app}' declares ACTIVITY but never mounts it — a peer resolves activityPath from the `
            + 'manifest and gets a 404. A declaration nothing serves is worse than none.',
          where,
        });
      }
      if (!Array.isArray(ACTIVITY.kinds) || !ACTIVITY.kinds.length) {
        out.push({
          level: 'drift',
          msg: `'${entry.app}' declares ACTIVITY with no kinds — an activity surface with no vocabulary says nothing.`,
          where,
        });
      }

      // ── 3. the rule's negative half: no shared implementation ─────────────────
      /* ⚠️ RESOLVE the specifier, don't pattern-match it. A cross-app reach is far
         more likely to be written `require('../../beigeboard/backend/discovery')` than
         with a literal `apps/` in the string — the first version of this check
         matched only the latter and sailed straight past a planted violation. */
      const ownDir = resolve(REPO_ROOT, 'apps', entry.app);
      const moduleDir = resolve(REPO_ROOT, dirname(entry.module));
      const foreign = [...moduleSrc.matchAll(/require\(\s*['"](\.[^'"]*)['"]/g)]
        .map((m) => m[1])
        .filter((spec) => {
          const target = resolve(moduleDir, spec);
          if (!relative(ownDir, target).startsWith('..')) return false;   // inside its own app
          return !relative(resolve(REPO_ROOT, 'apps'), target).startsWith('..'); // but under apps/
        })
        .map((spec) => [spec, spec]);
      if (foreign.length) {
        out.push({
          level: 'drift',
          msg: `'${entry.app}' reaches into another app's source (${foreign.map((m) => m[0]).join(', ')}). `
            + 'The activity contract is a DECLARED SHAPE, not a shared implementation — each app stays '
            + 'authoritative about its own ledger and answers only about itself.',
          where,
        });
      }

      if (declaredInManifest && /ACTIVITY\.mount\s*\(/.test(serverSrc) && ACTIVITY.kinds?.length) conforming++;
    }

    if (conforming) {
      const kinds = BACKEND_DOCS
        .map((e) => activityOf(e))
        .filter(Boolean)
        .flatMap((a) => a.kinds.map((k) => k.id));
      out.push({
        level: 'ok',
        msg: `${conforming} app(s) declare and serve the activity contract, between them ${new Set(kinds).size} `
          + `distinct verb(s) (${[...new Set(kinds)].sort().join(', ')}) — one shape, four independent implementations, `
          + 'which is the arrangement XC-2 asked for.',
        where: ['packages/weave/src/shared/activity.js'],
      });
    }
    return out;
  },
};

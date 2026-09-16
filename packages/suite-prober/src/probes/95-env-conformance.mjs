/**
 * TEST-10 · Env/config conformance — every backend's `process.env.*` reads reconciled
 * against what the deployment actually provisions (.env.example + docker-compose).
 *
 * The failure this exists to catch is the BUG-5 class: `CALENDAR_ENC_KEY` was read by
 * the BeigeBoard backend to encrypt OAuth refresh tokens at rest, but appeared in NO
 * .env.example and NO compose file — so in every real deployment it was unset and the
 * secrets sat in plaintext, silently. A "sixth app" reading the source would have seen
 * a secret-shaped var read by code and provisioned nowhere.
 *
 * This probe reads the SOURCE (no live deployment needed), and for each backend cross-
 * references three things: what the code reads, what `.env.example` documents, and what
 * the compose files pass through. It reports — never fails the gate — because an
 * undocumented var is a documentation/hygiene gap, not two sources that MUST agree
 * disagreeing (the prober's definition of `drift`). Levels used:
 *   gap         a var the code reads that is documented NOWHERE — SECURITY-relevant
 *               names (…_SECRET/_KEY/_TOKEN/_PASSWORD) are called out first; also an
 *               orphan `backend/Dockerfile` build trap.
 *   consolidate a `.env.example` key the backend never reads (a dead doc), excluding
 *               vars a shared package (@jkos/auth-middleware, @jkos/weave/server) or the
 *               app's own prefix legitimately consumes out of this directory.
 *   info        a var only compose passes (infra plumbing) — believed intentional.
 *   ok          a backend whose secret reads are all provisioned.
 *
 * Also checks the CAPABILITY level: a capability declaring a scope jkAuth cannot mint
 * is provisioned in code and unprovisioned in reality — it fails at the write gate, at
 * the first call, in production.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';

// Per-backend descriptors: where the code lives, what documents its env, and what the
// app "owns" by prefix (so a self-prefixed example key isn't misread as dead).
const BACKENDS = [
  {
    app: 'beigeboard',
    srcRoots: ['apps/beigeboard/backend/src', 'apps/beigeboard/backend/server.js', 'apps/beigeboard/backend/discovery.js'],
    envExample: 'apps/beigeboard/backend/.env.example',
    composes: ['apps/beigeboard/docker-compose.yml', 'apps/beigeboard/docker-compose.staging.yml'],
    selfPrefix: 'BB_',
    orphanDockerfile: 'apps/beigeboard/backend/Dockerfile',
  },
  {
    app: 'jkauth',
    srcRoots: ['apps/jkauth/src', 'apps/jkauth/server.js'],
    envExample: 'apps/jkauth/.env.example',
    composes: ['apps/jkauth/docker-compose.yml', 'apps/jkauth/docker-compose.staging.yml'],
    selfPrefix: 'JKAUTH_',
    orphanDockerfile: null,
  },
  {
    app: 'lazuros',
    srcRoots: ['apps/lazuros/backend'],
    envExample: 'apps/lazuros/.env.example',
    composes: ['apps/lazuros/docker-compose.yml'],
    selfPrefix: 'LAZUROS_',
    orphanDockerfile: null,
  },
  /* ⚠️ PapyrOS and KourOS were not in this list at all — two whole backends, and the
     probe reported nothing about either. That is the quietest possible failure for a
     coverage probe: a clean report about the apps it happens to know, which reads
     exactly like a clean report about the suite. The BUG-5 class it was built for
     (`CALENDAR_ENC_KEY` read by code and provisioned nowhere) could have been sitting
     in either one for as long as they have existed. */
  {
    app: 'papyros',
    srcRoots: ['apps/papyros/backend/src', 'apps/papyros/backend/server.js', 'apps/papyros/backend/discovery.js'],
    envExample: 'apps/papyros/.env.example',
    composes: ['apps/papyros/docker-compose.yml', 'apps/papyros/docker-compose.staging.yml'],
    selfPrefix: 'PAPYROS_',
    orphanDockerfile: null,
  },
  {
    app: 'kouros',
    srcRoots: ['apps/kouros/backend/src', 'apps/kouros/backend/server.js', 'apps/kouros/backend/discovery.js'],
    envExample: 'apps/kouros/.env.example',
    composes: ['apps/kouros/docker-compose.yml', 'apps/kouros/docker-compose.staging.yml'],
    selfPrefix: 'KOUROS_',
    orphanDockerfile: null,
  },
];

// Vars consumed by a SHARED package (auth middleware / weave server) out of the app's
// own source tree — so a `.env.example` documenting them isn't a "dead" local key.
const SHARED_CONSUMED = /^(JKOS_AUTH_|JKOS_APP_ID$|JKOS_SERVICE_CLIENT|JKOS_COOKIE_|JKOS_DELEGATION|AUTH_ORIGIN$|PORTAL_URL$|ALLOWED_ORIGINS$|NODE_ENV$|DB_PATH$|PORT$)/;
const SECRETY = /(_SECRET|_KEY|_TOKEN|_PASSWORD)$|PASSWORD|SECRET/;
// Runtime/infra vars a deployer never provisions in a .env (the platform sets them) —
// not a documentation gap when unlisted.
const INFRA_IGNORE = new Set(['NODE_ENV']);

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

// Recursively collect *.js/*.mjs/*.cjs under a path (file or dir), skipping deps + tests
// (a test's process.env writes aren't the app's runtime reads).
function collectSources(rel) {
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return /\.(js|mjs|cjs)$/.test(abs) ? [abs] : [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'test' || entry.name === '__tests__') continue;
    const child = join(abs, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(join(rel, entry.name)));
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(child);
  }
  return out;
}

/* ⚠️ A HELPER READS ENV TOO, and missing that is how this probe cried wolf.
 *
 * jkAuth reads three of its session knobs through `numEnv('SESSION_TTL_MS', default)`
 * — a two-line helper whose body is the only `process.env[…]` in sight. Scanning for
 * the literal `process.env.X` therefore reported SESSION_TTL_MS,
 * SESSION_ABSOLUTE_TTL_MS and SESSION_TOMBSTONE_MS as "documented but never read":
 * three confident, wrong findings about live, load-bearing configuration.
 *
 * A probe with false positives is worse than a missing probe. It does not merely fail
 * to catch things — it teaches whoever reads the report that this section is noise,
 * and the next finding here, the real one, gets the same shrug.
 *
 * So the helpers are DISCOVERED rather than listed: a function whose body indexes
 * `process.env[` with one of its own parameters is an env reader, and its call sites
 * are env reads. Self-maintaining — a second helper under another name is picked up
 * without anyone remembering this exists. */
function envHelperNames(text) {
  const helpers = new Set();
  /* `const numEnv = (k, d) => (process.env[k] != null ? … )` and the `function`
     form. The parameter name is captured and required to be the thing indexed, so a
     function that merely mentions process.env somewhere is not mistaken for one. */
  const forms = [
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*([A-Za-z_$][\w$]*)[^)]*\)?\s*=>\s*([\s\S]{0,240}?)(?:\n\s*\n|$)/g,
    /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{([\s\S]{0,240}?)\n\}/g,
  ];
  for (const re of forms) {
    for (const m of text.matchAll(re)) {
      const [, name, param, body] = m;
      if (new RegExp(`process\\.env\\[\\s*${param}\\b`).test(body)) helpers.add(name);
    }
  }
  return helpers;
}

// The set of env names read across a backend's own source — directly, or through a
// helper that reads env on the caller's behalf.
function readEnvReads(srcRoots) {
  const names = new Set();
  const files = [];
  for (const root of srcRoots) for (const file of collectSources(root)) files.push(file);

  const texts = files.map((f) => readFileSync(f, 'utf8'));
  /* Helpers are collected across the WHOLE backend before any call site is read: a
     helper defined in config.js is called from config.js here, but nothing says the
     next one will be, and a helper found only after its callers were scanned would
     miss them. */
  const helpers = new Set();
  for (const text of texts) for (const h of envHelperNames(text)) helpers.add(h);

  for (const text of texts) {
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(m[1]);
    // Also `process.env['X']` / destructured — tolerant, rarely used here.
    for (const m of text.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) names.add(m[1]);
    for (const h of helpers) {
      for (const m of text.matchAll(new RegExp(`\\b${h}\\(\\s*['"\`]([A-Z0-9_]+)['"\`]`, 'g'))) names.add(m[1]);
    }
  }
  return names;
}

// Keys documented in a .env.example — both live (`KEY=`) and COMMENTED (`# KEY=`)
// entries count: a commented optional var is still documentation the deployer sees.
function readExampleKeys(rel) {
  if (!existsSync(join(REPO_ROOT, rel))) return new Set();
  const keys = new Set();
  for (const line of read(rel).split('\n')) {
    const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// Any env var NAME mentioned by a compose file — as `${VAR}` interpolation or a
// `VAR:` / `VAR=` environment entry. Over-inclusive on purpose: we only ask "does
// compose reference this var at all" (i.e. is it wired into the container).
function readComposeVars(composes) {
  const vars = new Set();
  for (const rel of composes) {
    if (!existsSync(join(REPO_ROOT, rel))) continue;
    const text = read(rel);
    for (const m of text.matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)) vars.add(m[1]);
    for (const m of text.matchAll(/^\s*-?\s*([A-Z][A-Z0-9_]+)\s*[:=]/gm)) vars.add(m[1]);
  }
  return vars;
}

export default {
  id: 'env-conformance',
  title: 'Env/config conformance — every backend read is provisioned (or knowingly not)',
  run(model) {
    const out = [];
    for (const be of BACKENDS) {
      const reads = readEnvReads(be.srcRoots);
      const example = readExampleKeys(be.envExample);
      const compose = readComposeVars(be.composes);
      const documented = (v) => example.has(v) || compose.has(v);

      // Orphan build trap: a backend/Dockerfile that shadow-builds the real image.
      if (be.orphanDockerfile && existsSync(join(REPO_ROOT, be.orphanDockerfile))) {
        out.push({
          level: 'gap',
          msg: `'${be.app}' has an orphan ${be.orphanDockerfile} — a legacy build trap (the real image builds from the app root). Delete it.`,
          where: [be.orphanDockerfile],
        });
      }

      // (1) Reads provisioned NOWHERE — secret-shaped ones first (the BUG-5 class).
      const undocumented = [...reads].filter((v) => !documented(v) && !INFRA_IGNORE.has(v)).sort();
      const secretHoles = undocumented.filter((v) => SECRETY.test(v));
      const plainHoles = undocumented.filter((v) => !SECRETY.test(v));
      for (const v of secretHoles) {
        out.push({
          level: 'gap',
          msg: `'${be.app}' reads SECRET-shaped ${v} but it is in neither ${be.envExample} nor any compose file — a real deployment leaves it unset (the CALENDAR_ENC_KEY-at-rest class).`,
          where: [be.envExample, ...be.composes],
        });
      }
      if (plainHoles.length) {
        out.push({
          level: 'gap',
          msg: `'${be.app}' reads ${plainHoles.length} var(s) documented nowhere: ${plainHoles.join(', ')} — a new deployer has no signal they exist.`,
          where: [be.envExample],
        });
      }

      // (2) Dead example keys the app never reads (and no shared package/self-prefix
      //     legitimately consumes) — a stale doc to prune.
      const dead = [...example]
        .filter((v) => !reads.has(v) && !compose.has(v) && !SHARED_CONSUMED.test(v) && !v.startsWith(be.selfPrefix))
        .sort();
      for (const v of dead) {
        out.push({
          level: 'consolidate',
          msg: `'${be.app}' documents ${v} in ${be.envExample} but the backend never reads it — a dead doc (or moved to a shared consumer?).`,
          where: [be.envExample],
        });
      }

      // (3) Roll-up: green when every secret read is provisioned.
      if (!secretHoles.length) {
        out.push({
          level: 'ok',
          msg: `'${be.app}' — ${reads.size} env reads, every secret-shaped one provisioned in .env.example/compose.`,
          where: [be.envExample],
        });
      }
    }
    /* ── The CAPABILITY level (Stage E item 2) ────────────────────────────────
     Env conformance asks "does the deployment provide what the code reads". One
     level up, the same question: does the deployment provide what a capability
     DECLARES it needs? A capability naming a scope nobody can ever hold is
     provisioned in code and unprovisioned in reality — the BUG-5 shape, one layer
     out — and it fails at the write gate, at the first call, in production.

     jkAuth mints `<app>:read` for every allowed role, plus the
     write/create/update/delete ladder for non-guests, plus `<app>:admin` for admins
     (db.js roleClaims). Anything else a capability asks for is unmintable. */
  {
    const VERBS = new Set(['read', 'write', 'create', 'update', 'delete', 'admin']);
    let checked = 0;
    for (const app of model.apps.values()) {
      for (const cap of app.docs?.capabilities || []) {
        const scopes = cap.scopes || (cap.scope ? [cap.scope] : []);
        for (const sc of scopes) {
          const [scApp, verb] = String(sc).split(':');
          if (scApp !== app.id) {
            out.push({
              level: 'drift',
              msg: `'${app.id}'.${cap.id} declares scope '${sc}' — jkAuth only ever mints '${app.id}:<verb>' for this app, so no token can hold it and the write gate refuses every call`,
              where: [app.docs.file, 'apps/jkauth/src/db.js'],
            });
          } else if (!VERBS.has(verb)) {
            out.push({
              level: 'drift',
              msg: `'${app.id}'.${cap.id} declares scope '${sc}' — '${verb}' is not one of the verbs jkAuth mints (${[...VERBS].join('/')}), so it is unmintable and unholdable`,
              where: [app.docs.file, 'apps/jkauth/src/db.js'],
            });
          } else checked++;
        }
      }
    }
    if (checked) {
      out.push({
        level: 'ok',
        msg: `${checked} declared capability scope(s) are mintable by jkAuth — what a capability asks for, a token can actually hold`,
        where: ['apps/jkauth/src/db.js'],
      });
    }
  }

  return out;
  },
};

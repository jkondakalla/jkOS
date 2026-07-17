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
 * sylibos is intentionally excluded (off-limits; its backend/Dockerfile is its own).
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

// The set of `process.env.X` names read across a backend's own source.
function readEnvReads(srcRoots) {
  const names = new Set();
  for (const root of srcRoots) {
    for (const file of collectSources(root)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(m[1]);
      // Also `process.env['X']` / destructured — tolerant, rarely used here.
      for (const m of text.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) names.add(m[1]);
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
  run() {
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
    return out;
  },
};

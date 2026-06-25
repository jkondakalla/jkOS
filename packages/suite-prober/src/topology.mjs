/**
 * topology.mjs — reconstruct the suite's app topology from the SOURCES table.
 *
 * The prober "acts as the sixth app" by doing exactly what the real Weave discovery
 * path does (read the registry, resolve each app's edge paths + docs) — except it
 * reads the source-of-truth FILES so it runs in a checkout with no live deployment.
 * Where a table is exported as data we import it; where it's a private module-local
 * we scrape the specific fields (tolerant regex), and we flag that we had to.
 *
 * Output: a normalized model keyed by canonical app id, plus the raw nginx peers,
 * the CODES vocab, and per-app backend doc facts. Read-only. No suite file is touched.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SOURCES, DERIVED, BACKEND_DOCS } from './sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..'); // src → suite-prober → packages → root
const require = createRequire(import.meta.url);

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/* ── tolerant field extractors (string-typed source → structured facts) ─────────
 * Now used only for the BACKEND_DOCS scrape fallback (an app that hasn't exported its
 * Weave docs yet) — the app directory itself is imported, not scraped. */

/** `name: ['a','b']` → ['a','b'] (empty/absent → []). */
function fieldArr(scope, name) {
  const m = scope.match(new RegExp(`\\b${name}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
}

/** All occurrences of `name: 'v'` across a whole file (e.g. every `app:` / `id:`). */
function allFieldStr(text, name) {
  return [...text.matchAll(new RegExp(`\\b${name}\\s*:\\s*'([^']*)'`, 'g'))].map((m) => m[1]);
}

/** Slug embedded in an edge path: '/api/beigeboard' | '/health/beigeboard' → 'beigeboard'. */
export function pathSlug(p) {
  if (!p) return null;
  const m = String(p).match(/^\/(?:api|health)\/([^/]+)/);
  return m ? m[1] : null;
}

/* ── loaders ───────────────────────────────────────────────────────────────────
 * The app directory is now imported from @jkos/suite-manifest (the single source) via
 * its builders — the SAME functions the registry seed / manifest / nginx generator
 * call — so the prober reconstructs exactly the topology they ship (ToDo A2). Only the
 * codes table and any not-yet-exported backend docs are still read from source. */

/** jkAuth registry seed rows, from registrySeed() → the prober's camelCased shape. */
function deriveRegistry(sm) {
  return sm.registrySeed().map((r) => ({
    id: r.id,
    apiBase: r.api_base,
    healthPath: r.health_path,
    capabilitiesPath: r.capabilities_path,
    datasetsPath: r.datasets_path,
    allowedRoles: String(r.allowed_roles || '').split(',').map((s) => s.trim()).filter(Boolean),
  }));
}

/** Weave SUITE_APPS entries, from manifestApps(). */
function deriveManifest(sm) {
  return Object.values(sm.manifestApps()).map((e) => ({
    id: e.id,
    apiBase: e.apiBase ?? null,
    healthPath: e.healthPath ?? null,
    capabilitiesPath: e.capabilitiesPath ?? null,
    datasetsPath: e.datasetsPath ?? null,
    ai: e.ai || undefined,
  }));
}

/** nginx peer-proxy rows, from peers(). `slug` is the edge token (SylibOS keeps `sylib`). */
function deriveNginxPeers(sm) {
  return sm.peers().map((p) => ({
    slug: p.slug, // NOTE: nginx keys peers by SLUG (= id once an app is canonicalized)
    upstream: p.upstream,
    health: p.health ?? null,
    apiPrefix: p.apiPrefix ?? null,
    kind: p.kind ?? null,
  }));
}

function loadCodes(file) {
  return require(join(REPO_ROOT, file)).CODES;
}

/** Per-app backend Weave docs: the keys/scopes the app declares about itself, plus
 *  the full capability/dataset objects when the docs are exported as data. */
function loadBackendDocs() {
  return BACKEND_DOCS.map((row) => {
    if (row.module && row.exported) {
      // The C3 payoff: require the REAL declarations instead of scraping. Pure-data
      // module (zero side effects) so this is safe in a checkout with no deployment.
      const mod = require(join(REPO_ROOT, row.module));
      const caps = mod.CAPABILITIES?.capabilities || [];
      const dsets = mod.DATASETS?.datasets || [];
      return {
        app: row.app,
        file: row.module,
        exported: true,
        declaredApp: [...new Set([mod.CAPABILITIES?.app, mod.DATASETS?.app].filter(Boolean))],
        invalidateKeys: [...new Set([
          ...caps.flatMap((c) => c.invalidates || []),
          ...dsets.flatMap((d) => d.invalidates || []),
        ])],
        scopes: [...new Set([
          ...caps.flatMap((c) => c.scopes || []),
          ...dsets.flatMap((d) => d.scopes || []),
        ])],
        capabilities: caps,
        datasets: dsets,
      };
    }
    // Fallback: scrape the inline consts (an app that hasn't exported its docs yet).
    const text = read(row.docsFile);
    return {
      app: row.app,
      file: row.docsFile,
      exported: row.exported,
      declaredApp: [...new Set(allFieldStr(text, 'app'))], // `app:` in CAPABILITIES + DATASETS
      invalidateKeys: [...new Set(fieldArr(text, 'invalidates').concat(
        [...text.matchAll(/invalidates\s*:\s*\[([^\]]*)\]/g)]
          .flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])),
      ))],
      scopes: [...new Set(
        [...text.matchAll(/scopes\s*:\s*\[([^\]]*)\]/g)]
          .flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])),
      )],
      capabilities: null,
      datasets: null,
    };
  });
}

/* ── assemble the normalized model ────────────────────────────────────────────── */

export function loadTopology() {
  const sourceMeta = Object.fromEntries(SOURCES.map((s) => [s.kind, s]));
  // The single source: import the SAME builders the registry seed / SUITE_APPS / nginx
  // generator call, so the prober's topology IS the one they ship (ToDo A2).
  const sm = require(join(REPO_ROOT, sourceMeta.suiteManifest.file));
  const registry = deriveRegistry(sm);
  const manifest = deriveManifest(sm);
  const nginxPeers = deriveNginxPeers(sm);
  const codes = loadCodes(sourceMeta.codes.file);
  const backendDocs = loadBackendDocs();

  // Merge registry + manifest into per-app records keyed by canonical id.
  const apps = new Map();
  const upsert = (id) => {
    if (!apps.has(id)) apps.set(id, { id, inRegistry: false, inManifest: false });
    return apps.get(id);
  };
  for (const r of registry) Object.assign(upsert(r.id), { registry: r, inRegistry: true });
  for (const m of manifest) Object.assign(upsert(m.id), { manifest: m, inManifest: true });

  // Attach the backend docs + every slug each source uses for the app.
  for (const app of apps.values()) {
    app.docs = backendDocs.find((d) => d.app === app.id) || null;
    const slugs = new Set();
    const fromReg = app.registry && (pathSlug(app.registry.apiBase) || pathSlug(app.registry.healthPath));
    const fromMan = app.manifest && (pathSlug(app.manifest.apiBase) || pathSlug(app.manifest.healthPath));
    if (fromReg) slugs.add(fromReg);
    if (fromMan) slugs.add(fromMan);
    // nginx peer matched by any slug we already know
    app.nginxPeer = nginxPeers.find((p) => slugs.has(p.slug)) || null;
    if (app.nginxPeer) slugs.add(app.nginxPeer.slug);
    app.slugs = { reg: fromReg || null, manifest: fromMan || null, nginx: app.nginxPeer?.slug || null };
    app.slugSet = [...slugs];
  }

  return { apps, registry, manifest, nginxPeers, codes, backendDocs, sources: SOURCES, derived: DERIVED };
}

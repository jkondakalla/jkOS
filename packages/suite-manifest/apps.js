'use strict'
// suite-manifest/apps.js — THE single source of truth for the jkOS app directory.
//
// One row per app in APPS. Everything else DERIVES from it:
//   • jkAuth's app_registry seed   (registrySeed())  — apps/jkauth/src/db.js
//   • Weave's SUITE_APPS fallback   (manifestApps())  — packages/weave/src/manifest.ts
//   • the nginx peer-proxy table    (peers())         — infra/nginx/gen-nginx-weave.mjs
//   • the suite-prober's topology   (all three)       — packages/suite-prober
//
// THE app `id` is the only identifier. Edge paths, the invalidation bus key, and the
// scope namespace are all COMPUTED from it (see helpers below), so adding an app is
// one row here, not the same slug re-typed in four places (the old consolidation
// findings C1–C5). The lone stored infra fact is `upstream` (container:port): nginx needs an
// address the registry deliberately never stores.
//
// Derivations:
//   apiBase           = '/api/'    + id        (when `api`)
//   healthPath        = '/health/' + id        (when `health`)
//   capabilitiesPath  = apiBase + '/capabilities'  (when `capabilities`)
//   datasetsPath      = apiBase + '/datasets'      (when `datasets`)
//   resourceKey       = id + '.' + resource    (the invalidation bus key, A5)
//   scope             = id + ':' + verb        (the capability scope namespace)
//
// Per-app override seam: an app whose edge slug ≠ id pins `apiBase`/`healthPath` so
// derivation can't rename its paths. SylibOS is the only such app today (edge slug
// `sylib`, un-migrated and OFF-LIMITS until Jag includes it — ToDo A1 constraints);
// LazurOS is a host-network AI gateway with bespoke `/api/lazuros/health`.
//
// Zero deps, CJS, no build step: require()'d by jkAuth + the beigeboard backend,
// imported (via CJS interop) by the nginx generator + prober (ESM) and manifest.ts
// (Vite). Safe to load in a bare checkout — no env, no DB, no network.

/**
 * The suite. Order is the systems-panel probe order. Optional flags gate which
 * derived surface an app exposes; `registry: false` keeps an app out of the jkAuth
 * registry. LazurOS now HAS a registry row (so its capability scopes are role-gated
 * and the portal hydrates its ai/capabilities/datasets metadata) but a null `origin`
 * — it's reached only through the `/api/lazuros` edge proxy, never as a launcher tile.
 */
const APPS = [
  {
    id: 'auth', name: 'jkAuth', origin: 'https://auth.jkos.net',
    allowedRoles: ['user', 'admin', 'guest'],
    upstream: 'jkos-auth:3100', health: true,
  },
  {
    id: 'beigeboard', name: 'BeigeBoard', origin: 'https://beigeboard.jkos.net',
    allowedRoles: ['user', 'admin', 'guest'],
    upstream: 'bb-app:3001', health: true, api: true,
    capabilities: true, datasets: true,
  },
  {
    id: 'sylibos', name: 'SylibOS', origin: 'https://sylibos.jkos.net',
    allowedRoles: ['user', 'admin'],
    upstream: 'sylibos-api:8004', health: true, api: true,
    apiBase: '/api/sylib', // OFF-LIMITS un-migrated edge slug — pinned, do NOT derive (ToDo A1)
  },
  {
    id: 'ordeck', name: 'ORDECK', origin: 'https://jkos.net',
    allowedRoles: ['user', 'admin'], // portal shell — no backend surface
  },
  {
    id: 'staging', name: 'Staging', origin: 'https://staging.jkos.net',
    allowedRoles: ['admin'], // the admin-only staging origin — no backend surface
  },
  {
    id: 'lazuros', name: 'LazurOS', origin: null, // internal AI gateway: no browsable origin (no launcher tile)
    allowedRoles: ['admin', 'user'], // registry row gates capability scopes (lazuros:write) by role; guests excluded
    upstream: 'host.docker.internal:8080', kind: 'lazuros',
    health: true, api: true, ai: true,
    capabilities: true, datasets: true, // Weave write+read contracts (LazurOS refactor)
    apiBase: '/api/lazuros', healthPath: '/api/lazuros/health', // host-network, bespoke paths
  },
  {
    id: 'papyros', name: 'PapyrOS', origin: 'https://papyros.jkos.net',
    allowedRoles: ['user', 'admin'],
    upstream: 'papyros-app:3010', health: true, api: true,
    capabilities: true, datasets: true,
    edge: 'standard', // GENERATED nginx server block + staging subpath (gen-nginx-weave.mjs)
  },
  {
    id: 'kouros', name: 'KourOS', origin: 'https://kouros.jkos.net',
    allowedRoles: ['user', 'admin'],
    upstream: 'kouros-app:3011', health: true, api: true,
    capabilities: true, datasets: true,
    edge: 'standard', // GENERATED nginx server block + staging subpath (gen-nginx-weave.mjs)
  },
  {
    // WV-8: jkDeploy was absent from the directory entirely, so "deploy staging"
    // could not be a HUD button and the portal had no way to know the deploy
    // controller exists — a system nobody can see from the system that lists the
    // systems.
    //
    // Deliberately NO `upstream`, `health` or `api`. Those drive the nginx PEER
    // generation, and jkDeploy is not a peer: it is a FastAPI service in its own
    // Compose project, reached through a hand-tuned `/deploy/` block in
    // standalone.conf that strips the prefix, disables buffering for its SSE log
    // stream, and sits behind the admin gate. Deriving a peer block for it would
    // fight that. What the row buys is DIRECTORY presence — the launcher and the
    // registry now know it is there and that only admins may reach it.
    id: 'jkdeploy', name: 'jkDeploy', origin: 'https://staging.jkos.net/deploy/',
    allowedRoles: ['admin'],
  },
]

/* ── derivations: id → everything ────────────────────────────────────────────── */

/** Every canonical app id, in APPS order. The literal union in apps.d.ts (`AppId`)
 *  must list exactly these — the weave test gate asserts the two stay in sync. */
const APP_IDS = Object.freeze(APPS.map((a) => a.id))

/** Edge-proxied API root for an app, or null if it exposes none. */
function apiBaseOf(app) {
  if (!app.api) return null
  return app.apiBase || `/api/${app.id}`
}
/** Edge-proxied health probe path, or null. */
function healthPathOf(app) {
  if (!app.health) return null
  return app.healthPath || `/health/${app.id}`
}
/** Edge path serving the app's CapabilityDoc, or null. */
function capabilitiesPathOf(app) {
  return app.capabilities ? `${apiBaseOf(app)}/capabilities` : null
}
/** Edge path serving the app's DatasetDoc, or null. */
function datasetsPathOf(app) {
  return app.datasets ? `${apiBaseOf(app)}/datasets` : null
}

/** The invalidation bus key for one of an app's resources, e.g.
 *  resourceKey('beigeboard','items') === 'beigeboard.items' (A5). */
function resourceKey(id, resource) {
  return `${id}.${resource}`
}
/** The capability scope namespace for an app + verb, e.g.
 *  scopeFor('beigeboard','write') === 'beigeboard:write'. */
function scopeFor(id, verb) {
  return `${id}:${verb}`
}

/* ── view builders: the three derived tables ─────────────────────────────────── */

/** Rows for jkAuth's app_registry seed (every app with a registry row). */
function registrySeed() {
  return APPS.filter((a) => a.registry !== false).map((a) => ({
    id: a.id,
    name: a.name,
    origin: a.origin || '', // app_registry.origin is NOT NULL; an origin-less gateway (LazurOS) stores ''
    icon_url: null,
    allowed_roles: a.allowedRoles.join(','),
    api_base: apiBaseOf(a),
    health_path: healthPathOf(a),
    capabilities_path: capabilitiesPathOf(a),
    datasets_path: datasetsPathOf(a),
    ai: a.ai ? 1 : 0,
  }))
}

/** Weave's SUITE_APPS fallback map (apps with a probeable health/api surface).
 *  `origin` is omitted when null; callers (manifest.ts) may override e.g. auth's
 *  origin with the env-configurable AUTH_URL. */
function manifestApps() {
  const out = {}
  for (const a of APPS) {
    if (!a.health && !a.api) continue
    const entry = { id: a.id, label: a.name }
    if (a.origin) entry.origin = a.origin
    const apiBase = apiBaseOf(a)
    const healthPath = healthPathOf(a)
    const capabilitiesPath = capabilitiesPathOf(a)
    const datasetsPath = datasetsPathOf(a)
    if (apiBase) entry.apiBase = apiBase
    if (healthPath) entry.healthPath = healthPath
    if (capabilitiesPath) entry.capabilitiesPath = capabilitiesPath
    if (datasetsPath) entry.datasetsPath = datasetsPath
    if (a.ai) entry.ai = true
    out[a.id] = entry
  }
  return out
}

/** nginx peer-proxy rows (every app with a container upstream). `slug` is the edge
 *  token (derived from apiBase, so SylibOS keeps `sylib`); `kind` flags the LazurOS
 *  host-network special case the generator block-handles. */
function peers() {
  return APPS.filter((a) => a.upstream).map((a) => {
    const apiBase = apiBaseOf(a)
    return {
      id: a.id,
      slug: apiBase ? apiBase.replace(/^\/api\//, '') : a.id,
      upstream: a.upstream,
      health: healthPathOf(a) || undefined,
      apiPrefix: apiBase ? `${apiBase}/` : undefined,
      kind: a.kind,
    }
  })
}

/** Apps that take a GENERATED standard edge: a prod origin server block (SPA served at
 *  root, proxied to one upstream) + an admin-gated `/<id>/` subpath on staging. Opt in
 *  with `edge: 'standard'` (the scaffolder sets it). The hand-tuned origins — the ORDECK
 *  portal, the staging shell, SylibOS, jkAuth, BeigeBoard — set NO `edge` and keep their
 *  bespoke blocks in standalone.conf, so the generator never rewrites them. Consumed by
 *  infra/nginx/gen-nginx-weave.mjs (apps-generated{,-staging}.conf). `host` is the origin
 *  hostname; `upstream` is the prod container:port (staging derives `staging-` itself). */
function edgeApps() {
  return APPS.filter((a) => a.edge === 'standard' && a.origin && a.upstream).map((a) => ({
    id: a.id,
    name: a.name,
    host: new URL(a.origin).host,
    upstream: a.upstream,
  }))
}

/* ── the port registry ───────────────────────────────────────────────────────── */

/**
 * Every localhost port a TEST may bind, in one table — the place a new smoke
 * claims its throwaway port from. Service ports are deliberately NOT re-typed
 * here: they already live in each app row's `upstream`, and `portTable()` folds
 * them in, so a test port can never silently shadow a service port either.
 *
 * ⚠️ Why this exists (OPS-1): two stray KourOS processes once sat on 3991/3992 —
 * ports ALSO claimed by BeigeBoard's routines/routine-spec smokes and PapyrOS's
 * playback/meta smokes — and eight assertions ran green against the wrong app's
 * server. A duplicate claim here is a STARTUP error (this module is require()'d
 * at boot by jkAuth and the BeigeBoard backend), and the suite-prober's
 * `port-registry` probe holds every smoke's `const PORT = <n>` literal to its
 * claim below, so the table and the files cannot drift apart.
 */
const TEST_PORTS = Object.freeze({
  'kouros:library.smoke': 3980,
  'kouros:playback.smoke': 3981,
  'kouros:history.smoke': 3982,
  // discover.smoke boots FOUR servers; only the base can be held to a row here (the
  // probe reads one `const PORT` literal per file). The other three live at +100/+101/
  // +102 — deliberately outside this band, because they used to be +1/+2/+3 and +3 was
  // 3986, i.e. beigeboard:delta.smoke's port. See that file's header.
  'kouros:discover.smoke': 3983,
  'beigeboard:delta.smoke': 3986,
  'beigeboard:import.smoke': 3987,
  'beigeboard:items.smoke': 3988,
  'beigeboard:contract.smoke': 3989,
  'papyros:library.smoke': 3990,
  'beigeboard:routines.smoke': 3991,
  'beigeboard:routine-spec.smoke': 3992,
  'papyros:history.smoke': 3993,
  'suite-prober:roundtrip': 3994,
  'papyros:playback.smoke': 3995,
  'papyros:meta.smoke': 3996,
})

/** Every port with its claimant — container service ports (from `upstream`) plus
 *  the test claims. Throws on a duplicate rather than returning one. */
function portTable() {
  const rows = []
  for (const a of APPS) {
    if (!a.upstream) continue
    rows.push({ claimant: `service:${a.id}`, port: Number(a.upstream.split(':').pop()) })
  }
  for (const [claimant, port] of Object.entries(TEST_PORTS)) {
    rows.push({ claimant: `test:${claimant}`, port })
  }
  const seen = new Map()
  for (const { claimant, port } of rows) {
    if (seen.has(port)) {
      throw new Error(
        `port ${port} is claimed by both ${seen.get(port)} and ${claimant} — ` +
        'every claimant needs its own row in the suite-manifest port registry',
      )
    }
    seen.set(port, claimant)
  }
  return rows
}
// A duplicate claim refuses to load, everywhere this module is required.
portTable()

module.exports = {
  APPS,
  APP_IDS,
  apiBaseOf,
  healthPathOf,
  capabilitiesPathOf,
  datasetsPathOf,
  resourceKey,
  scopeFor,
  registrySeed,
  manifestApps,
  peers,
  edgeApps,
  TEST_PORTS,
  portTable,
}

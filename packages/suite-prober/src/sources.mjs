/**
 * sources.mjs — THE EXPANDABLE SEAM (data, not logic).
 *
 * Post-A2 the suite has ONE source of truth for the app directory: @jkos/suite-manifest
 * (the APPS table). The jkAuth registry seed, Weave's SUITE_APPS, and the nginx peer
 * table all DERIVE from it via that package's builders, so the prober imports the SAME
 * builders (topology.mjs) instead of regex-scraping three independently-kept tables.
 * Add an app = one row in APPS — no probe, loader, or source edit here.
 *
 * `exported` records whether a source is importable as data (true) or has to be scraped
 * (false). With the directory consolidated, the only remaining scrape is a backend that
 * hasn't exported its Weave docs yet (BACKEND_DOCS below).
 */

/** The source-of-truth tables the prober reconstructs the suite topology from. */
export const SOURCES = [
  {
    id: 'suite-manifest',
    label: 'Suite app directory (@jkos/suite-manifest APPS — single source of truth)',
    file: 'packages/suite-manifest/apps.js',
    kind: 'suiteManifest',
    exported: true, // require()-able pure data; registry/manifest/nginx all derive from it
  },
  {
    id: 'codes',
    label: 'auth error-code vocabulary (CODES)',
    file: 'packages/auth-middleware/codes.js',
    kind: 'codes',
    exported: true, // require()-able
  },
];

/**
 * The DERIVED edge/registry views. Each is BUILT at its consumer from a suite-manifest
 * builder, so it cannot drift from the source — the prober reads the same builder the
 * consumer calls. The machine-readability probe reports these as the A2 payoff.
 */
export const DERIVED = [
  { label: 'jkAuth app_registry seed', file: 'apps/jkauth/src/db.js', builder: 'registrySeed()' },
  { label: 'Weave SUITE_APPS fallback manifest', file: 'packages/weave/src/manifest.ts', builder: 'manifestApps()' },
  { label: 'nginx peer-proxy table', file: 'infra/nginx/gen-nginx-weave.mjs', builder: 'peers()' },
];

/**
 * Per-app backend doc sources — where an app declares its Weave CapabilityDoc /
 * DatasetDoc. When `module` is set the docs are exported as DATA and the loader
 * `require()`s the real objects (no scraping) — the C3 payoff: the prober reads the
 * SAME declarations the server serves, and the capability-completeness probe can
 * inspect typed `returns`/filters. `docsFile` (where they're served from) is kept
 * for `where:` references. An app still inlining its docs sets only `docsFile` +
 * `exported:false` and the loader falls back to regex-scraping it.
 * Add a row when a new app grows a Weave surface.
 */
export const BACKEND_DOCS = [
  {
    app: 'beigeboard',
    module: 'apps/beigeboard/backend/discovery.js', // CAPABILITIES/DATASETS as importable data (A3)
    docsFile: 'apps/beigeboard/backend/server.js',  // served from here (serveCapabilities/serveDatasets)
    exported: true,
  },
  {
    app: 'lazuros',
    module: 'apps/lazuros/backend/docs.js',         // CAPABILITIES_DOC/DATASETS_DOC as importable data
    docsFile: 'apps/lazuros/backend/server.js',     // served from here (serveCapabilities/serveDatasets)
    exported: true,
  },
  {
    app: 'papyros',
    module: 'apps/papyros/backend/discovery.js',    // CAPABILITIES/DATASETS as importable data (derived from one defineCollection)
    docsFile: 'apps/papyros/backend/server.js',     // served from here (serveCapabilities/serveDatasets)
    exported: true,
  },
  {
    app: 'kouros',
    module: 'apps/kouros/backend/discovery.js',     // CAPABILITIES/DATASETS as importable data (derived from one defineCollection)
    docsFile: 'apps/kouros/backend/server.js',      // served from here (serveCapabilities/serveDatasets)
    exported: true,
  },
];

'use strict';
// server.js — LazurOS State node. The always-on Weave-integrated front of the AI
// gateway: it serves discovery docs, accepts capability calls, enqueues jobs, and
// exposes the worker-facing /internal API. Heavy inference runs on a compute node
// (the worker, Phase 2); this process only routes and queues.
//
// Built from the repo ROOT context so the @jkos/* workspace resolves (see
// ../Dockerfile, ../docker-compose.yml). CommonJS, matching the other node backends.

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const {
  weaveCors, weaveAuth, weaveWriteGate, healthHandler,
  serveCapabilities, serveDatasets,
} = require('@jkos/weave/server');
const { CAPABILITIES_DOC, DATASETS_DOC } = require('./docs');
const { loadDeploymentConfig } = require('./lib/loadDeployment');
const { composeFromConfig } = require('./lib/composeProviders');
const { makeHandler } = require('./routes/capability');
const jobsRouter = require('./routes/jobs');
const internalRouter = require('./routes/internal');

/* ── Deployment config → providers (the composability seam) ───────────────────
   All hardware-specific facts (model tags, inference backends, WoL MACs, tiers) come
   from the mounted deployment.json. Fail fast at boot on a malformed config. */
const deploymentCfg = loadDeploymentConfig();
const providers = composeFromConfig(deploymentCfg);

const app = express();
app.locals.providers = providers;       // available to route handlers (Phase 1)
app.locals.deploymentCfg = deploymentCfg;

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser()); // weaveAuth reads the jkos_token cookie (browser SSO)

/* Cross-origin: the shared weave header block over the env-derived allowlist. Under
   the suite same-origin edge model (browser → jkos.net/api/lazuros), peer browser
   calls don't hit this; it's here for completeness + dev. */
const originResolver = () => [
  process.env.PORTAL_URL,
  process.env.AUTH_ORIGIN,
  ...(process.env.ALLOWED_ORIGINS || '').split(','),
].map((s) => (s || '').trim().replace(/\/$/, '')).filter(Boolean);
app.use(weaveCors(originResolver));

/* ── Auth gate ─────────────────────────────────────────────────────────────────
   Discovery docs + health are PUBLIC (no secrets — the portal/prober read them
   unauthenticated). Everything else under /api/lazuros requires a valid jkos_token;
   `appId` turns on audience enforcement (the token's aud must include 'lazuros',
   which the jkAuth registry row grants admin/user roles). The /internal worker API is
   gated separately by a shared bearer token, below. */
const PUBLIC_PATHS = [
  '/api/lazuros/health',
  '/api/lazuros/capabilities',
  '/api/lazuros/datasets',
];
const authMiddleware = weaveAuth({ appId: 'lazuros' });
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/lazuros')) return next(); // /internal handled below
  if (PUBLIC_PATHS.includes(req.path)) return next();
  authMiddleware(req, res, next);
});

/* ── Health + Weave discovery (public) ─────────────────────────────────────────
   Health carries the one thing that is true of LazurOS and no other app: the State node
   can be perfectly healthy while the machine that does the actual thinking is ASLEEP.
   That's the design (a wol backend is off until a job wakes it), so it is reported, not
   hidden — `compute_online:false` is the ORDECK systems panel's "gpu asleep" warn, and
   the console's amber row. Probes are bounded (500ms each, in parallel) and cached for
   a few seconds so a polling HUD can't stampede a sleeping node. */
const COMPUTE_TTL_MS = 5000;
let computeCache = { at: 0, value: null };
async function computeStatus() {
  if (computeCache.value && Date.now() - computeCache.at < COMPUTE_TTL_MS) return computeCache.value;
  const entries = Object.entries(providers.computeBackends);
  const probed = await Promise.all(entries.map(async ([id, b]) => [id, await b.probe().catch(() => false)]));
  const backends = Object.fromEntries(probed);
  const value = { compute_online: probed.some(([, online]) => online), backends };
  computeCache = { at: Date.now(), value };
  return value;
}
app.get('/api/lazuros/health', healthHandler('lazuros', computeStatus));
app.get('/api/lazuros/capabilities', serveCapabilities(CAPABILITIES_DOC));
app.get('/api/lazuros/datasets', serveDatasets(DATASETS_DOC));

/* ── Test console (authed) ──────────────────────────────────────────────────────
   A static page for DRIVING the gateway by hand: pick a capability, submit it, watch
   the job walk PENDING → (PENDING_WAKEUP) → IN_PROGRESS → DONE|FAILED. It is the only
   first-party UI LazurOS has, it ships with the node (no build step, no bundle), and
   it talks to this server through the SAME public HTTP contract any peer uses — so
   what it proves, it proves for real.

   Not in PUBLIC_PATHS: it sits behind the weaveAuth gate above, like every other
   non-discovery route. The edge exposes it at https://staging.jkos.net/LazurOS, where
   nginx additionally admin-gates it (see infra/nginx/gen-nginx-weave.mjs). */
app.use('/api/lazuros/console', express.static(path.join(__dirname, 'console')));

/* ── Jobs dataset (authed read) — owner-scoped SQLite-backed list (the read contract). */
app.use('/api/lazuros/jobs', jobsRouter);

/* ── Capability routes — DERIVED from the doc (data, not branches) ───────────────
   Adding a sixth capability to docs.js auto-gets a route; the only per-capability
   logic is the `targetTier`/`scope` it already declares. makeHandler creates the job
   and probe/wakes the resolved tier's ComputeBackend. Full paths keep these under the
   weaveAuth prefix gate above; weaveWriteGate enforces the write scope. */
for (const cap of CAPABILITIES_DOC.capabilities) {
  app.post(cap.path, weaveWriteGate({ scope: cap.scope }), makeHandler(cap));
}

/* ── Internal worker API — bearer-token gated, no jkAuth ─────────────────────────
   The compute-node worker (Phase 2) polls/claims/posts results here. */
const requireInternalToken = (req, res, next) => {
  const tok = req.headers.authorization?.replace('Bearer ', '');
  if (!tok || tok !== process.env.LAZUROS_INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
};
app.use('/internal', requireInternalToken, internalRouter);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`[lazuros] listening on ${PORT}, deployment="${deploymentCfg.name || 'unnamed'}"`));

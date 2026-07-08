'use strict';
// PapyrOS backend — scaffolded by `pnpm new-app`.
//
// The minimal Layer-A app: an Express server that weaves in @jkos/weave/server (the one
// shared backend half — identity, write authorization, CORS, health, serving the
// capability/dataset discovery declarations) over a single COLLECTION primitive. The
// `items` collection's table, CRUD routes, filters and row⇄wire transforms all derive
// from the ONE CollectionDef in ./discovery (Layer D / F3) — so there is no hand-rolled
// table or routes to drift from the served contract. apps/beigeboard/backend/server.js
// is the fuller reference (calendar connectors, AI endpoints, bulk import). To grow the
// app: add fields (or another defineCollection) in discovery.js and mount it here.
const express      = require('express');
const path         = require('path');
const Database     = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const {
  weaveCors, weaveAuth, weaveWriteGate, healthHandler, serveCapabilities, serveDatasets,
} = require('@jkos/weave/server');
const { resolveIssuer } = require('@jkos/auth-middleware');   // shared issuer default (single source)
const { CAPABILITIES, DATASETS, ITEMS } = require('./discovery');   // discovery docs + the collection, derived from one spec

/* ── Env ───────────────────────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 3010;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'papyros.db');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'dist');
const SHELL_URL  = (process.env.SHELL_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Cross-origin allowlist — SHELL_URL plus any ALLOWED_ORIGINS (comma-separated), so a
   second suite app can call PapyrOS cross-origin. (Under the same-origin edge, peer
   browser calls don't hit this.) */
const ALLOWED_ORIGINS = new Set(
  [SHELL_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map(s => s.trim().replace(/\/$/, '')).filter(Boolean)
);

/* Identity verification inputs (JWKS-by-kid → static key → dev stub, all in weaveAuth). */
const JKOS_AUTH_PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').trim();
const JKOS_AUTH_ISSUER     = resolveIssuer();   // shared default ('jkos-auth'); JKOS_AUTH_ISSUER overrides
const JKOS_AUTH_JWKS_URI   = (process.env.JKOS_AUTH_JWKS_URI  || '').trim();

/* ── Database ──────────────────────────────────────────────────────────── */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/* ── Migrations ────────────────────────────────────────────────────────────
   The items table + its weave delta triggers come straight from the collection
   (ITEMS.ddl()) — the same spec that produces the routes + discovery docs. */
const MIGRATIONS = [
  { id: 1, name: 'create_items', up(d) { d.exec(ITEMS.ddl()); } },
];

function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY, name TEXT, run_at TEXT DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT id FROM migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (!applied.has(m.id)) {
      m.up(db);
      db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
      console.log(`[migration] applied: ${m.name}`);
    }
  }
}

/* ── Express app ───────────────────────────────────────────────────────── */
const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(weaveCors(() => [...ALLOWED_ORIGINS]));

/* These API paths are reachable without a valid jkos_token cookie. */
const PUBLIC_PATHS = [
  '/api/capabilities',   // Weave capability declaration — public, no secrets
  '/api/datasets',       // Weave dataset declaration — public, no secrets
];

/* Identity gate: only the API carries user data and is gated. The SPA shell + assets
   are public so a logged-out browser loads the app, gets 401 from /api/auth/me, and is
   redirected to jkAuth — instead of a raw 401 in place of the page. */
const authMiddleware = weaveAuth({
  publicKey: JKOS_AUTH_PUBLIC_KEY,
  jwksUri: JKOS_AUTH_JWKS_URI,
  issuer: JKOS_AUTH_ISSUER,
});
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (PUBLIC_PATHS.some(p => req.path === p)) return next();
  authMiddleware(req, res, next);
});

/* Write authorization — the shared weave gate (guest read-only → service NO_USER_CONTEXT
   → papyros:write scope; a delegated service token writes per-user). Reads need no extra
   gate; every row is scoped to req.user.sub by the collection. */
app.use(weaveWriteGate({ scope: 'papyros:write' }));

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/health', healthHandler('papyros'));

/* ── Weave discovery declarations ───────────────────────────────────────────
   What can be DONE to (CAPABILITIES) and READ from (DATASETS) PapyrOS, derived from
   the collection so the portal, an AI step, and offline tooling read the SAME contract
   the routes enforce. Public; the resource routes still enforce auth + scope. */
app.get('/api/capabilities', serveCapabilities(CAPABILITIES));
app.get('/api/datasets', serveDatasets(DATASETS));

/* ── Auth: me ──────────────────────────────────────────────────────────── */
app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

/* ── Items ───────────────────────────────────────────────────────────────────
   The collection wires GET (filtered + owner-scoped) / POST / PATCH / DELETE at
   /api/items, deriving its filters from the dataset declaration (declared-readable ==
   actually-filtered) and its column⇄wire transforms from the field types. One line. */
ITEMS.mount(app, db);

/* ── Static + SPA fallback ─────────────────────────────────────────────── */
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(STATIC_DIR));
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'), err => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

/* ── Boot ──────────────────────────────────────────────────────────────── */
function boot() {
  runMigrations();
  app.listen(PORT, () => console.log(`PapyrOS running on :${PORT}`));
}

boot();

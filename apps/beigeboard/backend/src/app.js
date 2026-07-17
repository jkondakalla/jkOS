'use strict';
// Express app factory: wires the middleware stack in the same order the monolith
// used (cookies/json/CORS → identity gate → write gate), then mounts the route
// modules and the static SPA fallback. server.js just require()s this and listens.
// Requiring ./db (transitively, via the route modules and below) opens the DB and
// runs migrations once, exactly as the previous single-file server did at startup.
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const {
  weaveCors, weaveWriteGate, healthHandler, serveCapabilities, serveDatasets,
} = require('@jkos/weave/server');
const { ALLOWED_ORIGINS, STATIC_DIR } = require('./config');
const { PUBLIC_PATHS, authMiddleware } = require('./auth');
const { CAPABILITIES, DATASETS } = require('../discovery');   // Weave discovery docs, as importable data (A3)

const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

/* Cross-origin: the shared weave header block over the env-derived allowlist.
   (Under the suite same-origin edge model, peer browser calls don't hit this.) */
app.use(weaveCors(() => [...ALLOWED_ORIGINS]));

/* ── Auth middleware (jkos SSO) ────────────────────────────────────────── */
/* Only the API carries user data and is gated. The SPA shell and assets are
   public so a logged-out browser loads the app, gets 401 from /api/auth/me,
   and is redirected to jkAuth — instead of a raw 401 in place of the page. */
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (PUBLIC_PATHS.some(p => req.path === p)) return next();
  authMiddleware(req, res, next);
});

/* Write authorization — the shared weave gate (guest read-only → service
   NO_USER_CONTEXT → beigeboard:write scope). Reads need no extra gate beyond a
   valid token; every row is already scoped to req.user.sub. */
app.use(weaveWriteGate({ scope: 'beigeboard:write' }));

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/health', healthHandler('beigeboard'));

/* ── Weave discovery declarations ──────────────────────────────────────────
   What can be DONE to (CAPABILITIES) and READ from (DATASETS) BeigeBoard, as pure
   data — an importable module (../discovery) so the portal, an AI step, and offline
   tooling (the suite-prober) all read the SAME declarations the server serves.
   Public; the resource routes still enforce auth + scope. See WEAVE.md. */
app.get('/api/capabilities', serveCapabilities(CAPABILITIES));
app.get('/api/datasets', serveDatasets(DATASETS));

/* ── Route modules ─────────────────────────────────────────────────────── */
app.use(require('./routes/calendar'));       // /api/auth/me + OAuth flows + status/sync
app.use(require('./routes/items'));          // /api/items CRUD
app.use(require('./routes/import').router);  // /api/import

/* ── Static + SPA fallback ─────────────────────────────────────────────── */
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(STATIC_DIR));
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'), err => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

module.exports = app;

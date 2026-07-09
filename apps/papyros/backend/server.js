'use strict';
// PapyrOS backend — scaffolded by `pnpm new-app`, Wave 2 grew its own catalog.
//
// An Express server that weaves in @jkos/weave/server (the one shared backend half —
// identity, write authorization, CORS, health, serving the capability/dataset discovery
// declarations). Wave 1 scaffolded a single placeholder `items` defineCollection; Wave 2
// (2.1) replaces it with the real shared `books` catalog below — a plain migration, not
// a defineCollection, because books are populated by the library SCANNER (not user CRUD)
// and are shared across users (no owner column). apps/beigeboard/backend/server.js is
// the fuller reference (calendar connectors, AI endpoints, bulk import) for this
// hand-rolled-table style of migration.
const express      = require('express');
const path         = require('path');
const Database     = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const {
  weaveCors, weaveAuth, weaveWriteGate, healthHandler, serveCapabilities, serveDatasets,
} = require('@jkos/weave/server');
const { resolveIssuer } = require('@jkos/auth-middleware');   // shared issuer default (single source)
const { CAPABILITIES, DATASETS } = require('./discovery');   // discovery docs (2.3 write side + 2.4 read side)
const { createScanner } = require('./src/library/scan');     // 2.3: AUDIOBOOKS_DIR walker → `books` catalog
const { createLibraryRouter } = require('./src/routes/library'); // 2.3: rescanLibrary route
const { createBooksRouter } = require('./src/routes/books');     // 2.4: filtered `books` dataset read

/* ── Env ───────────────────────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 3010;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'papyros.db');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'dist');
const SHELL_URL  = (process.env.SHELL_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Library scanner (2.3): the folder the scanner walks (docker-compose mounts the real
   NAS library read-only at /audiobooks) and the root it writes covers under. DATA_DIR
   is DB_PATH's directory (the same persisted volume as the db, /data in prod) rather
   than its own env var — one less knob, and the brief's literal cover path
   (/data/covers/<id>.jpg) falls out of it directly. */
const AUDIOBOOKS_DIR = process.env.AUDIOBOOKS_DIR || path.join(__dirname, 'audiobooks');
const DATA_DIR        = path.dirname(DB_PATH);

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

/* Library scanner instance (2.3). Safe to construct before runMigrations() runs — its
   statements are prepared lazily inside scanLibrary(), not here — so route mounting
   below (module load time) and the boot scan (after migrations, inside boot()) can
   share the one instance without an ordering trap. */
const scanner = createScanner({ db, audiobooksDir: AUDIOBOOKS_DIR, dataDir: DATA_DIR });

/* ── Migrations ────────────────────────────────────────────────────────────
   `books` is a SHARED catalog (no user_id — every user sees the same library) that the
   scanner (src/library/*, Wave 2) populates by walking the audiobook mount and running
   ffprobe; there is no user-facing create/update/delete, so this is a plain hand-rolled
   migration rather than a defineCollection. `files`/`chapters`/`genres` are JSON-array
   TEXT columns (files: [{index,path,duration,codec}], chapters: [{start,end,title}]).
   The updated_at stamp/touch triggers mirror @jkos/weave/collection's delta-cursor
   convention (?since=<cursor> → updated_at > ?) so the Wave-2.4 books DatasetDef can
   declare a `since` filter over this table exactly like a defineCollection one would. */
const MIGRATIONS = [
  {
    id: 1,
    name: 'create_books',
    up(d) {
      d.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          path            TEXT    NOT NULL UNIQUE,
          title           TEXT,
          subtitle        TEXT,
          author          TEXT,
          narrator        TEXT,
          series          TEXT,
          series_seq      REAL,
          year            INTEGER,
          genres          TEXT    DEFAULT '[]',
          duration        REAL,
          files           TEXT    DEFAULT '[]',
          chapters        TEXT    DEFAULT '[]',
          cover_path      TEXT,
          metadata_source TEXT    CHECK (metadata_source IS NULL OR metadata_source IN ('embedded', 'itunes', 'manual')),
          ext_ref         TEXT,
          mtime           INTEGER,
          added_at        TEXT    DEFAULT (datetime('now')),
          updated_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_books_author  ON books(author);
        CREATE INDEX IF NOT EXISTS idx_books_series  ON books(series);
        CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at);

        DROP TRIGGER IF EXISTS books_stamp_added;
        CREATE TRIGGER books_stamp_added AFTER INSERT ON books
          FOR EACH ROW WHEN NEW.updated_at IS NULL
          BEGIN UPDATE books SET updated_at = COALESCE(NEW.added_at, datetime('now')) WHERE id = NEW.id; END;
        DROP TRIGGER IF EXISTS books_touch_updated;
        CREATE TRIGGER books_touch_updated AFTER UPDATE ON books
          FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
          BEGIN UPDATE books SET updated_at = datetime('now') WHERE id = NEW.id; END;
      `);
    },
  },
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
   → papyros:write scope; a delegated service token writes per-user). `books` is a
   SHARED catalog (no owner column) written only by the scanner/rescan capability, not
   by arbitrary per-user CRUD — this gate still covers any future write route. */
app.use(weaveWriteGate({ scope: 'papyros:write' }));

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/health', healthHandler('papyros'));

/* ── Weave discovery declarations ───────────────────────────────────────────
   What can be DONE to (CAPABILITIES, 2.3's rescanLibrary) and READ from (DATASETS,
   2.4's `books`) PapyrOS, so the portal, an AI step, and offline tooling read the SAME
   contract the routes below enforce. Public; the resource routes still enforce auth
   (and, for rescanLibrary, the admin-role gate). */
app.get('/api/capabilities', serveCapabilities(CAPABILITIES));
app.get('/api/datasets', serveDatasets(DATASETS));

/* ── Auth: me ──────────────────────────────────────────────────────────── */
app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

/* ── Library (2.3 write side + 2.4 read side) ─────────────────────────────
   Both identity-gated (neither path is in PUBLIC_PATHS above) — books metadata is
   fine behind login, it's just not in the public discovery-doc allowlist. */
app.use(createLibraryRouter({ scanLibrary: scanner.scanLibrary }));
app.use(createBooksRouter({ db }));

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
  app.listen(PORT, () => {
    console.log(`PapyrOS running on :${PORT}`);
    // Non-blocking background scan: listen() must not wait on walking (possibly a
    // large) AUDIOBOOKS_DIR. Not awaited on purpose — .catch keeps a scan failure
    // (missing mount, no ffprobe, …) from becoming an unhandled rejection that could
    // take the process down.
    console.log(`[papyros scan] boot scan starting (${AUDIOBOOKS_DIR})`);
    scanner.scanLibrary()
      .then((counts) => console.log(`[papyros scan] boot scan complete: ${JSON.stringify(counts)}`))
      .catch((err) => console.error(`[papyros scan] boot scan failed: ${err.message}`));
  });
}

boot();

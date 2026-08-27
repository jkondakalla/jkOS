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
  weaveCors, weaveAuth, weaveWriteGate, healthHandler, serveCapabilities, serveDatasets, serveSpa,
  backfillWireTime,   // XC-1: one-time conversion of existing rows to the canonical wire format
} = require('@jkos/weave/server');
const { resolveIssuer } = require('@jkos/auth-middleware');   // shared issuer default (single source)
const {
  CAPABILITIES, DATASETS, PROGRESS, BOOKMARKS, CLUBS, CLUB_MEMBERS, HISTORY, META,
} = require('./discovery');   // discovery docs (2.3/2.4) + 3.1's four owner-scoped collections + 17.4's append-only HISTORY + 4.1's META connector
const { createScanner } = require('./src/library/scan');     // 2.3: AUDIOBOOKS_DIR walker → `books` catalog
const { createLibraryRouter } = require('./src/routes/library'); // 2.3: rescanLibrary route
const { createBooksRouter } = require('./src/routes/books');     // 2.4: filtered `books` dataset read
const { createMediaRouter, prepareAllCompat } = require('./src/media');   // 3.2/3.3 media routes + the compat pre-generation sweep
const { createMatchRouter, runEnrichmentSweep } = require('./src/routes/match');   // 4.2 matchBook + the auto-enrichment sweep

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
/* Post-scan hook (boot scan AND admin rescans): auto-enrich metadata when
   PAPYROS_AUTO_ENRICH=1 (both compose files set it; tests don't, so smoke boots never
   touch the live iTunes API). Fire-and-forget — enrichment failing must never affect
   a scan's result, same doctrine as the boot scan itself. */
const AUTO_ENRICH = process.env.PAPYROS_AUTO_ENRICH === '1';
const AUTO_COMPAT = process.env.PAPYROS_AUTO_COMPAT === '1';
function onScanComplete() {
  if (AUTO_ENRICH) {
    runEnrichmentSweep({ db, dataDir: DATA_DIR, doFetch: globalThis.fetch })
      .then((r) => console.log(`[papyros] auto-enrich: applied ${r.applied.length}/${r.examined}${r.truncated ? ' (truncated — next scan continues)' : ''}`))
      .catch((err) => console.warn(`[papyros] auto-enrich failed: ${err.message}`));
  }
  if (AUTO_COMPAT) {
    prepareAllCompat({ db, audiobooksDir: AUDIOBOOKS_DIR, dataDir: DATA_DIR })
      .then((r) => console.log(`[papyros] auto-compat: ${r.made} generated, ${r.fresh} already fresh${r.failed ? `, ${r.failed} FAILED` : ''}`))
      .catch((err) => console.warn(`[papyros] auto-compat failed: ${err.message}`));
  }
}

const scanner = createScanner({ db, audiobooksDir: AUDIOBOOKS_DIR, dataDir: DATA_DIR, onScanComplete });

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
  // 3.1: the four per-user collections — each DDL comes straight off its
  // defineCollection (discovery.js), so the table, the CRUD routes (mounted below),
  // and the served capability/dataset docs cannot drift from one another.
  { id: 2, name: 'create_progress',     up(d) { d.exec(PROGRESS.ddl()); } },
  { id: 3, name: 'create_bookmarks',    up(d) { d.exec(BOOKMARKS.ddl()); } },
  { id: 4, name: 'create_clubs',        up(d) { d.exec(CLUBS.ddl()); } },
  { id: 5, name: 'create_club_members', up(d) { d.exec(CLUB_MEMBERS.ddl()); } },
  // 4.2: `books` had no home for an iTunes-sourced blurb — matchBook (src/routes/
  // match.js) writes a candidate's description onto the book it matched, and
  // GET /api/book/:id (src/media.js) serves it back. Deliberately NOT in BOOK_SHAPE's
  // list row (discovery.js) — see that file's comment just above BOOK_SHAPE.
  { id: 6, name: 'add_book_description', up(d) { d.exec('ALTER TABLE books ADD COLUMN description TEXT'); } },
  /* Tags fix (Jag 2026-07-10): standalone rips tag album == title, and the old probe
     mapping wrote that through as a junk "series" equal to the book's own name (every
     card wore its title as a pill). probe.js now maps album==title -> NULL for future
     scans; this one-shot heals rows written before the fix — a rescan alone never
     would, because the scanner skips mtime-unchanged folders. */
  { id: 7, name: 'null_series_equal_title', up(d) { d.exec("UPDATE books SET series = NULL WHERE series IS NOT NULL AND title IS NOT NULL AND lower(trim(series)) = lower(trim(title))"); } },
  /* 17.5 (BUG): `progress` had no server-side UNIQUE(user_id, book_ref) — one-row-
     per-user-per-book was a CLIENT convention only (the resume cursor's find-then-
     create/update choreography, packages/weave/src/resumeCursor.ts + offline/
     writes.ts's find-by-book_ref-else-POST replay), which the server would happily
     let a race violate (two POSTs landing before either's row existed yet — e.g.
     two tabs' first play of the same book). Dedupe FIRST (keep the newest row per
     pair — highest updated_at, ties by highest id — via ROW_NUMBER(), so this
     migration can't crash on a staging DB that already carries duplicates: a
     migration that dies on existing rows is a boot-loop trap), THEN add the
     composite UNIQUE index. SQLite has no ALTER TABLE ADD CONSTRAINT — a UNIQUE
     INDEX is the idiom, same DDL-only shape as migration 1's idx_books_* (no table
     rebuild). A companion BEFORE INSERT trigger makes POST /api/progress upsert-
     safe against that index WITHOUT touching packages/weave/src/server/
     collection.js's generic mount(): defineCollection's create route has no per-
     collection conflict hook, and its generic `fail()` maps ANY thrown error
     (including SQLITE_CONSTRAINT_UNIQUE) to a bare 500 — which resumeCursor.ts's
     doWrite() swallows non-fatally (by design, for transient failures), but since
     `row` is only ever reassigned on a SUCCESSFUL write, a raw constraint violation
     would silently and PERMANENTLY stop that tab's position saves for the book
     (every later tick retries the same losing create forever). The trigger deletes
     the stale (user_id, book_ref) row immediately before the INSERT proceeds, so
     the create route's own SQL is untouched and always succeeds — the second
     creator's data wins, same last-write-wins semantics an unconstrained PATCH race
     already had, and the collection's `id`/`updated_at` triggers (PROGRESS.ddl())
     still stamp the surviving row normally. */
  {
    id: 8,
    name: 'progress_unique_user_book',
    up(d) {
      d.exec(`
        DELETE FROM progress WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY user_id, book_ref
              ORDER BY updated_at DESC, id DESC
            ) AS rn
            FROM progress
          )
          WHERE rn > 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_user_book ON progress(user_id, book_ref);

        DROP TRIGGER IF EXISTS progress_upsert_on_conflict;
        CREATE TRIGGER progress_upsert_on_conflict BEFORE INSERT ON progress
          FOR EACH ROW WHEN EXISTS (
            SELECT 1 FROM progress WHERE user_id = NEW.user_id AND book_ref = NEW.book_ref
          )
          BEGIN
            DELETE FROM progress WHERE user_id = NEW.user_id AND book_ref = NEW.book_ref;
          END;
      `);
    },
  },
  // 17.4: `history` — append-only play events (HISTORY.ddl(), same one-source
  // pattern as migration 2's `progress`). Deliberately NO analogue of migration 8's
  // upsert-on-conflict trigger: history is meant to accumulate one row per session,
  // never collapse duplicates — the opposite intent of progress's resume cursor.
  { id: 9, name: 'create_history', up(d) { d.exec(HISTORY.ddl()); } },
  /* XC-1: see the same migration in KourOS. Converts rows already written to the
     canonical millisecond-ISO wire format; the recreated triggers handle new ones. */
  {
    id: 10, name: 'canonical_wire_timestamps',
    up(d) { backfillWireTime(d, ['books', 'progress', 'bookmarks', 'clubs', 'club_members', 'history']); },
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

/* 3.4 audit fix: run migrations NOW, before any route is registered below — not
   deferred into boot() (which used to run it last, AFTER every app.use/app.get call
   in this file had already executed). library/books routers happened to survive that
   because they db.prepare() lazily inside each request handler; 3.4's media router
   (src/media.js) prepares its `books` SELECT at construction time, so mounting it
   below while `books` doesn't exist yet threw SQLITE_ERROR "no such table: books" at
   boot. Matches apps/beigeboard/backend/src/db.js's require-time runMigrations() —
   the DB is ready before any route or the listen() call touches it. */
runMigrations();

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
app.get('/api/auth/me', (req, res) => res.json({ user: req.user })); // app-private: echoes the verified identity back to this app's own SPA; jkAuth owns the identity contract

/* ── Library (2.3 write side + 2.4 read side) ─────────────────────────────
   Both identity-gated (neither path is in PUBLIC_PATHS above) — books metadata is
   fine behind login, it's just not in the public discovery-doc allowlist. */
app.use(createLibraryRouter({ scanLibrary: scanner.scanLibrary }));
app.use(createBooksRouter({ db }));

/* ── Per-user collections (3.1 + 17.4) ─────────────────────────────────────
   progress/bookmarks/clubs/club_members each wire their own scoped GET/POST/PATCH/
   DELETE at /api/<id> in one line — filtered (their dataset's declared filters) AND
   owner-scoped to req.user.sub, derived from the CollectionDefs in discovery.js.
   `history` (17.4) is the same shape but append-only — its CollectionDef declares
   `only: ['create']`, so .mount() below wires GET (list) + POST (create) only; there
   is no PATCH/DELETE route for it at all. Mounted after the identity gate + write
   gate (above) and before the SPA fallback, same slot as the library/books routes. */
PROGRESS.mount(app, db);
BOOKMARKS.mount(app, db);
CLUBS.mount(app, db);
CLUB_MEMBERS.mount(app, db);
HISTORY.mount(app, db);   // 17.4: GET (list) + POST (create) only — see discovery.js's HISTORY comment

/* ── Connectors (4.1) ──────────────────────────────────────────────────────
   META wires GET /api/metadataSearch — it proxies to the iTunes Search API
   server-side and maps the JSON response to the typed row shape declared in
   discovery.js. `defineConnector`'s mount(router, opts) signature (not
   defineCollection's mount(app, db) above) defaults opts.fetch to the global
   fetch (Node >=18) and opts.basePath to '/api', so `META.mount(app)` needs no
   overrides here — auth.kind is 'none' so there's no token to resolve either.
   Mounted in the same identity-gated + write-gate-cleared slot as every other
   route below (it is NOT in PUBLIC_PATHS above, so the gate at line ~170
   still covers it — only /api/capabilities and /api/datasets are public). */
META.mount(app);

/* ── matchBook (4.2) ────────────────────────────────────────────────────────
   POST /api/match applies a chosen metadataSearch candidate (META, just above) to a
   book: author/description/year/genres + metadata_source/ext_ref, plus a best-effort
   600x600 cover download to DATA_DIR/covers/<id>.jpg. No fetch override here — the
   route defaults to the real global fetch (Node >=20); only the throwaway test in
   task 4.2/4.4 injects a mock. Same identity-gated + write-gate-cleared slot as every
   other route in this file. */
app.use(createMatchRouter({ db, dataDir: DATA_DIR }));

/* ── Media (3.2 stream/cover/book-detail + 3.3 download) ──────────────────
   The playback backend: range-aware audio streaming, cover art, book detail (the
   per-track file manifest BOOK_SHAPE deliberately excludes from the list route), and
   whole-book download (single file direct, multi-file zipped on the fly). Task 3.4
   mounts it here — same identity-gated + write-gate-cleared slot as library/books/
   collections above, still before the /api/* 404 catch-all and the SPA fallback. */
app.use(createMediaRouter({ db, audiobooksDir: AUDIOBOOKS_DIR, dataDir: DATA_DIR }));

/* ── Static + SPA fallback ─────────────────────────────────────────────── */
/* serveSpa is the suite's shared rule (see @jkos/weave/server/spa.js): revalidate
   the entry document, cache hashed assets forever, and 404 a missing asset instead
   of handing back the HTML shell — which is what turns a redeploy into a blank
   page under a correct <title>. */
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));
serveSpa(app, STATIC_DIR, { express });

/* ── Boot ──────────────────────────────────────────────────────────────── */
function boot() {
  // runMigrations() already ran above (before routes were registered) — boot() only
  // has to start listening + kick off the background scan.
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

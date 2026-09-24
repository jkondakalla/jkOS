'use strict';
// KourOS backend — git history: item 18.2: the real music backend on the shared bricks (Wave 17).
// Wave 18.1 scaffolded the minimal Layer-A template (a single placeholder `items`
// defineCollection); this replaces it. Follows PapyrOS's proven pattern verbatim:
// `tracks` is a SHARED, scanner-written catalog (`defineLibraryScanner`, unit:'file' —
// one row per track, git history: item 17.2) with a hand-rolled migration (not a defineCollection
// — same reasoning as papyros's `books`: populated by the scanner, not user CRUD, no
// owner column); `playlists`/`history`/`ratings` are genuine per-user CRUD via
// defineCollection. Media playback (range-aware streaming + cover art) comes from
// `defineMediaRoutes` (17.3) — direct-play only, no compat ladder (see src/media.js's
// header for why). apps/papyros/backend/server.js is the fuller reference this mirrors.
const express      = require('express');
const path         = require('path');
const Database     = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const {
  weaveCors, weaveAuth, weaveWriteGate, healthHandler, serveCapabilities, serveDatasets, serveSpa,
  backfillWireTime,   // XC-1: one-time conversion of existing rows to the canonical wire format
  SQL_NOW, sqlConvert,   // XC-1: the canonical stamp, and the both-forms converter
} = require('@jkos/weave/server');
const { resolveIssuer } = require('@jkos/auth-middleware');   // shared issuer default (single source)
const {
  CAPABILITIES, DATASETS, PLAYLISTS, HISTORY, RATINGS, ACTIVITY,
  PROGRESS, BOOKMARKS, BOOK_HISTORY, META,
} = require('./discovery');   // discovery docs + the collections + the activity surface + the audiobook half
const { createScanner } = require('./src/library/scan');            // 18.2: MUSIC_DIR walker → `tracks` catalog
const { createLibraryRouter } = require('./src/routes/library');    // 18.2: rescanLibrary route
const { createTracksRouter } = require('./src/routes/tracks');      // 18.2: filtered `tracks` dataset read
const { createMediaRouter } = require('./src/media');               // 18.2: stream/cover/download routes
const { createBrowseRouter } = require('./src/routes/browse');      // server-side album/artist grouping
const { createDiscoverRouter } = require('./src/routes/discover');  // the similarity engine's HTTP surface
const { createDiscovery } = require('./src/discover');              // vectors → aligned space → similar/radio/runs/map
// Audiobooks — PapyrOS's backend, folded in (2026-09-23; see discovery.js's books block).
const { createBookScanner } = require('./src/books/scan');               // AUDIOBOOKS_DIR walker → `books` catalog
const { createBooksRouter } = require('./src/books/list');               // filtered `books` dataset read
const { createBookMediaRouter, prepareAllCompat } = require('./src/books/media');   // /api/books/stream|cover|download + /api/book/:id
const { createMatchRouter, runEnrichmentSweep } = require('./src/books/match');     // matchBook / matchAllMissing + the enrichment sweep

/* ── Env ───────────────────────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 3011;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'kouros.db');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'dist');
const SHELL_URL  = (process.env.SHELL_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Library scanner: the folder the boot scan + rescanLibrary walk. NEVER a hardcoded NAS
   path here — unlike papyros's AUDIOBOOKS_DIR, no docker-compose bind mount exists for
   this yet; the real music library mount is Jag's own deploy-time decision (git history: item 18.2, flagged in the wave's report). The local-dev default (a sibling `music/`
   folder that doesn't need to exist — the scanner degrades to a 0-track no-op when it's
   missing) mirrors papyros's AUDIOBOOKS_DIR default exactly. DATA_DIR mirrors papyros
   too: DB_PATH's own directory, so cover art lands at <DATA_DIR>/covers/<id>.jpg with
   no extra knob. */
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, 'music');
const DATA_DIR  = path.dirname(DB_PATH);

/* The audiobook library (PapyrOS's AUDIOBOOKS_DIR, folded in). Same missing-folder
   degradation as MUSIC_DIR: an absent root scans to zero books, it does not fail boot.
   ⚠️ BOOKS_DATA_DIR is a SUBDIRECTORY of DATA_DIR, not DATA_DIR: the scanner brick
   writes covers to `<dataDir>/covers/<id>.jpg` and tracks already own that path —
   book 12 and track 12 would overwrite each other's art (see src/books/scan.js). The
   compat remux cache lives under it too. */
const AUDIOBOOKS_DIR = process.env.AUDIOBOOKS_DIR || path.join(__dirname, 'audiobooks');
const BOOKS_DATA_DIR = path.join(DATA_DIR, 'books');
/* Post-book-scan sweeps, compose-only (the smokes never set them, so a test boot never
   touches the live iTunes API or races a 404-before-prepare assertion). */
const BOOKS_AUTO_ENRICH = process.env.KOUROS_BOOKS_AUTO_ENRICH === '1';
const BOOKS_AUTO_COMPAT = process.env.KOUROS_BOOKS_AUTO_COMPAT === '1';

/* The music embedder's index (ALGORITHMS.md §4's music/index.db) — the source of the CLAP
   vectors behind similarity, radio, Runs and the vibe map. OPTIONAL by design: it
   is produced by a separate Python pipeline on a separate schedule, it is read
   strictly read-only, and when it is absent (or has not reached a given track yet)
   every discovery surface degrades to metadata affinity and says so on the wire.
   Defaults to a file beside the database so the deploy only has to place it there. */
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH || path.join(DATA_DIR, 'music-index.db');

/* The pulsarmap mesh store (ALGORITHMS.md §9's music/meshes.db) — one decimated,
   quantised mel matrix per track, revealed as the track plays. A SEPARATE FILE
   from the vector index on purpose: that one holds the whole banked vector space
   and its own snapshot invariant, and a mesh table has no business in it.
   OPTIONAL on exactly the same terms as VECTOR_DB_PATH — separate pipeline,
   separate schedule, read strictly read-only, and a track with no mesh yet
   answers `state: 'pending'` rather than failing. */
const MESH_DB_PATH = process.env.MESH_DB_PATH || path.join(DATA_DIR, 'music-meshes.db');

/* The directory name the embedder's paths are rooted at, used to recover an
   artist/title key from an index built against a DIFFERENT library layout — see
   src/discover/vectors.js's header for why a plain path join is not enough. */
const LIBRARY_ROOT_NAME = process.env.LIBRARY_ROOT_NAME || path.basename(MUSIC_DIR);

/* Cross-origin allowlist — SHELL_URL plus any ALLOWED_ORIGINS (comma-separated), so a
   second suite app can call KourOS cross-origin. (Under the same-origin edge, peer
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

/* Library scanner instance. Safe to construct before runMigrations() runs — its
   statements are prepared lazily inside scanLibrary(), not here — so the boot scan
   (after migrations, inside boot()) can share the one instance with no ordering trap. */
const scanner = createScanner({
  db, musicDir: MUSIC_DIR, dataDir: DATA_DIR,
  // A completed scan changes the catalog the similarity space is aligned onto, so
  // drop the built space rather than serving neighbours for a library that no
  // longer matches. `discovery` is declared just below — this callback only ever
  // fires long after module load, so the forward reference is safe.
  onScanComplete: () => discovery.invalidate(),
});

/* The audiobook scanner, beside the music one. Its completion hook runs PapyrOS's two
   optional sweeps; both are fire-and-forget — a sweep failing must never change what a
   scan reports. */
function onBookScanComplete() {
  if (BOOKS_AUTO_ENRICH) {
    runEnrichmentSweep({ db, dataDir: BOOKS_DATA_DIR, doFetch: globalThis.fetch })
      .then((r) => console.log(`[kouros books] auto-enrich: applied ${r.applied.length}/${r.examined}${r.truncated ? ' (truncated — next scan continues)' : ''}`))
      .catch((err) => console.warn(`[kouros books] auto-enrich failed: ${err.message}`));
  }
  if (BOOKS_AUTO_COMPAT) {
    prepareAllCompat({ db })
      .then((r) => console.log(`[kouros books] auto-compat: ${r.made} generated, ${r.fresh} already fresh${r.failed ? `, ${r.failed} FAILED` : ''}`))
      .catch((err) => console.warn(`[kouros books] auto-compat failed: ${err.message}`));
  }
}
const bookScanner = createBookScanner({
  db, audiobooksDir: AUDIOBOOKS_DIR, dataDir: BOOKS_DATA_DIR, onScanComplete: onBookScanComplete,
});

/** One rescan over BOTH roots, counts summed — the shape `rescanLibrary` declares.
 *  Sequential, not parallel: both walks spawn ffprobe pools against the same NAS. The
 *  analysis-delivery hook below still rescans MUSIC ONLY — a new analysis file
 *  describes music, and walking every book folder for it would be wasted I/O. */
async function scanEverything() {
  const music = await scanner.scanLibrary();
  const books = await bookScanner.scanLibrary();
  const sum = {};
  for (const k of ['scanned', 'upserted', 'removed', 'skipped']) sum[k] = (music[k] || 0) + (books[k] || 0);
  return sum;
}

/* The discovery service. Built lazily on first read (the `tracks` table does not
   exist yet at this point — migrations run below) and rebuilt whenever a scan
   changes the catalog, so a rescan that adds an album is reflected without waiting
   out its TTL. */
const discovery = createDiscovery({
  db, vectorDbPath: VECTOR_DB_PATH, meshDbPath: MESH_DB_PATH, libraryRootName: LIBRARY_ROOT_NAME, musicDir: MUSIC_DIR,
  // How long an analysis file is trusted before its identity is re-read. Only the
  // smoke sets this; five minutes is the right answer for a person.
  ttlMs: Number(process.env.DISCOVER_TTL_MS) > 0 ? Number(process.env.DISCOVER_TTL_MS) : undefined,
  /* An analysis delivery means the workstation's watcher found new music on the
     shelf — so walk it. The same incremental scan the boot runs (unchanged files
     are skipped by mtime, a scan in flight is joined), and its onScanComplete above
     drops the space so the upload's track and its vectors arrive together. Not
     awaited, exactly like the boot scan: a request must never wait on a walk. */
  onAnalysisChanged: (what) => {
    console.log(`[kouros scan] ${what} was replaced — rescanning for the music it describes`);
    scanner.scanLibrary()
      .then((counts) => console.log(`[kouros scan] analysis-triggered scan complete: ${JSON.stringify(counts)}`))
      .catch((err) => console.error(`[kouros scan] analysis-triggered scan failed: ${err.message}`));
  },
});

/* ── Migrations ────────────────────────────────────────────────────────────
   `tracks` is a SHARED catalog (no user_id — every user sees the same library) that
   the scanner (src/library/scan.js) populates by walking MUSIC_DIR and running
   ffprobe; there is no user-facing create/update/delete, so this is a plain
   hand-rolled migration rather than a defineCollection — same shape as papyros's
   `books` (server.js migration 1 there). `files`/`chapters` are the brick's own JSON-
   array TEXT columns (files: always one entry, {index:0,path,duration,codec} — a
   'file'-unit row is always exactly one track; chapters: always [], music files carry
   none). The updated_at stamp/touch triggers mirror @jkos/weave/collection's
   delta-cursor convention (?since=<cursor> → updated_at > ?) so the `tracks`
   DatasetDef (discovery.js) can declare a `since` filter exactly like a
   defineCollection one would. */
const MIGRATIONS = [
  {
    id: 1,
    name: 'create_tracks',
    up(d) {
      d.exec(`
        CREATE TABLE IF NOT EXISTS tracks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          path        TEXT    NOT NULL UNIQUE,
          title       TEXT,
          artist      TEXT,
          album       TEXT,
          albumartist TEXT,
          track_no    INTEGER,
          disc_no     INTEGER,
          year        INTEGER,
          genres      TEXT    DEFAULT '[]',
          duration    REAL,
          files       TEXT    DEFAULT '[]',
          chapters    TEXT    DEFAULT '[]',
          cover_path  TEXT,
          mtime       INTEGER,
          added_at    TEXT    DEFAULT (${SQL_NOW}),
          updated_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_artist  ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album   ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks(updated_at);

        -- XC-1: these stamp updated_at, which is this catalog's declared ?since=
        -- delta cursor, so they must write the canonical millisecond-ISO form.
        -- See the note above migration 7 for why converting the rows once
        -- was not enough.
        DROP TRIGGER IF EXISTS tracks_stamp_added;
        CREATE TRIGGER tracks_stamp_added AFTER INSERT ON tracks
          FOR EACH ROW WHEN NEW.updated_at IS NULL
          BEGIN UPDATE tracks SET updated_at = COALESCE(${sqlConvert('NEW.added_at')}, ${SQL_NOW}) WHERE id = NEW.id; END;
        DROP TRIGGER IF EXISTS tracks_touch_updated;
        CREATE TRIGGER tracks_touch_updated AFTER UPDATE ON tracks
          FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
          BEGIN UPDATE tracks SET updated_at = ${SQL_NOW} WHERE id = NEW.id; END;
      `);
    },
  },
  { id: 2, name: 'create_playlists', up(d) { d.exec(PLAYLISTS.ddl()); } },
  { id: 3, name: 'create_history',   up(d) { d.exec(HISTORY.ddl()); } },
  /* `ratings`: the collection's generic ddl() PLUS a composite UNIQUE(user_id,
     track_ref) index and an upsert-on-conflict BEFORE INSERT trigger, in the SAME
     migration — from day one, not retrofitted (the papyros 17.5 lesson; see
     discovery.js's RATINGS comment for why a fresh table needs no dedupe step the
     way papyros's live `progress` table did). The trigger deletes the caller's
     existing (user_id, track_ref) row immediately before an INSERT that would
     collide with the unique index, so a second "rate this track" POST — whether the
     client's own find-else-POST replay or a genuine two-tab race — updates the
     rating in place instead of hitting a raw SQLITE_CONSTRAINT_UNIQUE (which
     defineCollection's generic mount() would map to a bare 500 via its generic
     `fail()` — see packages/weave/src/server/collection.js). */
  {
    id: 4,
    name: 'create_ratings',
    up(d) {
      d.exec(RATINGS.ddl());
      d.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_user_track ON ratings(user_id, track_ref);
        DROP TRIGGER IF EXISTS ratings_upsert_on_conflict;
        CREATE TRIGGER ratings_upsert_on_conflict BEFORE INSERT ON ratings
          FOR EACH ROW WHEN EXISTS (
            SELECT 1 FROM ratings WHERE user_id = NEW.user_id AND track_ref = NEW.track_ref
          )
          BEGIN
            DELETE FROM ratings WHERE user_id = NEW.user_id AND track_ref = NEW.track_ref;
          END;
      `);
    },
  },
  /* XC-1: bring every collection's timestamps onto the suite's canonical
     millisecond-ISO wire format. The whole-second `datetime('now')` default sorts
     BEFORE an ISO stamp of the same instant as a string (' ' < 'T'), and
     `?since=` IS a string comparison — so a delta cursor was not portable across
     the suite. The triggers converge new rows on their own (they are recreated
     each boot); this converts the rows already written. Idempotent. */
  {
    id: 5, name: 'canonical_wire_timestamps',
    up(d) { backfillWireTime(d, ['tracks', 'playlists', 'history', 'ratings']); },
  },
  /* D6: the activity read orders and windows on (user_id, started_at), which had no
     index — `history` carried only defineCollection's implicit user + updated_at
     ones. A ledger is the one table that only ever grows, so a full per-user scan
     here gets slower every day it works. */
  {
    id: 6, name: 'index_history_started',
    up(d) { d.exec('CREATE INDEX IF NOT EXISTS idx_history_user_started ON history(user_id, started_at)'); },
  },
  /* ⚠️ A SECOND conversion, because the first one did not hold. Migration 5
     canonicalised these columns and recorded that "the triggers converge new rows on
     their own (they are recreated each boot)". That is exactly backwards: they ARE
     recreated each boot, from the DDL above, which went on writing SQLite's
     whole-second `datetime('now')`. So every row stamped since — every rescan, every
     edit — went straight back to the legacy form, into the column that IS the
     `?since=` cursor (the music vector space's incremental-embedding cursor is the reason XC-1 was raised). `' ' < 'T'`, so a mixed column
     sorts wrongly as a string and a delta silently returns the wrong window.
     The triggers are fixed; this converts the rows written in the gap.
     `backfillWireTime` skips already-canonical values, so it is a no-op on a
     database that never drifted.
     ⚠️ The probe that exists to catch this never scanned this file — its SCAN_ROOTS
     named `backend/src` and this is `backend/server.js`. Both are fixed. */
  {
    id: 7, name: 'rebackfill_wire_timestamps',
    up(d) { backfillWireTime(d, ['tracks', 'playlists', 'history', 'ratings'], { history: ['started_at'] }); },
  },
  /* ── Audiobooks: PapyrOS folded in (2026-09-23) ────────────────────────────────
     The `books` catalog exactly as PapyrOS built it — its migration 1, with migration
     6's `description` column folded into the CREATE (a fresh table needs no ALTER) and
     the canonical-stamp triggers PapyrOS only reached at its migration 12. Every column
     keeps its name and meaning, so scripts/import-papyros.js copies rows unchanged. */
  {
    id: 8,
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
          description     TEXT,
          mtime           INTEGER,
          added_at        TEXT    DEFAULT (${SQL_NOW}),
          updated_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_books_author  ON books(author);
        CREATE INDEX IF NOT EXISTS idx_books_series  ON books(series);
        CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at);

        DROP TRIGGER IF EXISTS books_stamp_added;
        CREATE TRIGGER books_stamp_added AFTER INSERT ON books
          FOR EACH ROW WHEN NEW.updated_at IS NULL
          BEGIN UPDATE books SET updated_at = COALESCE(${sqlConvert('NEW.added_at')}, ${SQL_NOW}) WHERE id = NEW.id; END;
        DROP TRIGGER IF EXISTS books_touch_updated;
        CREATE TRIGGER books_touch_updated AFTER UPDATE ON books
          FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
          BEGIN UPDATE books SET updated_at = ${SQL_NOW} WHERE id = NEW.id; END;
      `);
    },
  },
  /* `progress`: one row per (user, book), enforced from DAY ONE — the UNIQUE index and
     the upsert-on-conflict trigger PapyrOS only gained at its migration 8, after a race
     had already written duplicates (see RATINGS in migration 4 for the same lesson). */
  {
    id: 9,
    name: 'create_progress',
    up(d) {
      d.exec(PROGRESS.ddl());
      d.exec(`
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
  { id: 10, name: 'create_bookmarks', up(d) { d.exec(BOOKMARKS.ddl()); } },
  /* The audiobook ledger, with the (user_id, started_at) index `history` only gained at
     migration 6 — the activity read windows and orders on it. */
  {
    id: 11,
    name: 'create_book_history',
    up(d) {
      d.exec(BOOK_HISTORY.ddl());
      d.exec('CREATE INDEX IF NOT EXISTS idx_book_history_user_started ON book_history(user_id, started_at)');
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

/* Run migrations NOW, before any route is registered below — src/media.js's router
   prepares its `tracks` SELECT at construction time, so mounting it before the table
   exists would throw SQLITE_ERROR "no such table: tracks" at boot. Matches papyros
   server.js's 3.4 fix (see that file's comment) and apps/beigeboard/backend/src/db.js's
   require-time runMigrations() — the DB is ready before any route or listen() touches it. */
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
   → kouros:write scope; a delegated service token writes per-user). `tracks` is a
   SHARED catalog (no owner column) written only by the scanner/rescan capability, not
   by arbitrary per-user CRUD — this gate still covers every other write route. */
app.use(weaveWriteGate({ scope: 'kouros:write' }));

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/health', healthHandler('kouros'));

/* ── Weave discovery declarations ───────────────────────────────────────────
   What can be DONE to (CAPABILITIES, rescanLibrary) and READ from (DATASETS, `tracks`
   + playlists/history/ratings) KourOS, so the portal, an AI step, and offline tooling
   read the SAME contract the routes below enforce. Public; the resource routes still
   enforce auth (and, for rescanLibrary, the admin-role gate). */
app.get('/api/capabilities', serveCapabilities(CAPABILITIES));
app.get('/api/datasets', serveDatasets(DATASETS));

/* ── Auth: me ──────────────────────────────────────────────────────────── */
app.get('/api/auth/me', (req, res) => res.json({ user: req.user })); // app-private: echoes the verified identity back to this app's own SPA; jkAuth owns the identity contract

/* ── Library (write side: rescan / read side: tracks) ─────────────────────
   Both identity-gated (neither path is in PUBLIC_PATHS above). */
app.use(createLibraryRouter({ scanLibrary: scanEverything }));   // music AND audiobooks
app.use(createTracksRouter({ db }));
app.use(createBrowseRouter({ db }));                       // /api/albums, /api/artists, /api/library/stats
app.use(createDiscoverRouter({ discovery, db }));          // /api/discover/*

/* ── Per-user collections ─────────────────────────────────────────────────
   playlists/ratings each wire their own scoped GET/POST/PATCH/DELETE at /api/<id> in
   one line — filtered (their dataset's declared filters) AND owner-scoped to
   req.user.sub, derived from the CollectionDefs in discovery.js. `history` is the
   same shape but append-only — its CollectionDef declares `only: ['create']`, so
   .mount() below wires GET (list) + POST (create) only; there is no PATCH/DELETE
   route for it at all. */
PLAYLISTS.mount(app, db);
HISTORY.mount(app, db);   // append-only — see discovery.js's HISTORY comment
RATINGS.mount(app, db);
/* D6 / XC-2: GET /api/activity — "what did the user DO here", in the ONE declared
   suite shape. Distinct from HISTORY's list route above, which serves this app's own
   columns to its own frontend; this answers a question asked of four apps at once. */
ACTIVITY.mount(app, db);

/* ── Audiobooks (PapyrOS, folded in) ────────────────────────────────────────
   The catalog read, the per-user progress/bookmarks/ledger, the iTunes META read and
   the two match capabilities — same identity-gated + write-gate-cleared slot as every
   route above. `progress` and `bookmarks` are full CRUD; `book_history` is append-only
   (`only: ['create']`, like `history`). */
app.use(createBooksRouter({ db }));
PROGRESS.mount(app, db);
BOOKMARKS.mount(app, db);
BOOK_HISTORY.mount(app, db);
META.mount(app);
app.use(createMatchRouter({ db, dataDir: BOOKS_DATA_DIR }));

/* ── Media (stream/cover/download) ─────────────────────────────────────────
   The playback backend: range-aware audio streaming, cover art, whole-track download.
   Same identity-gated + write-gate-cleared slot as library/tracks/collections above,
   still before the /api/* 404 catch-all and the SPA fallback. */
app.use(createMediaRouter({ db, musicDir: MUSIC_DIR, dataDir: DATA_DIR }));
/* The book half of the same brick, under /api/books/* so it cannot shadow a track's
   /api/stream|cover|download (src/books/media.js's header), plus GET /api/book/:bookId. */
app.use(createBookMediaRouter({ db, audiobooksDir: AUDIOBOOKS_DIR, dataDir: BOOKS_DATA_DIR }));

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
    console.log(`KourOS running on :${PORT}`);
    // Non-blocking background scan: listen() must not wait on walking (possibly a
    // large) MUSIC_DIR. Not awaited on purpose — .catch keeps a scan failure (missing
    // mount, no ffprobe, …) from becoming an unhandled rejection that could take the
    // process down.
    console.log(`[kouros scan] boot scan starting (${MUSIC_DIR})`);
    scanner.scanLibrary()
      .then((counts) => console.log(`[kouros scan] boot scan complete: ${JSON.stringify(counts)}`))
      .catch((err) => console.error(`[kouros scan] boot scan failed: ${err.message}`))
      // Books AFTER music, not beside it: both walks run ffprobe pools against the
      // same NAS, and the music scan is the one a fresh boot is waiting on.
      .then(() => {
        console.log(`[kouros books] boot scan starting (${AUDIOBOOKS_DIR})`);
        return bookScanner.scanLibrary();
      })
      .then((counts) => console.log(`[kouros books] boot scan complete: ${JSON.stringify(counts)}`))
      .catch((err) => console.error(`[kouros books] boot scan failed: ${err.message}`));
  });
}

boot();

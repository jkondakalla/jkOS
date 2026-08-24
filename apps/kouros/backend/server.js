'use strict';
// KourOS backend — ToDo §3 18.2: the real music backend on the shared bricks (Wave 17).
// Wave 18.1 scaffolded the minimal Layer-A template (a single placeholder `items`
// defineCollection); this replaces it. Follows PapyrOS's proven pattern verbatim:
// `tracks` is a SHARED, scanner-written catalog (`defineLibraryScanner`, unit:'file' —
// one row per track, ToDo §3 17.2) with a hand-rolled migration (not a defineCollection
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
} = require('@jkos/weave/server');
const { resolveIssuer } = require('@jkos/auth-middleware');   // shared issuer default (single source)
const { CAPABILITIES, DATASETS, PLAYLISTS, HISTORY, RATINGS } = require('./discovery');   // discovery docs + the three collections
const { createScanner } = require('./src/library/scan');            // 18.2: MUSIC_DIR walker → `tracks` catalog
const { createLibraryRouter } = require('./src/routes/library');    // 18.2: rescanLibrary route
const { createTracksRouter } = require('./src/routes/tracks');      // 18.2: filtered `tracks` dataset read
const { createMediaRouter } = require('./src/media');               // 18.2: stream/cover/download routes
const { createBrowseRouter } = require('./src/routes/browse');      // server-side album/artist grouping
const { createDiscoverRouter } = require('./src/routes/discover');  // the similarity engine's HTTP surface
const { createDiscovery } = require('./src/discover');              // vectors → aligned space → similar/radio/runs/map

/* ── Env ───────────────────────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 3011;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'kouros.db');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'dist');
const SHELL_URL  = (process.env.SHELL_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Library scanner: the folder the boot scan + rescanLibrary walk. NEVER a hardcoded NAS
   path here — unlike papyros's AUDIOBOOKS_DIR, no docker-compose bind mount exists for
   this yet; the real music library mount is Jag's own deploy-time decision (ToDo §3
   18.2, flagged in the wave's report). The local-dev default (a sibling `music/`
   folder that doesn't need to exist — the scanner degrades to a 0-track no-op when it's
   missing) mirrors papyros's AUDIOBOOKS_DIR default exactly. DATA_DIR mirrors papyros
   too: DB_PATH's own directory, so cover art lands at <DATA_DIR>/covers/<id>.jpg with
   no extra knob. */
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, 'music');
const DATA_DIR  = path.dirname(DB_PATH);

/* The music embedder's index (ToDo §8's music/index.db) — the source of the CLAP
   vectors behind similarity, radio, Runs and the vibe map. OPTIONAL by design: it
   is produced by a separate Python pipeline on a separate schedule, it is read
   strictly read-only, and when it is absent (or has not reached a given track yet)
   every discovery surface degrades to metadata affinity and says so on the wire.
   Defaults to a file beside the database so the deploy only has to place it there. */
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH || path.join(DATA_DIR, 'music-index.db');

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

/* The discovery service. Built lazily on first read (the `tracks` table does not
   exist yet at this point — migrations run below) and rebuilt whenever a scan
   changes the catalog, so a rescan that adds an album is reflected without waiting
   out its TTL. */
const discovery = createDiscovery({ db, vectorDbPath: VECTOR_DB_PATH, libraryRootName: LIBRARY_ROOT_NAME, musicDir: MUSIC_DIR });

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
          added_at    TEXT    DEFAULT (datetime('now')),
          updated_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_artist  ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album   ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks(updated_at);

        DROP TRIGGER IF EXISTS tracks_stamp_added;
        CREATE TRIGGER tracks_stamp_added AFTER INSERT ON tracks
          FOR EACH ROW WHEN NEW.updated_at IS NULL
          BEGIN UPDATE tracks SET updated_at = COALESCE(NEW.added_at, datetime('now')) WHERE id = NEW.id; END;
        DROP TRIGGER IF EXISTS tracks_touch_updated;
        CREATE TRIGGER tracks_touch_updated AFTER UPDATE ON tracks
          FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
          BEGIN UPDATE tracks SET updated_at = datetime('now') WHERE id = NEW.id; END;
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
app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

/* ── Library (write side: rescan / read side: tracks) ─────────────────────
   Both identity-gated (neither path is in PUBLIC_PATHS above). */
app.use(createLibraryRouter({ scanLibrary: scanner.scanLibrary }));
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

/* ── Media (stream/cover/download) ─────────────────────────────────────────
   The playback backend: range-aware audio streaming, cover art, whole-track download.
   Same identity-gated + write-gate-cleared slot as library/tracks/collections above,
   still before the /api/* 404 catch-all and the SPA fallback. */
app.use(createMediaRouter({ db, musicDir: MUSIC_DIR, dataDir: DATA_DIR }));

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
      .catch((err) => console.error(`[kouros scan] boot scan failed: ${err.message}`));
  });
}

boot();

'use strict';
// discovery.js — PapyrOS's Weave discovery declarations.
//
// Wave 1 scaffolded a single placeholder `items` defineCollection. Wave 2 (2.1) replaced
// it with the real shared `books` catalog — a plain migration in server.js, populated by
// the library scanner rather than user CRUD, so there is no defineCollection to derive
// docs from here. 2.3 filled in the write side (rescanLibrary). 2.4 (below) hand-authors
// the `books` DatasetDef — typed filters over the migration's columns, enforced by
// src/routes/books.js via buildItemFilters/filterSpec (single source, P3), same as
// BeigeBoard's items dataset. Kept as pure data + zero side effects — safe for the
// suite-prober, a workshop GUI, or an AI composer to require() with no env/DB/network,
// same contract a defineCollection-derived doc gives.
const { resourceKey } = require('@jkos/suite-manifest');

/** The `books` catalog's invalidation bus key — the scanner (src/library/scan.js)
 *  bumps every book row it touches, so a peer polling `books` refetches on rescan.
 *  Exported so 2.4's DatasetDef declares the SAME key, not a re-typed 'papyros.books'. */
const BOOKS_KEY = resourceKey('papyros', 'books'); // 'papyros.books'

/* ── What can be DONE to PapyrOS (the write contract) ─────────────────────────
   rescanLibrary (2.3) is the one capability so far: walk AUDIOBOOKS_DIR and
   (re)catalog books via src/library/scan.js. Admin-scoped (scopes: ['papyros:admin'] —
   jkAuth mints this for every admin on a reachable app, apps/jkauth/src/db.js
   roleClaims); the route enforces the equivalent req.user.role === 'admin' check (see
   src/routes/library.js) so it still passes under the documented dev-auth fallback
   (weaveAuth's no-key stub carries a role but no scope array — @jkos/weave/server/auth.js),
   the same precedent apps/lazuros/backend/routes/jobs.js uses for its admin gate. */
const CAPABILITIES = {
  app: 'papyros',
  version: 1,
  capabilities: [
    {
      id: 'rescanLibrary', label: 'Rescan audiobook library', method: 'POST', path: '/library/rescan',
      body: [],
      returns: [
        { name: 'scanned',  type: 'number', label: 'Book folders examined' },
        { name: 'upserted', type: 'number', label: 'Books inserted or updated' },
        { name: 'removed',  type: 'number', label: 'Books removed (folder no longer exists)' },
        { name: 'skipped',  type: 'number', label: 'Books skipped (folder unchanged since last scan)' },
      ],
      invalidates: [BOOKS_KEY], scopes: ['papyros:admin'],
      doc: 'Walks AUDIOBOOKS_DIR and (re)catalogs books: probes new/changed folders, extracts covers, removes rows whose folder vanished. A scan already in flight is joined, not duplicated.',
    },
  ],
};

/* ── What can be READ from PapyrOS (the read contract) ─────────────────────────
   The `books` list row is SCALAR METADATA ONLY — no `files`/`chapters` (the JSON
   arrays a multi-file rip's per-track detail lives in) and no filesystem `path`.
   Those stay server-internal until Wave 3's GET /api/book/:id detail route; a peer
   browsing the catalog (ORDECK library widget, a search step) needs title/author/
   series/cover, not a per-track manifest. Declared once here so src/routes/books.js
   derives its SELECT column list from BOOK_SHAPE.map(f => f.name) — the fields this
   doc says a `books` row carries and the columns the route actually queries are
   provably the same set, not two hand-synced lists (the drift class ARCH-1 named). */
const BOOK_SHAPE = [
  { name: 'id',              type: 'number' },
  { name: 'title',           type: 'string' },
  { name: 'subtitle',        type: 'string' },
  { name: 'author',          type: 'string' },
  { name: 'narrator',        type: 'string' },
  { name: 'series',          type: 'string' },
  { name: 'series_seq',      type: 'number' },
  { name: 'year',            type: 'number' },
  { name: 'genres',          type: 'json',   label: 'Genre tags (string[])' },
  { name: 'duration',        type: 'number', label: 'Total duration, seconds' },
  { name: 'cover_path',      type: 'string', label: 'Cover image path relative to DATA_DIR (null if none extracted)' },
  { name: 'metadata_source', type: 'enum',   enum: ['embedded', 'itunes', 'manual'] },
  { name: 'ext_ref',         type: 'string', label: 'External metadata reference (enrichment lookup key)' },
  { name: 'updated_at',      type: 'string', label: 'Last catalog update (delta cursor for `since`)' },
];

const DATASETS = {
  app: 'papyros',
  version: 1,
  datasets: [
    {
      id: 'books', label: 'Audiobook library', path: '/books',
      description: 'The shared audiobook catalog the scanner (rescanLibrary) populates. '
        + 'List rows carry scalar metadata only — per-file/chapter detail is Wave 3\'s GET /api/book/:id.',
      // Each filter carries its OWN enforcement mapping (column/op): src/routes/books.js
      // derives its SQL filter from these via filterSpec() (same pattern as BeigeBoard's
      // items dataset), so what this doc DECLARES the books list can be read by is
      // exactly what the route filters on (no drift).
      filters: [
        { name: 'title',  type: 'string', label: 'Title prefix',                          column: 'title',      op: 'prefix' },
        { name: 'author', type: 'string', label: 'Author prefix',                          column: 'author',     op: 'prefix' },
        { name: 'series', type: 'string', label: 'Series (exact)',                         column: 'series',     op: 'eq' },
        { name: 'since',  type: 'string', label: 'Updated since (updated_at delta cursor)', column: 'updated_at', op: 'gt' },
      ],
      item: BOOK_SHAPE,
      invalidates: [BOOKS_KEY],
    },
  ],
};

module.exports = { CAPABILITIES, DATASETS, BOOKS_KEY, BOOK_SHAPE };

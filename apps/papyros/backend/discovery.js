'use strict';
// discovery.js — PapyrOS's Weave discovery declarations.
//
// Wave 1 scaffolded a single placeholder `items` defineCollection. Wave 2 (2.1) replaced
// it with the real shared `books` catalog — a plain migration in server.js, populated by
// the library scanner rather than user CRUD, so there is no defineCollection to derive
// docs from here. 2.3 filled in the write side (rescanLibrary). 2.4 hand-authors the
// `books` DatasetDef — typed filters over the migration's columns, enforced by
// src/routes/books.js via buildItemFilters/filterSpec (single source, P3), same as
// BeigeBoard's items dataset. Wave 3 (3.1, below) brings `defineCollection` BACK for the
// four per-user tables — progress/bookmarks/clubs/club_members are genuine user CRUD (not
// scanner-populated, not shared), exactly the shape defineCollection was built for — so
// their table, routes, and discovery docs derive from ONE spec each (Layer D / F3), same
// as Wave 1's `items`. Kept as pure data + zero side effects — safe for the suite-prober,
// a workshop GUI, or an AI composer to require() with no env/DB/network.
const { resourceKey } = require('@jkos/suite-manifest');
const { defineCollection } = require('@jkos/weave/collection');   // 3.1: the four collections below

/** The `books` catalog's invalidation bus key — the scanner (src/library/scan.js)
 *  bumps every book row it touches, so a peer polling `books` refetches on rescan.
 *  Exported so 2.4's DatasetDef declares the SAME key, not a re-typed 'papyros.books'. */
const BOOKS_KEY = resourceKey('papyros', 'books'); // 'papyros.books'

/* ── 3.1: the four per-user playback + club collections ──────────────────────────
   All FOUR are owner-scoped (`scoped: true` — also the factory default, spelled out
   here to match the ToDo's contract literally): every row carries a `user_id` column
   set to `req.user.sub` on create, and every GET/PATCH/DELETE is filtered to the
   caller's own rows (see @jkos/weave/collection's `mount()` — `ownerOf(req) =>
   req.user.sub`). That is exactly what per-user playback state needs: my progress,
   my bookmarks, the clubs I'm in — never someone else's, never a cross-user leak. */

/** A listener's position in one book. `book_ref` is a typed STUD (type: 'ref') pointing
 *  at the shared `books` catalog, not a bare string/number, so a GUI/AI composer knows
 *  this field IS "a book" and can snap it to a `books` row. `position`/`duration` are
 *  both in seconds (matches BOOK_SHAPE.duration below). `finished` is the one filterable
 *  field (`filter: 'eq'`) — a "continue listening" or "finished" shelf reads
 *  `GET /api/progress?finished=true|false`, owner-scoped for free.
 *  NOUN OVERRIDE: the id `progress` ends in a lone `s` that ISN'T a plural marker, so the
 *  factory's naive singularizer (strip trailing `s`) would mangle it to `Progres` —
 *  `noun: 'Progress'` sidesteps that (createProgress/updateProgress/deleteProgress). */
const PROGRESS = defineCollection({
  app: 'papyros', id: 'progress', label: 'Reading progress', noun: 'Progress',
  scoped: true,
  fields: [
    { name: 'book_ref',    type: 'ref',     label: 'Book',                    ref: 'papyros.books', required: true },
    { name: 'position',    type: 'number',  label: 'Position (seconds)',      default: 0 },
    { name: 'duration',    type: 'number',  label: 'Duration (seconds)' },
    { name: 'finished',    type: 'boolean', label: 'Finished',                filter: 'eq' },
    { name: 'last_played', type: 'string',  label: 'Last played (ISO timestamp)' },
  ],
});

/** A saved position in a book, distinct from `progress` (the one "where am I now"
 *  cursor) — a listener can drop many named bookmarks per book. Same `book_ref` stud
 *  as `progress`; `position` is required (a bookmark IS a position, there's no useful
 *  default) while `title`/`note` are optional labels. */
const BOOKMARKS = defineCollection({
  app: 'papyros', id: 'bookmarks', label: 'Bookmarks',
  scoped: true,
  fields: [
    { name: 'book_ref', type: 'ref',    label: 'Book',               ref: 'papyros.books', required: true },
    { name: 'position', type: 'number', label: 'Position (seconds)', required: true },
    { name: 'title',    type: 'string', label: 'Title',              max: 200 },
    { name: 'note',     type: 'text',   label: 'Note' },
  ],
});

/** A book club a user runs or belongs to. `current_pick` is another `ref` stud at
 *  `books` (nullable — a club can exist before it has picked anything).
 *
 *  *Heads-up for Wave 8, don't solve now:* `clubs` and `club_members` (below) are BOTH
 *  owner-scoped, same as `progress`/`bookmarks` — but that means every user only ever
 *  sees the clubs/memberships THEY created, never a clubmate's row. Scoped collections
 *  hide rows cross-user, so "who's-caught-up" will need a bespoke membership-gated read
 *  route later (a club member listing everyone's `progress` for the `current_pick`).
 *  Not this task — just flagging the shape for whoever builds that route. */
const CLUBS = defineCollection({
  app: 'papyros', id: 'clubs', label: 'Book clubs',
  scoped: true,
  fields: [
    { name: 'name',         type: 'string', label: 'Name',         required: true, max: 200 },
    { name: 'description',  type: 'text',   label: 'Description' },
    { name: 'current_pick', type: 'ref',    label: 'Current pick', ref: 'papyros.books' },
  ],
});

/** Club membership — a join row between a club and a jkAuth identity (`member_sub`).
 *  `club_ref` is a `ref` stud at `papyros.clubs` (this app's own club collection above).
 *  `member_sub` stays a plain string: jkAuth doesn't publish a `users` weave dataset to
 *  target with `ref`, so there's no dataset id to point at (unlike `book_ref`/`club_ref`).
 *
 *  Same Wave-8 heads-up as `clubs` above: this table is owner-scoped too, so a member
 *  can only ever see the membership row THEY created — not a full member roster. That
 *  bespoke membership-gated route is deferred, not built here. */
const CLUB_MEMBERS = defineCollection({
  app: 'papyros', id: 'club_members', label: 'Club members',
  scoped: true,
  fields: [
    { name: 'club_ref',   type: 'ref',    label: 'Club',               ref: 'papyros.clubs', required: true },
    { name: 'member_sub', type: 'string', label: 'Member (jkAuth sub)', required: true },
  ],
});

/* ── What can be DONE to PapyrOS (the write contract) ─────────────────────────
   rescanLibrary (2.3) walks AUDIOBOOKS_DIR and (re)catalogs books via
   src/library/scan.js. Admin-scoped (scopes: ['papyros:admin'] — jkAuth mints this for
   every admin on a reachable app, apps/jkauth/src/db.js roleClaims); the route enforces
   the equivalent req.user.role === 'admin' check (see src/routes/library.js) so it still
   passes under the documented dev-auth fallback (weaveAuth's no-key stub carries a role
   but no scope array — @jkos/weave/server/auth.js), the same precedent
   apps/lazuros/backend/routes/jobs.js uses for its admin gate.
   3.1 appends the four collections' create/update/delete capabilities (DERIVED from the
   CollectionDefs above, not hand-typed) so the write contract stays one source. */
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
    ...PROGRESS.capabilities,
    ...BOOKMARKS.capabilities,
    ...CLUBS.capabilities,
    ...CLUB_MEMBERS.capabilities,
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

/* The `books` DatasetDef, kept as its own object (rather than inline in DATASETS.datasets
   below) so it reads the same whether it's the only dataset or, as of 3.1, one of five. */
const BOOKS_DATASET = {
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
};

/* 3.1 appends the four collections' DatasetDefs (DERIVED — filters/item shape come
   straight off the CollectionDefs above) so a peer (ORDECK's Wave-8 widget, a search
   step) can discover `progress`/`bookmarks`/`clubs`/`club_members` the same way it
   discovers `books` — one served contract, no hand-typed second copy. */
const DATASETS = {
  app: 'papyros',
  version: 1,
  datasets: [BOOKS_DATASET, PROGRESS.dataset, BOOKMARKS.dataset, CLUBS.dataset, CLUB_MEMBERS.dataset],
};

module.exports = {
  CAPABILITIES, DATASETS, BOOKS_KEY, BOOK_SHAPE,
  PROGRESS, BOOKMARKS, CLUBS, CLUB_MEMBERS,   // 3.1: server.js .mount()s each of these
};

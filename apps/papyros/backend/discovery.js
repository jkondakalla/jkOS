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
// as Wave 1's `items`. Wave 4 (4.1, below) brings `defineConnector` in for META — the
// suite's FIRST production connector, wrapping the free/keyless iTunes Search API as a
// suite peer (Layer D / F2+G2) so a book's metadata can be enriched from a search step,
// same lego property as a native app's dataset. Kept as pure data + zero side effects —
// safe for the suite-prober, a workshop GUI, or an AI composer to require() with no
// env/DB/network: `defineConnector` only builds the clean dataset doc + a mount CLOSURE
// here — it doesn't read auth.env or touch fetch until server.js calls `META.mount(app)`.
const { resourceKey } = require('@jkos/suite-manifest');
const { defineCollection } = require('@jkos/weave/collection');   // 3.1: the four collections below
const { defineConnector } = require('@jkos/weave/connector');     // 4.1: META, the iTunes metadata connector below

/** The `books` catalog's invalidation bus key — the scanner (src/library/scan.js)
 *  bumps every book row it touches, so a peer polling `books` refetches on rescan.
 *  Exported so 2.4's DatasetDef declares the SAME key, not a re-typed 'papyros.books'. */
const BOOKS_KEY = resourceKey('papyros', 'books'); // 'papyros.books'

/* ── 3.1: the four per-user playback + club collections ──────────────────────────
   All FOUR are owner-scoped (`scoped: true` — also the factory default, spelled out
   here to match the the reset's contract literally): every row carries a `user_id` column
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
 *  `noun: 'Progress'` sidesteps that (createProgress/updateProgress/deleteProgress).
 *
 *  DOCUMENTED, NOT FIXED (17.5): every `type: 'ref'` field (this one, BOOKMARKS.book_ref,
 *  CLUBS.current_pick, CLUB_MEMBERS.club_ref below) gets a TEXT-affinity column —
 *  packages/weave/src/server/collection.js's `sqlType()` only special-cases number/
 *  boolean, and `coerceRef()` stores a numeric ref as its canonical string ("12", not
 *  "12.0"). `books.id` (server.js migration 1) is INTEGER PRIMARY KEY. So
 *  `progress.book_ref` is stored as `'12'` against `books.id` `12` — SQLite's type
 *  affinity makes an `=` comparison between them work by coincidence (TEXT '12' does
 *  NOT numeric-compare equal to INTEGER 12 in a raw join predicate; every actual read
 *  path here goes through the app layer instead — src/routes/books.js's SELECT, this
 *  collection's owner-scoped list, and the frontend's `row.book_ref === bookId`
 *  strict-equal-after-Number()-coercion in usePlayerEngine.ts/writes.ts — never a raw
 *  SQL `JOIN progress ON progress.book_ref = books.id`). A real SQL JOIN between them
 *  needs `CAST(progress.book_ref AS INTEGER) = books.id` (or `= CAST(books.id AS TEXT)`)
 *  — there is no such join in this codebase today, but the Wave-8 club "who's caught
 *  up" route (heads-up below, at CLUBS) is the first candidate that would need one.
 *  Not fixed here: rebuilding `progress`/`bookmarks`/`clubs`/`club_members` onto an
 *  INTEGER-affinity ref column means changing `sqlType()` (collection.js, out of scope
 *  for this task — sibling agents are mid-edit on packages/weave/src/server/) for
 *  EVERY collection in the suite, not just this one; a targeted rebuild of just these
 *  four tables would still desync from collection.js's own `ddl()` output for every
 *  future collection. Cheaper and safer to name the CAST requirement here than to
 *  risk a half-migrated ref-column convention. */
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

/* ── 17.4: `history` — append-only play events ────────────────────────────────────
   There is no event log today and nothing computes stats — every "recently played",
   "most played", or recommendation feature later assumes events have been recorded
   ALL ALONG. Cheap to add now, impossible to backfill retroactively, so this starts
   recording immediately even though nothing reads it back yet.

   One row per LISTENING SESSION (not per timeupdate tick — the frontend, src/api.ts/
   usePlayerEngine.ts, debounces to exactly one POST per session-end: pause, book/
   track change, or page unload/visibilitychange). `item_ref` is a typed `ref` stud
   at the shared `books` catalog — same TEXT-affinity convention as PROGRESS.book_ref
   above (see that field's long NOTE for the ref/INTEGER-affinity join caveat;
   unchanged and unfixed here for the same reason). `started_at` is the ISO
   timestamp the session began; `ms_played` is milliseconds ACTUALLY played
   (accumulated play time, not wall-clock session length — paused/backgrounded time
   doesn't count); `completed` is true when that session's playback reached the
   track's end.

   APPEND-ONLY, enforced server-side, not just by frontend convention: `only:
   ['create']` (packages/weave/src/server/collection.js, added for this task) means
   defineCollection emits ONLY the createHistory capability and mounts ONLY GET
   (list) + POST (create) — there is no updateHistory/deleteHistory capability and no
   PATCH/DELETE route AT ALL (not merely auth-denied — the route literally isn't
   wired, so a PATCH/DELETE falls through to server.js's /api/* 404 catch-all). A
   past play event can never be edited or removed by anyone, including the user who
   created it — the one property every downstream stat needs to be trustworthy. */
const HISTORY = defineCollection({
  app: 'papyros', id: 'history', label: 'Play history',
  scoped: true, only: ['create'],
  fields: [
    { name: 'item_ref',   type: 'ref',     label: 'Book',                          ref: 'papyros.books', required: true },
    { name: 'started_at', type: 'string',  label: 'Session start (ISO timestamp)', required: true },
    { name: 'ms_played',  type: 'number',  label: 'Milliseconds played',           default: 0 },
    { name: 'completed',  type: 'boolean', label: 'Completed' },
  ],
});

/* ── 4.1: META — the iTunes metadata connector (the suite's first) ────────────────
   PapyrOS's `books` rows can carry only what the scanner extracted from the file's own
   tags (embedded metadata, `metadata_source: 'embedded'`); a folder with sparse/missing
   tags has nothing better to fall back on. iTunes Search is the ONE sanctioned external
   call in this app — free, no key — so `defineConnector` wraps it as a suite peer: a
   `metadataSearch` read that proxies `GET /search?media=audiobook&entity=audiobook` and
   maps the JSON response straight to the SAME typed-row shape a native app's dataset
   would serve (the lego property — a GUI/AI composer can't tell META apart from a
   defineCollection dataset). `term` is the only filter and passes straight through to
   the upstream query untouched (no upstream :param substitution needed), so this is
   pure-data spec + factory — @jkos/weave stays untouched by this task. auth:{kind:'none'}
   because the endpoint takes no key; `map` reads each mapped field off the upstream
   result row by its iTunes JSON key (collectionId/collectionName/artistName/
   artworkUrl100/description/releaseDate/primaryGenreName), `item` is this app's own
   typed contract for what a metadata candidate row looks like on the wire — future
   waves can wire this into rescanLibrary's enrichment ladder (`metadata_source:
   'itunes'`) without discovery.js or server.js changing again. */
const META = defineConnector({
  app: 'papyros', id: 'meta', label: 'Audiobook metadata',
  base: 'https://itunes.apple.com', auth: { kind: 'none' },   // free, no key
  reads: [{ id: 'metadataSearch', label: 'Metadata candidates',
    upstream: { path: '/search', query: { media: 'audiobook', entity: 'audiobook', limit: '5' } },
    collection: 'results',
    map: { id: 'collectionId', title: 'collectionName', author: 'artistName',
           cover: 'artworkUrl100', description: 'description', year: 'releaseDate',
           genre: 'primaryGenreName' },
    item: [
      { name: 'id',          type: 'number', label: 'iTunes collection id' },
      { name: 'title',       type: 'string', label: 'Title' },
      { name: 'author',      type: 'string', label: 'Author (artist)' },
      { name: 'cover',       type: 'string', label: 'Cover artwork URL' },
      { name: 'description', type: 'string', label: 'Description' },
      { name: 'year',        type: 'string', label: 'Release date (ISO timestamp)' },
      { name: 'genre',       type: 'string', label: 'Genre' },
    ],
    filters: [{ name: 'term', type: 'string', label: 'Search term', column: 'term', op: 'eq' }] }],
});

/* 4.2 closes the loop META opened: `matchBook` (below, in CAPABILITIES) takes ONE
   candidate row shaped exactly like META's `metadataSearch` item above (the caller
   picked it from that same read) plus a bookId, and writes it onto the `books` row —
   author/description/year/genres + metadata_source:'itunes' + ext_ref:'itunes:<id>',
   and best-effort upsizes+downloads the cover art. See src/routes/match.js for the
   write set and artwork-failure semantics (long comment there, not repeated here). */

/* 4.3 adds `matchAllMissing` (below, in CAPABILITIES) — an admin sweep over EVERY book
   still `metadata_source:'embedded'` with a missing author, cover, OR description
   (description joined the trigger set 2026-07-09 — embedded rips carry author+cover
   but never a synopsis, so the original trigger was a no-op on a healthy library).
   Manual-first is suite philosophy (AI-assist via LazurOS is parked, git history): the
   sweep only WRITES (via the same applyCandidate() matchBook uses) when a candidate's
   title AND author both match the book's exactly after conservative normalization
   (case-fold + trim + collapse whitespace + stripping iTunes' trailing
   "(Unabridged)" — nothing fuzzier); everything else — including every book
   missing an author, since there's then no author to match against — comes back as a
   review list for a human to pick from (the existing metadataSearch + matchBook flow).
   See src/routes/match.js for the exact-match gate, the batch cap/throttle, and the
   per-book upstream-failure handling (long comments there, not repeated here). */

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
    {
      // 4.2: matchBook — a REGULAR-USER capability (unlike rescanLibrary above): the
      // Wave-5 "Fix metadata" flow lets any listener pick a candidate off
      // GET /api/metadataSearch and apply it to a book they're looking at, so this
      // carries no admin scopes/role gate of its own — weaveWriteGate (server.js)
      // already requires `papyros:write` for any POST from a service caller, same as
      // every other write route in this app.
      id: 'matchBook', label: 'Match book metadata (iTunes)', method: 'POST', path: '/match',
      body: [
        { name: 'bookId', type: 'ref', label: 'Book', ref: 'papyros.books', required: true },
        // `candidate` is one whole row off META's `metadataSearch` dataset (id/title/
        // author/cover/description/year/genre) — the caller round-trips exactly what
        // that read served, not a re-typed subset, so `type: 'json'` (the documented
        // escape hatch, weave/capability.ts) is the honest shape here rather than
        // flattening it into six top-level body fields a form would have to re-derive.
        { name: 'candidate', type: 'json', label: 'Chosen metadataSearch candidate row', required: true },
      ],
      returns: [
        { name: 'updated', type: 'boolean', label: 'Metadata written to the book row' },
        { name: 'cover', type: 'enum', enum: ['updated', 'failed'], label: 'Artwork download outcome' },
      ],
      invalidates: [BOOKS_KEY], scopes: ['papyros:write'],
      doc: 'Applies a chosen iTunes metadata candidate to a book: writes author/description/'
        + 'year/genres (merged) + metadata_source:\'itunes\' + ext_ref:\'itunes:<candidate.id>\', '
        + 'and best-effort downloads a 600x600 cover to /data/covers/<id>.jpg (upsized from the '
        + 'candidate\'s 100x100 artworkUrl100). Title and series are left untouched — the scanner/'
        + 'user title wins, and iTunes audiobook candidates carry no series field. A failed artwork '
        + 'download does not fail the match: metadata still writes, cover_path is left unchanged, '
        + 'and the response reports cover:\'failed\'.',
    },
    {
      // 4.3: matchAllMissing — an ADMIN capability (unlike matchBook above): it writes
      // to books other than the one the caller is looking at, so it carries the same
      // admin gate as rescanLibrary (scopes:['papyros:admin'] + the equivalent
      // req.user.role === 'admin' route check — src/routes/match.js, mirroring
      // src/routes/library.js's precedent).
      id: 'matchAllMissing', label: 'Match all missing metadata (iTunes, admin sweep)', method: 'POST', path: '/match/all',
      body: [],
      returns: [
        { name: 'examined', type: 'number', label: 'Books examined this run (bounded by the per-run cap)' },
        {
          name: 'applied', type: 'json',
          label: 'Books auto-applied via an exact title+author match: [{bookId, title, extRef}]',
        },
        {
          name: 'review', type: 'json',
          label: 'Books needing manual review: [{bookId, title, candidates, error?}] — '
            + 'candidates is metadataSearch\'s typed item shape (possibly empty); error:true marks '
            + 'a book whose iTunes search itself failed (network/upstream error), not a failed match.',
        },
        { name: 'truncated', type: 'boolean', label: 'True when more candidate books remain beyond this run\'s cap' },
      ],
      invalidates: [BOOKS_KEY], scopes: ['papyros:admin'],
      doc: 'Sweeps every book still metadata_source:\'embedded\' with a missing author or missing '
        + 'cover. For each, searches iTunes (title, plus author when the book has one) and '
        + 'CONSERVATIVELY auto-applies (same write as matchBook) only when a candidate\'s title AND '
        + 'author both match the book\'s exactly, after case-fold + trim + collapse-whitespace '
        + 'normalization — nothing fuzzier, by design (manual-first is suite philosophy; AI-assist '
        + 'via LazurOS is parked). A book with no author can never auto-apply (nothing to match '
        + 'against) and always lands in review, even when candidates were found. Every other book — '
        + 'no exact match, or the search itself failed — comes back in `review` for a human to pick '
        + 'from via the existing metadataSearch + matchBook flow. Sequential, ~250ms between books '
        + '(polite to the free/keyless upstream) and capped at 50 books per run (`truncated` flags '
        + 'more); one book\'s search failure does not abort the run.',
    },
    ...PROGRESS.capabilities,
    ...BOOKMARKS.capabilities,
    ...CLUBS.capabilities,
    ...CLUB_MEMBERS.capabilities,
    ...HISTORY.capabilities,   // 17.4: createHistory only — see HISTORY's comment above
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
// NOTE (4.2): the `books` table also carries a `description` TEXT column (migration 6,
// server.js) — added for matchBook to write iTunes' description onto. It's deliberately
// NOT in BOOK_SHAPE: list rows stay lean for the browse grid (a blurb is detail-only
// weight), so it's exposed solely by GET /api/book/:id (src/media.js), same asymmetry
// as `files`/`chapters` above this comment's header already establishes.
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
  //
  // `genre` (task: genre chips on the library card + filter-by-genre) reuses the
  // `tags` op already in @jkos/weave/server/filters.js's vocabulary (BeigeBoard's
  // `items.tags` filter is the precedent) rather than a naive `eq` on `genres`:
  // `genres` is a JSON-array TEXT column ('["Fantasy","Adventure"]'), and `eq` would
  // compare the WHOLE serialized array to one genre string and never match. `tags`
  // instead binds one `genres LIKE '%"<value>"%' ESCAPE '\'` clause per CSV entry (LIKE
  // metachars escaped, embedded quotes stripped — see filters.js) — exact JSON-array
  // MEMBERSHIP, not a substring/prefix match, so "Fantasy" doesn't also match a
  // "Fantasy Romance" tag. A chip click sends one bare value (no comma), so this is
  // effectively exact-membership in practice. buildItemFilters (routes/books.js,
  // UNCHANGED) already handles `op:'tags'` generically, so declaring it here is the
  // WHOLE enforcement — declared==enforced holds through the existing seam, no
  // packages/weave change needed.
  filters: [
    { name: 'title',  type: 'string', label: 'Title prefix',                          column: 'title',      op: 'prefix' },
    { name: 'author', type: 'string', label: 'Author prefix',                          column: 'author',     op: 'prefix' },
    { name: 'series', type: 'string', label: 'Series (exact)',                         column: 'series',     op: 'eq' },
    { name: 'genre',  type: 'string', label: 'Genre (exact tag match)',                column: 'genres',     op: 'tags' },
    { name: 'since',  type: 'string', label: 'Updated since (updated_at delta cursor)', column: 'updated_at', op: 'gt' },
  ],
  item: BOOK_SHAPE,
  invalidates: [BOOKS_KEY],
};

/* 3.1 appends the four collections' DatasetDefs (DERIVED — filters/item shape come
   straight off the CollectionDefs above) so a peer (ORDECK's Wave-8 widget, a search
   step) can discover `progress`/`bookmarks`/`clubs`/`club_members` the same way it
   discovers `books` — one served contract, no hand-typed second copy. 4.1 appends
   META.datasets (just `metadataSearch` today) the same way — `defineConnector` already
   strips the upstream/map plumbing, so it's exactly as clean as a defineCollection
   dataset by the time it lands here. */
const DATASETS = {
  app: 'papyros',
  version: 1,
  datasets: [
    BOOKS_DATASET, PROGRESS.dataset, BOOKMARKS.dataset, CLUBS.dataset, CLUB_MEMBERS.dataset,
    HISTORY.dataset,   // 17.4: readable (list, owner-scoped) even though it's create-only to write
    ...META.datasets,
  ],
};

module.exports = {
  CAPABILITIES, DATASETS, BOOKS_KEY, BOOK_SHAPE,
  PROGRESS, BOOKMARKS, CLUBS, CLUB_MEMBERS,   // 3.1: server.js .mount()s each of these
  HISTORY,                                     // 17.4: server.js .mount()s this too (append-only)
  META,                                        // 4.1: server.js .mount()s this too (reads only, no CollectionDef .ddl())
};

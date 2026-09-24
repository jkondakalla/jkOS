'use strict';
// discovery.js — KourOS's Weave discovery declarations (git history: item 18.2 — real backend on
// the shared bricks, replacing 18.1's scaffolded placeholder `items` collection).
//
// Follows PapyrOS's proven split (git history: Wave 17): `tracks` is a SHARED,
// scanner-written catalog — populated by `defineLibraryScanner` (src/library/scan.js),
// not user CRUD, no `user_id` — so it's a hand-rolled migration + hand-authored dataset
// (server.js migration 1 + TRACKS_DATASET below), the same shape as papyros's `books`.
// `playlists` / `history` / `ratings` are genuine per-user CRUD, so each is ONE
// `defineCollection` (Layer D / F3) — table DDL, CRUD routes, and the served
// capability/dataset docs all derive from the same spec, exactly like papyros's
// progress/bookmarks/clubs/club_members/history. Kept as pure data + zero side
// effects — safe for the suite-prober, a workshop GUI, or an AI composer to require()
// with no env/DB/network.
const { resourceKey } = require('@jkos/suite-manifest');
const { defineCollection } = require('@jkos/weave/collection');
const { defineActivity, canonicalTime, extRef, checkExtRefDoc, extRefFieldDoc } = require('@jkos/weave/activity'); // D6/D7: the activity contract + ext_ref schemes (lean subpath — this file is imported as DATA by the prober)
const { defineConnector } = require('@jkos/weave/connector');   // META, the iTunes audiobook metadata connector below

/** The `tracks` catalog's invalidation bus key — the scanner (src/library/scan.js)
 *  bumps every track row it touches, so a peer polling `tracks` refetches on rescan. */
const TRACKS_KEY = resourceKey('kouros', 'tracks'); // 'kouros.tracks'

/* ── Audiobooks — PapyrOS, folded in (2026-09-23) ──────────────────────────────────
   Jag: "PapyrOS should be folded inside of KourOS entirely. The split was arbitrary."
   Everything below the `books` key was PapyrOS's own declaration, carried over with
   its app id changed and nothing else: the shared `books` catalog (hand-rolled
   migration + scanner, books/scan.js), the per-user `progress` and `bookmarks`
   collections, the listening ledger, the iTunes META connector and the two match
   capabilities. PapyrOS's `clubs`/`club_members` did NOT come over — no frontend ever
   read or wrote them, and the rows stay in papyros.db, which nothing deletes. */

/** The `books` catalog's invalidation bus key — the book scanner bumps every row it
 *  touches, so a peer polling `books` refetches on rescan. */
const BOOKS_KEY = resourceKey('kouros', 'books'); // 'kouros.books'

/* ── D7 / BB-5: the EXT_REF SCHEMES this app writes ───────────────────────────────
   `itunes:` is written by books/match.js onto `books.ext_ref`. ⚠️ THE SCHEME IS THE
   PROVIDER, NOT THE CONNECTOR: the connector is `meta`, the id is iTunes'. See
   packages/weave/src/shared/extref.js for the three classes and why. */
const EXT_REFS = {
  app: 'kouros',
  version: 1,
  schemes: [
    {
      id: 'itunes', class: 'external', label: 'An iTunes Search catalog id (the audiobook metadata enrichment key)',
      shape: 'itunes:<trackId>',
    },
  ],
};
const extRefsErr = checkExtRefDoc(EXT_REFS);
if (extRefsErr) throw new Error(`kouros ext_ref schemes: ${extRefsErr}`);

/** A listener's long-term position in one book — the audiobook's resume point, which
 *  outlives the listening session (a session holds whatever is playing NOW; this holds
 *  where every book was left). `finished` is filterable so a "continue listening" shelf
 *  reads `GET /api/progress?finished=false`. `noun: 'Progress'`: the factory's
 *  singularizer would otherwise strip the trailing `s` into `Progres`.
 *
 *  ⚠️ `book_ref` is TEXT-affinity (a weave `ref` column stores `'12'`, not `12`), so a
 *  raw SQL join needs `CAST(book_ref AS INTEGER)` and a client comparing it to a
 *  number must coerce at ONE door — PapyrOS lost four features to that for months
 *  (TRAPS.md § SQLite). UNIQUE(user_id, book_ref) + an upsert trigger ship with the
 *  table (server.js), from day one. */
const PROGRESS = defineCollection({
  app: 'kouros', id: 'progress', label: 'Audiobook progress', noun: 'Progress',
  scoped: true,
  fields: [
    { name: 'book_ref',    type: 'ref',     label: 'Book',                    ref: 'kouros.books', required: true },
    { name: 'position',    type: 'number',  label: 'Position (seconds)',      default: 0 },
    { name: 'duration',    type: 'number',  label: 'Duration (seconds)' },
    { name: 'finished',    type: 'boolean', label: 'Finished',                filter: 'eq' },
    { name: 'last_played', type: 'string',  label: 'Last played (ISO timestamp)' },
  ],
});

/** A named position in a book. Same TEXT-affinity `book_ref` caveat as PROGRESS. */
const BOOKMARKS = defineCollection({
  app: 'kouros', id: 'bookmarks', label: 'Bookmarks',
  scoped: true,
  fields: [
    { name: 'book_ref', type: 'ref',    label: 'Book',               ref: 'kouros.books', required: true },
    { name: 'position', type: 'number', label: 'Position (seconds)', required: true },
    { name: 'title',    type: 'string', label: 'Title',              max: 200 },
    { name: 'note',     type: 'text',   label: 'Note' },
  ],
});

/* ── playlists / history / ratings — genuine per-user CRUD ────────────────────────── */

/** A user-curated ordered list of tracks. `track_refs` is a `list: true` field — the
 *  SAME JSON-array-TEXT weave interop shape the scaffold's placeholder `items.tags`
 *  field already used (packages/weave/src/server/columns.js's `coerceWeaveColumn`
 *  JSON.stringifies an array as-is on write; `collection.js`'s `toRow()` JSON.parses it
 *  back on read) — the simplest reorderable shape: 18.6's drag-reorder is "PATCH the
 *  whole array back in its new order", no join table, no per-row position column to
 *  keep in sync. A `playlist_tracks(playlist_id, track_id, position)` join table would
 *  need its own defineCollection or hand-rolled routes just to reorder — not worth it
 *  for what this needs. Declared `type: 'string'` (matching the `tags` precedent) even
 *  though the array holds numeric track ids; `list: true` is what actually drives the
 *  storage/coercion, `type` here is cosmetic for the GUI/AI stud. */
const PLAYLISTS = defineCollection({
  app: 'kouros', id: 'playlists', label: 'Playlists',
  scoped: true,
  fields: [
    { name: 'name',        type: 'string', label: 'Name', required: true, max: 200 },
    { name: 'description', type: 'text',   label: 'Description' },
    { name: 'track_refs',  type: 'string', label: 'Track ids, in order (JSON array)', list: true },
  ],
});

/* ── history — append-only play events, same `only` knob as papyros's 17.4 ────────
   One row per LISTENING STRETCH (not per timeupdate tick). `item_ref` is a typed `ref`
   stud at the shared `tracks` catalog — same soft TEXT-affinity convention as papyros's
   PROGRESS.book_ref (see that file's long NOTE; unchanged here for the same reason: no
   SQL JOIN in this codebase needs INTEGER affinity, every real read goes through the
   app layer). `only: ['create']` means defineCollection emits ONLY createHistory and
   mounts ONLY GET (list) + POST (create) — there is no updateHistory/deleteHistory
   capability and no PATCH/DELETE route AT ALL (not auth-denied — not wired; falls
   through to server.js's /api/* 404 catch-all). */
const HISTORY = defineCollection({
  app: 'kouros', id: 'history', label: 'Play history',
  scoped: true, only: ['create'],
  fields: [
    { name: 'item_ref',   type: 'ref',     label: 'Track',                          ref: 'kouros.tracks', required: true },
    /* `wire: true` (XC-1): client-stamped, but it is the column the activity read
       WINDOWS and ORDERS on, so it must be canonical. Declared a plain string, any
       text could be stored — and a space-separated stamp sorts BEFORE an ISO cursor
       of an EARLIER instant, so the row silently vanished from the merged feed. */
    { name: 'started_at', type: 'string',  label: 'Session start (ISO timestamp)', required: true, wire: true },
    { name: 'ms_played',  type: 'number',  label: 'Milliseconds played',           default: 0 },
    { name: 'completed',  type: 'boolean', label: 'Completed' },
  ],
});

/** The audiobook listening ledger — `history`'s twin, one row per listening stretch of a
 *  BOOK. ⚠️ A SEPARATE TABLE ON PURPOSE, not a `kind` column on `history`: a `ref` field
 *  names ONE target (`kouros.tracks` there, `kouros.books` here), and a ref that could
 *  point at either table is a declaration that lies to every reader — `check:refs` and
 *  every GUI/AI composer snap a ref to the table it names. The activity read below
 *  answers for both ledgers in one list. Carried over from PapyrOS's `history` field for
 *  field, so the importer (scripts/import-papyros.js) copies rows across unchanged. */
const BOOK_HISTORY = defineCollection({
  app: 'kouros', id: 'book_history', label: 'Audiobook listening history',
  scoped: true, only: ['create'],
  fields: [
    { name: 'item_ref',   type: 'ref',     label: 'Book',                          ref: 'kouros.books', required: true },
    { name: 'started_at', type: 'string',  label: 'Session start (ISO timestamp)', required: true, wire: true },
    { name: 'ms_played',  type: 'number',  label: 'Milliseconds played',           default: 0 },
    { name: 'completed',  type: 'boolean', label: 'Completed' },
  ],
});

/** A listener's rating for a track. UNIQUE(user_id, track_ref) + an upsert-on-conflict
 *  BEFORE INSERT trigger are added in server.js's migration ALONGSIDE the base ddl() —
 *  from DAY ONE, not retrofitted. The papyros 17.5 lesson: `progress` shipped without a
 *  server-side UNIQUE(user_id, book_ref) for several waves, one-row-per-user-per-book
 *  was a CLIENT convention only, and a race between two POSTs (e.g. two tabs' first
 *  action on the same row) could create duplicates — the fix needed a dedupe-then-ALTER
 *  migration (papyros migration 8) specifically BECAUSE live rows already existed and
 *  might already violate the constraint (a migration that dies on existing rows is a
 *  boot-loop trap). `ratings` never ships without the constraint, so there is nothing
 *  to dedupe and no reason to defer it — see server.js's `ratings_upsert_on_conflict`
 *  trigger for the actual DDL. */
const RATINGS = defineCollection({
  app: 'kouros', id: 'ratings', label: 'Ratings',
  scoped: true,
  fields: [
    { name: 'track_ref', type: 'ref',    label: 'Track',  ref: 'kouros.tracks', required: true },
    { name: 'rating',    type: 'number', label: 'Rating', required: true },
  ],
});

/* ── D6 / XC-2: the ACTIVITY contract ─────────────────────────────────────────────
   ⚠️ KourOS's `history` and PapyrOS's `history` were FIELD-FOR-FIELD IDENTICAL, and
   were invented independently. Read that as the finding rather than as an
   embarrassment: neither author was careless, the suite simply had no word for "this
   app keeps a record of what the user did", so each one had to coin a private one.
   (Since the fold, PapyrOS's ledger lives here as `book_history`.)

   ⚠️ The remedy is a DECLARED SHAPE, NOT A SHARED TABLE, and the difference is the
   whole point. KourOS keeps its own ledgers, indexes them how it likes, and stays
   free to purge a user's rows without coordinating a migration with other apps.
   What is common is the ANSWER — so ORDECK can ask every app "what did I do today"
   and merge, and so the suite has one action-audit trail instead of private ones.

   The JOINs carry the CAST caveat: `item_ref` is TEXT-affinity (see HISTORY above),
   so `= tracks.id` would compare TEXT '12' to INTEGER 12 and match nothing —
   silently labelling every event null rather than erroring. */
const ACTIVITY = defineActivity({
  app: 'kouros',
  kinds: [
    { id: 'listen', label: 'Listened', verb: 'listened to' },
    // Audiobooks since the PapyrOS fold. A separate KIND rather than more `listen`
    // rows, because a reader merging the suite's feed renders "listened to Dune" and
    // "listened to a track" differently, and the kind is the only thing it can key on.
    { id: 'book', label: 'Listened to a book', verb: 'listened to' },
  ],
  read(db, userId, { since, until, limit }) {
    /* ONE list over TWO ledgers (see BOOK_HISTORY for why they are two). Each arm
       windows on its own `started_at` and the UNION is ordered and limited once, so
       `limit` bounds the merged answer, not each half. */
    const arm = (alias) => {
      const where = [`${alias}.user_id = ?`];
      const params = [userId];
      if (since) { where.push(`${alias}.started_at > ?`); params.push(since); }
      if (until) { where.push(`${alias}.started_at < ?`); params.push(until); }
      return { where: where.join(' AND '), params };
    };
    const t = arm('h');
    const b = arm('bh');
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT 'listen' AS kind, h.id, h.item_ref, h.started_at, h.ms_played, h.completed, h.created_at,
                  tr.title AS item_title, tr.artist AS item_byline
             FROM history h
             LEFT JOIN tracks tr ON tr.id = CAST(h.item_ref AS INTEGER)
            WHERE ${t.where}
           UNION ALL
           SELECT 'book' AS kind, bh.id, bh.item_ref, bh.started_at, bh.ms_played, bh.completed, bh.created_at,
                  bk.title AS item_title, bk.author AS item_byline
             FROM book_history bh
             LEFT JOIN books bk ON bk.id = CAST(bh.item_ref AS INTEGER)
            WHERE ${b.where}
         )
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(...t.params, ...b.params, limit);
    return rows.map((r) => ({
      id: r.kind === 'book' ? `book_history:${r.id}` : `history:${r.id}`,
      kind: r.kind,
      // Normalised, not trusted: `started_at` is stamped by the player in the
      // browser, and `at` is the cross-app merge key compared as a STRING. Falls
      // back to the server's own `created_at` when the client sent junk.
      at: canonicalTime(r.started_at) || canonicalTime(r.created_at),
      // A track keeps the `kouros:<id>` it always had; a book is `kouros:book:<id>`.
      // An ext_ref's local id is the owning app's to shape (extref.js splits on the
      // FIRST ':'), and a bare number would name track 12 and book 12 identically.
      ref: r.kind === 'book' ? extRef('kouros', `book:${r.item_ref}`) : extRef('kouros', r.item_ref),
      label: r.item_title
        ? (r.item_byline ? `${r.item_title} — ${r.item_byline}` : r.item_title)
        : null,
      ms: r.ms_played ?? null,
      completed: r.completed == null ? null : !!r.completed,
    }));
  },
});

/* ── META — the iTunes audiobook metadata connector (PapyrOS 4.1, folded in) ────────
   A book folder with sparse tags has nothing better than its folder name; iTunes Search
   is the ONE sanctioned external call (free, no key). `defineConnector` makes it a typed
   read — `GET /api/metadataSearch?term=` — that serves candidate rows in this app's own
   shape, and `matchBook` below writes a chosen one onto a book. */
const META = defineConnector({
  app: 'kouros', id: 'meta', label: 'Audiobook metadata',
  base: 'https://itunes.apple.com', auth: { kind: 'none' },   // free, no key
  reads: [{ id: 'metadataSearch', label: 'Audiobook metadata candidates',
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

/* ── What can be DONE to KourOS (the write contract) ───────────────────────────────
   rescanLibrary walks MUSIC_DIR and (re)catalogs tracks via src/library/scan.js.
   Admin-scoped (scopes: ['kouros:admin']), same precedent as papyros's rescanLibrary —
   src/routes/library.js enforces the EQUIVALENT req.user.role === 'admin' check (the
   suite's existing admin-gate idiom, resilient to weaveAuth's no-key dev stub, which
   carries a role but no scope array). */
const CAPABILITIES = {
  app: 'kouros',
  version: 1,
  capabilities: [
    {
      id: 'rescanLibrary', label: 'Rescan music + audiobook library', method: 'POST', path: '/library/rescan',
      body: [],
      // Summed over BOTH walks — a track file and a book folder are each one unit.
      returns: [
        { name: 'scanned',  type: 'number', label: 'Track files + book folders examined' },
        { name: 'upserted', type: 'number', label: 'Tracks + books inserted or updated' },
        { name: 'removed',  type: 'number', label: 'Tracks + books removed (file/folder no longer exists)' },
        { name: 'skipped',  type: 'number', label: 'Tracks + books skipped (unchanged since last scan)' },
      ],
      invalidates: [TRACKS_KEY, BOOKS_KEY], scopes: ['kouros:admin'],
      doc: 'Walks MUSIC_DIR (one track per audio file) and AUDIOBOOKS_DIR (one book per folder) '
        + 'and (re)catalogs both: probes new/changed audio, extracts cover art (embedded, else a '
        + 'folder-level cover.*), removes rows whose file/folder vanished. A scan already in '
        + 'flight is joined, not duplicated.',
    },
    {
      // A REGULAR-USER capability: any listener may fix the metadata of a book they are
      // looking at. weaveWriteGate still requires `kouros:write` of a service caller.
      id: 'matchBook', label: 'Match book metadata (iTunes)', method: 'POST', path: '/match',
      body: [
        { name: 'bookId', type: 'ref', label: 'Book', ref: 'kouros.books', required: true },
        // One whole row off `metadataSearch`, round-tripped — hence `json` with a schema.
        { name: 'candidate', type: 'json', label: 'Chosen metadataSearch candidate row', required: true, schema: 'kouros.metadataSearch' },
      ],
      returns: [
        { name: 'updated', type: 'boolean', label: 'Metadata written to the book row' },
        { name: 'cover', type: 'enum', enum: ['updated', 'failed'], label: 'Artwork download outcome' },
      ],
      invalidates: [BOOKS_KEY], scopes: ['kouros:write'],
      doc: 'Applies a chosen iTunes metadata candidate to a book: writes author/description/'
        + 'year/genres (merged) + metadata_source:\'itunes\' + ext_ref:\'itunes:<candidate.id>\', '
        + 'and best-effort downloads a 600x600 cover (upsized from the candidate\'s 100x100 '
        + 'artworkUrl100). Title and series are left untouched. A failed artwork download does '
        + 'not fail the match: metadata still writes and the response reports cover:\'failed\'.',
    },
    {
      // ADMIN: it writes books other than the one the caller is looking at.
      id: 'matchAllMissing', label: 'Match all missing audiobook metadata (iTunes, admin sweep)', method: 'POST', path: '/match/all',
      body: [],
      returns: [
        { name: 'examined', type: 'number', label: 'Books examined this run (bounded by the per-run cap)' },
        {
          name: 'applied', type: 'json', schema: 'kouros.books',
          label: 'Books auto-applied: [{bookId, title, extRef, via}]',
        },
        {
          name: 'review', type: 'json', schema: 'kouros.metadataSearch',
          label: 'Books needing manual review: [{bookId, title, candidates, error?}] — '
            + 'candidates is metadataSearch\'s typed item shape (possibly empty); error:true marks '
            + 'a book whose iTunes search itself failed, not a failed match.',
        },
        { name: 'truncated', type: 'boolean', label: 'True when more candidate books remain beyond this run\'s cap' },
      ],
      invalidates: [BOOKS_KEY], scopes: ['kouros:admin'],
      doc: 'Sweeps every book still metadata_source:\'embedded\' with a missing author, cover or '
        + 'description, searches iTunes for each (title + author), filters knockoff "summary" '
        + 'listings, and applies the best of: exact title+author → exact author → title → first '
        + 'candidate. Sequential, ~250ms apart, capped at 50 books per run (`truncated` flags more).',
    },
    ...PLAYLISTS.capabilities,
    ...HISTORY.capabilities,   // 17.4-style: createHistory only — see HISTORY's comment above
    ...RATINGS.capabilities,
    ...PROGRESS.capabilities,
    ...BOOKMARKS.capabilities,
    ...BOOK_HISTORY.capabilities,   // createBookHistory only — append-only like HISTORY
  ],
};

/* ── What can be READ from KourOS (the read contract) ──────────────────────────────
   The `tracks` list row is SCALAR METADATA ONLY — no `files`/`chapters` (the brick
   writes these unconditionally; for a one-file-per-row track they're never useful past
   the scan itself) and no filesystem `path`. Artist→album→track hierarchy is DERIVED
   at read time from these same filters (browse: `?artist=X`, then `?artist=X&album=Y`)
   — no separate `artists`/`albums` table. */
const TRACK_SHAPE = [
  { name: 'id',          type: 'number' },
  { name: 'title',       type: 'string' },
  { name: 'artist',      type: 'string' },
  { name: 'album',       type: 'string' },
  { name: 'albumartist', type: 'string' },
  { name: 'track_no',    type: 'number' },
  { name: 'disc_no',     type: 'number' },
  { name: 'year',        type: 'number' },
  { name: 'genres',      type: 'json',   label: 'Genre tags (string[])' , schema: 'Documentation/ARCHITECTURE.md' },
  { name: 'duration',    type: 'number', label: 'Duration, seconds' },
  { name: 'cover_path',  type: 'string', label: 'Cover image path relative to DATA_DIR (null if none extracted)' },
  { name: 'updated_at',  type: 'string', label: 'Last catalog update (delta cursor for `since`)' },
];

/* The `tracks` DatasetDef — mirrors papyros's BOOKS_DATASET shape/filter style
   (title/author/series/genre/since → title/artist/album/genre/since here). Each filter
   carries its own column/op so src/routes/tracks.js's buildItemFilters enforces
   EXACTLY what this doc declares (P3, no drift). */
const TRACKS_DATASET = {
  id: 'tracks', label: 'Music library', path: '/tracks',
  description: 'The shared track catalog the scanner (rescanLibrary) populates. '
    + 'List rows carry scalar metadata only; browse by artist/album to derive the hierarchy.',
  filters: [
    { name: 'title',  type: 'string', label: 'Title prefix (search)',                     column: 'title',      op: 'prefix' },
    { name: 'artist', type: 'string', label: 'Artist prefix',                              column: 'artist',     op: 'prefix' },
    { name: 'album',  type: 'string', label: 'Album (exact)',                              column: 'album',      op: 'eq' },
    { name: 'genre',  type: 'string', label: 'Genre (exact tag match)',                    column: 'genres',     op: 'tags' },
    { name: 'since',  type: 'string', label: 'Updated since (updated_at delta cursor)',    column: 'updated_at', op: 'gt' },
  ],
  item: TRACK_SHAPE,
  invalidates: [TRACKS_KEY],
};

/* ── The audiobook catalog's read contract (PapyrOS's, folded in) ─────────────────
   A list row is SCALAR METADATA ONLY — no per-file manifest, no chapters, no path, no
   description (all detail-only weight, served by GET /api/book/:bookId). books/list.js
   derives its SELECT from BOOK_SHAPE, so the declared row and the queried columns are
   one array. */
const BOOK_SHAPE = [
  { name: 'id',              type: 'number' },
  { name: 'title',           type: 'string' },
  { name: 'subtitle',        type: 'string' },
  { name: 'author',          type: 'string' },
  { name: 'narrator',        type: 'string' },
  { name: 'series',          type: 'string' },
  { name: 'series_seq',      type: 'number' },
  { name: 'year',            type: 'number' },
  { name: 'genres',          type: 'json',   label: 'Genre tags (string[])' , schema: 'Documentation/ARCHITECTURE.md' },
  { name: 'duration',        type: 'number', label: 'Total duration, seconds' },
  { name: 'cover_path',      type: 'string', label: 'Cover image path relative to the books data dir (null if none extracted)' },
  { name: 'metadata_source', type: 'enum',   enum: ['embedded', 'itunes', 'manual'] },
  { name: 'ext_ref',         type: 'string', label: 'External metadata reference (enrichment lookup key)', doc: extRefFieldDoc(EXT_REFS) },
  { name: 'updated_at',      type: 'string', label: 'Last catalog update (delta cursor for `since`)' },
];

const BOOK_DATASET = {
  id: 'book', label: 'One audiobook, in full', path: '/book/:bookId',
  filters: [],
  description: 'The list row plus the per-file manifest — including compat_ready, so a player '
    + 'knows it can start on the Firefox-safe remux instead of discovering a decode failure — '
    + 'the chapters, and the description.',
};

const BOOKS_DATASET = {
  id: 'books', label: 'Audiobook library', path: '/books',
  description: 'The shared audiobook catalog the book scanner (rescanLibrary) populates. '
    + 'List rows carry scalar metadata only — per-file/chapter detail is GET /api/book/:bookId.',
  // `genre` uses the `tags` op: `genres` is a JSON-array TEXT column, so `eq` would
  // compare the whole serialised array to one string and never match.
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

/* ── The discovery surface (XC-7) ──────────────────────────────────────────────
 *
 * ⚠️ These seven reads existed and were DECLARED NOWHERE. `src/discover/` is
 * ~1,700 lines of CLAP-vector similarity search — the consumer of the whole
 * music vector space — and to anything reading this document it did not exist.
 * The consequence is the reason RESET promotes this finding: a request like
 * "play something that matches this routine's energy" was blocked by a missing
 * DECLARATION, not by a missing model. A GUI, a peer app, or an AI composer can
 * only reach what is declared here.
 *
 * They are datasets rather than capabilities because every one is a READ: they
 * compute, but they change nothing. `item: TRACK_SHAPE` on the track-returning
 * ones is what makes the results composable — a caller learns the rows are
 * `kouros.tracks`, so a result can be fed to anything that takes a track.
 *
 * ⚠️ Every one of these DEGRADES rather than failing when the vector index is
 * absent or thin (no `VECTOR_DB_PATH`, or a backfill that hasn't reached these
 * rows): the answer falls back to metadata affinity and the response says so in
 * its `basis`. That is deliberate and it is why `discoveryStats` is declared
 * too — it is how a consumer tells "no results" from "no index".
 */
/* The browse reads. Not part of the vector space — these are plain catalogue
 * roll-ups over `tracks` — but they were undeclared for the same reason the
 * discover surface was: nothing forced the question. A peer wanting "this
 * artist's albums" had to read KourOS's source to learn the route exists. */
const BROWSE_DATASETS = [
  {
    app: 'kouros', id: 'albums', label: 'Albums',
    path: '/albums',
    filters: [
      { name: 'artist', type: 'string', label: 'Artist', computed: true },
      { name: 'limit', type: 'number', label: 'How many', computed: true },
      { name: 'offset', type: 'number', label: 'Skip', computed: true },
    ],
  },
  {
    app: 'kouros', id: 'artists', label: 'Artists',
    path: '/artists',
    filters: [
      { name: 'limit', type: 'number', label: 'How many', computed: true },
      { name: 'offset', type: 'number', label: 'Skip', computed: true },
    ],
  },
  {
    app: 'kouros', id: 'libraryStats', label: 'Library totals',
    path: '/library/stats',
    filters: [],
  },
];

const DISCOVER_DATASETS = [
  {
    app: 'kouros', id: 'discoverStats', label: 'Discovery coverage',
    path: '/discover/stats',
    // Not a track list: how much of the library the embedder has reached. Every
    // "why is this rail empty?" question in the UI is answered from here.
    filters: [],
  },
  {
    app: 'kouros', id: 'discoverMesh', label: "One track's pulsarmap",
    path: '/discover/mesh/:id',
    // ⚠️ THIS CANNOT RIDE ON `discoverStats` OR ANY OTHER DISCOVER DECLARATION.
    // `98-surface-coverage` bounds a declared path to ONE segment of cover
    // (MAX_COVER_DEPTH = 1) precisely so a surface that adds a NOUN of its own
    // has to say so — and a mesh is a new noun, not another way to address a
    // track row. Hence its own entry, and deliberately no `item: TRACK_SHAPE`:
    // the response is one picture, not a list of tracks.
    filters: [],
  },
  {
    app: 'kouros', id: 'discoverSimilar', label: 'Tracks similar to one track',
    path: '/discover/similar/:id',
    filters: [{ name: 'k', type: 'number', label: 'How many', computed: true }],
    item: TRACK_SHAPE,
  },
  {
    app: 'kouros', id: 'discoverRadio', label: 'An endless station around seed tracks',
    path: '/discover/radio',
    filters: [
      { name: 'seed', type: 'string', label: 'Seed track ids (comma-separated)', required: true, computed: true },
      { name: 'k', type: 'number', label: 'How many', computed: true },
    ],
    item: TRACK_SHAPE,
  },
  {
    app: 'kouros', id: 'discoverRun', label: 'A sequenced set with an arc',
    path: '/discover/run',
    filters: [
      { name: 'seed', type: 'number', label: 'Seed track id', required: true, computed: true },
      { name: 'length', type: 'number', label: 'How many tracks', computed: true },
      { name: 'arc', type: 'enum', label: 'Shape', enum: ['rise', 'fall', 'flat'], computed: true },
    ],
    item: TRACK_SHAPE,
  },
  {
    app: 'kouros', id: 'discoverMap', label: 'The vibe space — every covered track in 3-D, along an energy rail',
    path: '/discover/map',
    filters: [],
  },
  {
    app: 'kouros', id: 'discoverNear', label: 'What sits near a point in the vibe space',
    path: '/discover/near',
    filters: [
      { name: 'x', type: 'number', label: 'x, in [-1, 1]', required: true, computed: true },
      { name: 'y', type: 'number', label: 'y, in [-1, 1]', required: true, computed: true },
      { name: 'z', type: 'number', label: 'z, in [-1, 1]', required: true, computed: true },
      { name: 'w', type: 'number', label: 'Energy percentile, in [0, 1]', required: true, computed: true },
      { name: 'k', type: 'number', label: 'How many', computed: true },
    ],
    item: TRACK_SHAPE,
  },
  {
    app: 'kouros', id: 'discoverHome', label: 'The home rails, assembled in one request',
    path: '/discover/home',
    // `hour` is the LISTENER's local hour: the server clock is UTC in a
    // container, and "morning" is a property of where the listener is.
    filters: [{ name: 'hour', type: 'number', label: "Listener's local hour (0–23)", computed: true }],
  },
];

const DATASETS = {
  app: 'kouros',
  version: 1,
  datasets: [
    TRACKS_DATASET, PLAYLISTS.dataset, HISTORY.dataset, RATINGS.dataset,
    ...BROWSE_DATASETS, ...DISCOVER_DATASETS,
    BOOKS_DATASET, BOOK_DATASET, PROGRESS.dataset, BOOKMARKS.dataset, BOOK_HISTORY.dataset,
    ...META.datasets,
  ],
};

module.exports = {
  CAPABILITIES, DATASETS, TRACKS_KEY, TRACK_SHAPE, BOOKS_KEY, BOOK_SHAPE,
  PLAYLISTS, HISTORY, RATINGS,              // server.js .mount()s each of these
  PROGRESS, BOOKMARKS, BOOK_HISTORY,        // …and these (audiobooks, since the PapyrOS fold)
  META,                                     // server.js .mount()s this too (reads only, no .ddl())
  ACTIVITY,                                 // D6: server.js mounts its handler (what the user DID here)
  EXT_REFS,                                 // D7/BB-5: the ext_ref schemes this app writes
};

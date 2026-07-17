'use strict';
// discovery.js — KourOS's Weave discovery declarations (ToDo §3 18.2 — real backend on
// the shared bricks, replacing 18.1's scaffolded placeholder `items` collection).
//
// Follows PapyrOS's proven split (ToDo §3 Wave 17): `tracks` is a SHARED,
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

/** The `tracks` catalog's invalidation bus key — the scanner (src/library/scan.js)
 *  bumps every track row it touches, so a peer polling `tracks` refetches on rescan. */
const TRACKS_KEY = resourceKey('kouros', 'tracks'); // 'kouros.tracks'

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
    { name: 'started_at', type: 'string',  label: 'Session start (ISO timestamp)', required: true },
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
      id: 'rescanLibrary', label: 'Rescan music library', method: 'POST', path: '/library/rescan',
      body: [],
      returns: [
        { name: 'scanned',  type: 'number', label: 'Track files examined' },
        { name: 'upserted', type: 'number', label: 'Tracks inserted or updated' },
        { name: 'removed',  type: 'number', label: 'Tracks removed (file no longer exists)' },
        { name: 'skipped',  type: 'number', label: 'Tracks skipped (file unchanged since last scan)' },
      ],
      invalidates: [TRACKS_KEY], scopes: ['kouros:admin'],
      doc: 'Walks MUSIC_DIR and (re)catalogs tracks: probes new/changed audio files, extracts '
        + 'cover art (embedded, else a folder-level cover.*), removes rows whose file vanished. '
        + 'A scan already in flight is joined, not duplicated.',
    },
    ...PLAYLISTS.capabilities,
    ...HISTORY.capabilities,   // 17.4-style: createHistory only — see HISTORY's comment above
    ...RATINGS.capabilities,
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
  { name: 'genres',      type: 'json',   label: 'Genre tags (string[])' },
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

const DATASETS = {
  app: 'kouros',
  version: 1,
  datasets: [TRACKS_DATASET, PLAYLISTS.dataset, HISTORY.dataset, RATINGS.dataset],
};

module.exports = {
  CAPABILITIES, DATASETS, TRACKS_KEY, TRACK_SHAPE,
  PLAYLISTS, HISTORY, RATINGS,   // server.js .mount()s each of these
};

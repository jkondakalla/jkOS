'use strict';
// discovery.js — BeigeBoard's Weave discovery declarations, as importable DATA.
//
// What can be DONE to BeigeBoard (CAPABILITIES, the write contract) and what can be
// READ from it (DATASETS, the read contract), declared once as pure data so the
// server can serve them AND any tool — the suite-prober, a workshop GUI, an AI
// composer — can `require()` and lint them without parsing server.js. (Previously
// these were inline `const`s in the server, invisible to everything but the running
// process — the "sources of truth must be importable data" rule.)
//
// Zero side effects on purpose (and its one dep, @jkos/suite-manifest, is itself
// zero-dep pure data): this file is required both by the live backend and by offline
// tooling, so it must be safe to load in a checkout with no env, no DB, no network.
// The canonical TS shapes are @jkos/weave/src/{capability,dataset}.ts; the structural
// rule is @jkos/weave/src/shared/docShape.js (serveCapabilities/serveDatasets validate
// at boot).
//
// The invalidation bus key is DERIVED from the app id via resourceKey (ToDo A5), not a
// free-typed 'beigeboard.items' repeated on each capability + the dataset.
const { resourceKey } = require('@jkos/suite-manifest');
// ITEM_SHAPE is DERIVED (ARCH-1) from the one per-column list in src/item-fields —
// the same source src/schema.js derives ITEM_COLUMNS + the import cleaner tables
// from. So the row a peer READS (this shape), the columns the server WRITES
// (ITEM_COLUMNS), and the caps/enums it ENFORCES are provably one schema, not four
// hand-synced copies (the drift class behind BUG-1/3/7). item-fields.js is pure,
// zero-dep data, so requiring it keeps this file offline-safe for the prober.
const { ITEM_SHAPE } = require('./src/item-fields');
// The library's collection vocabulary comes from the routine spec (ARCH-1 again):
// the same closed list the validator enforces and the editor's dropdown renders, so
// a peer cannot be told a collection exists that a write would then reject.
// routine-spec.js is zero-dep, pure, side-effect-free data + functions, so requiring
// it keeps this file offline-safe for the prober exactly as item-fields.js does.
const { COLLECTIONS: LIBRARY_COLLECTIONS } = require('./src/routine-spec');

/** This app's polled resources. Writers bump them; the datasets read them. */
const ITEMS_KEY = resourceKey('beigeboard', 'items');     // 'beigeboard.items'
/* The library is its OWN key, not part of `items`. Editing an exercise must not
   invalidate every task in every peer's cache, and adding a task must not make a
   library browser refetch — they change on completely different rhythms. */
const LIBRARY_KEY = resourceKey('beigeboard', 'library'); // 'beigeboard.library'

/* The shape of ONE items row. createItem/completeItem RESOLVE TO this, and the
   `items` dataset reads it — declared once (in item-fields) so a capability's
   OUTPUT stud and the dataset's row are provably the same `beigeboard.items`
   shape (no drift). It declares EVERY column a `SELECT *` row through toRow
   returns, and every `kind` the API emits (goal/milestone/routine included).

   A ROUTINE is a pattern row, never a scheduled one — a peer that just wants
   work to do should read `kind=task` and ignore routines entirely: their
   occurrences ARE tasks (minted under them by src/routines.js) and carry an
   `ext_ref` of `routine:<id>:<date>`, so `?ext_ref_prefix=routine:` lists them. */

/* ── What can be DONE to BeigeBoard (the write contract) ─────────────────────── */
const CAPABILITIES = {
  app: 'beigeboard',
  version: 1,
  capabilities: [
    {
      id: 'createItem', label: 'Add a task', method: 'POST', path: '/items',
      body: [
        { name: 'title',          type: 'string', label: 'Title', required: true, max: 500 },
        { name: 'week_start',     type: 'date',   label: 'Week bench (ISO Monday)' },
        { name: 'due_date',       type: 'date',   label: 'Due date' },
        { name: 'scheduled_time', type: 'time',   label: 'Time' },
        { name: 'notes',          type: 'text',   label: 'Notes' },
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event', 'routine'], default: 'task' },
        { name: 'tags',           type: 'string', label: 'Tags (comma-separated)' },
        { name: 'ext_ref',        type: 'string', label: 'External ref' },
        // Routine cadence. Declared on the WRITE contract because a peer creating a
        // kind:'routine' with no cadence would create an inert row — the two fields
        // are the routine. The occurrences it produces are plain tasks a peer reads
        // through the `items` dataset like any other, with no routine concept
        // needed; see src/routines.js.
        { name: 'cadence_days',   type: 'string', label: 'Routine: days (offsets from Monday, "0,2,4")' },
        { name: 'cadence_count',  type: 'number', label: 'Routine: times per week' },
        // The routine DOCUMENT — steps and progression rules (src/routine-spec.js).
        // Declared here for the same reason the cadence is: a peer creating a
        // routine without it creates a session with no content. Prefer
        // `importRoutine` below for anything more than a one-line document — it
        // resolves library refs, is idempotent by slug, and returns the lint.
        { name: 'spec',           type: 'json',   label: 'Routine: the step document' },
      ],
      returns: ITEM_SHAPE,
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
    },
    {
      id: 'completeItem', label: 'Mark done', method: 'PATCH', path: '/items/:id',
      body: [
        { name: 'id',        type: 'number',  label: 'Item id', required: true },
        { name: 'completed', type: 'boolean', label: 'Completed', required: true, default: true },
      ],
      returns: ITEM_SHAPE,
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
    },
    {
      // General partial update — the load-bearing capability for cross-app
      // scheduling. Drag reschedule (and Today's carried-reschedule) commit through
      // THIS: any subset of the schedulable fields is patched. completeItem stays a
      // narrow, intent-named alias for the common "mark done" case; this is the
      // open seam everything else (move a date/time, rename, recolour) maps onto.
      // The server's PATCH /items/:id route already accepts any ITEM_COLUMNS field;
      // this widens only the DECLARED contract so peers can discover the write.
      id: 'updateItem', label: 'Reschedule / edit', method: 'PATCH', path: '/items/:id',
      body: [
        { name: 'id',             type: 'number', label: 'Item id', required: true },
        { name: 'week_start',     type: 'date',   label: 'Week bench (ISO Monday)' },
        { name: 'due_date',       type: 'date',   label: 'Due date' },
        { name: 'end_date',       type: 'date',   label: 'End date (multi-day)' },
        { name: 'scheduled_time', type: 'time',   label: 'Start time' },
        { name: 'scheduled_end',  type: 'time',   label: 'End time' },
        { name: 'title',          type: 'string', label: 'Title', max: 500 },
        { name: 'notes',          type: 'text',   label: 'Notes' },
        { name: 'accent',         type: 'string', label: 'Accent' },
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event'] },
        { name: 'cadence_days',   type: 'string', label: 'Routine: days (offsets from Monday, "0,2,4")' },
        { name: 'cadence_count',  type: 'number', label: 'Routine: times per week' },
        { name: 'spec',           type: 'json',   label: 'Routine: the step document' },
        { name: 'cadence_rule',   type: 'string', label: "Routine: cadence beyond weekly ('every_n_days:3', 'monthly:15', 'rolling:3', 'rrule:…')" },
        // On an OCCURRENCE, not on the routine: what the user actually did. It is
        // the one field the progression engine reads BACK — an `autoregulated`
        // step advances only when the log says the top of its range was met — so a
        // peer that records real sets is feeding the routine, not just annotating
        // it. Shape: { steps: { <stepKey>: { done, met, sets: [{value, load}] } } }.
        { name: 'performed',      type: 'json',   label: 'Occurrence: what was actually done' },
        { name: 'deload_override', type: 'number', label: 'Occurrence: 1 = take this one easy (prefer POST /items/:id/deload, which also reconciles)' },
      ],
      returns: ITEM_SHAPE,
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
      doc: 'Patches any subset of an item\'s schedulable fields. Drag reschedule maps to this. Pass id + only the fields to change.',
    },
    {
      /* One document → one routine, created or updated. The AI-facing door, and
         the reason it exists rather than leaving callers to POST /items with a
         `spec`: it resolves library `ref`s into complete steps, it is IDEMPOTENT by
         slug (a retry after a timeout updates rather than duplicating), it accepts
         `days: ['mon','thu']` as well as the raw Monday-offset encoding, and it
         returns the LINT — the tier that says "no step in this routine ever gets
         harder", which is the way an AI-authored routine actually fails. */
      id: 'importRoutine', label: 'Import a routine (JSON document)', method: 'POST', path: '/routines/import',
      body: [
        { name: 'slug',          type: 'string', label: 'Stable id — re-importing the same slug UPDATES' },
        { name: 'title',         type: 'string', label: 'Title', required: true, max: 500 },
        { name: 'days',          type: 'json',   label: 'Days — ["mon","thu"] or [0,3]' },
        { name: 'cadence_count', type: 'number', label: 'Times per week (surplus over `days` floats to the week bench)' },
        { name: 'time',          type: 'time',   label: 'Time of day' },
        { name: 'spec',          type: 'json',   label: 'The step document — steps, progression, phases, vars', required: true },
      ],
      returns: [
        { name: 'ok',       type: 'boolean' },
        { name: 'slug',     type: 'string' },
        { name: 'created',  type: 'boolean' },
        { name: 'routine',  type: 'json', label: 'The created/updated routine row' },
        { name: 'summary',  type: 'string', label: 'The document in one line' },
        { name: 'warnings', type: 'json', label: 'Lint — accepted, but probably not what you meant' },
        { name: 'minted',   type: 'number', label: 'Occurrences minted across the horizon' },
      ],
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
      doc: 'Creates or updates one routine from a JSON document. Idempotent by slug. ?dryRun=1 validates and renders the first four sessions without writing. GET /api/routines/vocabulary returns every legal value plus a worked example — read it first.',
    },
    {
      /* Reusable sub-tasks: exercises, recipes, pieces, chores. A routine step
         references one with `ref: '<slug>'` and inherits its unit, rest interval,
         variant ladder and default progression — which is what lets an author who
         knows nothing about programming a lift still produce a sane one. */
      id: 'importLibrary', label: 'Import library entries', method: 'POST', path: '/library/import',
      body: [{ name: 'entries', type: 'json', label: 'Array of { collection, slug, title, unit, variants, defaults }', required: true }],
      returns: [
        { name: 'ok',      type: 'boolean' },
        { name: 'created', type: 'number' },
        { name: 'updated', type: 'number' },
        { name: 'failed',  type: 'json' },
      ],
      invalidates: [LIBRARY_KEY], scopes: ['beigeboard:write'],
      doc: 'Bulk upsert by (collection, slug) — safe to resend. Teaches the app a whole domain in one call. GET /api/library/export returns the same document back.',
    },
    {
      /* "Take this one easy." Its own capability rather than a `deload_override`
         PATCH because it must reconcile in the same breath: a deloaded session
         spends NO RUNG on the cycle ladder, so the sessions after it shift back and
         re-render. A peer setting the column alone would leave the ladder wrong. */
      id: 'deloadSession', label: 'Take this session easy', method: 'POST', path: '/items/:id/deload',
      body: [
        { name: 'id',     type: 'number',  label: 'Occurrence id', required: true },
        { name: 'deload', type: 'boolean', label: 'true = lighter (default) · false = force normal', default: true },
        { name: 'clear',  type: 'boolean', label: 'Hand the decision back to the programme' },
      ],
      returns: ITEM_SHAPE,
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
      doc: 'Renders one session at the deload factor and gives it no rung on the cycle ladder, so taking it easy costs no progress. Refuses the past — a record is not editable.',
    },
    {
      id: 'deleteItem', label: 'Delete', method: 'DELETE', path: '/items/:id',
      body: [{ name: 'id', type: 'number', label: 'Item id', required: true }],
      returns: [{ name: 'ok', type: 'boolean' }],
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
    },
    {
      // Bulk/AI import: one JSON document → a whole goal→milestone→task tree in one
      // transaction. Body is a document, not a flat form, so `items`/`defaults` are
      // declared as JSON; the canonical use is a direct POST (see README → Importing).
      id: 'importItems', label: 'Import (JSON tree)', method: 'POST', path: '/import',
      body: [
        { name: 'items',    type: 'json', label: 'Items — a nested tree or a flat ref/parent list', required: true },
        { name: 'defaults', type: 'json', label: 'Field defaults applied to every item (optional)' },
      ],
      returns: [
        { name: 'ok',       type: 'boolean' },
        { name: 'created',  type: 'number' },
        { name: 'items',    type: 'json', label: 'The created items (flattened, with ids)' },
        { name: 'warnings', type: 'json', label: 'Non-fatal per-item notes' },
      ],
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
      doc: 'Creates a nested goal→milestone→task tree (or a flat list linked by ref/parent) in one transaction. Validated before any write; ?dryRun=1 previews. See README → Importing tasks & goals.',
    },
    // NO AI capabilities here. BeigeBoard used to declare `parseTask` + `breakdownGoal`
    // over its own /api/ai/* routes, which proxied a synchronous Ollama chat call. That
    // whole surface is retired: AI is LazurOS's job, it is ASYNCHRONOUS (202 {job_id} →
    // poll), and its results come back INTO BeigeBoard through `createItem`/`importItems`
    // below via delegated write-back. So an AI parse is a LazurOS capability composed with
    // a BeigeBoard one — not a second, parallel AI surface bolted onto this app.

    /* ── The routine + calendar writes (BB-7) ─────────────────────────────────
     * Served and undeclared until 2026-08-27. `routines/bundle` in particular is
     * how a whole authored routine arrives, and it was reachable only by reading
     * the source — the exact surface an AI author most needs to find. */
    {
      id: 'importRoutineBundle', label: 'Import a routine bundle', method: 'POST', path: '/routines/bundle',
      body: [
        { name: 'bundle', type: 'json', label: 'A routine document plus the library entries it references', required: true },
        { name: 'dryRun', type: 'boolean', label: 'Validate and report without writing' },
      ],
      returns: [
        { name: 'routine',  type: 'json',   label: 'The routine as stored' },
        { name: 'library',  type: 'json',   label: 'Library entries created or matched' },
        { name: 'warnings', type: 'json',   label: 'Lint — accepted, but worth a look' },
      ],
      invalidates: [ITEMS_KEY, LIBRARY_KEY],
      doc: 'One document carrying a routine AND the library entries its steps reference, so an '
        + 'author submits a complete unit rather than ordering two imports correctly. dryRun '
        + 'returns the same report and writes nothing.',
    },
    {
      id: 'syncCalendar', label: 'Pull a connected calendar', method: 'POST', path: '/calendar/:provider/sync',
      body: [{ name: 'provider', type: 'enum', label: 'Provider', enum: ['google', 'outlook', 'icloud'], required: true }],
      returns: [
        { name: 'imported', type: 'number', label: 'Events written' },
        { name: 'updated',  type: 'number', label: 'Events changed' },
        { name: 'removed',  type: 'number', label: 'Events withdrawn' },
      ],
      invalidates: [ITEMS_KEY],
      doc: 'Pull-only: reads the connected calendar and reconciles its events into `items`. '
        + 'Nothing is ever written back to the provider. ⚠️ Declared as one capability over a '
        + '`:provider` path because the three providers are the same operation — the three '
        + 'hand-rolled route copies behind it are what RESET Stage D item 10 folds onto '
        + 'defineConnector.',
    },
    {
      id: 'disconnectCalendar', label: 'Disconnect a calendar', method: 'DELETE', path: '/auth/:provider',
      body: [{ name: 'provider', type: 'enum', label: 'Provider', enum: ['google', 'outlook', 'icloud'], required: true }],
      returns: [{ name: 'ok', type: 'boolean' }],
      invalidates: [ITEMS_KEY],
      doc: 'Drops the stored credential and the events it owned. ⚠️ The current implementation '
        + 'raw-DELETEs those items rather than routing through cascadeDelete — Stage D item 10.',
    },
  ],
};

/* ── What can be READ from BeigeBoard (the read contract) ────────────────────── */
const DATASETS = {
  app: 'beigeboard',
  version: 1,
  datasets: [
    {
      id: 'items', label: 'Tasks & events', path: '/items',
      // Each filter carries its OWN enforcement mapping (column/op): the server's
      // list endpoint derives the SQL filter from these via filterSpec(), so what the
      // dataset DECLARES it can be read by is exactly what it filters on (no drift).
      filters: [
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event', 'routine'],      column: 'kind',       op: 'eq' },
        { name: 'scope',          type: 'string', label: 'Scope',                                          column: 'scope',      op: 'eq' },
        { name: 'week_start',     type: 'date',   label: 'Week bench (ISO Monday)',                        column: 'week_start', op: 'eq' },
        { name: 'due_date',       type: 'date',   label: 'Due date',                                       column: 'due_date',   op: 'eq' },
        { name: 'ext_ref_prefix', type: 'string', label: 'External-ref prefix (an app\'s own items)',      column: 'ext_ref',    op: 'prefix' },
        { name: 'since',          type: 'string', label: 'Updated since (updated_at delta)',               column: 'updated_at', op: 'gt' },
        { name: 'tags',           type: 'string', label: 'Tags (comma-separated; ANDed)',                  column: 'tags',       op: 'tags' },
      ],
      item: ITEM_SHAPE,
      invalidates: [ITEMS_KEY],
    },
    {
      /* The routine document, resolved. `GET /items` already returns the raw `spec`
         column; this returns each routine with its spec NORMALISED — library refs
         resolved into complete steps, defaults filled, the one-line summary
         computed — which is what a consumer actually wants and what it would
         otherwise have to reimplement routine-spec.js to get. */
      id: 'routines', label: 'Routines (with their step documents)', path: '/routines',
      filters: [],
      item: [
        ...ITEM_SHAPE,
        { name: 'spec',    type: 'json',   label: 'The normalised step document' },
        { name: 'summary', type: 'string', label: 'The document in one line' },
        { name: 'cadence', type: 'string', label: 'The cadence in words' },
        { name: 'metric',  type: 'json',   label: 'What it contributes to its goal: {measure, unit, target, value, pct, window}' },
      ],
      invalidates: [ITEMS_KEY],
    },
    {
      /* The reusable sub-tasks routines are built out of. Read this BEFORE
         authoring a routine: the `slug`s here are what a step's `ref` names, and
         the entries carry the units, rest intervals and difficulty ladders that
         make a generated routine sane rather than merely valid. */
      id: 'library', label: 'Library (exercises, recipes, drills)', path: '/library',
      filters: [
        // BB-9: both filters carry their own enforcement now, so the SQL derives
        // from the declaration. `q` spans three columns — the reason its WHERE used
        // to be hand-written — which the `search` op now expresses declaratively.
        { name: 'collection', type: 'enum',   label: 'Collection', enum: LIBRARY_COLLECTIONS,
          column: 'collection', op: 'eq' },
        { name: 'q',          type: 'string', label: 'Search title, slug or tags',
          op: 'search', columns: ['title', 'slug', 'tags'] },
      ],
      item: [
        { name: 'id',         type: 'number' },
        { name: 'collection', type: 'enum',   enum: LIBRARY_COLLECTIONS },
        { name: 'slug',       type: 'string', label: 'What a step\'s `ref` names' },
        { name: 'title',      type: 'string' },
        { name: 'notes',      type: 'string' },
        { name: 'unit',       type: 'string' },
        { name: 'load_unit',  type: 'string' },
        { name: 'tags',       type: 'json' },
        { name: 'variants',   type: 'json',   label: 'The difficulty ladder, easiest → hardest' },
        { name: 'defaults',   type: 'json',   label: 'Step defaults: sets, target, load, rest, progression' },
        { name: 'created_at', type: 'string' },
        { name: 'updated_at', type: 'string' },
      ],
      invalidates: [LIBRARY_KEY],
    },

    /* ── The routine reads (BB-7) ──────────────────────────────────────────────
     *
     * ⚠️ BeigeBoard served ~40 routes and declared 8 paths. These six were among
     * the invisible ones: everything about how a routine is PERFORMED — its
     * metric, its history, what the next occurrence would look like, how the
     * document has changed — existed only if you read the source. That is the
     * defect §3 calls the worst class, because it misinforms rather than merely
     * omitting: a reader trusting the declaration concludes the data isn't there.
     *
     * `:id` paths are per-routine reads rather than filtered lists, so their
     * parameters are `computed` — there is no WHERE clause to map them to. */
    {
      id: 'routineMetric', label: "A routine's goal metric", path: '/routines/:id/metric',
      filters: [],
      doc: 'What this routine is measured by, and where it currently stands.',
    },
    {
      id: 'routineSeries', label: "A routine's performance series", path: '/routines/:id/series',
      filters: [{ name: 'weeks', type: 'number', label: 'How many weeks back', computed: true }],
      doc: 'Prescribed against performed over time — the series the charts read, and the '
        + 'same shape the variance analysis consumes.',
    },
    {
      id: 'routinePreview', label: 'What the next occurrences would be', path: '/routines/:id/preview',
      filters: [{ name: 'today', type: 'date', label: "The caller's local day", computed: true }],
      doc: 'The occurrences the current rules WOULD mint, without minting them — how an '
        + 'author checks a cadence before committing to it.',
    },
    {
      id: 'routineRevisions', label: "A routine's revision history", path: '/routines/:id/revisions',
      filters: [],
      doc: 'Every committed version of the routine document, newest first.',
    },
    {
      id: 'routineVocabulary', label: 'The routine authoring vocabulary', path: '/routines/vocabulary',
      filters: [],
      doc: 'Every cadence, progression, unit and field a routine document may use — the '
        + 'machine-readable half of the authoring contract. A GUI builds its pickers from '
        + 'this; an AI author validates against it before submitting.',
    },
    {
      id: 'routinePrompt', label: 'The generated routine-authoring prompt', path: '/routines/prompt',
      filters: [],
      doc: 'The authoring instructions, GENERATED from the vocabulary above so the prose and '
        + 'the enum can never disagree (Documentation/ROUTINE_PROMPT.md is this output, '
        + 'checked in and gated by check:routine).',
    },
  ],
};

module.exports = { CAPABILITIES, DATASETS, ITEM_SHAPE };

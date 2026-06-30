'use strict';
// discovery.js — BeigeBoard's Weave discovery declarations, as importable DATA.
//
// What can be DONE to BeigeBoard (CAPABILITIES, the write contract) and what can be
// READ from it (DATASETS, the read contract), declared once as pure data so the
// server can serve them AND any tool — the suite-prober, a workshop GUI, an AI
// composer — can `require()` and lint them without parsing server.js. (Previously
// these were inline `const`s in the server, invisible to everything but the running
// process; see CONSOLIDATION.md C3 / ToDo A3.)
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

/** This app's one polled resource. Writers bump it; the `items` dataset reads it. */
const ITEMS_KEY = resourceKey('beigeboard', 'items'); // 'beigeboard.items'

/* The shape of ONE items row. createItem/completeItem RESOLVE TO this, and the
   `items` dataset reads it — declared once so a capability's OUTPUT stud and the
   dataset's row are provably the same `beigeboard.items` shape (no drift). */
const ITEM_SHAPE = [
  { name: 'id',             type: 'number' },
  { name: 'title',          type: 'string' },
  { name: 'kind',           type: 'enum',    enum: ['task', 'event'] },
  { name: 'scope',          type: 'string' },
  { name: 'parent_id',      type: 'number' },
  { name: 'due_date',       type: 'date' },
  { name: 'end_date',       type: 'date' },
  { name: 'scheduled_time', type: 'time' },
  { name: 'scheduled_end',  type: 'time' },
  { name: 'completed',      type: 'boolean' },
  { name: 'accent',         type: 'string' },
  { name: 'source',         type: 'string' },
  { name: 'tags',           type: 'string' },
  { name: 'ext_ref',        type: 'string' },
  { name: 'updated_at',     type: 'string' },
];

/* ── What can be DONE to BeigeBoard (the write contract) ─────────────────────── */
const CAPABILITIES = {
  app: 'beigeboard',
  version: 1,
  capabilities: [
    {
      id: 'createItem', label: 'Add a task', method: 'POST', path: '/items',
      body: [
        { name: 'title',          type: 'string', label: 'Title', required: true, max: 200 },
        { name: 'due_date',       type: 'date',   label: 'Due date' },
        { name: 'scheduled_time', type: 'time',   label: 'Time' },
        { name: 'notes',          type: 'text',   label: 'Notes' },
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event'], default: 'task' },
        { name: 'tags',           type: 'string', label: 'Tags (comma-separated)' },
        { name: 'ext_ref',        type: 'string', label: 'External ref' },
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
        { name: 'due_date',       type: 'date',   label: 'Due date' },
        { name: 'end_date',       type: 'date',   label: 'End date (multi-day)' },
        { name: 'scheduled_time', type: 'time',   label: 'Start time' },
        { name: 'scheduled_end',  type: 'time',   label: 'End time' },
        { name: 'title',          type: 'string', label: 'Title', max: 200 },
        { name: 'notes',          type: 'text',   label: 'Notes' },
        { name: 'accent',         type: 'string', label: 'Accent' },
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event'] },
      ],
      returns: ITEM_SHAPE,
      invalidates: [ITEMS_KEY], scopes: ['beigeboard:write'],
      doc: 'Patches any subset of an item\'s schedulable fields. Drag reschedule maps to this. Pass id + only the fields to change.',
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
    {
      // AI: free text → structured task/event fields (the "quick add" parser). Declared
      // here so it stops being a parallel, undiscoverable surface (CONSOLIDATION.md G2):
      // a HUD widget or AI step can now discover + invoke it through Weave. It only
      // PARSES — the caller still createItem's the result — so it invalidates nothing.
      id: 'parseTask', label: 'Parse text → task', method: 'POST', path: '/ai/parse-task',
      body: [
        { name: 'text',  type: 'string', label: 'Natural-language task/event', required: true, max: 500 },
        { name: 'today', type: 'date',   label: 'Anchor date for relative phrasing (defaults to server date)' },
      ],
      returns: [
        { name: 'title',          type: 'string' },
        { name: 'kind',           type: 'enum', enum: ['task', 'event'] },
        { name: 'scope',          type: 'enum', enum: ['day', 'week', 'month'] },
        { name: 'due_date',       type: 'date' },
        { name: 'scheduled_time', type: 'time' },
        { name: 'notes',          type: 'text' },
      ],
      scopes: ['beigeboard:write'], ai: true,
      doc: 'Parses one free-text line into structured fields; does not write. Feed the result into createItem.',
    },
    {
      // AI: a goal → a short ladder of milestones + first actions (Breakdown Method).
      // Declared (G2) so it is discoverable; the milestone/action lists are free-form
      // arrays, hence `json` outputs (no array FieldType yet — see ToDo F4).
      id: 'breakdownGoal', label: 'Break a goal into steps', method: 'POST', path: '/ai/breakdown',
      body: [
        { name: 'title',       type: 'string', label: 'Goal', required: true, max: 200 },
        { name: 'done_means',  type: 'text',   label: 'Definition of done' },
        { name: 'target_date', type: 'date',   label: 'Target date' },
      ],
      returns: [
        { name: 'milestones',    type: 'json', label: 'Ordered checkpoints (string[])' },
        { name: 'first_actions', type: 'json', label: 'Concrete first tasks (string[])' },
      ],
      scopes: ['beigeboard:write'], ai: true,
      doc: 'Drafts 2–5 milestones + 2–4 first actions for a goal; does not write. Feed into importItems to materialise the ladder.',
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
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event'],                 column: 'kind',       op: 'eq' },
        { name: 'scope',          type: 'string', label: 'Scope',                                          column: 'scope',      op: 'eq' },
        { name: 'due_date',       type: 'date',   label: 'Due date',                                       column: 'due_date',   op: 'eq' },
        { name: 'ext_ref_prefix', type: 'string', label: 'External-ref prefix (an app\'s own items)',      column: 'ext_ref',    op: 'prefix' },
        { name: 'since',          type: 'string', label: 'Updated since (updated_at delta)',               column: 'updated_at', op: 'gt' },
        { name: 'tags',           type: 'string', label: 'Tags (comma-separated; ANDed)',                  column: 'tags',       op: 'tags' },
      ],
      item: ITEM_SHAPE,
      invalidates: [ITEMS_KEY],
    },
  ],
};

module.exports = { CAPABILITIES, DATASETS, ITEM_SHAPE };

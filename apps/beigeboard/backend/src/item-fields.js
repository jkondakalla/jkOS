'use strict';
// item-fields.js — the ONE source of truth for BeigeBoard's `items` schema, as pure
// data with ZERO dependencies (so discovery.js stays offline-safe for the prober).
//
// Everything else is DERIVED from this ordered list (ARCH-1), collapsing the four
// copies the audit found (ITEM_COLUMNS · the import cleaner tables · discovery.js's
// ITEM_SHAPE · the direct-write validator) into one — so a column can't be declared
// in one place and enforced differently in another (the class behind BUG-1/3/7).
//   • discovery.js  → ITEM_SHAPE      (the returned row shape: `shape` + `shapeEnum`)
//   • schema.js     → ITEM_COLUMNS    (names where `client`)
//                     IMPORT_STR_CAP  (`cap`), IMPORT_NUM_COLS (`num`),
//                     IMPORT_DATE_COLS/IMPORT_TIME_COLS (`shape`),
//                     IMPORT_{KIND,SCOPE,STATUS}_ENUM (`importEnum`)
//
// Per-column keys:
//   name       column name
//   shape      ITEM_SHAPE type — 'number'|'string'|'enum'|'boolean'|'date'|'time'
//   shapeEnum  enum members surfaced in ITEM_SHAPE (kind, status)
//   client     client-writable → included in ITEM_COLUMNS (id/user_id/*_at are not)
//   cap        max length for a text/date/time value → IMPORT_STR_CAP
//   num        numeric import column (bounded integer) → IMPORT_NUM_COLS
//   importEnum enum enforced at import/clean time (kind/scope/status)
//   struct     structural key handled by the import walker, not a value cleaner
//              (parent_id) — client-writable but skipped by the field normaliser
//
// ORDER IS CONTRACT: ITEM_SHAPE is emitted in this order and served to peers — keep
// id/user_id first and created_at/updated_at last, matching the historical shape.
const ITEM_FIELDS = [
  { name: 'id',             shape: 'number',  client: false },
  { name: 'user_id',        shape: 'number',  client: false },
  { name: 'kind',           shape: 'enum',    client: true,  shapeEnum: ['task', 'event', 'goal', 'milestone'], importEnum: ['task', 'event', 'goal', 'milestone'] },
  { name: 'scope',          shape: 'string',  client: true,  cap: 20, importEnum: ['day', 'week', 'month', 'year', 'project'] },
  { name: 'title',          shape: 'string',  client: true,  cap: 500 },
  { name: 'notes',          shape: 'string',  client: true,  cap: 5000 },
  { name: 'parent_id',      shape: 'number',  client: true,  struct: true },
  { name: 'accent',         shape: 'string',  client: true,  cap: 40 },
  { name: 'source',         shape: 'string',  client: true,  cap: 40 },
  { name: 'completed',      shape: 'boolean', client: true },
  { name: 'year',           shape: 'number',  client: true,  num: true },
  { name: 'month',          shape: 'number',  client: true,  num: true },
  { name: 'week_start',     shape: 'date',    client: true,  cap: 10 },
  { name: 'due_date',       shape: 'date',    client: true,  cap: 10 },
  { name: 'scheduled_time', shape: 'time',    client: true,  cap: 5 },
  { name: 'scheduled_end',  shape: 'time',    client: true,  cap: 5 },
  { name: 'end_date',       shape: 'date',    client: true,  cap: 10 },
  { name: 'location',       shape: 'string',  client: true,  cap: 500 },
  { name: 'attendees',      shape: 'number',  client: true,  num: true },
  { name: 'target',         shape: 'string',  client: true,  cap: 500 },
  { name: 'done_means',     shape: 'string',  client: true,  cap: 1000 },
  { name: 'target_date',    shape: 'date',    client: true,  cap: 10 },
  { name: 'position',       shape: 'number',  client: true,  num: true },
  { name: 'status',         shape: 'enum',    client: true,  cap: 20, shapeEnum: ['active', 'parked', 'done'], importEnum: ['active', 'parked', 'done'] },
  { name: 'tags',           shape: 'string',  client: true },   // JSON array on the wire; coerced at insert
  { name: 'ext_ref',        shape: 'string',  client: true,  cap: 200 },
  { name: 'created_at',     shape: 'string',  client: false },
  { name: 'updated_at',     shape: 'string',  client: false },  // trigger-managed
];

/* ITEM_SHAPE — the returned row shape, one `{ name, type, enum? }` per column, in
   declaration order. discovery.js re-exports this AS its ITEM_SHAPE. */
const ITEM_SHAPE = ITEM_FIELDS.map((f) => (
  f.shapeEnum ? { name: f.name, type: f.shape, enum: f.shapeEnum }
              : { name: f.name, type: f.shape }
));

module.exports = { ITEM_FIELDS, ITEM_SHAPE };

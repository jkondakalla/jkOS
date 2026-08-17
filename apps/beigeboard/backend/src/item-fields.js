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
  { name: 'kind',           shape: 'enum',    client: true,  shapeEnum: ['task', 'event', 'goal', 'milestone', 'routine'], importEnum: ['task', 'event', 'goal', 'milestone', 'routine'] },
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
  // ── Routines (kind:'routine') ──────────────────────────────────────────────
  // A routine is a CADENCE, not an occurrence. These two columns are the whole
  // pattern; the occurrences themselves are ordinary kind:'task' rows minted
  // under the routine by src/routines.js, so every downstream surface (Today,
  // Week, Calendar, ORDECK widgets, the weave `items` dataset) needs no new
  // concept to read them. Both are NULL on every other kind.
  //   cadence_days   CSV of DAY OFFSETS FROM THE WEEK START, e.g. "0,2,4". The
  //                  suite's week starts Monday (weekStart() in @jkos/cards, and
  //                  its DOW), so 0=Mon … 6=Sun. Offsets rather than JS getDay()
  //                  values because every board column and every mint is already
  //                  computed as addDays(weekStart, n) — storing the number the
  //                  render and the mint both use removes the one place a Sunday
  //                  off-by-one could enter.
  //   cadence_count  the weekly TARGET. NULL → the committed days are the target
  //                  (cadence_days.length). GREATER than that → the surplus is
  //                  FLOAT, minted onto the week bench (week_start set, no
  //                  due_date) so "3× a week, any days" is expressible without a
  //                  second mechanism. Lower than that mints nothing extra.
  // Appended here, after the last pre-existing client column and before the two
  // server-managed timestamps, because ORDER IS CONTRACT (see above): new columns
  // extend the shape's tail, they don't shift a column a peer already indexes.
  { name: 'cadence_days',   shape: 'string',  client: true,  cap: 40 },
  { name: 'cadence_count',  shape: 'number',  client: true,  num: true },
  // ── The routine document + its rendered output (migration 10) ──────────────
  // The cadence above says WHEN; these say WHAT, and how it gets harder. The
  // split is by owner, and it is the whole primitive:
  //   spec          on the ROUTINE — the document (src/routine-spec.js): steps,
  //                 progression rules, phases, variant ladders. RULES, not
  //                 numbers, so "make week 6 harder" is one edit and not thirty.
  //   prescription  on an OCCURRENCE — that document RENDERED at its cycle, as
  //                 concrete numbers, written once at mint and then frozen for
  //                 the past exactly like every other fact on the row.
  //   cycle_index   on an OCCURRENCE — which cycle produced the snapshot.
  //   performed     on an OCCURRENCE — what the user actually did. The only
  //                 field the engine reads BACK, to autoregulate.
  // All four are JSON-in-TEXT except cycle_index; `shape: 'json'` would be a new
  // ITEM_SHAPE type every peer would have to learn, and the value is a string on
  // the wire either way — so they declare as strings and the document contract
  // lives in routine-spec.js, which peers can require().
  { name: 'spec',           shape: 'string',  client: true,  cap: 20000 },
  { name: 'prescription',   shape: 'string',  client: true,  cap: 20000 },
  { name: 'performed',      shape: 'string',  client: true,  cap: 20000 },
  { name: 'cycle_index',    shape: 'number',  client: true,  num: true },
  // ── Wave 2 (migration 11) ──────────────────────────────────────────────────
  //   cadence_rule     on the ROUTINE — WHEN, beyond the weekly grid. Empty (the
  //                    default) = weekly via cadence_days/cadence_count. Otherwise
  //                    a tiny positional grammar parsed by routine-spec.js
  //                    parseCadence: `every_n_days:3` · `monthly:15` ·
  //                    `monthly:last` · `rolling:3` · `rrule:FREQ=WEEKLY;…`.
  //   deload_override  on an OCCURRENCE — "take this one easy". Renders light
  //                    regardless of the programme's deload cadence AND consumes no
  //                    rung on the cycle ladder. NULL = follow the programme.
  //   spec_version     on the ROUTINE — the document revision, bumped on every spec
  //                    write and stamped into each prescription as `sv`, so a frozen
  //                    snapshot can be traced back to the rules that produced it
  //                    (routine_revisions).
  { name: 'cadence_rule',    shape: 'string',  client: true,  cap: 200 },
  { name: 'deload_override', shape: 'number',  client: true,  num: true },
  { name: 'spec_version',    shape: 'number',  client: false },
  // ── The skip list (migration 12) ───────────────────────────────────────────
  //   cadence_skips  on the ROUTINE — the dates the cadence calls for and the user
  //                  has struck out. A CSV of occurrence REF SUFFIXES: the part of
  //                  an occurrence's ext_ref after `routine:<id>:`, so a dated one
  //                  is `YYYY-MM-DD` and a float is `<weekStart>#<index>`. Written
  //                  by DELETE /api/items/<occurrence> and cleared by re-planning
  //                  the cell; plannedOccurrences() filters the horizon through it.
  //                  Client-writable so the board can un-skip in the same PATCH
  //                  vocabulary it commits days with — validated at the door
  //                  (schema.js looksLikeCadenceSkips) exactly like cadence_days,
  //                  and for the same reason: it steers the mint.
  { name: 'cadence_skips',   shape: 'string',  client: true,  cap: 4000 },
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

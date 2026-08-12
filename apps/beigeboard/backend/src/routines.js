'use strict';
/*
 * routines.js — the cadence engine.
 *
 * A ROUTINE (kind:'routine') is a commitment: "lift three times a week, Mon/Wed/Fri
 * at 07:00". It is one row, and it holds only the PATTERN (cadence_days +
 * cadence_count — see item-fields.js). It is never itself scheduled, never appears
 * on a day, and is never checked off.
 *
 * Its OCCURRENCES are ordinary `kind:'task'` rows minted under it (parent_id = the
 * routine's id). That is the whole design decision, and it is worth stating plainly
 * because the alternative is the obvious one:
 *
 *   The rejected alternative was PROJECTION — store the pattern only, and expand it
 *   into synthetic items at read time. It is tidier in the database and it costs a
 *   projector in every consumer: BeigeBoard's four views, ORDECK's two widgets, the
 *   weave `items` dataset, any peer app, and every write path (a synthetic item has
 *   no id to PATCH, so dragging one occurrence needs a materialise-on-write rule
 *   anyway). MATERIALISATION pays a bounded number of rows and buys the property
 *   that nothing downstream has to know routines exist. A minted occurrence is a
 *   task: it drags, reschedules, completes, inherits accent, rolls up into its
 *   goal, syncs, and appears in every surface with zero new code.
 *
 * The cost of that choice is that rows are FACTS, not a live view of the pattern —
 * so the two rules below are what keep the facts honest.
 *
 *   RULE 1 — NEVER MINT INTO THE PAST. An occurrence is minted only for a date >=
 *   the later of today and the routine's own creation date. Creating a "Mon/Wed/Fri"
 *   routine on a Friday must not conjure Monday and Wednesday tasks that are already
 *   overdue; the user did not miss them, they did not exist. This is why a routine
 *   started mid-week shows its first cells empty on the board rather than red.
 *
 *   RULE 2 — EDITING THE PATTERN REWRITES ONLY THE UNTOUCHED FUTURE. When the
 *   cadence changes, occurrences that no longer match it are withdrawn, and an edit
 *   to the routine itself (rename, retime) is pushed onto the ones that remain —
 *   but both only for rows that are in the future and still ENGINE-OWNED (see
 *   `isEngineOwned`: not completed, not moved off their minted date). A completed
 *   occurrence is a record of something you did and a moved one is a decision you
 *   made; neither is the engine's to rewrite because the schedule changed later.
 *   Past and today stay put, always.
 *
 * The mint is idempotent and safe to run on every read: identity is the ext_ref
 * `routine:<routineId>:<key>`, unique-indexed per user (migration 9), and inserts
 * are INSERT OR IGNORE so a concurrent duplicate is dropped by the database rather
 * than raced for in JS.
 */
const { db, run, all, get } = require('./db');

/* How far ahead occurrences exist. Two weeks: enough that the board's "this week /
   next week" always shows real, draggable rows, and short enough that a routine
   edited today has only ~14 rows of future to reconcile. Rows grow as
   O(routines × cadence × 2 weeks), which is the bounded cost the design pays. */
const HORIZON_WEEKS = 2;

/* ── Date helpers (UTC-anchored, matching @jkos/cards' isoDate/addDays) ───── */

const iso = (d) => d.toISOString().slice(0, 10);
const parseISO = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/* The Monday on or before `s`. The suite's week starts Monday everywhere (the
   frontend's weekStart() in @jkos/cards, its DOW row, the week bench's week_start
   column), and cadence_days are offsets from THIS day. */
function weekStart(s) {
  const d = parseISO(s);
  const dow = d.getUTCDay();             // 0=Sun … 6=Sat
  const back = dow === 0 ? 6 : dow - 1;  // Sunday belongs to the week that just ended
  return addDays(s, -back);
}

/* ── Reading a routine's pattern ──────────────────────────────────────────── */

/** The committed day offsets, cleaned. Validation happens at the write door
 *  (schema.js looksLikeCadenceDays); this is the belt-and-braces read so a row
 *  written before that guard existed, or edited straight in SQLite, can't drive
 *  the mint loop out of range. */
function cadenceDays(routine) {
  const raw = String(routine.cadence_days || '').trim();
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(',')) {
    const n = parseInt(part, 10);
    if (!Number.isInteger(n) || n < 0 || n > 6 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** How many FLOAT occurrences a week carries — the surplus of the weekly target
 *  over the committed days. "3× a week" with Mon+Wed committed = 1 float, which
 *  lands on the week bench for the user to place. */
function floatCount(routine) {
  const days = cadenceDays(routine).length;
  const target = routine.cadence_count;
  if (target == null || !Number.isFinite(target)) return 0;
  return Math.max(0, Math.trunc(target) - days);
}

/** The weekly target a routine is measured against — explicit count, else the
 *  number of days it committed to. Zero means the routine asks for nothing. */
function weeklyTarget(routine) {
  const days = cadenceDays(routine).length;
  const target = routine.cadence_count;
  if (target == null || !Number.isFinite(target)) return days;
  return Math.max(0, Math.trunc(target));
}

/* ── Occurrence identity ──────────────────────────────────────────────────── */

/* A dated occurrence is keyed by its date; a float is keyed by its week plus an
   ordinal, because floats within one week are interchangeable and only their COUNT
   is meaningful. Both go in ext_ref, which is unique-indexed per user. */
const dayRef   = (routineId, date)      => `routine:${routineId}:${date}`;
const floatRef = (routineId, wkStart, i) => `routine:${routineId}:${wkStart}#${i}`;

/** The date the engine minted an occurrence ON, read back out of its ext_ref —
 *  null for a float, which never had one. The ref is the mint's own record, so
 *  comparing the row's CURRENT due_date against it is how "has the user moved
 *  this?" is answered without storing a second copy of the schedule. */
function refMintedDate(ref) {
  const rest = String(ref || '').split(':').slice(2).join(':');
  if (!rest || rest.includes('#')) return null;            // float, or malformed
  return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? rest : null;
}

/** Is this occurrence still the engine's to move? Only such a row may be
 *  withdrawn by a pattern change or rewritten by an edit to the routine (RULE 2).
 *
 *  Two conditions, both about what the USER did — never about what the routine
 *  currently says. Completing it makes it a record of something done; moving it
 *  off its minted date makes it a decision taken. Either hands the row over
 *  permanently. Title is deliberately NOT part of this test: the engine keeps
 *  future untouched occurrences named after their routine, so comparing titles
 *  would read every rename of the ROUTINE as a user edit of every OCCURRENCE and
 *  freeze the whole future. */
function isEngineOwned(occ) {
  if (occ.completed) return false;
  return (occ.due_date || null) === refMintedDate(occ.ext_ref);
}

/* ── The mint ─────────────────────────────────────────────────────────────── */

/** The (date, ext_ref) pairs a routine SHOULD have across the horizon, given today.
 *  Pure — no DB — so the rules above are testable without a database. */
function plannedOccurrences(routine, today) {
  const out = [];
  const days = cadenceDays(routine);
  const floats = floatCount(routine);
  // RULE 1: a routine never reaches back before the day it was created.
  const born = String(routine.created_at || '').slice(0, 10);
  const floor = born && born > today ? born : today;

  let wk = weekStart(today);
  for (let w = 0; w < HORIZON_WEEKS; w++) {
    for (const off of days) {
      const date = addDays(wk, off);
      if (date < floor) continue;                    // RULE 1
      out.push({ ref: dayRef(routine.id, date), date, week: wk });
    }
    for (let i = 0; i < floats; i++) {
      // Floats have no date — they sit on the week bench (week_start, no due_date),
      // which is exactly the shape WeekView's bench lane already renders and
      // accepts drops from. A past week's unplaced float is not minted.
      if (addDays(wk, 6) < floor) continue;
      out.push({ ref: floatRef(routine.id, wk, i), date: null, week: wk });
    }
    wk = addDays(wk, 7);
  }
  return out;
}

/** Mint the missing occurrences for one routine and withdraw the stale ones.
 *  Returns { minted, withdrawn } for the tests and the smoke. */
function reconcileRoutine(routine, userId, today) {
  if ((routine.status || 'active') !== 'active') {
    // A parked routine stops producing. Its untouched future is withdrawn so
    // pausing actually clears the board ahead; its past and its real work stay.
    return { minted: 0, withdrawn: withdrawStale(routine, userId, today, new Map()) };
  }

  const planned = plannedOccurrences(routine, today);
  const byRef = new Map(planned.map((p) => [p.ref, p]));
  const withdrawn = withdrawStale(routine, userId, today, byRef);
  propagate(routine, userId, today);

  const existing = new Set(
    all('SELECT ext_ref FROM items WHERE user_id = ? AND parent_id = ? AND ext_ref IS NOT NULL',
        [userId, routine.id]).map((r) => r.ext_ref),
  );

  let minted = 0;
  for (const p of planned) {
    if (existing.has(p.ref)) continue;
    /* INSERT OR IGNORE, not a check-then-insert: this runs on every unfiltered
       GET, so two concurrent requests can both see the row missing. The unique
       index on (user_id, ext_ref) decides, and the loser writes nothing. */
    const r = run(
      `INSERT OR IGNORE INTO items
         (user_id, kind, scope, parent_id, title, notes, accent, source,
          completed, due_date, week_start, scheduled_time, scheduled_end, ext_ref)
       VALUES (?, 'task', 'day', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        userId, routine.id, routine.title, routine.notes ?? null,
        routine.accent ?? null, routine.source || 'bb',
        p.date, p.week, routine.scheduled_time ?? null, routine.scheduled_end ?? null,
        p.ref,
      ],
    );
    minted += r.changes;
  }
  return { minted, withdrawn };
}

/** Occurrences of a routine, with just the columns the two reconcile passes read. */
const occurrencesOf = (routineId, userId) => all(
  `SELECT id, ext_ref, title, notes, accent, completed, due_date, week_start,
          scheduled_time, scheduled_end
     FROM items
    WHERE user_id = ? AND parent_id = ? AND ext_ref LIKE 'routine:%'`,
  [userId, routineId],
);

/* Future only — today itself is never rewritten or withdrawn, because the day is
   already in progress and may already be on screen. A dated occurrence is future
   when its date is after today; an undated float belongs to its week, and that
   week is future only when it hasn't started. */
const isFutureOccurrence = (row, today) => (
  row.due_date ? row.due_date > today : (row.week_start || '') > today
);

/** Withdraw occurrences the pattern no longer calls for (RULE 2). `keep` is the
 *  planned map; anything not in it, in the future, and still engine-owned, goes. */
function withdrawStale(routine, userId, today, keep) {
  let n = 0;
  for (const row of occurrencesOf(routine.id, userId)) {
    if (keep.has(row.ext_ref)) continue;
    if (!isFutureOccurrence(row, today)) continue;
    if (!isEngineOwned(row)) continue;
    run('DELETE FROM items WHERE id = ? AND user_id = ?', [row.id, userId]);
    n++;
  }
  return n;
}

/** Push an edit of the ROUTINE (rename, retime, recolour) onto the future
 *  occurrences it still owns, so "move gym to 07:30" doesn't leave next week
 *  sitting at 07:00 with the same name.
 *
 *  This is the other half of isEngineOwned: the engine writes only rows the user
 *  hasn't claimed, so a renamed or moved occurrence keeps whatever the user made
 *  it. Past and today are never rewritten — history is a record. */
function propagate(routine, userId, today) {
  for (const row of occurrencesOf(routine.id, userId)) {
    if (!isFutureOccurrence(row, today)) continue;
    if (!isEngineOwned(row)) continue;
    const same = row.title === routine.title
      && (row.notes ?? null) === (routine.notes ?? null)
      && (row.accent ?? null) === (routine.accent ?? null)
      && (row.scheduled_time ?? null) === (routine.scheduled_time ?? null)
      && (row.scheduled_end ?? null) === (routine.scheduled_end ?? null);
    if (same) continue;   // don't touch updated_at for nothing — peers poll on it
    run(
      `UPDATE items SET title = ?, notes = ?, accent = ?, scheduled_time = ?, scheduled_end = ?
        WHERE id = ? AND user_id = ?`,
      [
        routine.title, routine.notes ?? null, routine.accent ?? null,
        routine.scheduled_time ?? null, routine.scheduled_end ?? null,
        row.id, userId,
      ],
    );
  }
}

/** Reconcile EVERY routine a user owns. Cheap when there are none (one indexed
 *  SELECT), which is the common case, so callers don't need to guard it. */
const materializeRoutines = db.transaction((userId, today) => {
  const routines = all('SELECT * FROM items WHERE user_id = ? AND kind = ?', [userId, 'routine']);
  let minted = 0, withdrawn = 0;
  for (const r of routines) {
    const res = reconcileRoutine(r, userId, today);
    minted += res.minted;
    withdrawn += res.withdrawn;
  }
  return { routines: routines.length, minted, withdrawn };
});

/** Reconcile one routine by id, for the write paths (POST/PATCH) so the board
 *  reflects an edit on the very next read instead of one round-trip later. */
function materializeOne(routineId, userId, today) {
  const r = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [routineId, userId, 'routine']);
  if (!r) return { minted: 0, withdrawn: 0 };
  return db.transaction(() => reconcileRoutine(r, userId, today))();
}

module.exports = {
  materializeRoutines, materializeOne,
  // exported for the tests + the frontend's mirror of the same rules
  plannedOccurrences, cadenceDays, floatCount, weeklyTarget, weekStart, addDays,
  HORIZON_WEEKS,
};

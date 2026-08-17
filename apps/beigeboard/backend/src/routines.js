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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND HALF (migration 10): WHAT the session is, and how it gets HARDER.
 *
 * Everything above is about WHEN. On its own it made a routine a repeating task:
 * fourteen rows all named "Push Day", with nowhere to say what a push day is. A
 * routine now also carries a `spec` — a document of steps and PROGRESSION RULES
 * (src/routine-spec.js) — and this engine gained a second job:
 *
 *     AT MINT, EVALUATE EVERY RULE AT THIS OCCURRENCE'S CYCLE INDEX AND WRITE THE
 *     RESULTING CONCRETE NUMBERS INTO THE OCCURRENCE'S `prescription`.
 *
 * That is the same bet as materialisation, one level down. The rejected alternative
 * was again projection — store rules only, render in every consumer — and it fails
 * for a sharper reason here than it did for occurrences: a rendered prescription is
 * a RECORD OF WHAT YOU WERE TOLD TO DO. Last Tuesday has to keep saying 95 lb after
 * the rule has moved on to 105, or the log of what you did is measured against a
 * plan that no longer exists. Rules render forward; facts stay put.
 *
 * WHAT A CYCLE INDEX IS (`cycleLadder` below). Cycle 0 is the first session,
 * cycle 1 the second. The subtle part is what counts as a session, and the default
 * is DELIBERATELY NOT ELAPSED TIME: a cycle is one you DID. Missing a week must not
 * silently march your squat up 15 lb while you were ill, so a past occurrence that
 * was never ticked drops out of the ladder entirely and the ones after it keep
 * their place. `advance_on: 'calendar'` opts into the other reading, for the
 * routines where the date genuinely is the driver (a taper, a medication ramp, a
 * syllabus) — there a cycle is a WEEK, so every session in one week renders alike.
 *
 * RULE 3 — THE FUTURE IS A PROJECTION, THE PAST IS A RECORD. A future occurrence
 * the engine still owns is RE-RENDERED on every reconcile, because the ladder moves
 * under it every time you complete or miss a session. Today's is not: the day is
 * already in progress and may already be on screen, and a prescription that changed
 * mid-session would be worse than one that is slightly stale. Past ones are never
 * touched. This is the same past/today/future boundary RULE 2 already draws, which
 * is why it needs no new predicate — `isFutureOccurrence` and `isEngineOwned`
 * decide this exactly as they decide the rest.
 */
const { db, run, all, get } = require('./db');
const {
  normalizeSpec, renderCycle, normalizePerformed, stepWasMet,
  parseCadence, expandCadence, summarize,
} = require('./routine-spec');
const { resolverFor } = require('./library');

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

/** Whole weeks from `a` to `b`, both ISO Mondays. The period unit for
 *  `advance_on: 'calendar'` — a week, because the cadence itself is weekly, so any
 *  other period would make "cycle 3" mean something different from "week 3" and
 *  nobody would be able to read a phase table against a calendar. */
const weeksBetween = (a, b) => Math.round(
  (parseISO(b).getTime() - parseISO(a).getTime()) / (7 * 86400000),
);

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
  const days = cadenceDays(routine);
  const floats = floatCount(routine);
  /* RULE 1: a routine never reaches back before the day it was created.
   *
   * The two dates are in DIFFERENT FRAMES and the slack below is what reconciles
   * them. `created_at` is stamped by SQLite's datetime('now') — UTC. `today` is the
   * caller's LOCAL date, off the X-BB-Today header (see routes/items.js on why it
   * is a header). At 19:00 in Chicago the UTC date has already rolled over, so a
   * routine created that evening was `born` TOMORROW as far as this comparison is
   * concerned — and the floor then skipped the user's own next day, silently, for
   * everyone west of UTC. One day of slack absorbs exactly that skew, which is the
   * largest it can ever be.
   *
   * The floor is kept rather than dropped because it is also the guard on a
   * CLIENT-SUPPLIED value: `today` arrives in a header, so without a floor a stale
   * tab or a wrong clock could ask the engine to mint a year of occurrences into
   * the past. Pulled back a day, it still refuses that and stops fighting the
   * timezone. */
  const born = String(routine.created_at || '').slice(0, 10);
  const bornFloor = born ? addDays(born, -1) : '';
  const floor = bornFloor && bornFloor > today ? bornFloor : today;

  /* THE DATE MATHS LIVES IN routine-spec.js, not here.
   *
   * Every cadence mode — the weekly grid, `every_n_days`, `monthly`, `rolling`, the
   * RRULE subset — is expanded by one pure function over a window, so this keeps
   * only the parts that need the database: RULE 1's floor, the horizon, and the
   * ext_ref identity. That split is what lets the forge preview an UNSAVED cadence
   * (it calls the same expander in the browser) and what lets `pnpm check:routine`
   * drive the schedule maths exhaustively without a server. */
  const cadence = parseCadence(routine.cadence_rule);
  const to = addDays(weekStart(today), HORIZON_WEEKS * 7 - 1);
  const anchor = born || today;

  return expandCadence(cadence, { from: floor, to, anchor, days, floats })
    .map((p) => ({
      ref: p.float ? floatRef(routine.id, p.week, p.index) : dayRef(routine.id, p.date),
      date: p.date,
      week: p.week,
    }));
}

/* ── The cycle ladder ─────────────────────────────────────────────────────────
 *
 * Which cycle each occurrence — existing, or about to be minted — renders at. See
 * the header for why the default counts sessions DONE rather than time elapsed.
 * Kept pure apart from the rows handed in, so the whole progression story is
 * testable without a database. */

/** The date an occurrence is ordered BY. A dated occurrence sorts on its date; an
 *  undated float belongs to its week and sorts at the END of it, because a float is
 *  "sometime this week" and the honest assumption is that the days you committed to
 *  happen first and the spare one gets fitted in around them. */
const orderDate = (o) => o.due_date || (o.week_start ? addDays(o.week_start, 6) : '9999-12-31');

/**
 * @param {object} routine
 * @param {object} spec      the routine's NORMALISED spec
 * @param {Array}  existing  the occurrence rows that survived withdrawal
 * @param {Array}  planned   plannedOccurrences() output — includes not-yet-minted
 * @param {string} today
 * @returns {Map<string, {cycle:number, earned:object}>} keyed by ext_ref
 */
function cycleLadder(routine, spec, existing, planned, today) {
  const out = new Map();

  /* Everything that exists or is about to, de-duplicated by ext_ref — a planned
     entry whose row already exists is the same rung, not a second one. */
  const byRef = new Map();
  for (const o of existing) byRef.set(o.ext_ref, o);
  for (const p of planned) {
    if (byRef.has(p.ref)) continue;
    byRef.set(p.ref, {
      ext_ref: p.ref, due_date: p.date, week_start: p.week,
      completed: 0, performed: null, deload_override: null, id: Number.MAX_SAFE_INTEGER,
    });
  }

  /* CALENDAR MODE — a cycle is a week since the routine started, so every session
     in one week renders alike. Nothing about what was or wasn't done enters into
     it, which is the entire point of opting in: a taper is a taper whether or not
     you kept up with it. */
  if (spec.advance_on === 'calendar') {
    const born = String(routine.created_at || today).slice(0, 10);
    const anchor = weekStart(born);
    for (const [ref, o] of byRef) {
      out.set(ref, { cycle: Math.max(0, weeksBetween(anchor, weekStart(orderDate(o)))), earned: {} });
    }
    return out;
  }

  /* COMPLETION MODE — the ladder is the sessions that count: the ones you did,
     plus the ones still ahead of you. A past occurrence that was never ticked is
     omitted, so it consumes no rung and nothing after it advances past work that
     never happened. */
  const rungs = [...byRef.values()]
    .filter((o) => o.completed || orderDate(o) >= today)
    .sort((a, b) => String(orderDate(a)).localeCompare(String(orderDate(b))) || (a.id - b.id));

  /* `earned` is the autoregulation tally, accumulated as we walk: how many times,
     BEFORE this rung, the user actually hit the top of a step's range. Snapshotted
     per rung rather than recomputed per step later, because a step's answer depends
     on every session before it and on nothing after it.
     SEEDED AT ZERO FOR EVERY STEP, not left sparse: progressionAt reads a MISSING
     tally as "no history at all" and falls back to the plain cycle, so a step that
     has genuinely earned nothing would otherwise advance exactly as if it were not
     autoregulated — silently turning the one progression type that holds you back
     into the one that never does. Zero has to be a value, not an absence. */
  const earned = {};
  for (const s of spec.steps) earned[s.key] = 0;
  let cycle = 0;
  for (const o of rungs) {
    out.set(o.ext_ref, { cycle, earned: { ...earned }, deload: o.deload_override === 1 });
    /* A DELOAD SPENDS NO RUNG. "Take this one easy" that still advanced the ladder
       would be a contradiction — you would come back from an easy session to
       heavier numbers than you left. So a deloaded occurrence renders at the
       current cycle and the NEXT one renders at the same cycle, which is exactly
       what "repeat this week lighter, then carry on" means. It earns nothing
       either, for the same reason. */
    if (o.deload_override === 1) continue;
    cycle++;
    if (!o.completed) continue;
    const perf = normalizePerformed(o.performed);
    for (const s of spec.steps) {
      if (stepWasMet(perf, s.key)) earned[s.key] = (earned[s.key] || 0) + 1;
    }
  }
  return out;
}

/** The prescription JSON for one rung, or null when the routine carries no
 *  document — a bare cadence routine writes nothing and behaves exactly as it did
 *  before migration 10, which is what makes the whole primitive additive. */
function prescriptionFor(spec, rung, routine) {
  if (!spec.steps.length || !rung) return null;
  return JSON.stringify(renderCycle(spec, rung.cycle, {
    earned: rung.earned,
    // undefined (not false) when there is no override, so the programme's own
    // deload cadence decides — see renderCycle's three-state `ctx.deload`.
    deload: rung.deload ? true : undefined,
    spec_version: routine?.spec_version ?? null,
  }));
}

/** Mint the missing occurrences for one routine and withdraw the stale ones.
 *  Returns { minted, withdrawn } for the tests and the smoke. */
function reconcileRoutine(routine, userId, today, resolve) {
  if ((routine.status || 'active') !== 'active') {
    // A parked routine stops producing. Its untouched future is withdrawn so
    // pausing actually clears the board ahead; its past and its real work stay.
    return { minted: 0, withdrawn: withdrawStale(routine, userId, today, new Map()), updated: 0 };
  }

  const planned = plannedOccurrences(routine, today);
  const byRef = new Map(planned.map((p) => [p.ref, p]));
  const withdrawn = withdrawStale(routine, userId, today, byRef);

  /* Normalised ONCE per reconcile and threaded through both passes below. The
     library resolver it closes over reads the whole library in one query, so a
     40-step document costs one SELECT and not forty — this runs on every
     unfiltered GET, so that difference is the difference between free and not. */
  const { spec } = normalizeSpec(routine.spec, { resolve });
  const surviving = occurrencesOf(routine.id, userId);
  const ladder = cycleLadder(routine, spec, surviving, planned, today);

  const updated = propagate(routine, userId, today, spec, ladder, surviving);

  const existing = new Set(surviving.map((r) => r.ext_ref));

  let minted = 0;
  for (const p of planned) {
    if (existing.has(p.ref)) continue;
    const rung = ladder.get(p.ref);
    /* INSERT OR IGNORE, not a check-then-insert: this runs on every unfiltered
       GET, so two concurrent requests can both see the row missing. The unique
       index on (user_id, ext_ref) decides, and the loser writes nothing. */
    const r = run(
      `INSERT OR IGNORE INTO items
         (user_id, kind, scope, parent_id, title, notes, accent, source,
          completed, due_date, week_start, scheduled_time, scheduled_end, ext_ref,
          cycle_index, prescription)
       VALUES (?, 'task', 'day', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, routine.id, routine.title, routine.notes ?? null,
        routine.accent ?? null, routine.source || 'bb',
        p.date, p.week, routine.scheduled_time ?? null, routine.scheduled_end ?? null,
        p.ref,
        rung ? rung.cycle : null, prescriptionFor(spec, rung, routine),
      ],
    );
    minted += r.changes;
  }
  return { minted, withdrawn, updated };
}

/** Occurrences of a routine, with just the columns the two reconcile passes read. */
const occurrencesOf = (routineId, userId) => all(
  `SELECT id, ext_ref, title, notes, accent, completed, due_date, week_start,
          scheduled_time, scheduled_end, cycle_index, prescription, performed,
          deload_override
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
 *  sitting at 07:00 with the same name — and RE-RENDER their prescriptions, so
 *  "tick today's session" makes tomorrow's numbers go up immediately (RULE 3).
 *
 *  This is the other half of isEngineOwned: the engine writes only rows the user
 *  hasn't claimed, so a renamed or moved occurrence keeps whatever the user made
 *  it. Past and today are never rewritten — history is a record, and today is a
 *  day already in progress. */
function propagate(routine, userId, today, spec, ladder, rows) {
  let updated = 0;
  for (const row of rows || occurrencesOf(routine.id, userId)) {
    if (!isFutureOccurrence(row, today)) continue;
    if (!isEngineOwned(row)) continue;

    /* The re-render. The ladder moves under a future occurrence every time a
       session is completed or missed, so its cycle — and therefore every number in
       its prescription — is a projection that has to be recomputed, not a value
       written once at mint. */
    const rung = ladder ? ladder.get(row.ext_ref) : null;
    const cycle = rung ? rung.cycle : null;
    const prescription = prescriptionFor(spec, rung, routine);

    const same = row.title === routine.title
      && (row.notes ?? null) === (routine.notes ?? null)
      && (row.accent ?? null) === (routine.accent ?? null)
      && (row.scheduled_time ?? null) === (routine.scheduled_time ?? null)
      && (row.scheduled_end ?? null) === (routine.scheduled_end ?? null)
      && (row.cycle_index ?? null) === cycle
      && (row.prescription ?? null) === prescription;
    if (same) continue;   // don't touch updated_at for nothing — peers poll on it
    run(
      `UPDATE items SET title = ?, notes = ?, accent = ?, scheduled_time = ?, scheduled_end = ?,
                        cycle_index = ?, prescription = ?
        WHERE id = ? AND user_id = ?`,
      [
        routine.title, routine.notes ?? null, routine.accent ?? null,
        routine.scheduled_time ?? null, routine.scheduled_end ?? null,
        cycle, prescription,
        row.id, userId,
      ],
    );
    updated++;
  }
  return updated;
}

/** Reconcile EVERY routine a user owns. Cheap when there are none (one indexed
 *  SELECT), which is the common case, so callers don't need to guard it. */
const materializeRoutines = db.transaction((userId, today) => {
  const routines = all('SELECT * FROM items WHERE user_id = ? AND kind = ?', [userId, 'routine']);
  if (!routines.length) return { routines: 0, minted: 0, withdrawn: 0, updated: 0 };
  /* ONE resolver for the whole pass — it lazily loads the user's library once and
     every routine's normalise shares it, so N routines cost one library read. */
  const resolve = resolverFor(userId);
  let minted = 0, withdrawn = 0, updated = 0;
  for (const r of routines) {
    const res = reconcileRoutine(r, userId, today, resolve);
    minted += res.minted;
    withdrawn += res.withdrawn;
    updated += res.updated;
  }
  return { routines: routines.length, minted, withdrawn, updated };
});

/** Reconcile one routine by id, for the write paths (POST/PATCH) so the board
 *  reflects an edit on the very next read instead of one round-trip later. */
function materializeOne(routineId, userId, today) {
  const r = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [routineId, userId, 'routine']);
  if (!r) return { minted: 0, withdrawn: 0 };
  return db.transaction(() => reconcileRoutine(r, userId, today, resolverFor(userId)))();
}

/**
 * DELOAD ON DEMAND — set one occurrence's override and make it take effect now.
 *
 * Two writes that only mean something together, which is why they are one function
 * and not a PATCH the client follows with a reload:
 *
 *   1. the override lands, and the routine reconciles — a deloaded session spends
 *      NO RUNG on the cycle ladder, so every session after it shifts back one and
 *      re-renders. Taking it easy must not cost a session's worth of progress.
 *   2. THIS occurrence is re-rendered explicitly, because `propagate` refuses to
 *      rewrite today (RULE 3 — a day in progress must not change under you) and
 *      today's session is precisely the one being deloaded. Rather than loosen that
 *      rule for everything, the one rewrite the user explicitly asked for is done
 *      here, by name.
 *
 * THE PAST IS STILL REFUSED. You cannot retroactively make last Tuesday easy; that
 * is not a deload, it is editing the record of what you were asked to do.
 *
 * The ownership test here is deliberately NOT `isEngineOwned`: a session you dragged
 * to Wednesday is still a session you can take easy, even though moving it handed
 * the SCHEDULE to you. Only completion disqualifies it — you cannot deload something
 * you have already done.
 */
const setDeloadOverride = db.transaction((occId, userId, today, value) => {
  const row = get('SELECT * FROM items WHERE id = ? AND user_id = ?', [occId, userId]);
  if (!row || !String(row.ext_ref || '').startsWith('routine:')) return { ok: false, error: 'not a routine occurrence' };
  if (row.completed) return { ok: false, error: 'that session is already done' };
  const when = row.due_date || row.week_start || '';
  if (when && when < today) return { ok: false, error: 'the past is a record — it cannot be deloaded' };

  run('UPDATE items SET deload_override = ? WHERE id = ? AND user_id = ?', [value, occId, userId]);

  const routine = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?',
    [row.parent_id, userId, 'routine']);
  if (!routine) return { ok: true, row: get('SELECT * FROM items WHERE id = ?', [occId]) };

  const resolve = resolverFor(userId);
  reconcileRoutine(routine, userId, today, resolve);

  const { spec } = normalizeSpec(routine.spec, { resolve });
  const surviving = occurrencesOf(routine.id, userId);
  const ladder = cycleLadder(routine, spec, surviving, plannedOccurrences(routine, today), today);
  const fresh = surviving.find((o) => o.id === occId);
  if (fresh) {
    const rung = ladder.get(fresh.ext_ref);
    run('UPDATE items SET cycle_index = ?, prescription = ? WHERE id = ? AND user_id = ?',
      [rung ? rung.cycle : null, prescriptionFor(spec, rung, routine), occId, userId]);
  }
  return { ok: true, row: get('SELECT * FROM items WHERE id = ? AND user_id = ?', [occId, userId]) };
});

/* ══════════════════════════════════════════════════════════════════════════════
   REVISIONS — the history that makes a frozen snapshot legible

   An occurrence's prescription is deliberately frozen, so March keeps saying 5 × 5.
   What it could not say was WHY: the rule that produced it is long overwritten, and
   a number with no reachable reason is not much better than no number. Every spec
   write appends the OUTGOING document here and bumps `spec_version`, which each
   subsequent prescription stamps as `sv` — so `prescription.sv` →
   `routine_revisions.version` closes the loop.

   Called from the write paths rather than from the reconcile: a revision marks an
   AUTHORING EVENT, and the reconcile runs on every read.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Record the routine's CURRENT spec as a revision and return the next version
 *  number. Call BEFORE writing the new spec — what is archived is what is being
 *  replaced, so version N is "the document the sessions stamped `sv: N` followed".
 *
 *  A no-op when the document has not actually changed: an edit that only renames
 *  the routine, or a re-import of an identical document, must not manufacture
 *  history nobody made. */
const recordRevision = db.transaction((routine, userId, nextSpecText, note) => {
  const current = routine.spec ?? null;
  const version = routine.spec_version ?? 1;
  if (String(current ?? '') === String(nextSpecText ?? '')) return version;

  if (current !== null && current !== '') {
    const { spec } = normalizeSpec(current);
    run(
      `INSERT OR IGNORE INTO routine_revisions (user_id, routine_id, version, spec, summary, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, routine.id, version, current, summarizeSafe(spec), note ?? null],
    );
  }
  const next = version + 1;
  run('UPDATE items SET spec_version = ? WHERE id = ? AND user_id = ?', [next, routine.id, userId]);
  return next;
});

/* summarize() is display code and must never be the reason an archive write fails. */
function summarizeSafe(spec) {
  try { return summarize(spec); } catch { return null; }
}

/** The revisions of one routine, newest first, with the CURRENT document at the
 *  head so a reader sees one list rather than "history, plus the thing it is
 *  history of, somewhere else". */
function revisionsOf(routineId, userId) {
  const routine = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?',
    [routineId, userId, 'routine']);
  if (!routine) return null;
  const past = all(
    `SELECT version, spec, summary, note, created_at FROM routine_revisions
      WHERE user_id = ? AND routine_id = ? ORDER BY version DESC`,
    [userId, routineId],
  );
  const { spec } = normalizeSpec(routine.spec);
  return [
    {
      version: routine.spec_version ?? 1,
      current: true,
      summary: summarizeSafe(spec),
      note: null,
      created_at: routine.updated_at || routine.created_at,
      spec: routine.spec,
    },
    ...past.map((r) => ({ ...r, current: false })),
  ];
}

/** Reconcile the routine an OCCURRENCE belongs to, if it belongs to one.
 *
 *  This is what makes progression feel like a live system rather than a batch job:
 *  ticking today's session is exactly the event that moves the ladder, so the rows
 *  ahead of it are re-rendered on that same request and tomorrow's numbers are
 *  already right when the board re-reads. Without it the user would tick a session,
 *  see nothing change, and only get the new numbers on some later unrelated load.
 *
 *  A no-op (one indexed lookup) for any row that isn't an occurrence, which is
 *  almost every row — so the PATCH route can call it unconditionally. */
function materializeForOccurrence(row, userId, today) {
  const ref = String(row?.ext_ref || '');
  if (!ref.startsWith('routine:') || row.parent_id == null) return { minted: 0, withdrawn: 0 };
  return materializeOne(row.parent_id, userId, today);
}

module.exports = {
  materializeRoutines, materializeOne, materializeForOccurrence,
  recordRevision, revisionsOf, setDeloadOverride,
  // exported for the tests + the frontend's mirror of the same rules
  plannedOccurrences, cadenceDays, floatCount, weeklyTarget, weekStart, addDays,
  cycleLadder, prescriptionFor, orderDate, weeksBetween, isEngineOwned,
  HORIZON_WEEKS,
};

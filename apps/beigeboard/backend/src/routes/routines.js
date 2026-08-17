'use strict';
/*
 * routes/routines.js — the routine document's own surface, and the library it
 * draws from.
 *
 * Everything a routine NEEDS already works through /api/items: a routine is an
 * item, its occurrences are items, and `spec` is a column on the first. This file
 * exists for the three things that are awkward or impossible through that door,
 * and each is here because of the same requirement — that a not-especially-good
 * author, human or machine, can produce a decent routine:
 *
 *   1. THE PREVIEW (`GET /routines/:id/preview`). A spec is a set of rules; what a
 *      person wants to see is the next eight sessions as numbers. Rendering them
 *      is pure (routine-spec.js), but it has to be rendered SOMEWHERE, and the
 *      server is the only place that can answer "what does week 6 look like" for a
 *      routine you have not opened. It is also the single best repair tool for an
 *      AI author: write a document, look at cycle 12, notice the squat is at 400 lb.
 *
 *   2. THE ROUND TRIP (`GET /routines/:id` → `POST /routines/import`). One document
 *      out, the same document back in, upserted by slug. Round-tripping is what
 *      lets an agent EDIT a routine rather than only create one, and idempotency by
 *      slug is what makes a retry after a timeout safe rather than duplicating.
 *
 *   3. THE VOCABULARY (`GET /routines/vocabulary`). Every closed list, every limit,
 *      and a worked example, served from the same constants the validator enforces.
 *      An agent that reads this before authoring cannot invent a progression type
 *      that does not exist — and because it is DERIVED from routine-spec.js rather
 *      than written out here, it cannot drift from what is actually accepted.
 *
 * The library (`/library`) is the vocabulary of SUB-TASKS: exercises for training,
 * recipes for cooking, pieces for practice. See src/library.js for why it is its
 * own table and not a fifth item kind.
 */
const express = require('express');
const { all, get, run } = require('../db');
const { ITEM_COLUMNS, coerceColumn, validateItemWrite, looksLikeDate } = require('../schema');
const { validParentId } = require('../items-store');
const lib = require('../library');
const spec = require('../routine-spec');
const { materializeOne, recordRevision, revisionsOf, setDeloadOverride, HORIZON_WEEKS } = require('../routines');
const { toRow, fail } = require('../util');

const router = express.Router();

/* Day offsets are from MONDAY everywhere in the suite (see item-fields.js). Named
   as well as numbered because "0 means Monday" is the single most likely thing for
   an author to get wrong, and `days: ['mon','thu']` removes the question entirely. */
const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/* Same rule as routes/items.js: the caller's LOCAL date, because the routine engine
   mints relative to "today" and the server's UTC day is not the user's day. */
function callerToday(req) {
  const h = req.get('X-BB-Today');
  if (h && looksLikeDate(String(h))) return String(h).trim();
  return new Date().toISOString().slice(0, 10);
}

/* The starter library is seeded on first touch, the same lazy bargain the items
   seed and the routine mint already make. One COUNT when it is already there.
   Never for a guest or a service identity — a peer app reading on its own behalf
   must not have three dozen exercises conjured under its `svc:` sub. */
function ensureLibrary(req) {
  const isService = req.user?.typ === 'service' || String(req.user?.sub || '').startsWith('svc:');
  if (isService || req.user?.role === 'guest') return;
  try { lib.seedLibrary(req.user.sub); } catch (e) { console.error('[bb] seedLibrary', e?.message || e); }
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE LIBRARY
   ══════════════════════════════════════════════════════════════════════════════ */

router.get('/api/library', (req, res) => {
  try {
    ensureLibrary(req);
    const entries = lib.listEntries(req.user.sub, {
      collection: req.query.collection || null,
      q: req.query.q || null,
      limit: req.query.limit,
    });
    res.json({
      collections: spec.COLLECTIONS,
      count: entries.length,
      entries,
    });
  } catch (e) { fail(res, e); }
});

router.post('/api/library', (req, res) => {
  try {
    ensureLibrary(req);
    const r = lib.upsertEntry(req.user.sub, req.body);
    if (!r.ok) return res.status(400).json({ error: r.error, code: 'VALIDATION' });
    res.status(r.created ? 201 : 200).json(r.entry);
  } catch (e) { fail(res, e); }
});

/* Bulk — the call that teaches the app a whole domain at once (a lifting library,
   a recipe box). Upserts, so it is safe to resend. */
router.post('/api/library/import', (req, res) => {
  try {
    ensureLibrary(req);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries
      : Array.isArray(req.body) ? req.body : null;
    if (!entries) return res.status(400).json({ error: 'entries must be an array', code: 'VALIDATION' });
    if (entries.length > 1000) return res.status(400).json({ error: 'at most 1000 entries per import', code: 'VALIDATION' });
    res.json({ ok: true, ...lib.importEntries(req.user.sub, entries) });
  } catch (e) { fail(res, e); }
});

/**
 * EXPORT — the library as a document `POST /library/import` accepts back.
 *
 * The other half of a round trip that was previously one-way: import existed, so a
 * library could be taught but never carried. This makes a curated set of exercises
 * or a recipe box a FILE — moveable between accounts, checkable into a repo,
 * reviewable in a diff, and handed to an assistant as the vocabulary to write
 * against. `?collection=` narrows it; `?mine=1` drops the starter set, which is the
 * common case when what you want to share is your own work rather than everyone's
 * identical seed data.
 */
router.get('/api/library/export', (req, res) => {
  try {
    ensureLibrary(req);
    let entries = lib.listEntries(req.user.sub, {
      collection: req.query.collection || null, limit: 2000,
    });
    if (req.query.mine) entries = entries.filter((e) => e.source !== 'starter');
    res.json({
      kind: 'jkos.beigeboard.library',
      version: spec.SPEC_VERSION,
      exported_at: new Date().toISOString(),
      count: entries.length,
      // Only the authored fields — ids, timestamps and ownership are this
      // installation's business and would be noise (or worse, misleading) in a
      // document meant to be imported somewhere else.
      entries: entries.map((e) => ({
        collection: e.collection, slug: e.slug, title: e.title,
        notes: e.notes || undefined,
        unit: e.unit || undefined, load_unit: e.load_unit || undefined,
        tags: e.tags?.length ? e.tags : undefined,
        variants: e.variants?.length ? e.variants : undefined,
        defaults: Object.keys(e.defaults || {}).length ? e.defaults : undefined,
      })),
    });
  } catch (e) { fail(res, e); }
});

router.patch('/api/library/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const r = lib.patchEntry(id, req.user.sub, req.body);
    if (!r.ok) return res.status(r.error === 'not found' ? 404 : 400).json({ error: r.error });
    res.json(r.entry);
  } catch (e) { fail(res, e); }
});

router.delete('/api/library/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!lib.deleteEntry(id, req.user.sub)) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE VOCABULARY

   Served from the constants the validator uses, so what an author is TOLD is legal
   is exactly what is legal. Declared before /routines/:id because Express matches
   in order and 'vocabulary' would otherwise be parsed as an id.
   ══════════════════════════════════════════════════════════════════════════════ */

/* A worked example, not a schema dump. An agent given three real documents
   outperforms one given a field list every time, and the one thing a field list
   cannot convey is which fields to leave out — so this shows a complete routine
   that omits most of them. */
const EXAMPLE = {
  slug: 'lower-body',
  title: 'Lower Body',
  days: ['mon', 'thu'],
  time: '07:00',
  spec: {
    intent: 'Build a squat and keep the hinge honest',
    advance_on: 'completion',
    deload_every: 5,
    vars: { squat_max: 225 },
    phases: [
      { name: 'Base', cycles: 6 },
      { name: 'Build', cycles: 6, intensity: 1.05 },
    ],
    steps: [
      { ref: 'mobility-flow', block: 'warmup', target: 6 },
      { ref: 'back-squat', sets: 3, load: 135, progression: { type: 'double', range: [5, 8], increment: 10 } },
      { ref: 'deadlift', sets: 3, load: 185, progression: { type: 'percent', of: 'squat_max', start: 0.7, increment: 0.02 } },
      { ref: 'pull-up', sets: 3, target: 5 },
      { ref: 'plank', block: 'cooldown', sets: 2, target: 40, progression: { type: 'linear', increment: 5, drives: 'target' } },
    ],
  },
};

router.get('/api/routines/vocabulary', (_req, res) => {
  res.json({
    spec_version: spec.SPEC_VERSION,
    /* Day offsets are from MONDAY, everywhere in the suite. Named here as well as
       numbered because "0" meaning Monday is the single most likely thing for an
       author to get wrong, and `days: ['mon','thu']` removes the question. */
    days: { encoding: 'offsets from Monday', names: DAY_NAMES, example: '0,3' },
    units: spec.UNITS,
    load_units: spec.LOAD_UNITS,
    progressions: {
      types: spec.PROGRESSIONS,
      drives: spec.DRIVES,
      doc: {
        fixed: 'never changes — the default',
        linear: '{ increment, every?, cap?, drives? } — add `increment` every `every` cycles',
        double: '{ range: [lo, hi], increment, cap? } — climb the rep range, then add load and reset',
        ladder: '{ values: [...], repeat?: hold|loop, drives? } — an explicit per-cycle table',
        percent: '{ of: <vars key>, start, increment, cap? } — a creeping fraction of a stored max',
        autoregulated: '{ range: [lo, hi], increment, cap? } — advances only when the log says you met the top',
      },
    },
    blocks: spec.BLOCKS,
    advance_on: { values: spec.ADVANCE_ON, doc: 'completion = a cycle is a session you DID (default); calendar = a cycle is a week that elapsed' },
    phase_repeat: spec.PHASE_REPEAT,
    collections: spec.COLLECTIONS,
    /* WHEN, beyond the weekly grid. Written as one string in `cadence` on the
       import document (or the `cadence_rule` column); omit it entirely for the
       weekly default, which is what almost every routine is. */
    cadence: {
      types: spec.CADENCES,
      doc: {
        weekly: 'omit `cadence` and use `days` — the default',
        every_n_days: "'every_n_days:3' — a fixed interval from the routine's own start",
        monthly: "'monthly:15' or 'monthly:last'",
        rolling: "'rolling:3' — N times per rolling 7 days, anchored on the start weekday, not on Monday",
        rrule: "'rrule:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH' — the RFC 5545 subset below",
      },
      rrule_supported: ['FREQ=DAILY|WEEKLY|MONTHLY', 'INTERVAL', 'BYDAY (no ordinals)', 'BYMONTHDAY', 'COUNT', 'UNTIL'],
      rrule_rejected: ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYMONTH', 'EXDATE', 'RDATE', 'WKST', 'ordinal BYDAY (2MO)', 'FREQ=YEARLY'],
      rrule_note: 'Unsupported parts are REJECTED, never half-honoured — a rule that silently drops BYSETPOS produces a schedule that looks right and is not. Prefer the named modes: RRULE cannot be drawn on the weekly board.',
    },
    /* WHAT THIS ROUTINE FEEDS. A routine never finishes, so it contributes a
       MEASUREMENT to its goal rather than percent-complete. */
    contributes: {
      measures: spec.MEASURES,
      windows: spec.WINDOWS,
      doc: {
        sessions: 'count the sessions kept',
        volume: 'sets × target, summed',
        target: 'the target alone, summed — distance, minutes, pages',
        load: 'load × sets × target, summed — tonnage',
      },
      example: { measure: 'target', step: 'easy-run', target: 100, window: 'month', label: '100 km a month' },
    },
    /* A step may carry SEVERAL rules. Reps every session, a harder movement every
       six weeks, a fourth set in the second month — one step, three rules. */
    multi_rule: {
      max: spec.MAX_RULES,
      doc: '`progression` accepts an ARRAY. Rules apply in order and the last writer of a field wins; variant shifts ADD.',
      example: [
        { type: 'double', range: [5, 8], increment: 10, cap: 225 },
        { type: 'linear', drives: 'sets', increment: 1, every: 8, cap: 5 },
      ],
    },
    promote_on_cap: {
      doc: 'Step-level flag. When a capped LOAD rule tops out, the excess climbs the `variants` ladder and the load resets — "double progression until you cannot add weight, then a harder variation". Needs both a cap and a ladder.',
    },
    deload: {
      programmed: '`deload_every: N` — every Nth session is lighter and shorter',
      on_demand: 'POST /api/items/:id/deload — one session, on request. It also spends NO RUNG on the cycle ladder, so taking it easy costs no progress. The past is refused.',
    },
    revisions: {
      doc: 'Every spec write archives the outgoing document and bumps spec_version; each prescription stamps it as `sv`. GET /api/routines/:id/revisions to trace a frozen session back to the rules that produced it.',
    },
    limits: spec.LIMITS,
    horizon_weeks: HORIZON_WEEKS,
    notes: [
      'Every field is optional. Omit progression and the step never gets harder; omit unit and it is inferred.',
      'Reference a library entry with `ref` and it supplies unit, rest, variant ladder and a sane progression — anything the step states itself always wins.',
      'A step with a `variants` ladder gets harder by MOVING UP IT (variant_every: N), which is the only way bodyweight work can progress.',
      'Import is idempotent by `slug`: the same document sent twice updates, it does not duplicate.',
      'POST /api/routines/import returns `warnings` — a valid routine that never progresses is accepted and flagged there.',
      'A step may carry an ARRAY of progression rules; each moves a different field.',
      'An uncapped rule on a count (reps, seconds, pages) is linted — +5s a session is a five-minute plank by next spring.',
      'GET /api/routines/:id/preview?cycles=12 before you trust a progression. GET /api/library/export to read the vocabulary as a file.',
    ],
    example: EXAMPLE,
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ROUTINES — read, preview, round-trip
   ══════════════════════════════════════════════════════════════════════════════ */

/** `days: ['mon','thu']` or `[0, 3]` or `'0,3'` → the canonical "0,3". Accepting all
 *  three is not indulgence: day-of-week encoding is the single most common thing an
 *  author gets wrong, and every form here is unambiguous. */
function toCadenceDays(v) {
  if (v === null || v === undefined) return null;
  const parts = Array.isArray(v) ? v : String(v).split(',');
  const out = [];
  for (const p of parts) {
    const s = String(p).trim().toLowerCase();
    if (s === '') continue;
    const named = DAY_NAMES.indexOf(s.slice(0, 3));
    const n = named >= 0 ? named : parseInt(s, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b).join(',');
}

/** A routine row → the document `POST /routines/import` accepts. The round trip
 *  the header promises; `normalizeSpec` output rather than the raw column, so what
 *  comes out is what the engine actually renders (a document with `ref`s comes back
 *  resolved, which is what an editing agent needs to see). */
function toDocument(row, resolve) {
  const { spec: s } = spec.normalizeSpec(row.spec, { resolve });
  return {
    slug: String(row.ext_ref || '').startsWith('routinedoc:')
      ? String(row.ext_ref).slice('routinedoc:'.length)
      : spec.slugify(row.title, `routine-${row.id}`),
    title: row.title,
    notes: row.notes || undefined,
    days: (row.cadence_days || '').split(',').filter(Boolean).map((n) => DAY_NAMES[Number(n)]),
    cadence_days: row.cadence_days || '',
    cadence_count: row.cadence_count ?? undefined,
    cadence: row.cadence_rule || undefined,
    time: row.scheduled_time || undefined,
    end_time: row.scheduled_end || undefined,
    accent: row.accent || undefined,
    status: row.status || 'active',
    spec: s,
  };
}

router.get('/api/routines', (req, res) => {
  try {
    ensureLibrary(req);
    const resolve = lib.resolverFor(req.user.sub);
    const rows = all('SELECT * FROM items WHERE user_id = ? AND kind = ? ORDER BY position ASC, id ASC',
      [req.user.sub, 'routine']);
    res.json(rows.map((row) => {
      const { spec: s } = spec.normalizeSpec(row.spec, { resolve });
      return { ...toRow(row), spec: s, summary: spec.summarize(s) };
    }));
  } catch (e) { fail(res, e); }
});

router.get('/api/routines/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    ensureLibrary(req);
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [id, req.user.sub, 'routine']);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const resolve = lib.resolverFor(req.user.sub);
    const { warnings } = spec.validateSpec(row.spec, { resolve });
    res.json({ ...toRow(row), document: toDocument(row, resolve), warnings });
  } catch (e) { fail(res, e); }
});

/**
 * THE PREVIEW — the next N sessions as concrete numbers.
 *
 * Anchored at the routine's CURRENT cycle, taken from the highest cycle_index its
 * occurrences have reached, so "next" means next for this user and not cycle 0 of
 * an abstract programme. `from` overrides it, which is how the editor shows "what
 * does cycle 30 look like" without the user having to get there.
 */
router.get('/api/routines/:id/preview', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    ensureLibrary(req);
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [id, req.user.sub, 'routine']);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const resolve = lib.resolverFor(req.user.sub);
    const { spec: s, warnings } = spec.normalizeSpec(row.spec, { resolve });

    const cycles = Math.min(52, Math.max(1, parseInt(req.query.cycles, 10) || 8));
    const explicitFrom = parseInt(req.query.from, 10);
    let from = Number.isFinite(explicitFrom) ? Math.max(0, explicitFrom) : null;
    if (from === null) {
      const top = get(
        `SELECT MAX(cycle_index) AS c FROM items
          WHERE user_id = ? AND parent_id = ? AND ext_ref LIKE 'routine:%' AND completed = 1`,
        [req.user.sub, id],
      );
      from = top && top.c !== null ? top.c + 1 : 0;
    }

    res.json({
      id, title: row.title, from, cycles,
      summary: spec.summarize(s),
      warnings,
      sessions: Array.from({ length: cycles }, (_, i) => spec.renderCycle(s, from + i)),
    });
  } catch (e) { fail(res, e); }
});

/** The occurrences of one routine, for the analytics below. Kept here rather than
 *  in the engine because it is a READ shape (whole rows, ordered for display), not
 *  the narrow column set the reconcile passes need. */
const occurrencesOf = (routineId, userId) => all(
  `SELECT * FROM items
    WHERE user_id = ? AND parent_id = ? AND ext_ref LIKE 'routine:%'
    ORDER BY COALESCE(due_date, week_start) ASC, id ASC`,
  [userId, routineId],
);

/**
 * THE METRIC — what this routine contributes to its goal.
 *
 * A routine never finishes, so it cannot contribute PERCENT COMPLETE without
 * corrupting the goal's `done / total`. It contributes a MEASUREMENT instead —
 * "run 100 km this month" — declared as `contributes` in the spec and computed
 * here from what was actually performed (falling back to what was prescribed for a
 * completed session with no per-step log).
 */
router.get('/api/routines/:id/metric', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [id, req.user.sub, 'routine']);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { spec: s } = spec.normalizeSpec(row.spec, { resolve: lib.resolverFor(req.user.sub) });
    const metric = spec.metricOf(s, occurrencesOf(id, req.user.sub), callerToday(req));
    res.json({ id, title: row.title, goal_id: row.parent_id ?? null, metric });
  } catch (e) { fail(res, e); }
});

/**
 * THE SERIES — prescribed vs performed over time, per step.
 *
 * Two lines that answer different questions and only mean something together:
 * prescribed is whether the PROGRAMME is climbing, performed is whether YOU are.
 * The gap between them opening is the most useful signal a training log carries and
 * is invisible in either line alone.
 */
router.get('/api/routines/:id/series', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [id, req.user.sub, 'routine']);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { spec: s } = spec.normalizeSpec(row.spec, { resolve: lib.resolverFor(req.user.sub) });
    const occ = occurrencesOf(id, req.user.sub);
    const measure = ['load', 'target', 'sets', 'volume'].includes(req.query.measure) ? req.query.measure : 'load';
    const keys = req.query.step ? [String(req.query.step)] : s.steps.map((x) => x.key);
    res.json({
      id, title: row.title, measure,
      steps: keys.map((k) => ({
        key: k,
        title: s.steps.find((x) => x.key === k)?.title || k,
        points: spec.seriesFor(s, occ, k, measure),
      })),
    });
  } catch (e) { fail(res, e); }
});

/**
 * THE REVISIONS — which document each stamped session was following.
 *
 * A prescription is frozen on purpose, so March keeps saying 5 × 5. This is how
 * March explains itself: every occurrence stamps `sv`, and `sv` names a row here.
 */
router.get('/api/routines/:id/revisions', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const list = revisionsOf(id, req.user.sub);
    if (!list) return res.status(404).json({ error: 'Not found' });
    res.json({
      id,
      current: list[0]?.version ?? 1,
      revisions: list.map((r) => ({ ...r, spec: req.query.full ? r.spec : undefined })),
    });
  } catch (e) { fail(res, e); }
});

/**
 * DELOAD ON DEMAND — "take this one easy", on one occurrence.
 *
 * A dedicated route rather than a bare PATCH because it has to do two things
 * together to mean anything: set the override AND reconcile, so the session
 * re-renders light immediately and the ladder behind it shifts (a deloaded session
 * spends no rung, so the sessions after it repeat rather than advance). A client
 * doing those as two calls would show a stale card in between.
 *
 * `{ deload: false }` clears it — including forcing a session NORMAL that the
 * programme's own cadence would have deloaded, which is the same gesture in the
 * other direction and costs nothing extra to support.
 */
router.post('/api/items/:id/deload', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    /* `{ deload: false }` forces a session NORMAL that the programme's own cadence
       would have deloaded — the same gesture in the other direction. `{ clear: true }`
       hands the decision back to the programme entirely. */
    const asked = req.body?.deload;
    const value = req.body?.clear === true ? null
      : (asked === false || asked === 0 ? 0 : 1);
    const r = setDeloadOverride(id, req.user.sub, callerToday(req), value);
    if (!r.ok) return res.status(400).json({ error: r.error, code: 'VALIDATION' });
    res.json(toRow(r.row));
  } catch (e) { fail(res, e); }
});

/**
 * THE IMPORT — one document → one routine, created or updated.
 *
 * Idempotent by `slug`, carried on the routine row's `ext_ref` as
 * `routinedoc:<slug>` (which cannot collide with the `routine:<id>:<date>` refs the
 * mint owns — those have a colon after "routine", these do not). An agent that
 * times out and resends gets an update, not a second routine.
 *
 * `?dryRun=1` validates and renders without writing, matching /import's convention.
 */
router.post('/api/routines/import', (req, res) => {
  try {
    ensureLibrary(req);
    const doc = req.body && typeof req.body === 'object' ? req.body : null;
    if (!doc) return res.status(400).json({ error: 'body must be a JSON object', code: 'VALIDATION' });

    /* The spec is `doc.spec`, or — for the author who wrote the fields at the top
       level because that is what the shape suggested — the document itself. */
    const rawSpec = doc.spec !== undefined ? doc.spec
      : (doc.steps || doc.phases || doc.vars) ? doc : null;

    const resolve = lib.resolverFor(req.user.sub);
    const check = spec.validateSpec(rawSpec, { resolve });
    if (!check.ok) return res.status(400).json({ error: 'spec is invalid', code: 'VALIDATION', errors: check.errors });
    const { spec: normalized } = spec.normalizeSpec(rawSpec, { resolve });

    const slug = spec.slugify(doc.slug ?? doc.key ?? doc.title, '');
    if (!slug) return res.status(400).json({ error: 'slug or title is required', code: 'VALIDATION' });
    const title = String(doc.title ?? spec.humanize(slug)).trim().slice(0, 500);

    const fields = {
      kind: 'routine', scope: 'week', source: 'bb',
      title,
      notes: doc.notes == null ? null : String(doc.notes).slice(0, 5000),
      accent: doc.accent ?? null,
      status: ['active', 'parked', 'done'].includes(doc.status) ? doc.status : 'active',
      cadence_days: toCadenceDays(doc.days ?? doc.cadence_days) ?? '',
      cadence_rule: spec.formatCadence(spec.parseCadence(doc.cadence ?? doc.cadence_rule)) || null,
      cadence_count: doc.cadence_count ?? doc.times_per_week ?? null,
      scheduled_time: doc.time ?? doc.scheduled_time ?? null,
      scheduled_end: doc.end_time ?? doc.scheduled_end ?? null,
      parent_id: doc.parent_id ?? doc.goal_id ?? null,
      spec: JSON.stringify(normalized),
      ext_ref: `routinedoc:${slug}`,
    };
    /* Straight through the SAME validator every direct write uses — an import must
       not be a side door past the caps and enums the API enforces. */
    const invalid = validateItemWrite(fields);
    if (invalid) return res.status(400).json({ error: invalid, code: 'VALIDATION' });
    if (!validParentId(fields.parent_id, req.user.sub)) return res.status(400).json({ error: 'Invalid parent_id' });

    const existing = get('SELECT * FROM items WHERE user_id = ? AND ext_ref = ? AND kind = ?',
      [req.user.sub, fields.ext_ref, 'routine']);

    if (req.query.dryRun) {
      return res.json({
        ok: true, dryRun: true, slug,
        action: existing ? 'update' : 'create',
        warnings: check.warnings,
        summary: spec.summarize(normalized),
        sessions: Array.from({ length: 4 }, (_, i) => spec.renderCycle(normalized, i)),
      });
    }

    let id;
    if (existing) {
      // Re-importing a CHANGED document is a revision like any other spec edit, so
      // the outgoing one is archived and the version bumped before the overwrite.
      recordRevision(existing, req.user.sub, fields.spec, doc.revision_note || null);
      const keys = Object.keys(fields).filter((k) => ITEM_COLUMNS.has(k));
      run(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
        [...keys.map((k) => coerceColumn(k, fields[k])), existing.id, req.user.sub]);
      id = existing.id;
    } else {
      const d = { user_id: req.user.sub, ...fields };
      const keys = Object.keys(d).filter((k) => k === 'user_id' || ITEM_COLUMNS.has(k));
      const r = run(`INSERT INTO items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map((k) => (k === 'user_id' ? d[k] : coerceColumn(k, d[k]))));
      id = r.lastInsertRowid;
      run('UPDATE items SET spec_version = 1 WHERE id = ? AND user_id = ?', [id, req.user.sub]);
    }

    // Mint immediately, so the very next read shows real, prescribed occurrences.
    const mint = materializeOne(id, req.user.sub, callerToday(req));
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ?', [id, req.user.sub]);

    res.status(existing ? 200 : 201).json({
      ok: true, slug, created: !existing,
      routine: toRow(row),
      summary: spec.summarize(normalized),
      warnings: check.warnings,
      ...mint,
    });
  } catch (e) { fail(res, e); }
});

module.exports = router;

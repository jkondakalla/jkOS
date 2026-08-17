'use strict';
// Items CRUD — the core per-user task/event store. GET (with weave filters + lazy
// first-run seed), POST/PATCH (validated direct writes), DELETE (cascade).
const express = require('express');
const { buildItemFilters, filterSpec } = require('@jkos/weave/server');
const { all, run, get } = require('../db');
const { DATASETS } = require('../../discovery');
const { ITEM_COLUMNS, coerceColumn, validateItemWrite } = require('../schema');
const { validParentId, cascadeDelete, seedDefaults } = require('../items-store');
const { materializeRoutines, materializeOne, materializeForOccurrence, recordRevision } = require('../routines');
const { toRow, fail } = require('../util');
const { looksLikeDate } = require('../schema');

const router = express.Router();

/* The caller's LOCAL date, from the X-BB-Today header, falling back to the
   server's UTC date.
 *
 * Routines mint relative to "today", and the server's UTC day is not the user's
 * day: at 17:00 in California it is already tomorrow in UTC, so a UTC floor would
 * skip the occurrence the user is looking at. The client knows its own date
 * (isoDate(new Date()) — the same value the whole frontend calls `today`), so it
 * sends it.
 *
 * A HEADER rather than a query param on purpose: `GET /api/items` treats ANY query
 * param as "this is a filtered read" and suppresses the first-run seed and this
 * materialise on that basis. A `?today=` would have silently turned every normal
 * load into a filtered one. Untrusted like any input — a malformed value falls back
 * rather than reaching the date maths. */
function callerToday(req) {
  const h = req.get('X-BB-Today');
  if (h && looksLikeDate(String(h))) return String(h).trim();
  return new Date().toISOString().slice(0, 10);
}

/* Attach the routine document's LINT to an otherwise-successful write.
 *
 * The lint tier (routine-spec.js) is the answer to the way an AI author actually
 * fails. It rarely emits invalid JSON; it emits a routine with five steps and no
 * progression on any of them — valid, accepted, and useless. Nothing else in the
 * system would ever say so, so the write that accepted it says so, in the same
 * machine-readable shape as an error. Present only when there is something to say,
 * so the row a normal client reads is unchanged. */
function withLint(row, details) {
  const w = details?.warnings;
  return w && w.length ? { ...row, warnings: w } : row;
}

/* The weave filter vocabulary for items — which query param maps to which column
   and operator. DERIVED from the DATASETS `items.filters` declaration (P3) so the
   filter an app DECLARES it can be read by is exactly the one it enforces: one
   source, no drift. filterSpec() projects each FilterField → {param,column,op}. */
const ITEM_FILTER_SPEC = filterSpec(
  DATASETS.datasets.find((d) => d.id === 'items').filters,
);

router.get('/api/items', async (req, res) => {
  try {
    /* Server-side filters so other suite apps fetch only what they own/need
       instead of dumping every row — the shared weave filter builder over the
       per-user base clause. */
    const q = req.query;
    const { where, params } = buildItemFilters(q, ITEM_FILTER_SPEC, {
      base: ['user_id = ?'], baseParams: [req.user.sub],
    });
    const filtered = Object.keys(q).length > 0;
    let rows = all(`SELECT * FROM items WHERE ${where} ORDER BY id ASC`, params);
    // Lazy first-run seed only for an unfiltered, empty, non-guest HUMAN account —
    // a filter returning nothing must NOT trigger seeding, and a service identity
    // (e.g. the prober or a peer app reading on its own behalf) must never have
    // demo rows conjured under its `svc:` sub.
    const isService = req.user.typ === 'service' || String(req.user.sub).startsWith('svc:');
    if (rows.length === 0 && !filtered && req.user.role !== 'guest' && !isService) {
      await seedDefaults(req.user.sub);
      rows = all(`SELECT * FROM items WHERE ${where} ORDER BY id ASC`, params);
    }
    /* Keep the routine occurrences current before answering. A write on a read is
       the same bargain the lazy seed above already makes, and it is what makes the
       cadence engine need no scheduler, no cron and no worker: the horizon rolls
       forward whenever someone looks. Idempotent and cheap — one indexed SELECT
       when the user owns no routines, which is the common case.
       Guarded exactly like the seed: never for a filtered read (a peer asking for
       one day's rows must not trigger a horizon-wide write), never for a guest,
       and never under a service identity. */
    if (!filtered && req.user.role !== 'guest' && !isService) {
      /* Re-read on UPDATED as well as minted/withdrawn. The reconcile's third pass
         (propagate) rewrites rows IN PLACE — the routine's own edits pushed onto
         the future it still owns, and since migration 10 the re-rendered
         prescriptions too — without inserting or deleting anything. Gating the
         re-read on the insert/delete counts alone therefore answered from `rows` as
         they were BEFORE the reconcile, so a change made on this very request
         didn't show up until some later unrelated load: tick today's session and
         tomorrow's numbers stay stale for one round trip. */
      const { minted, withdrawn, updated } = materializeRoutines(req.user.sub, callerToday(req));
      if (minted || withdrawn || updated) rows = all(`SELECT * FROM items WHERE ${where} ORDER BY id ASC`, params);
    }
    res.json(rows.map(toRow));
  } catch (e) { fail(res, e); }
});

router.post('/api/items', (req, res) => {
  try {
    const raw  = req.body;
    if (!raw?.title?.toString().trim()) return res.status(400).json({ error: 'title is required' });
    /* `details` collects the routine validator's machine-readable output for a
       `spec` in the body — the errors on rejection so an AI author's next turn can
       fix itself, and the LINT on acceptance so a valid-but-thin routine ("no step
       ever gets harder") is told so by the only thing that can tell it. */
    const details = {};
    const invalid = validateItemWrite(raw, details);
    if (invalid) return res.status(400).json({ error: invalid, code: 'VALIDATION', errors: details.errors || [] });
    if (!validParentId(raw.parent_id, req.user.sub)) return res.status(400).json({ error: 'Invalid parent_id' });
    const d    = { user_id: req.user.sub };
    for (const k of Object.keys(raw)) {
      if (ITEM_COLUMNS.has(k)) d[k] = coerceColumn(k, raw[k]);
    }
    const keys = Object.keys(d);
    const cols = keys.join(', ');
    const phs  = keys.map(() => '?').join(', ');
    const r    = run(`INSERT INTO items (${cols}) VALUES (${phs})`, keys.map(k => d[k]));
    const row  = get('SELECT * FROM items WHERE id = ?', [r.lastInsertRowid]);
    // A new routine gets its horizon immediately, so the board it was created from
    // shows real occurrences without waiting for the next full load.
    if (row.kind === 'routine') {
      // Every routine starts at revision 1, so `sv` is meaningful from the first
      // render rather than null until someone happens to edit it.
      run('UPDATE items SET spec_version = 1 WHERE id = ? AND user_id = ?', [row.id, req.user.sub]);
      materializeOne(row.id, req.user.sub, callerToday(req));
      row.spec_version = 1;
    }
    res.status(201).json(withLint(toRow(row), details));
  } catch (e) { fail(res, e); }
});

router.patch('/api/items/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const raw = req.body;
    const details = {};
    const invalid = validateItemWrite(raw, details);
    if (invalid) return res.status(400).json({ error: invalid, code: 'VALIDATION', errors: details.errors || [] });
    const valid = Object.keys(raw).filter(k => ITEM_COLUMNS.has(k));
    if (!valid.length) return res.status(400).json({ error: 'No valid fields to update' });
    if (Object.prototype.hasOwnProperty.call(raw, 'parent_id') && !validParentId(raw.parent_id, req.user.sub, id)) {
      return res.status(400).json({ error: 'Invalid parent_id' });
    }
    /* A SPEC EDIT IS AN AUTHORING EVENT. Archive the outgoing document and bump
       spec_version BEFORE the write, so the version each subsequent prescription
       stamps as `sv` names the document those sessions actually followed. A no-op
       when the document is unchanged (a rename is not a revision) and when the row
       is not a routine. */
    if (valid.includes('spec')) {
      const before = get('SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = ?', [id, req.user.sub, 'routine']);
      if (before) recordRevision(before, req.user.sub, coerceColumn('spec', raw.spec), raw.revision_note || null);
    }
    const sets = valid.map(k => `${k} = ?`).join(', ');
    const vals = valid.map(k => coerceColumn(k, raw[k]));
    run(`UPDATE items SET ${sets} WHERE id = ? AND user_id = ?`, [...vals, id, req.user.sub]);
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ?', [id, req.user.sub]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    // Patching a routine IS the pattern edit: reconcile now so the withdraw +
    // propagate rules (see routines.js RULE 2) apply to this change, not to
    // whatever the horizon happens to look like at the next read.
    if (row.kind === 'routine') materializeOne(row.id, req.user.sub, callerToday(req));
    // Patching an OCCURRENCE — ticking it, above all — is what moves the cycle
    // ladder (routines.js RULE 3), so the sessions ahead of it are re-rendered on
    // this same request. Without it you would tick today's session, watch nothing
    // change, and get tomorrow's new numbers on some later unrelated load.
    else materializeForOccurrence(row, req.user.sub, callerToday(req));
    res.json(withLint(toRow(row), details));
  } catch (e) { fail(res, e); }
});

router.delete('/api/items/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const row = get('SELECT id FROM items WHERE id = ? AND user_id = ?', [id, req.user.sub]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    cascadeDelete(id, req.user.sub);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;

'use strict';
// Items CRUD — the core per-user task/event store. GET (with weave filters + lazy
// first-run seed), POST/PATCH (validated direct writes), DELETE (cascade).
const express = require('express');
const { buildItemFilters, filterSpec } = require('@jkos/weave/server');
const { all, run, get } = require('../db');
const { DATASETS } = require('../../discovery');
const { ITEM_COLUMNS, coerceColumn, validateItemWrite } = require('../schema');
const { validParentId, cascadeDelete, seedDefaults } = require('../items-store');
const { materializeRoutines, materializeOne } = require('../routines');
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
      const { minted, withdrawn } = materializeRoutines(req.user.sub, callerToday(req));
      if (minted || withdrawn) rows = all(`SELECT * FROM items WHERE ${where} ORDER BY id ASC`, params);
    }
    res.json(rows.map(toRow));
  } catch (e) { fail(res, e); }
});

router.post('/api/items', (req, res) => {
  try {
    const raw  = req.body;
    if (!raw?.title?.toString().trim()) return res.status(400).json({ error: 'title is required' });
    const invalid = validateItemWrite(raw);
    if (invalid) return res.status(400).json({ error: invalid, code: 'VALIDATION' });
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
    if (row.kind === 'routine') materializeOne(row.id, req.user.sub, callerToday(req));
    res.status(201).json(toRow(row));
  } catch (e) { fail(res, e); }
});

router.patch('/api/items/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const raw = req.body;
    const invalid = validateItemWrite(raw);
    if (invalid) return res.status(400).json({ error: invalid, code: 'VALIDATION' });
    const valid = Object.keys(raw).filter(k => ITEM_COLUMNS.has(k));
    if (!valid.length) return res.status(400).json({ error: 'No valid fields to update' });
    if (Object.prototype.hasOwnProperty.call(raw, 'parent_id') && !validParentId(raw.parent_id, req.user.sub, id)) {
      return res.status(400).json({ error: 'Invalid parent_id' });
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
    res.json(toRow(row));
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

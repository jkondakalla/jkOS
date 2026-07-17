'use strict';
// Items CRUD — the core per-user task/event store. GET (with weave filters + lazy
// first-run seed), POST/PATCH (validated direct writes), DELETE (cascade).
const express = require('express');
const { buildItemFilters, filterSpec } = require('@jkos/weave/server');
const { all, run, get } = require('../db');
const { DATASETS } = require('../../discovery');
const { ITEM_COLUMNS, coerceColumn, validateItemWrite } = require('../schema');
const { validParentId, cascadeDelete, seedDefaults } = require('../items-store');
const { toRow, fail } = require('../util');

const router = express.Router();

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

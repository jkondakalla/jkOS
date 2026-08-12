'use strict';
// Bulk import (AI-friendly): one JSON document → a whole goal→milestone→task tree in
// a single transaction. Validate-then-write; ?dryRun=1 previews. See README →
// "Importing tasks & goals (JSON)".
const express = require('express');
const { db, run } = require('../db');
const {
  MAX_IMPORT_ITEMS, MAX_IMPORT_DEPTH,
  IMPORT_ALIASES, IMPORT_STRUCT_KEYS, IMPORT_DATE_COLS, IMPORT_TIME_COLS, IMPORT_KIND_ENUM,
  ITEM_COLUMNS, coerceColumn,
  looksLikeDate, looksLikeTime, looksLikeCadenceDays, importChildren, cleanImportField,
} = require('../schema');
const { validParentId } = require('../items-store');
const { fail } = require('../util');

const router = express.Router();

/* ── Bulk import (AI-friendly) ──────────────────────────────────────────────
   POST /api/import takes ONE JSON document describing a tree (or flat graph) of
   items and creates them in a single transaction, wiring parent→child links so a
   whole broken-down goal (goal → milestones → tasks) lands in one call. Built so an
   AI tool can emit it directly. Hierarchy can be expressed two equivalent ways:

     • nested  — a node carries `children: [...]`        (also accepts kids/subtasks)
     • refs    — a node sets `ref: "x"`; a child sets `parent: "x"`
   You can also point `parent_id` at an EXISTING item id to append beneath it.

   Field names are forgiving (IMPORT_ALIASES); kind/scope/status are inferred from
   tree position when omitted (root w/ children → goal, deeper w/ children →
   milestone, leaf → task). The whole document is validated BEFORE any write, so a
   bad import creates nothing and returns precise per-item errors. `?dryRun=1`
   validates + echoes the plan without writing. */

/* Flatten → normalise/alias/infer → resolve parent links → reject cycles/overflow.
   Returns { errors, warnings, nodes, roots, childrenOf }: each node carries `.data`
   (the columns to write), `.kind`, `.parentIdx` (in-document) and `.dbParentId`
   (an existing item). No DB writes happen here. */
function planImport(doc, userId) {
  const errors = [], warnings = [];
  const defaults = (doc.defaults && typeof doc.defaults === 'object' && !Array.isArray(doc.defaults)) ? doc.defaults : {};
  const items = Array.isArray(doc.items) ? doc.items : [];

  // ── flatten depth-first, recording the structural parent + a path for messages ──
  const nodes = [];
  const walk = (arr, structParent, depth, prefix) => {
    arr.forEach((raw, i) => {
      const path = `${prefix}[${i}]`;
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`${path}: each item must be an object`);
        return;
      }
      const idx = nodes.length;
      nodes.push({ raw, structParent, depth, path, ref: (typeof raw.ref === 'string' && raw.ref) ? raw.ref.slice(0, 200) : null });
      const kids = importChildren(raw);
      if (kids) {
        if (depth + 1 > MAX_IMPORT_DEPTH) errors.push(`${path}: nesting exceeds ${MAX_IMPORT_DEPTH} levels`);
        else walk(kids, idx, depth + 1, `${path}.children`);
      }
    });
  };
  walk(items, null, 0, 'items');

  if (nodes.length === 0) errors.push('items: provide at least one item');
  if (nodes.length > MAX_IMPORT_ITEMS) errors.push(`items: ${nodes.length} items exceeds the ${MAX_IMPORT_ITEMS} limit`);

  // ── normalise each node into column data + infer kind/scope/status ──
  for (const n of nodes) {
    const merged = { ...defaults, ...n.raw };
    const data = {};
    for (const [k0, v] of Object.entries(merged)) {
      if (IMPORT_STRUCT_KEYS.has(k0)) continue;
      const k = IMPORT_ALIASES[k0] || k0;
      if (k === 'updated_at') { warnings.push(`${n.path}: 'updated_at' is managed automatically — ignored`); continue; }
      if (!ITEM_COLUMNS.has(k)) { warnings.push(`${n.path}: ignored unknown field '${k0}'`); continue; }
      const cleaned = cleanImportField(k, v, n.path, warnings);   // type-normalise + bound + validate
      if (cleaned !== undefined) data[k] = cleaned;
    }

    const hasChildren = !!importChildren(n.raw);
    let kind = (data.kind != null && data.kind !== '') ? data.kind
             : hasChildren ? (n.depth === 0 ? 'goal' : 'milestone') : 'task';
    if (!IMPORT_KIND_ENUM.has(kind)) errors.push(`${n.path}.kind: must be one of ${[...IMPORT_KIND_ENUM].join(', ')}`);
    data.kind = kind;

    if (data.title == null || data.title === '') errors.push(`${n.path}.title: required`);

    // goals use target_date, not due_date — remap a stray date for friendliness
    if (kind === 'goal' && data.due_date && !data.target_date) {
      data.target_date = data.due_date; delete data.due_date;
      warnings.push(`${n.path}: a goal's date was applied to target_date`);
    }
    if (data.scope == null || data.scope === '') data.scope = (kind === 'goal') ? 'year' : 'day';
    if (kind === 'goal' && (data.status == null || data.status === '')) data.status = 'active';

    for (const c of Object.keys(data)) {
      const val = data[c];
      if (val == null || val === '') continue;
      if (IMPORT_DATE_COLS.has(c) && !looksLikeDate(val)) errors.push(`${n.path}.${c}: expected YYYY-MM-DD, got ${JSON.stringify(val)}`);
      if (IMPORT_TIME_COLS.has(c) && !looksLikeTime(val)) errors.push(`${n.path}.${c}: expected HH:MM, got ${JSON.stringify(val)}`);
      // Same door as the direct writes (validateItemWrite): a cadence string drives
      // the mint loop, so an imported one is checked, not trusted.
      if (c === 'cadence_days' && !looksLikeCadenceDays(String(val))) {
        errors.push(`${n.path}.cadence_days: expected comma-separated day offsets 0-6, got ${JSON.stringify(val)}`);
      }
    }

    n.data = data; n.kind = kind;
  }

  // ── resolve parent links: explicit ref → structural nesting → existing item id ──
  const byRef = new Map();
  nodes.forEach((n, i) => {
    if (!n.ref) return;
    if (byRef.has(n.ref)) errors.push(`${n.path}.ref: duplicate ref '${n.ref}'`);
    else byRef.set(n.ref, i);
  });
  nodes.forEach((n) => {
    n.parentIdx = null; n.dbParentId = null;
    const p = n.raw.parent;
    if (typeof p === 'string' && p) {
      if (byRef.has(p)) n.parentIdx = byRef.get(p);
      else errors.push(`${n.path}.parent: unknown ref '${p}'`);
    } else if (n.structParent != null) {
      n.parentIdx = n.structParent;
    } else if (n.raw.parent_id != null && n.raw.parent_id !== '') {
      const pid = parseInt(n.raw.parent_id, 10);
      if (isNaN(pid) || !validParentId(pid, userId)) errors.push(`${n.path}.parent_id: must reference one of your existing items`);
      else n.dbParentId = pid;
    }
  });

  // ── reject cycles (refs can form them) + over-deep chains ──
  nodes.forEach((n, i) => {
    let cur = n.parentIdx, hops = 0; const seen = new Set([i]);
    while (cur != null) {
      if (seen.has(cur)) { errors.push(`${n.path}: parent cycle detected`); break; }
      seen.add(cur);
      if (++hops > MAX_IMPORT_DEPTH) { errors.push(`${n.path}: parent chain exceeds ${MAX_IMPORT_DEPTH} levels`); break; }
      cur = nodes[cur].parentIdx;
    }
  });

  // ── adjacency for insertion (roots first, then DFS so parents precede children) ──
  const childrenOf = nodes.map(() => []);
  const roots = [];
  nodes.forEach((n, i) => {
    if (n.parentIdx != null) childrenOf[n.parentIdx].push(i);
    else roots.push(i);
  });

  return { errors, warnings, nodes, roots, childrenOf };
}

router.post('/api/import', (req, res) => {
  try {
    let doc = req.body;
    // accept a double-encoded items/defaults (a command form may send JSON strings)
    if (doc && typeof doc === 'object' && typeof doc.items === 'string') {
      try { const p = JSON.parse(doc.items); doc = { ...doc, items: p }; } catch { /* leave as-is → shape error below */ }
    }
    if (doc && typeof doc === 'object' && typeof doc.defaults === 'string') {
      try { doc.defaults = JSON.parse(doc.defaults); } catch { delete doc.defaults; }
    }
    // forgiving top-level shape: a bare array → items; a single item object → one item
    if (Array.isArray(doc)) doc = { items: doc };
    else if (doc && typeof doc === 'object' && !Array.isArray(doc.items) && (doc.title || doc.name || importChildren(doc))) {
      doc = { items: [doc] };
    }
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) {
      return res.status(400).json({ ok: false, error: 'Body must be { "items": [ ... ] } — or a bare array of items, or a single item object.' });
    }

    const plan = planImport(doc, req.user.sub);
    if (plan.errors.length) {
      return res.status(400).json({ ok: false, errors: plan.errors, warnings: plan.warnings });
    }

    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    if (dryRun) {
      const out = [];
      const describe = (i, parentLabel) => {
        const n = plan.nodes[i];
        out.push({ ...(n.ref ? { ref: n.ref } : {}), title: n.data.title, kind: n.kind, parent: parentLabel ?? null, fields: n.data });
        for (const c of plan.childrenOf[i]) describe(c, n.ref || n.data.title);
      };
      for (const i of plan.roots) describe(i, plan.nodes[i].dbParentId != null ? `#${plan.nodes[i].dbParentId}` : null);
      return res.json({ ok: true, dryRun: true, wouldCreate: plan.nodes.length, plan: out, warnings: plan.warnings });
    }

    const out = [];
    const insertNode = (i, parentRealId) => {
      const n = plan.nodes[i];
      const cols = { user_id: req.user.sub };
      for (const [k, v] of Object.entries(n.data)) cols[k] = coerceColumn(k, v);
      if (parentRealId != null) cols.parent_id = parentRealId;
      const keys = Object.keys(cols);
      const r = run(`INSERT INTO items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => cols[k]));
      out.push({ ...(n.ref ? { ref: n.ref } : {}), id: r.lastInsertRowid, title: n.data.title, kind: n.kind, parent_id: parentRealId ?? null });
      for (const c of plan.childrenOf[i]) insertNode(c, r.lastInsertRowid);
    };

    const tx = db.transaction(() => {
      for (const i of plan.roots) insertNode(i, plan.nodes[i].dbParentId);
    });
    tx();

    res.status(201).json({ ok: true, created: out.length, items: out, warnings: plan.warnings });
  } catch (e) { fail(res, e); }
});

module.exports = { router, planImport };

'use strict'
// weave/server/collection.js — the COLLECTION primitive factory (Layer D / F3).
//
// `defineCollection(def)` expands ONE CollectionDef (a name + typed fields) into all
// the artifacts a hand-written app used to spell out separately and keep in sync:
//   • .item / .capabilities / .dataset — the Layer-A discovery contract (pure data,
//     what discovery.js serves; safe to require offline — no DB, env, or network),
//   • .ddl()                           — the CREATE TABLE + weave delta triggers,
//   • .coerce() / .toRow()             — the column ⇄ wire transforms,
//   • .mount(router, db)               — the scoped CRUD routes (GET/POST/PATCH/DELETE).
// Because all of them derive from the same spec, the table, the routes, and the
// served capability/dataset docs cannot drift — the trap that made the scaffolder's
// `items` three hand-coupled copies. Reuses the existing weave server helpers
// (filterSpec/buildItemFilters/coerceWeaveColumn) so a collection list endpoint is
// filtered EXACTLY as its dataset declares (P3), with zero new SQL surface.
//
// Zero extra deps (only ./filters + ./columns, both pure) so the lean subpath
// `@jkos/weave/collection` loads it without dragging in jsonwebtoken/express — the
// discovery doc imports it the same way it imports @jkos/suite-manifest. The Express
// router + better-sqlite3 handle are passed IN by the backend (never imported here).
// Design-time TS shapes: ../collection.ts. The ../../ resourceKey is the bus key.

const { filterSpec, buildItemFilters } = require('./filters')
const { coerceWeaveColumn } = require('./columns')
const { resourceKey } = require('@jkos/suite-manifest')

// A field name is interpolated into SQL (as a column), so it must be a safe
// identifier — never user input, but validated so a typo'd spec fails loudly at
// boot instead of producing broken SQL. Same rule for the collection/table id.
const IDENT = /^[a-z][a-z0-9_]*$/

function singular(id) {
  return id.length > 1 && id.endsWith('s') ? id.slice(0, -1) : id
}
function pascal(s) {
  return s.replace(/(^|[_-])([a-z0-9])/g, (_, __, c) => c.toUpperCase())
}

// FieldType → SQLite column affinity. number/boolean store as INTEGER; everything
// else (string/text/date/time/enum/json/ref + the `list` JSON-array shape) is TEXT.
function sqlType(field) {
  if (field.type === 'number') return 'INTEGER'
  if (field.type === 'boolean') return 'INTEGER'
  return 'TEXT'
}

function sqlDefault(field) {
  if (field.list) return " DEFAULT '[]'"
  if (field.type === 'boolean') return ` DEFAULT ${field.default ? 1 : 0}`
  if (field.default === undefined) return ''
  if (typeof field.default === 'number') return ` DEFAULT ${field.default}`
  return ` DEFAULT '${String(field.default).replace(/'/g, "''")}'`
}

// Project a CollectionField to the public BodyField (the GUI/AI-facing stud). `opts`
// drops `required` for a partial-update body.
function toBodyField(field, { required = field.required } = {}) {
  const b = { name: field.name, type: field.type }
  if (field.label) b.label = field.label
  if (required) b.required = true
  if (field.enum) b.enum = field.enum
  if (field.ref) b.ref = field.ref
  if (field.default !== undefined) b.default = field.default
  if (field.max != null) b.max = field.max
  return b
}

// The row shape: id + every field (typed, carrying its ref/enum stud) + updated_at.
// Capabilities `returns` this and the dataset's `item` IS this — one shape, no drift.
function toRowField(field) {
  const f = { name: field.name, type: field.type }
  if (field.ref) f.ref = field.ref
  if (field.enum) f.enum = field.enum
  return f
}

/**
 * @param {import('../collection').CollectionDef} def
 * @returns {import('../collection').Collection}
 */
function defineCollection(def) {
  if (!def || typeof def !== 'object') throw new Error('defineCollection: a CollectionDef is required')
  const { app, id, label } = def
  if (!app || typeof app !== 'string') throw new Error('defineCollection: def.app (owning app id) is required')
  if (!IDENT.test(String(id))) throw new Error(`defineCollection: id '${id}' must match ${IDENT} (it becomes the table name + dataset id)`)
  const fields = Array.isArray(def.fields) ? def.fields : []
  if (!fields.length) throw new Error(`defineCollection('${id}'): at least one field is required`)
  for (const f of fields) {
    if (!f || !IDENT.test(String(f.name))) throw new Error(`defineCollection('${id}'): field name '${f && f.name}' must match ${IDENT}`)
    if (f.name === 'id' || f.name === 'user_id' || f.name === 'created_at' || f.name === 'updated_at') {
      throw new Error(`defineCollection('${id}'): '${f.name}' is a reserved column (id/user_id/created_at/updated_at are implicit)`)
    }
  }

  const scoped = def.scoped !== false
  const key = resourceKey(app, id)
  const writeScope = `${app}:write`
  const Noun = def.noun || pascal(singular(id))

  // Which write capabilities/routes to emit — default all three (unchanged behavior
  // for every existing caller). 17.4 (papyros `history`, an append-only play-event
  // log) needed a collection that is genuinely never mutable after creation — no
  // update, no delete, ever — which the generic mount() below couldn't express
  // before this: it always wired all four CRUD routes. Smallest additive knob
  // (rather than a bespoke hand-rolled table, the `books`-in-server.js precedent)
  // so an append-only collection keeps the same one-spec-drives-table+routes+docs
  // property every other collection has. Read (list) is NOT gated by this — it
  // always mounts; `only` restricts mutation, not visibility.
  const ALLOWED_OPS = new Set(['create', 'update', 'delete'])
  const only = def.only || ['create', 'update', 'delete']
  for (const op of only) {
    if (!ALLOWED_OPS.has(op)) throw new Error(`defineCollection('${id}'): only[] entries must be one of create/update/delete, got '${op}'`)
  }
  const ops = new Set(only)

  // Client-writable columns: everything not server-managed.
  const writable = fields.filter((f) => !f.readOnly)
  const writableNames = new Set(writable.map((f) => f.name))
  const byName = new Map(fields.map((f) => [f.name, f]))

  /* ── the Layer-A contract (pure data) ─────────────────────────────────── */
  const item = [
    { name: 'id', type: 'number' },
    ...fields.map(toRowField),
    { name: 'updated_at', type: 'string' },
  ]
  const idField = { name: 'id', type: 'number', label: `${Noun} id`, required: true }

  const capabilities = [
    ops.has('create') && {
      id: `create${Noun}`, label: `Add ${article(label || Noun)}`, method: 'POST', path: `/${id}`,
      body: writable.map((f) => toBodyField(f)),
      returns: item, invalidates: [key], scopes: [writeScope],
    },
    ops.has('update') && {
      id: `update${Noun}`, label: `Update ${Noun}`, method: 'PATCH', path: `/${id}/:id`,
      body: [idField, ...writable.map((f) => toBodyField(f, { required: false }))],
      returns: item, invalidates: [key], scopes: [writeScope],
    },
    ops.has('delete') && {
      id: `delete${Noun}`, label: `Delete ${Noun}`, method: 'DELETE', path: `/${id}/:id`,
      body: [idField],
      returns: [{ name: 'ok', type: 'boolean' }], invalidates: [key], scopes: [writeScope],
    },
  ].filter(Boolean)

  // Filters: one per field that opted in (filter: op | true), PLUS the universal
  // `since` delta cursor over the implicit updated_at (the polled-resource bus reads
  // ?since=<cursor> → updated_at > ?). Each carries its own column/op so the dataset
  // declaration IS the enforced SQL (filterSpec, P3).
  const filters = [
    ...fields
      .filter((f) => f.filter)
      .map((f) => {
        const op = f.filter === true ? 'eq' : f.filter
        const b = toBodyField(f, { required: false })
        delete b.required
        delete b.default
        return { ...b, column: f.name, op }
      }),
    { name: 'since', type: 'string', label: 'Updated since (updated_at cursor)', column: 'updated_at', op: 'gt' },
  ]

  const dataset = {
    id, label: label || Noun, path: `/${id}`,
    ...(filters.length ? { filters } : {}),
    item, invalidates: [key],
  }

  const FILTER_SPEC = filterSpec(filters)

  /* ── the column ⇄ wire transforms ─────────────────────────────────────── */
  // A `ref` field's column has TEXT affinity (sqlType, above) — everything that
  // isn't number/boolean falls to TEXT. A JS number written unstringified binds as
  // SQLite REAL, and SQLite's REAL→TEXT storage conversion mangles it (1 → "1.0",
  // 999999 → "999999.0" — confirmed deterministic). Numbers get their canonical
  // string form (String(1) === '1', no float noise); strings pass through as-is
  // (already canonical TEXT); null/undefined follow the field's existing
  // nullability rules (required is enforced before coerce() runs; an optional ref
  // may be omitted/null) — coerce() never invents a value for those.
  function coerceRef(v) {
    if (typeof v === 'number') return String(v)
    return v
  }
  function coerce(name, v) {
    const f = byName.get(name)
    if (!f) return v
    if (f.type === 'boolean') return typeof v === 'boolean' ? (v ? 1 : 0) : v
    if (f.type === 'ref') return coerceRef(v)
    if (f.list) return coerceWeaveColumn('tags', v)   // reuse the JSON-array rule
    return coerceWeaveColumn(name, v)
  }
  function toRow(raw) {
    if (!raw) return null
    const out = { ...raw }
    for (const f of fields) {
      if (f.type === 'boolean') out[f.name] = raw[f.name] === 1 || raw[f.name] === true
      else if (f.list) { try { out[f.name] = raw[f.name] ? JSON.parse(raw[f.name]) : [] } catch { out[f.name] = [] } }
    }
    return out
  }

  /* ── storage ──────────────────────────────────────────────────────────── */
  function ddl() {
    const cols = [
      'id         INTEGER PRIMARY KEY AUTOINCREMENT',
      ...(scoped ? ['user_id    INTEGER'] : []),
      ...fields.map((f) => `${f.name} ${sqlType(f)}${f.required ? ' NOT NULL' : ''}${f.unique ? ' UNIQUE' : ''}${sqlDefault(f)}`),
      "created_at TEXT    DEFAULT (datetime('now'))",
      'updated_at TEXT',
    ]
    const idx = [
      ...(scoped ? [`CREATE INDEX IF NOT EXISTS idx_${id}_user ON ${id}(user_id);`] : []),
      `CREATE INDEX IF NOT EXISTS idx_${id}_updated ON ${id}(updated_at);`,
    ]
    return `
      CREATE TABLE IF NOT EXISTS ${id} (
        ${cols.join(',\n        ')}
      );
      ${idx.join('\n      ')}
      /* Stamp updated_at on insert AND touch it on every update so the weave delta
         contract (?since=<cursor> → updated_at > ?) sees new + edited rows alike. */
      DROP TRIGGER IF EXISTS ${id}_stamp_inserted;
      CREATE TRIGGER ${id}_stamp_inserted AFTER INSERT ON ${id}
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE ${id} SET updated_at = COALESCE(NEW.created_at, datetime('now')) WHERE id = NEW.id; END;
      DROP TRIGGER IF EXISTS ${id}_touch_updated;
      CREATE TRIGGER ${id}_touch_updated AFTER UPDATE ON ${id}
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE ${id} SET updated_at = datetime('now') WHERE id = NEW.id; END;
    `
  }

  /* ── routes ───────────────────────────────────────────────────────────── */
  function mount(router, db, opts = {}) {
    const base = opts.basePath || `/api/${id}`
    const run = (sql, p = []) => db.prepare(sql).run(...p)
    const all = (sql, p = []) => db.prepare(sql).all(...p)
    const get = (sql, p = []) => db.prepare(sql).get(...p)
    const ownerOf = (req) => (scoped ? req.user.sub : null)
    const fail = (res, e) => { console.error(`[${app}.${id}]`, e?.stack || e?.message || e); return res.status(500).json({ error: 'Internal error' }) }
    const required = writable.filter((f) => f.required).map((f) => f.name)

    // LIST — filtered (its dataset's declared filters) + scoped to the owner. Not
    // gated by `only` — an append-only collection is still fully readable, it's
    // mutation after creation that's disallowed.
    router.get(base, (req, res) => {
      try {
        const seed = scoped ? { base: ['user_id = ?'], baseParams: [ownerOf(req)] } : {}
        const { where, params } = buildItemFilters(req.query, FILTER_SPEC, seed)
        const sql = where ? `SELECT * FROM ${id} WHERE ${where} ORDER BY id DESC` : `SELECT * FROM ${id} ORDER BY id DESC`
        res.json(all(sql, params).map(toRow))
      } catch (e) { fail(res, e) }
    })

    // CREATE
    if (ops.has('create')) {
      router.post(base, (req, res) => {
        try {
          const raw = req.body || {}
          for (const name of required) {
            const v = raw[name]
            if (v == null || String(v).trim() === '') return res.status(400).json({ error: `${name} is required` })
          }
          const d = scoped ? { user_id: ownerOf(req) } : {}
          for (const k of Object.keys(raw)) if (writableNames.has(k)) d[k] = coerce(k, raw[k])
          const keys = Object.keys(d)
          if (!keys.length) return res.status(400).json({ error: 'No valid fields' })
          const r = run(`INSERT INTO ${id} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => d[k]))
          res.status(201).json(toRow(get(`SELECT * FROM ${id} WHERE id = ?`, [r.lastInsertRowid])))
        } catch (e) { fail(res, e) }
      })
    }

    // UPDATE (partial) — omitted entirely (no route mounted) unless `only` opts in.
    if (ops.has('update')) {
      router.patch(`${base}/:id`, (req, res) => {
        try {
          const rowId = parseInt(req.params.id, 10)
          if (isNaN(rowId)) return res.status(400).json({ error: 'Invalid id' })
          const valid = Object.keys(req.body || {}).filter((k) => writableNames.has(k))
          if (!valid.length) return res.status(400).json({ error: 'No valid fields to update' })
          const scope = scoped ? ' AND user_id = ?' : ''
          const tail = scoped ? [rowId, ownerOf(req)] : [rowId]
          run(`UPDATE ${id} SET ${valid.map((k) => `${k} = ?`).join(', ')} WHERE id = ?${scope}`,
            [...valid.map((k) => coerce(k, req.body[k])), ...tail])
          const row = get(`SELECT * FROM ${id} WHERE id = ?${scope}`, tail)
          if (!row) return res.status(404).json({ error: 'Not found' })
          res.json(toRow(row))
        } catch (e) { fail(res, e) }
      })
    }

    // DELETE — omitted entirely (no route mounted) unless `only` opts in.
    if (ops.has('delete')) {
      router.delete(`${base}/:id`, (req, res) => {
        try {
          const rowId = parseInt(req.params.id, 10)
          if (isNaN(rowId)) return res.status(400).json({ error: 'Invalid id' })
          const scope = scoped ? ' AND user_id = ?' : ''
          const tail = scoped ? [rowId, ownerOf(req)] : [rowId]
          const row = get(`SELECT id FROM ${id} WHERE id = ?${scope}`, tail)
          if (!row) return res.status(404).json({ error: 'Not found' })
          run(`DELETE FROM ${id} WHERE id = ?${scope}`, tail)
          res.json({ ok: true })
        } catch (e) { fail(res, e) }
      })
    }
  }

  return { app, id, key, scoped, item, capabilities, dataset, filterSpec: FILTER_SPEC, ddl, coerce, toRow, mount }
}

// 'a'/'an' for the create label — tiny, purely cosmetic.
function article(noun) {
  return /^[aeiou]/i.test(String(noun)) ? `an ${noun}` : `a ${noun}`
}

module.exports = { defineCollection }

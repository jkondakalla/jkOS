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
const { SQL_NOW, sqlConvert, canonical: canonicalTime } = require('./wireTime')
const { idempotencyBodyField, idempotencyKeyError } = require('../shared/idempotency')
const { DDL: IDEMPOTENCY_DDL, keyOf: idempotencyKeyOf, withIdempotency } = require('./idempotency')

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
  // for every existing caller). 17.4 (a `history`, an append-only play-event
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
      // ⭐ THE RESERVED IDEMPOTENCY FIELD, DECLARED (WEAVE.md §3.4). The trigger
      // engine has always SENT one; until this line no capability in the suite
      // said it accepted one, so a GUI or an AI reading the contract could not
      // know the door dedups — and the writer below dropped the key as an unknown
      // body field. Declared here rather than per app so every collection in the
      // suite gains it at once and none can spell it differently.
      body: [...writable.map((f) => toBodyField(f)), idempotencyBodyField()],
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
    /* A CLIENT-SUPPLIED WIRE TIMESTAMP IS STORED CANONICAL (XC-1). checkWire has
       already refused anything unparseable, so this only re-renders the form. */
    if (f.wire) return canonicalTime(v) ?? v
    if (f.list) return coerceWeaveColumn('tags', v)   // reuse the JSON-array rule
    return coerceWeaveColumn(name, v)
  }

  /* ⭐ `wire: true` — a field the CLIENT supplies that is nonetheless a wire
   * timestamp, and must therefore obey XC-1 like a server-written one.
   *
   * ⚠️ The defect this closes was live in two apps. KourOS's two ledgers'
   * `started_at` is stamped by the player in the browser and declared a plain
   * `string`, so any text at all could be stored — and their activity reads then
   * WINDOW and ORDER on that raw column (`started_at > ?`, `ORDER BY started_at
   * DESC`) while EMITTING `canonicalTime(started_at)` as the merge key. Filter key and
   * merge key were different values. A row written in the space-separated form sorts
   * BEFORE an ISO cursor of an EARLIER instant (`' ' < 'T'`), so it silently drops out
   * of the window and never appears in the merged feed again.
   *
   * Rejected rather than coerced-to-now: BeigeBoard validates the same-named column at
   * its door and answers 400 (BUG-3 — a direct caller should learn, not silently lose
   * data), and inventing a server timestamp for a field whose whole meaning is "when
   * the client says this happened" would be worse than refusing it.
   *
   * Only keys PRESENT are checked, so a PATCH sending a subset is unaffected. */
  const wireNames = fields.filter((f) => f.wire).map((f) => f.name)
  function checkWire(raw) {
    for (const name of wireNames) {
      const v = raw?.[name]
      if (v == null || v === '') continue        // absence is the `required` check's business
      if (canonicalTime(v) == null) {
        return `${name} must be an ISO-8601 instant (e.g. 2026-08-31T14:05:00.000Z)`
      }
    }
    return null
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
    // ⚠️ `CREATE TABLE IF NOT EXISTS`, so an app that mounts six collections gets
    // ONE dedup table rather than six. It lives with the collection's own DDL
    // because the write door is what needs it — an app that mounts no collection
    // has no door to protect and should not carry the table.

    const cols = [
      'id         INTEGER PRIMARY KEY AUTOINCREMENT',
      ...(scoped ? ['user_id    INTEGER'] : []),
      ...fields.map((f) => `${f.name} ${sqlType(f)}${f.required ? ' NOT NULL' : ''}${f.unique ? ' UNIQUE' : ''}${sqlDefault(f)}`),
      `created_at TEXT    DEFAULT (${SQL_NOW})`,
      'updated_at TEXT',
    ]
    const idx = [
      ...(scoped ? [`CREATE INDEX IF NOT EXISTS idx_${id}_user ON ${id}(user_id);`] : []),
      `CREATE INDEX IF NOT EXISTS idx_${id}_updated ON ${id}(updated_at);`,
    ]
    return `
      ${IDEMPOTENCY_DDL}
      CREATE TABLE IF NOT EXISTS ${id} (
        ${cols.join(',\n        ')}
      );
      ${idx.join('\n      ')}
      /* Stamp updated_at on insert AND touch it on every update so the weave delta
         contract (?since=<cursor> → updated_at > ?) sees new + edited rows alike. */
      DROP TRIGGER IF EXISTS ${id}_stamp_inserted;
      CREATE TRIGGER ${id}_stamp_inserted AFTER INSERT ON ${id}
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE ${id} SET updated_at = COALESCE(${sqlConvert('NEW.created_at')}, ${SQL_NOW}) WHERE id = NEW.id; END;
      /* ⚠️ A table CREATEd before the wire-time fix keeps its old whole-second
         column DEFAULT, and SQLite cannot ALTER a default without rebuilding the
         table. Triggers, however, are dropped and recreated on every boot — so
         this one canonicalises created_at on the way in, and an existing
         deployment converges without a rebuild or a data migration for new rows.
         Idempotent: re-formatting an already-canonical value is a no-op. */
      DROP TRIGGER IF EXISTS ${id}_canon_created;
      CREATE TRIGGER ${id}_canon_created AFTER INSERT ON ${id}
        FOR EACH ROW WHEN NEW.created_at IS NOT NULL AND NEW.created_at NOT LIKE '____-__-__T__:__:__.___Z'
        BEGIN UPDATE ${id} SET created_at = ${sqlConvert('NEW.created_at')} WHERE id = NEW.id; END;
      DROP TRIGGER IF EXISTS ${id}_touch_updated;
      CREATE TRIGGER ${id}_touch_updated AFTER UPDATE ON ${id}
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE ${id} SET updated_at = ${SQL_NOW} WHERE id = NEW.id; END;
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
          const wireErr = checkWire(raw)
          if (wireErr) return res.status(400).json({ error: wireErr, code: 'VALIDATION' })
          // A key that is present but cannot be honoured is refused, never silently
          // treated as absent — that would be a write without dedup, key in hand.
          const keyErr = idempotencyKeyError(raw)
          if (keyErr) return res.status(400).json({ error: keyErr, code: 'VALIDATION' })
          const d = scoped ? { user_id: ownerOf(req) } : {}
          for (const k of Object.keys(raw)) if (writableNames.has(k)) d[k] = coerce(k, raw[k])
          const keys = Object.keys(d)
          if (!keys.length) return res.status(400).json({ error: 'No valid fields' })

          /* ⭐ DEDUP AT THE WRITE DOOR (WEAVE.md §3.4). The trigger engine has always
             sent a DERIVED key — same trigger + same event ⇒ same key — and until
             this call nothing in the suite read it: the writer dropped it as an
             unknown body field and a retried DO wrote a second row. Idempotency is
             a property of the RECEIVER, and this is the receiver.

             ⚠️ Scoped by (door, USER), never globally: a per-user delegated DO fans
             one trigger out to N users carrying the SAME key, and a global store
             would answer user B with user A's row — with a 200 and no error. See
             ./idempotency.js.

             No key means no dedup, exactly as before; every GUI write arrives
             without one. */
          const out = withIdempotency(db, {
            scope: `${app}.${id}`,
            userId: ownerOf(req),
            key: idempotencyKeyOf(raw),
            write: () => {
              const r = run(`INSERT INTO ${id} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => d[k]))
              return { status: 201, body: toRow(get(`SELECT * FROM ${id} WHERE id = ?`, [r.lastInsertRowid])) }
            },
          })
          // The FIRST attempt's status and body, verbatim — not a fresh 201. A
          // caller that retried and got a new-looking creation has no way to tell
          // it did not create a second row, which is the confusion the key exists
          // to remove; the header is how it tells.
          if (out.replayed) res.set('Idempotent-Replay', 'true')
          res.status(out.status).json(out.body)
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
          const wireErr = checkWire(req.body || {})
          if (wireErr) return res.status(400).json({ error: wireErr, code: 'VALIDATION' })
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


/** One-time conversion of a collection's existing rows to the canonical wire
 *  format (XC-1). Safe to run repeatedly — `strftime` re-formatting an
 *  already-canonical value returns it unchanged — so an app can call it from a
 *  migration without needing to know whether it has run before.
 *
 *  ⚠️ Run it for EVERY collection the app owns, not only the ones that look
 *  stale. A cursor is a single ordering across the app's tables; converting some
 *  leaves exactly the mixed-format sort this exists to remove.
 */
/* `extra` names non-standard wire columns per table, e.g. `{ history: ['started_at'] }`.
   ⚠️ Needed because the two-name rule (`created_at`/`updated_at`) is not the whole
   truth: KourOS's ledgers' `started_at` is client-stamped AND is what
   their activity read windows on, so it is a wire timestamp under a third name. A
   convention that only recognises two names cannot see the one that broke. */
function backfillWireTime(db, tableIds, extra = {}) {
  for (const t of tableIds) {
    // ⚠️ Ask, don't assume. Not every table in an app's list is a
    // defineCollection — a scanner-populated catalog like KourOS's `tracks` or
    // `books` is hand-rolled and may carry only one of the two columns
    // (or neither). A migration that throws on a table it was handed is a BOOT
    // LOOP, which is the trap this codebase already paid for once in a
    // progress migration, and the cost of checking is one PRAGMA.
    let present
    try {
      present = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
    } catch {
      continue  // no such table in this deployment — nothing to convert
    }
    for (const col of ['created_at', 'updated_at', ...(extra[t] || [])]) {
      if (!present.has(col)) continue
      db.exec(`UPDATE ${t} SET ${col} = ${sqlConvert(col)} `
            + `WHERE ${col} IS NOT NULL AND ${col} NOT LIKE '____-__-__T__:__:__.___Z'`)
    }
  }
}

module.exports = { defineCollection, backfillWireTime }

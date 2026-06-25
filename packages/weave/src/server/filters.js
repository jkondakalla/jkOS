'use strict'
// weave/server/filters.js — declarative list-endpoint filters.
//
// The weave filter vocabulary so peers fetch only what they own/need instead of
// dumping every row. An app passes a SPEC (which query params map to which column
// and operator); this turns req.query into parameterised WHERE clauses. All values
// are bound (never interpolated), so the spec is the only trusted surface.
//
// Operators:
//   'eq'     column = ?
//   'gt'     column > ?            (deltas, e.g. ?since= over updated_at)
//   'prefix' column LIKE ?  (value + '%')   — an app's own ext_ref namespace
//   'tags'   one `column LIKE '%"tag"%'` per CSV tag — JSON-array membership
//
// Example spec (BeigeBoard items):
//   [ { param:'kind', column:'kind', op:'eq' },
//     { param:'scope', column:'scope', op:'eq' },
//     { param:'due_date', column:'due_date', op:'eq' },
//     { param:'ext_ref_prefix', column:'ext_ref', op:'prefix' },
//     { param:'since', column:'updated_at', op:'gt' },
//     { param:'tags', column:'tags', op:'tags' } ]

/**
 * @param {Record<string, unknown>} query  req.query
 * @param {Array<{param:string, column:string, op:'eq'|'gt'|'prefix'|'tags'}>} spec
 * @param {{ base?: string[], baseParams?: unknown[] }} [seed] clauses/params the
 *   caller always wants ANDed in first (e.g. ['user_id = ?'] + [req.user.sub]).
 * @returns {{ clauses: string[], params: unknown[], where: string }}
 */
// Escape LIKE metacharacters so a user-supplied value matches LITERALLY. Without
// this, a `%` or `_` in an ext_ref prefix or a tag acts as a wildcard and the filter
// silently over-matches (e.g. ?ext_ref_prefix=a_b would match "aXb"). Used with an
// explicit ESCAPE clause below; values are still bound (this is correctness, not
// injection — binding already prevents that).
const escLike = (v) => v.replace(/[\\%_]/g, (c) => '\\' + c)

/**
 * Project a DatasetDoc's declared `filters` (FilterField[]) into the `{param,column,op}`
 * spec `buildItemFilters` consumes — the single-source bridge (P3). An app declares its
 * filters ONCE on the dataset (name/type/label for the GUI/AI + column/op for enforcement);
 * the list endpoint derives its SQL filter from that same declaration, so what the dataset
 * SAYS it can be read by is exactly what it filters on. `column` defaults to the param name,
 * `op` to 'eq'.
 * @param {Array<{name:string, column?:string, op?:'eq'|'gt'|'prefix'|'tags'}>} filters
 * @returns {Array<{param:string, column:string, op:string}>}
 */
function filterSpec(filters = []) {
  return (filters || []).map((f) => ({ param: f.name, column: f.column || f.name, op: f.op || 'eq' }))
}

function buildItemFilters(query, spec, seed = {}) {
  const clauses = Array.isArray(seed.base) ? [...seed.base] : []
  const params = Array.isArray(seed.baseParams) ? [...seed.baseParams] : []
  for (const f of spec || []) {
    const v = query?.[f.param]
    if (v == null || v === '') continue
    const s = String(v)
    switch (f.op) {
      case 'eq':     clauses.push(`${f.column} = ?`); params.push(s); break
      case 'gt':     clauses.push(`${f.column} > ?`); params.push(s); break
      case 'prefix': clauses.push(`${f.column} LIKE ? ESCAPE '\\'`); params.push(escLike(s) + '%'); break
      case 'tags':
        for (const t of s.split(',').map(x => x.trim()).filter(Boolean)) {
          // strip embedded quotes so the JSON-membership match can't be broken out of,
          // then escape LIKE wildcards so the tag matches literally
          clauses.push(`${f.column} LIKE ? ESCAPE '\\'`); params.push('%"' + escLike(t.replace(/"/g, '')) + '"%')
        }
        break
      default: break
    }
  }
  return { clauses, params, where: clauses.join(' AND ') }
}

module.exports = { buildItemFilters, filterSpec }

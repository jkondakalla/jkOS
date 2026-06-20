'use strict'
// weave/server/columns.js — coerce a client value to its stored column form for
// the weave interop columns. Booleans → 0/1 (every column); `tags` → a JSON-array
// string, the shape the row reader parses back and the ?tags= filter matches with
// LIKE '%"tag"%':
//   • array/object → JSON.stringify
//   • CSV string ("a, b") → ["a","b"]   (what the createItem capability declares)
//   • existing JSON-array text → passed through ONLY if it actually parses to an
//     array. (BUG FIX: the old code returned any string starting with '[' raw, so
//     a malformed '[oops' was stored, then the row reader's JSON.parse threw and
//     silently dropped EVERY tag. Now it falls back to '[]'.)

function coerceWeaveColumn(k, v) {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (k === 'tags') {
    if (v == null) return v
    if (typeof v === 'object') return JSON.stringify(v)
    if (typeof v === 'string') {
      const s = v.trim()
      if (!s) return '[]'
      if (s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s)
          return Array.isArray(parsed) ? s : '[]'
        } catch {
          return '[]'
        }
      }
      return JSON.stringify(s.split(',').map(t => t.trim()).filter(Boolean))
    }
  }
  return v
}

module.exports = { coerceWeaveColumn }

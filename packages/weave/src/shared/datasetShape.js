// datasetShape.js — does what a dataset ANSWERS match what it DECLARES?
//
// A DatasetDef says two things a reader builds on without ever seeing the server:
//
//   cardinality  what one GET answers. 'many' (the default) is a bare JSON array of
//                rows — the list contract every `since`-paged collection keeps, and the
//                one weaveClient.list relies on (it reads a non-array as NO rows). 'one'
//                is a single JSON document: a session, a stats block, one book in full.
//   item         the fields of one row (many) or of the document (one).
//
// ⚠️ Neither was checked against a real answer. BeigeBoard's `library` declared its
// entry row as `item` and answered `{ collections, count, entries }`; KourOS's
// similar/radio/run/near declared a track row and answered `{ basis, results }`. A
// reader trusting the declaration — a widget, an AI composer, weaveClient — got an
// object where it was promised rows, and read it as empty. No error anywhere.
//
// So this is the check each app's smoke runs against its REAL endpoints: the answer's
// envelope matches `cardinality`, every key it carries is declared, every declared
// field is present, and each value is the declared type. Pure, ESM, no dependencies —
// the same shape as docShape.js, so a smoke (ESM), a CJS backend (require(ESM)) and
// the browser can all use it.

/** The two things a dataset GET may answer. */
export const CARDINALITIES = ['many', 'one']

/** A def's cardinality, with the default applied. */
export function cardinalityOf(def) {
  return def && def.cardinality === 'one' ? 'one' : 'many'
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}(:\d{2})?$/

/** Is `v` a value of the declared field type? null is always allowed: a declared
 *  field may be empty, and "present but null" is not a shape defect. */
function fits(field, v) {
  if (v === null) return true
  switch (field.type) {
    case 'string':
    case 'text':
      return typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'boolean':
      return typeof v === 'boolean'
    case 'date':
      return typeof v === 'string' && DATE.test(v)
    case 'time':
      return typeof v === 'string' && TIME.test(v)
    case 'enum':
      return typeof v === 'string' && (!Array.isArray(field.enum) || field.enum.includes(v))
    case 'ref':
      return typeof v === 'string' || typeof v === 'number'
    case 'json':
      // A document or a list — never a JSON-encoded STRING, which a binder cannot dig into.
      return typeof v === 'object'
    default:
      return false
  }
}

/** Describe a value for a problem message without dumping it. */
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : `a ${typeof v} (${JSON.stringify(v).slice(0, 40)})`)

/**
 * Check one GET's parsed JSON body against its DatasetDef.
 *
 * @param {{ id: string, cardinality?: 'many'|'one', item?: {name: string, type: string, enum?: string[]}[] }} def
 * @param {unknown} body
 * @param {{ maxRows?: number }} [opts] rows to inspect (a list may be long; the shape is per-row)
 * @returns {string[]} problems — [] when the answer is what the declaration says
 */
export function checkDatasetAnswer(def, body, { maxRows = 50 } = {}) {
  const out = []
  const card = cardinalityOf(def)
  const item = Array.isArray(def.item) ? def.item : null

  if (item) {
    const seen = new Set()
    for (const f of item) {
      if (seen.has(f.name)) out.push(`'${def.id}' declares the field '${f.name}' twice — a reader cannot know which type it is`)
      seen.add(f.name)
    }
  }

  let docs
  if (card === 'many') {
    if (!Array.isArray(body)) {
      out.push(`'${def.id}' is declared as a list of rows (cardinality 'many') and answered ${kind(body)} — `
        + 'answer a bare array, or declare `cardinality: \'one\'` and describe the document in `item`')
      return out
    }
    docs = body.slice(0, maxRows)
  } else {
    if (!isObj(body)) {
      out.push(`'${def.id}' is declared as one document (cardinality 'one') and answered ${kind(body)}`)
      return out
    }
    docs = [body]
  }
  if (!item) return out

  const byName = new Map(item.map((f) => [f.name, f]))
  const reported = new Set()
  const once = (key, msg) => { if (!reported.has(key)) { reported.add(key); out.push(msg) } }
  docs.forEach((doc, i) => {
    const where = card === 'many' ? `row ${i}` : 'the document'
    if (!isObj(doc)) { once(`row:${i}`, `'${def.id}' ${where} is ${kind(doc)}, not an object`); return }
    for (const k of Object.keys(doc)) {
      if (!byName.has(k)) once(`extra:${k}`, `'${def.id}' answers the field '${k}', which its \`item\` does not declare`)
    }
    for (const f of item) {
      if (!(f.name in doc)) { once(`missing:${f.name}`, `'${def.id}' declares the field '${f.name}' and ${where} does not carry it`); continue }
      if (!fits(f, doc[f.name])) {
        once(`type:${f.name}`, `'${def.id}'.${f.name} is declared '${f.type}'${f.enum ? ` (${f.enum.join('|')})` : ''} and ${where} holds ${kind(doc[f.name])}`)
      }
    }
  })
  return out
}

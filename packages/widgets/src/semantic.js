// semantic.js — does this widget bind what its apps actually DECLARE?
//
// validate.js is the structural + security tier: it needs nothing but the def, which is
// why jkAuth runs it at publish. This is the second tier, and it needs the declarations
// in hand — each app's DatasetDoc and CapabilityDoc, and ORDECK's HUD slice declaration
// (apps/ordeck/src/hud/slices.ts). The gate and `pnpm widget check` have them; jkAuth,
// which by design stores where an app's declarations live and never their contents,
// does not. Weave is a dev-time contract boundary, and this is where it is held.
//
// Before it, a binding to a field nobody declares drew an empty string and nothing
// said why: `{ src: 'jobs', path: 'statsu' }`, a form binding `$form.titel` that no
// input writes, a command body field the capability does not take, a dataset source
// naming a filter the dataset does not honour. Each is refused here, at a JSON Pointer,
// with the likely intended name.
//
// Shapes, as this file reads them:
//   fields  an object whose keys are declared (a slice, a 'one' dataset, a row)
//   list    rows, each a `fields` (a 'many' dataset) — a numeric segment or `length`
//   scalar  no fields below it
//   any     not declared deeply enough to check (a `schema` pointer, a fetch source)

import { NODES, FRAME, childProps } from './manifest.js'
import { CONDITIONS } from '@jkos/weave/binding'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1')
const ANY = { kind: 'any' }
const SCALAR = { kind: 'scalar' }

/** A declared field (BodyField / SliceField) → the shape a path continues into. */
function shapeOfField(f, docs) {
  if (!f) return ANY
  if (f.type !== 'json') return SCALAR
  if (f.of) return { kind: 'list', item: SCALAR }
  if (Array.isArray(f.item)) return fieldsShape(f.item)
  if (isObj(f.item)) return fieldsShape(Object.entries(f.item).map(([name, x]) => ({ name, ...x })))
  if (typeof f.schema === 'string') {
    const m = f.schema.match(/^([a-z][a-z0-9-]*)\.([A-Za-z_][\w]*)$/)
    const ds = m && docs[m[1]]?.datasets?.datasets?.find((d) => d.id === m[2])
    if (ds && Array.isArray(ds.item)) return { kind: 'list', item: fieldsShape(ds.item) }
  }
  return ANY
}

function fieldsShape(list) {
  return { kind: 'fields', fields: new Map(list.map((f) => [f.name, f])) }
}

/** The shape a dataset source answers with (its cardinality, its `item`). */
function datasetShape(ds) {
  if (!ds || !Array.isArray(ds.item)) return ANY
  const row = fieldsShape(ds.item)
  return ds.cardinality === 'one' ? row : { kind: 'list', item: row }
}

/** Walk `path` through `shape`. Returns the shape reached, or { problem, fix? }. */
function follow(shape, path, docs) {
  let cur = shape
  if (!path) return cur
  for (const seg of String(path).split('.')) {
    if (cur.kind === 'any') return ANY
    if (cur.kind === 'scalar') return { problem: `'${seg}' — the value before it has no fields` }
    if (cur.kind === 'list') {
      if (seg === 'length') { cur = SCALAR; continue }
      if (/^\d+$/.test(seg)) { cur = cur.item; continue }
      return { problem: `'${seg}' — this is a list: bind it to a list's \`from\` and read '${seg}' from $ inside it`, fix: 'list.from, then { src: "$", path: "…" }' }
    }
    const f = cur.fields.get(seg)
    if (!f) {
      const near = nearest(seg, [...cur.fields.keys()])
      return { problem: `no field '${seg}' is declared here`, fix: near ? `did you mean ${JSON.stringify(near)}?` : `declared: ${[...cur.fields.keys()].join(', ')}` }
    }
    cur = shapeOfField(f, docs)
  }
  return cur
}

function nearest(word, options) {
  let best = null
  let bestD = Infinity
  for (const o of options) {
    const d = editDistance(String(word).toLowerCase(), o.toLowerCase())
    if (d < bestD) { bestD = d; best = o }
  }
  // validate.js's rule: a swapped pair is two edits; a short word gets one.
  const w = String(word)
  return bestD <= Math.max(w.length <= 3 ? 1 : 2, Math.floor(w.length / 3)) ? best : null
}
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

/** The fields `$job` carries while a command runs (@jkos/weave followJob's JobOutcome). */
const JOB = fieldsShape([
  { name: 'phase', type: 'enum' }, { name: 'status', type: 'string' },
  { name: 'result', type: 'json' }, { name: 'error', type: 'string' },
])

/**
 * The second tier. Returns problems as validate.js does ({ path, code, message, fix? });
 * [] when every binding reaches something declared.
 *
 * @param {object} def a widget def that already passes validateWidget
 * @param {{ docs?: Record<string, { capabilities?: { capabilities: object[] }, datasets?: { datasets: object[] } }>,
 *           slices?: Record<string, object> }} ctx
 */
export function checkBindings(def, { docs = {}, slices = {} } = {}) {
  const out = []
  const err = (path, code, message, fix) => out.push(fix ? { path, code, message, fix } : { path, code, message })
  const spec = def?.spec
  if (!isObj(spec)) return out

  // ── the base scope: slices, the reserved sources, and the spec's own sources ──
  const scope = new Map()
  for (const [name, f] of Object.entries(slices)) scope.set(name, shapeOfField({ ...f, name }, docs))
  scope.set('$now', SCALAR)
  const sources = isObj(spec.sources) ? spec.sources : {}
  const sourceStates = new Map()
  for (const [name, s] of Object.entries(sources)) {
    const at = `/spec/sources/${esc(name)}`
    sourceStates.set(name, { name, type: 'json', item: [{ name: 'state', type: 'string' }, { name: 'error', type: 'string' }] })
    if (!isObj(s) || s.kind !== 'dataset') { scope.set(name, ANY); continue }
    const doc = docs[s.app]?.datasets
    if (!doc) { err(`${at}/app`, 'undeclared', `${JSON.stringify(s.app)} declares no datasets (or is not an app)`, `apps with datasets: ${Object.keys(docs).filter((a) => docs[a]?.datasets).join(', ')}`); scope.set(name, ANY); continue }
    const ds = doc.datasets.find((d) => d.id === s.dataset)
    if (!ds) {
      const near = nearest(s.dataset, doc.datasets.map((d) => d.id))
      err(`${at}/dataset`, 'undeclared', `${s.app} declares no dataset ${JSON.stringify(s.dataset)}`, near ? `did you mean ${JSON.stringify(near)}?` : `declared: ${doc.datasets.map((d) => d.id).join(', ')}`)
      scope.set(name, ANY)
      continue
    }
    const pathParams = [...String(ds.path).matchAll(/:(\w+)/g)].map((m) => m[1])
    const declared = [...pathParams, ...(ds.filters ?? []).map((f) => f.name)]
    const given = isObj(s.params) ? s.params : {}
    for (const k of Object.keys(given)) {
      if (!declared.includes(k)) {
        const near = nearest(k, declared)
        err(`${at}/params/${esc(k)}`, 'undeclared', `${s.app}.${s.dataset} honours no parameter ${JSON.stringify(k)} — the server would ignore it`, near ? `did you mean ${JSON.stringify(near)}?` : declared.length ? `declared: ${declared.join(', ')}` : 'it takes none')
      }
    }
    for (const p of pathParams) if (!(p in given)) err(`${at}/params`, 'missing-param', `${s.app}.${s.dataset} is read at ${ds.path} — give '${p}' a value`)
    for (const f of ds.filters ?? []) if (f.required && !(f.name in given)) err(`${at}/params`, 'missing-param', `${s.app}.${s.dataset} requires the filter '${f.name}'`)
    scope.set(name, datasetShape(ds))
  }
  scope.set('$sources', fieldsShape([...sourceStates.values()]))

  // A binding (and its operands) in `v`, read against `sc`, found at `at`.
  const checkBinding = (v, at, sc) => {
    if (!isObj(v) || 'lit' in v) return
    const keys = Object.keys(v)
    if (keys.length === 1 && CONDITIONS.includes(keys[0])) {
      const arg = v[keys[0]]
      const ops = Array.isArray(arg) ? arg.flatMap((x) => (Array.isArray(x) ? x : [x])) : [arg]
      ops.forEach((o) => checkBinding(o, at, sc))
      return
    }
    const src = typeof v.src === 'string' ? v.src : null
    if (!src) return
    if (!sc.has(src)) {
      const near = nearest(src, [...sc.keys()])
      err(at, 'unknown-source', `no source named ${JSON.stringify(src)} is in scope here`, near ? `did you mean ${JSON.stringify(near)}?` : `in scope: ${[...sc.keys()].join(', ')}`)
      return
    }
    const r = follow(sc.get(src), v.path, docs)
    if (r.problem) err(at, 'undeclared-path', `${src}${v.path ? `.${v.path}` : ''}: ${r.problem}`, r.fix)
  }
  const bindingsIn = (obj, props, at, sc) => {
    for (const [name, p] of Object.entries(props)) {
      if (obj[name] === undefined) continue
      if (p.type === 'binding' || p.type === 'tone') checkBinding(obj[name], `${at}/${esc(name)}`, sc)
    }
  }

  if (isObj(spec.frame)) bindingsIn(spec.frame, FRAME, '/spec/frame', scope)
  for (const [name, s] of Object.entries(sources)) {
    if (isObj(s) && isObj(s.params)) for (const [k, b] of Object.entries(s.params)) checkBinding(b, `/spec/sources/${esc(name)}/params/${esc(k)}`, scope)
  }

  // ── the tree, carrying what `$`, `$form`, `$result` and `$job` are at each node ──
  const formFields = (node) => {
    const acc = []
    const visit = (n) => {
      if (!isObj(n)) return
      if (typeof n.field === 'string' && ['input', 'select', 'toggle'].includes(n.t)) acc.push({ name: n.field, type: 'string' })
      for (const { name, many } of childProps(n.t)) {
        if (name === 'result') continue
        const c = n[name]
        if (many && Array.isArray(c)) c.forEach(visit)
        else if (!many && c) visit(c)
      }
    }
    ;(node.children ?? []).forEach(visit)
    return fieldsShape(acc)
  }
  const checkCmd = (cmd, at, sc) => {
    if (!isObj(cmd)) return null
    const capDoc = docs[cmd.app]?.capabilities
    if (!capDoc) { err(`${at}/app`, 'undeclared', `${JSON.stringify(cmd.app)} declares no capabilities (or is not an app)`); return null }
    const cap = capDoc.capabilities.find((c) => c.id === cmd.capability)
    if (!cap) {
      const near = nearest(cmd.capability, capDoc.capabilities.map((c) => c.id))
      err(`${at}/capability`, 'undeclared', `${cmd.app} declares no capability ${JSON.stringify(cmd.capability)}`, near ? `did you mean ${JSON.stringify(near)}?` : `declared: ${capDoc.capabilities.map((c) => c.id).join(', ')}`)
      return null
    }
    const body = isObj(cmd.body) ? cmd.body : {}
    const fields = new Map((cap.body ?? []).map((f) => [f.name, f]))
    for (const [k, b] of Object.entries(body)) {
      if (!fields.has(k)) {
        const near = nearest(k, [...fields.keys()])
        err(`${at}/body/${esc(k)}`, 'undeclared', `${cmd.app}.${cmd.capability} takes no body field ${JSON.stringify(k)}`, near ? `did you mean ${JSON.stringify(near)}?` : `it takes: ${[...fields.keys()].join(', ') || 'nothing'}`)
      }
      checkBinding(b, `${at}/body/${esc(k)}`, sc)
    }
    for (const f of fields.values()) {
      if (f.required && f.default === undefined && !(f.name in body)) {
        err(`${at}/body`, 'missing-field', `${cmd.app}.${cmd.capability} requires '${f.name}', and nothing binds it`)
      }
    }
    // What the command produces: an async one's result is what it RESOLVES to.
    return Array.isArray(cap.resolves) ? fieldsShape(cap.resolves) : Array.isArray(cap.returns) ? fieldsShape(cap.returns) : ANY
  }

  const visit = (node, at, sc) => {
    if (!isObj(node) || !NODES[node.t]) return
    const spec_ = NODES[node.t]
    let here = sc
    if (node.t === 'form') {
      here = new Map(sc)
      here.set('$form', formFields(node))
    }
    bindingsIn(node, spec_.props, at, here)
    const produced = spec_.props.cmd ? checkCmd(node.cmd, `${at}/cmd`, here) : null
    for (const { name, many } of childProps(node.t)) {
      const c = node[name]
      if (c === undefined) continue
      let inner = here
      if (node.t === 'list' && name === 'item') {
        const from = isObj(node.from) && typeof node.from.src === 'string' && here.has(node.from.src) ? follow(here.get(node.from.src), node.from.path, docs) : ANY
        inner = new Map(here)
        inner.set('$', from.kind === 'list' ? from.item : from.kind === 'fields' ? from : ANY)
      }
      if (name === 'result') {
        inner = new Map(sc)                       // a result is drawn beside the form: no $form
        inner.set('$result', produced ?? ANY)
        inner.set('$job', JOB)
      }
      if (many && Array.isArray(c)) c.forEach((x, i) => visit(x, `${at}/${esc(name)}/${i}`, inner))
      else if (!many) visit(c, `${at}/${esc(name)}`, inner)
    }
  }
  visit(spec.body, '/spec/body', scope)
  return out
}

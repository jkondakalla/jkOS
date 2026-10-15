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

import { NODES, FRAME, ACTIONS, childProps } from './manifest.js'
import { CONDITIONS } from '@jkos/weave/binding'
import { routeParams } from './routes.js'
import { walkNodes } from './walk.js'
import { fitsType } from './validate.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1')
const ANY = { kind: 'any' }
const SCALAR = { kind: 'scalar' }

/** A declared field (BodyField / SliceField) → the shape a path continues into. */
function shapeOfField(f, docs) {
  if (!f) return ANY
  if (f.type !== 'json') return SCALAR
  if (f.of) return { kind: 'list', item: SCALAR }
  // A json field with an `item` holds rows of it, or one of it (BodyField's own words) —
  // so it reads as the row's fields, and also as a list: `length`, or a row by index.
  if (Array.isArray(f.item)) return { ...fieldsShape(f.item), maybeList: true }
  if (isObj(f.item)) return { ...fieldsShape(Object.entries(f.item).map(([name, x]) => ({ name, ...x }))), maybeList: true }
  if (typeof f.schema === 'string') {
    const m = f.schema.match(/^([a-z][a-z0-9-]*)\.([A-Za-z_][\w]*)$/)
    const ds = m && docs[m[1]]?.datasets?.datasets?.find((d) => d.id === m[2])
    if (ds && Array.isArray(ds.item)) return datasetShape(ds)
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
    if (cur.maybeList && seg === 'length') { cur = SCALAR; continue }
    if (cur.maybeList && /^\d+$/.test(seg)) { cur = { kind: 'fields', fields: cur.fields }; continue }
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
export function checkBindings(def, { docs = {}, slices = {}, actions = {}, pages, widgets } = {}) {
  const out = []
  const err = (path, code, message, fix) => out.push(fix ? { path, code, message, fix } : { path, code, message })
  const spec = def?.spec
  if (!isObj(spec)) return out

  // ── the base scope: slices, the reserved sources, and the spec's own sources ──
  const scope = new Map()
  for (const [name, f] of Object.entries(slices)) scope.set(name, shapeOfField({ ...f, name }, docs))
  scope.set('$now', SCALAR)
  // A part reads what it is handed as $in — each input as declared.
  if (isObj(spec.inputs)) scope.set('$in', fieldsShape(Object.entries(spec.inputs).map(([name, d]) => ({ name, type: isObj(d) ? d.type : 'json' }))))
  // A page reads its route's params; any other widget has no route to read.
  if (typeof def.route === 'string') scope.set('$route', fieldsShape(routeParams(def.route).map((name) => ({ name, type: 'string' }))))
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
    // A debounce waits for a BOUND param to settle; with only literals nothing ever changes.
    if (s.debounce !== undefined && !Object.values(given).some((b) => isObj(b) && !('lit' in b))) {
      err(`${at}/debounce`, 'debounce-unbound', `${s.app}.${s.dataset} binds no param, so nothing changes for debounce to wait on`,
        'bind the param it waits on (a search box writes `$state.q`: { "params": { "q": { "src": "$state", "path": "q" } } }), or drop debounce')
    }
    scope.set(name, datasetShape(ds))
  }
  scope.set('$sources', fieldsShape([...sourceStates.values()]))
  // $state: this widget's own variables, each as declared (a json one is not checked deeper).
  const stateDecl = isObj(spec.state) ? spec.state : {}
  scope.set('$state', fieldsShape(Object.entries(stateDecl).map(([name, d]) => ({ name, type: isObj(d) ? d.type : 'json' }))))
  const checkStateName = (name, at) => {
    if (typeof name !== 'string' || name in stateDecl) return
    const near = nearest(name, Object.keys(stateDecl))
    err(at, 'undeclared', `no state variable ${JSON.stringify(name)} is declared in spec.state`, near ? `did you mean ${JSON.stringify(near)}?` : `declare it: "state": { "${name}": { "type": "string" } }`)
  }

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
  // `extra.row` is the scope a list pattern's per-row prop reads ($ = a row of `from`);
  // `extra.result` the scope a command's answer reads ($result / $job).
  const bindingsIn = (obj, props, at, sc, extra = {}) => {
    for (const [name, p] of Object.entries(props)) {
      const v = obj[name]
      if (v === undefined) continue
      const here = p.row ? extra.row ?? sc : p.result ? extra.result ?? sc : sc
      if (p.type === 'binding' || p.type === 'tone') checkBinding(v, `${at}/${esc(name)}`, here)
      if (p.type === 'state') checkStateName(v, `${at}/${esc(name)}`)
      if (p.type === 'pairs' && Array.isArray(v)) {
        v.forEach((pair, i) => {
          for (const k of ['label', 'value', 'tone']) if (isObj(pair) && pair[k] !== undefined) checkBinding(pair[k], `${at}/${esc(name)}/${i}/${k}`, here)
        })
      }
    }
  }
  /** The shape `$` has inside a list-like node: a row of what `from` reads. */
  const rowOf = (from, sc) => {
    const shape = isObj(from) && typeof from.src === 'string' && sc.has(from.src) ? follow(sc.get(from.src), from.path, docs) : ANY
    return shape.kind === 'list' ? shape.item : shape.kind === 'fields' ? shape : ANY
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
  const checkCmd = (cmd, at, sc, sent = {}) => {
    if (!isObj(cmd)) return null
    const capDoc = docs[cmd.app]?.capabilities
    if (!capDoc) { err(`${at}/app`, 'undeclared', `${JSON.stringify(cmd.app)} declares no capabilities (or is not an app)`); return null }
    const cap = capDoc.capabilities.find((c) => c.id === cmd.capability)
    if (!cap) {
      const near = nearest(cmd.capability, capDoc.capabilities.map((c) => c.id))
      err(`${at}/capability`, 'undeclared', `${cmd.app} declares no capability ${JSON.stringify(cmd.capability)}`, near ? `did you mean ${JSON.stringify(near)}?` : `declared: ${capDoc.capabilities.map((c) => c.id).join(', ')}`)
      return null
    }
    const body = { ...(isObj(cmd.body) ? cmd.body : {}), ...sent }
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

  /* A list read from INSIDE a one-document dataset (`home.continue_books`) can be empty
     while its source is not: the frame calls a document empty only when it is null, so it
     draws the body — and a list with nothing to say draws a blank card. Such a list says
     its own `empty`, or sits under a `when` on that same list (an empty array is false). */
  const oneDoc = new Set()
  for (const [name, s] of Object.entries(sources)) {
    if (!isObj(s) || s.kind !== 'dataset') continue
    const ds = docs[s.app]?.datasets?.datasets?.find((d) => d.id === s.dataset)
    if (ds?.cardinality === 'one') oneDoc.add(name)
  }
  const guardOf = (b) => (isObj(b) && typeof b.src === 'string' && !b.map && !b.fmt ? `${b.src}\u0000${b.path ?? ''}` : null)
  const silentEmpty = (node, at, guards) => {
    const spec_ = NODES[node.t]
    if (!spec_.props.from || !spec_.props.empty || node.empty !== undefined) return
    const from = node.from
    if (!isObj(from) || !oneDoc.has(from.src) || !from.path || guards.has(guardOf(from))) return
    err(`${at}/empty`, 'silent-empty', `${from.src}.${from.path} is a list inside one document — when it is empty the source is not, so the frame draws the body and this ${node.t} draws nothing: a blank card`,
      `give it an \`empty\` line, or put it under { "t": "when", "cond": { "src": "${from.src}", "path": "${from.path}" }, "then": …, "else": … }`)
  }

  /* An event's actions, in order, each read in the event's scope — and the actions after a
     `run` read what it produced as $result (an async capability: what it RESOLVES to). */
  const checkChain = (chain, at, sc) => {
    let here = sc
    const list = Array.isArray(chain) ? chain : [chain]
    list.forEach((a, i) => {
      if (!isObj(a)) return
      const p = Array.isArray(chain) ? `${at}/${i}` : at
      if ('run' in a) {
        const produced = checkCmd(a.run, `${p}/run`, here)
        here = new Map(here)
        here.set('$result', produced ?? ANY)
        here.set('$job', JOB)
      } else if ('set' in a) {
        checkStateName(a.set, `${p}/set`)
        checkBinding(a.to, `${p}/to`, here)
      } else if ('do' in a) {
        const produced = checkHostAction(a, p)
        here = new Map(here)
        here.set('$result', produced)
      } else if ('go' in a) {
        checkGo(a, p)
      }
      for (const [name, spec_] of Object.entries(ACTIONS[Object.keys(a).find((k) => ACTIONS[k])]?.props ?? {})) {
        if (spec_.type === 'params' && isObj(a[name])) for (const [k, b] of Object.entries(a[name])) checkBinding(b, `${p}/${esc(name)}/${esc(k)}`, here)
      }
    })
  }

  /* A host action, against what the HOST declares (ctx.actions — ORDECK's HUD_ACTIONS):
     it exists, takes the arguments given, and gets each one it requires. What it returns,
     if declared, is $result to the actions after it. */
  function checkHostAction(a, p) {
    const decl = actions[a.do]
    if (!decl) {
      const near = nearest(a.do, Object.keys(actions))
      err(`${p}/do`, 'undeclared', `this host declares no action ${JSON.stringify(a.do)}`, near ? `did you mean ${JSON.stringify(near)}?` : Object.keys(actions).length ? `declared: ${Object.keys(actions).join(', ')}` : 'this host declares no actions')
      return ANY
    }
    const args = new Map((decl.args ?? []).map((f) => [f.name, f]))
    const given = isObj(a.with) ? a.with : {}
    for (const k of Object.keys(given)) {
      if (!args.has(k)) {
        const near = nearest(k, [...args.keys()])
        err(`${p}/with/${esc(k)}`, 'undeclared', `${a.do} takes no argument ${JSON.stringify(k)}`, near ? `did you mean ${JSON.stringify(near)}?` : `it takes: ${[...args.keys()].join(', ') || 'nothing'}`)
      }
    }
    for (const f of args.values()) if (f.required && !(f.name in given)) err(`${p}/with`, 'missing-field', `${a.do} requires '${f.name}', and nothing binds it`)
    // An argument given as a literal is held to its declared type — an enum to its values.
    for (const [k, v] of Object.entries(given)) {
      const f = args.get(k)
      const lit = !isObj(v) ? v : 'lit' in v ? v.lit : undefined
      if (!f || lit === undefined || lit === null) continue
      const bad = f.type === 'enum' ? Array.isArray(f.enum) && !f.enum.includes(lit)
        : ['string', 'number', 'boolean'].includes(f.type) && !fitsType(f.type, lit)
      if (bad) err(`${p}/with/${esc(k)}`, 'bad-value', `${a.do}'s '${k}' is ${f.type === 'enum' ? `one of ${f.enum.join(', ')}` : `a ${f.type}`} — not ${JSON.stringify(lit)}`)
    }
    return Array.isArray(decl.returns) ? fieldsShape(decl.returns) : ANY
  }

  /* A `go`: its params fill exactly the route's :params, and — given the app's pages
     (ctx.pages, every route its page widgets declare) — the route is one of them. */
  function checkGo(a, p) {
    if (typeof a.go !== 'string') return
    if (Array.isArray(pages) && !pages.includes(a.go)) {
      const near = nearest(a.go, pages)
      err(`${p}/go`, 'undeclared', `no page of this app answers ${a.go}`, near ? `did you mean ${JSON.stringify(near)}?` : pages.length ? `its pages: ${pages.join(', ')}` : 'this app has no pages yet — a page is a widget file with a `route`')
    }
    const want = routeParams(a.go)
    const given = isObj(a.params) ? a.params : {}
    for (const k of Object.keys(given)) if (!want.includes(k)) err(`${p}/params/${esc(k)}`, 'undeclared', `${a.go} has no :${k}`, want.length ? `its params: ${want.join(', ')}` : 'it takes none')
    for (const k of want) if (!(k in given)) err(`${p}/params`, 'missing-param', `${a.go} needs a value for :${k}`)
  }

  /* A `use`, against the part it draws (ctx.widgets — every widget file, by id): it
     exists, is handed only inputs it declares, gets every required one, a literal fits
     its input's type, and the parts never come back round to this widget. */
  function checkUse(node, at, sc) {
    for (const [k, b] of Object.entries(isObj(node.with) ? node.with : {})) checkBinding(b, `${at}/with/${esc(k)}`, sc)
    if (!widgets || typeof node.widget !== 'string') return
    const part = widgets[node.widget]
    if (!part) {
      const near = nearest(node.widget, Object.keys(widgets))
      err(`${at}/widget`, 'undeclared', `no widget ${JSON.stringify(node.widget)} exists`, near ? `did you mean ${JSON.stringify(near)}?` : 'a part is a widget file (apps/<app>/widgets/<id>.json)')
      return
    }
    const inputs = isObj(part.spec?.inputs) ? part.spec.inputs : {}
    const given = isObj(node.with) ? node.with : {}
    for (const [k, b] of Object.entries(given)) {
      const decl = inputs[k]
      if (!decl) {
        const near = nearest(k, Object.keys(inputs))
        err(`${at}/with/${esc(k)}`, 'undeclared', `${node.widget} takes no input ${JSON.stringify(k)}`, near ? `did you mean ${JSON.stringify(near)}?` : `it takes: ${Object.keys(inputs).join(', ') || 'none'}`)
      } else if ((typeof b !== 'object' || b === null) && !fitsType(decl.type, b)) {
        err(`${at}/with/${esc(k)}`, 'bad-type', `${node.widget}'s input ${k} is a ${decl.type}`)
      }
    }
    for (const [k, d] of Object.entries(inputs)) if (isObj(d) && d.required && !(k in given)) err(`${at}/with`, 'missing-field', `${node.widget} requires the input '${k}', and nothing hands it one`)
    // A cycle: following the parts' own `use`s comes back to a widget already on the way
    // down. (Two parts that both use a third is a diamond, not a cycle — `done` skips it.)
    const done = new Set()
    const walk = (id, trail) => {
      if (trail.includes(id)) { err(`${at}/widget`, 'cycle', `${[...trail, id].join(' → ')} — a widget cannot contain itself`); return true }
      if (done.has(id)) return false
      let found = false
      walkNodes(widgets[id]?.spec?.body, (n) => { if (!found && n.t === 'use' && typeof n.widget === 'string') found = walk(n.widget, [...trail, id]) })
      done.add(id)
      return found
    }
    walk(node.widget, [def.id])
  }

  const visit = (node, at, sc, guards = new Set()) => {
    if (!isObj(node) || !NODES[node.t]) return
    const spec_ = NODES[node.t]
    if (node.t === 'use') checkUse(node, at, sc)
    silentEmpty(node, at, guards)
    let here = sc
    if (node.t === 'form') {
      here = new Map(sc)
      here.set('$form', formFields(node))
    }
    // An `ask` sends its question as `field` (default "text") — a body field like any other.
    const sent = node.t === 'ask' ? { [typeof node.field === 'string' ? node.field : 'text']: { lit: '' } } : {}
    const produced = spec_.props.cmd ? checkCmd(node.cmd, `${at}/cmd`, here, sent) : null
    const extra = {}
    if (Object.values(spec_.props).some((p) => p.row)) {
      extra.row = new Map(here)
      extra.row.set('$', rowOf(node.from, here))
    }
    if (Object.values(spec_.props).some((p) => p.result)) {
      extra.result = new Map(here)
      extra.result.set('$result', produced ?? ANY)
      extra.result.set('$job', JOB)
    }
    bindingsIn(node, spec_.props, at, here, extra)
    if (isObj(node.on)) {
      for (const [ev, chain] of Object.entries(node.on)) {
        // A row's event reads that row ($); a form's `done` reads what its command produced.
        let evScope = node.t === 'rows' ? extra.row ?? here : here
        if (node.t === 'form') { evScope = new Map(sc); evScope.set('$result', produced ?? ANY); evScope.set('$job', JOB) }
        // What the event itself hands its actions (a scrubber's `$seek`), as the manifest says.
        const handed = spec_.eventScope?.[ev]
        if (handed) { evScope = new Map(evScope); for (const [n, f] of Object.entries(handed)) evScope.set(n, fieldsShape(f)) }
        checkChain(chain, `${at}/on/${esc(ev)}`, evScope)
      }
    }
    for (const { name, many } of childProps(node.t)) {
      const c = node[name]
      if (c === undefined) continue
      let inner = here
      if (spec_.props[name]?.each) {
        inner = new Map(here)
        inner.set('$', rowOf(node.from, here))
      }
      if (name === 'result') {
        inner = new Map(sc)                       // a result is drawn beside the form: no $form
        inner.set('$result', produced ?? ANY)
        inner.set('$job', JOB)
      }
      const g = node.t === 'when' && name === 'then' && guardOf(node.cond) ? new Set([...guards, guardOf(node.cond)]) : guards
      if (many && Array.isArray(c)) c.forEach((x, i) => visit(x, `${at}/${esc(name)}/${i}`, inner, g))
      else if (!many) visit(c, `${at}/${esc(name)}`, inner, g)
    }
  }
  visit(spec.body, '/spec/body', scope)
  if (spec.mobile !== undefined) visit(spec.mobile, '/spec/mobile', scope)
  return out
}

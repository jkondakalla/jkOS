// validate.js — is this a widget ORDECK can render, and render safely?
//
// One function, two callers that must never disagree:
//   • jkAuth's POST /auth/widgets refuses a publish that fails it (400, with the list);
//   • the gate refuses a committed widget file that fails it (pnpm check:widgets), and
//     `pnpm widget check` prints the same list to the agent writing one.
//
// Every problem comes back as { path, code, message, fix? } where `path` is a JSON
// Pointer into the def (/spec/body/children/2/value) — a person can find it, an agent
// can act on it, and a model in a repair loop can be handed it verbatim.
//
// This is the STRUCTURAL + SECURITY tier: it needs nothing but the def. Checking a
// def against the data it binds (does that dataset exist, is that field declared) is
// the semantic tier, and needs the apps' declarations in hand.

import { NODES, FRAME, SOURCES, ACTIONS, STATE_TYPES, TONES, ICON_NAMES, RETIRED_COMPONENTS, TIER_COLS, LIMITS, childProps } from './manifest.js'
import { safeHref } from './href.js'
import { routeProblem } from './routes.js'
import { FORMATS, CONDITIONS } from '@jkos/weave/binding'

const ID_RE = new RegExp(LIMITS.ID_PATTERN)
const DEF_KEYS = ['id', 'label', 'sizing', 'route', 'spec', 'refreshMs', 'allowed_roles']
const SPEC_KEYS = ['frame', 'inputs', 'sources', 'state', 'body', 'mobile']
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
/** A host action's name: the engine, then the verb ("player.play", "focus.clear"). */
const ACTION_NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/
/** The most actions one event runs — a chain, not a program. */
const MAX_CHAIN = 8
const SIZING_TIERS = ['desktop', 'tablet', 'mobile']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1')
const at = (path, key) => `${path}/${esc(key)}`

/** The closest of `options` to `word`, when it is close enough to be a typo. */
function nearest(word, options) {
  const w = String(word).toLowerCase()
  let best = null
  let bestD = Infinity
  for (const o of options) {
    const d = editDistance(w, o.toLowerCase())
    if (d < bestD) { bestD = d; best = o }
  }
  // A swapped pair ("valeu") is two edits; a short word gets one.
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

const SOURCE_KEYS = ['src', 'path', 'fallback', 'map', 'fmt']
/** One entry of a `pairs` prop (a facts grid). */
const PAIR_PROPS = { label: { type: 'binding', required: true }, value: { type: 'binding', required: true }, tone: { type: 'tone' } }
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

/** A Binding object: {lit} | {src, path?, fallback?, map?, fmt?} | {from} | a condition
 *  ({eq: [a, b]} | {in: [a, list]} | {not: a}) — @jkos/weave's one binding model. */
function bindingProblem(v, depth = 0) {
  if (!isObj(v)) return null
  if (depth > 8) return 'conditions nest at most 8 deep'
  if ('lit' in v) return Object.keys(v).length === 1 ? null : '{lit} takes no other keys'
  const keys = Object.keys(v)
  if (keys.length === 1 && CONDITIONS.includes(keys[0])) {
    const op = keys[0]
    const arg = v[op]
    const operand = (x) => (isScalar(x) ? null : isObj(x) ? bindingProblem(x, depth + 1) : `${op}: an operand is a literal or a binding`)
    if (op === 'not') return operand(arg)
    if (!Array.isArray(arg) || arg.length !== 2) return `${op} takes exactly two operands: {${op}: [a, b]}`
    if (op === 'eq') return operand(arg[0]) || operand(arg[1])
    const list = arg[1]
    const listProblem = Array.isArray(list) ? list.map(operand).find(Boolean) ?? null
      : isObj(list) ? bindingProblem(list, depth + 1) : 'in: the second operand is an array, or a binding to one'
    return operand(arg[0]) || listProblem
  }
  if (typeof v.src === 'string') {
    if (!v.src) return 'src must be a non-empty string'
    if (v.path !== undefined && typeof v.path !== 'string') return 'path must be a string'
    const extra = keys.filter((k) => !SOURCE_KEYS.includes(k))
    if (extra.length) {
      const near = extra.map((k) => nearest(k, [...SOURCE_KEYS, ...CONDITIONS])).find(Boolean)
      return `unknown binding key(s): ${extra.join(', ')}${near ? ` — did you mean ${JSON.stringify(near)}?` : ''}`
    }
    if (v.map !== undefined && !(isObj(v.map) && Object.values(v.map).every(isScalar))) {
      return 'map is a lookup table: { "<value>": <string | number | boolean | null>, … }'
    }
    if (v.fmt !== undefined && !FORMATS.includes(v.fmt)) {
      const near = typeof v.fmt === 'string' ? nearest(v.fmt, FORMATS) : null
      return `unknown fmt ${JSON.stringify(v.fmt)}${near ? ` — did you mean ${JSON.stringify(near)}?` : ''} (one of: ${FORMATS.join(', ')})`
    }
    return null
  }
  if (typeof v.from === 'string') return keys.length === 1 ? null : '{from} takes no other keys'
  return `not a binding — expected a literal, {lit}, {src, path?, fallback?, map?, fmt?}, {from} or a condition (${CONDITIONS.map((c) => `{${c}}`).join(' ')})`
}

const isLiteral = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/**
 * Validate a widget def. Returns [] when it is valid.
 *
 * `ctx.suiteHosts` — the suite's hostnames (from @jkos/suite-manifest's origins). A
 * `fetch` source to one of them, or to a subdomain, is refused: suite data is read
 * through a DECLARED dataset. jkAuth passes them; without them only relative and
 * non-https URLs are refused (the renderer refuses the rest again at run time).
 *
 * `ctx.published` — the def is being PUBLISHED through jkAuth, onto every user's HUD. A
 * published widget binds only declared server contracts — its own sources (datasets,
 * already scope-checked by their app) and capabilities — never a host's slices, a
 * molecule (which reads one), or anything else only one host can supply. It is placed,
 * so its `sizing` is required. jkAuth's publish passes it; so does the Workshop.
 *
 * @param {unknown} def
 * @param {{ suiteHosts?: string[], published?: boolean }} [ctx]
 * @returns {{path: string, code: string, message: string, fix?: string}[]}
 */
export function validateWidget(def, ctx = {}) {
  const out = []
  const err = (path, code, message, fix) => out.push(fix ? { path, code, message, fix } : { path, code, message })

  if (!isObj(def)) { err('', 'not-an-object', 'a widget def must be a JSON object'); return out }

  let size = 0
  try { size = JSON.stringify(def).length } catch { err('', 'not-serializable', 'the def must be plain JSON'); return out }
  if (size > LIMITS.WIDGET_DEF_MAX) {
    err('', 'too-large', `the def is ${size} characters; the limit is ${LIMITS.WIDGET_DEF_MAX}`)
  }

  for (const k of Object.keys(def)) {
    if (k === 'component') {
      const mol = RETIRED_COMPONENTS[def.component]
      err('/component', 'retired', 'the `component` escape hatch is retired — every card is a spec, so it can be edited, validated and kept as a file',
        mol ? `{ "spec": { "body": { "t": "${mol}" } } }` : 'express it as a spec')
    } else if (k === 'ai') err('/ai', 'derived', 'whether a widget is AI-backed is DERIVED from the apps it binds (appsOf) — a hand-set flag could disagree with them', 'remove `ai`')
    else if (!DEF_KEYS.includes(k)) unknownKey(err, '', k, DEF_KEYS)
  }

  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) {
    err('/id', 'bad-id', `id must match ${LIMITS.ID_PATTERN} (lowercase letters, digits, '-' and '_')`)
  }
  if (def.label !== undefined && (typeof def.label !== 'string' || def.label.length > 100)) {
    err('/label', 'bad-type', 'label must be a string of at most 100 characters')
  }
  if (def.refreshMs !== undefined && !(Number.isFinite(def.refreshMs) && def.refreshMs >= 0)) {
    err('/refreshMs', 'bad-type', 'refreshMs must be a non-negative number of milliseconds')
  }
  if (def.allowed_roles !== undefined && !(typeof def.allowed_roles === 'string'
    || (Array.isArray(def.allowed_roles) && def.allowed_roles.every((r) => typeof r === 'string')))) {
    err('/allowed_roles', 'bad-type', 'allowed_roles must be an array of role names or a comma string')
  }

  if (def.route !== undefined) {
    const why = routeProblem(def.route)
    if (why) err('/route', 'bad-route', why)
    // A page is a screen its app draws at a path — never a card placed on the HUD.
    if (def.sizing !== undefined) err('/route', 'conflict', 'a page (route) is a screen, not a HUD card (sizing) — it takes one or the other')
    if (ctx.published) err('/route', 'unpublishable', "a page is one app's screen — a published widget is a HUD card", 'keep this page as a file in its app')
  }
  if (def.sizing !== undefined) checkSizing(def.sizing, err)
  else if (ctx.published) err('/sizing', 'missing-prop', 'a published widget is placed on the HUD: sizing is required — { desktop: {w,h}, mobile: {w,h}, tablet?, min? }')

  if (def.spec === undefined) {
    if (def.component === undefined) err('/spec', 'missing-prop', 'a def carries a `spec`: { frame?, sources?, body }')
  }
  const hasSpec = def.spec !== undefined
  if (hasSpec) checkSpec(def.spec, err, ctx)
  if (ctx.published && isObj(def.spec)) checkPublished(def.spec, err)
  return out
}

/** The names the RENDERER puts in every widget's scope — never a host's: the row of a
 *  list (`$`), the clock instant (`$now`), each source's state (`$sources`), a form's
 *  values (`$form`) and what a command produced (`$result` / `$job`). */
export const RUNTIME_NAMES = ['$', '$now', '$sources', '$form', '$result', '$job', '$state', '$seek', '$pin']

/* A published widget is drawn on every user's HUD and binds only what jkAuth can vouch
   for: the datasets and capabilities apps DECLARE (scope-checked by their app on every
   read and write). A host slice is one app's in-page state, not a server contract — a
   widget that binds one is that host's, and belongs in a file. */
function checkPublished(spec, err) {
  const own = new Set(isObj(spec.sources) ? Object.keys(spec.sources) : [])
  if (spec.inputs !== undefined) err('/spec/inputs', 'unpublishable', 'a published widget is placed on the HUD, where nothing hands it inputs', 'keep this part as a file in its app')
  const visit = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${path}/${i}`)); return }
    if (!isObj(v)) return
    if (typeof v.src === 'string' && !own.has(v.src) && !RUNTIME_NAMES.includes(v.src)) {
      err(path, 'unpublishable', `a published widget binds only its own sources — ${JSON.stringify(v.src)} is a host's slice, which no server declares`,
        own.size ? `bind one of its sources (${[...own].join(', ')}), or keep this widget as a file in its app` : 'declare a dataset source for it, or keep this widget as a file in its app')
    }
    if (typeof v.t === 'string' && NODES[v.t]?.kind === 'molecule') {
      err(path, 'unpublishable', `a ${v.t} is drawn by its host from the host's own state — a published widget cannot carry one`, 'keep this widget as a file in its app')
    }
    if (v.t === 'use') {
      err(path, 'unpublishable', `a use draws ${JSON.stringify(v.widget)}, a file in one app — a published widget is whole in itself`, 'keep this widget as a file in its app')
    }
    if (typeof v.go === 'string') {
      err(path, 'unpublishable', `go ${JSON.stringify(v.go)} navigates one app's pages — a published widget is a HUD card, and links out with an href`, 'a `link` or a frame `href`')
    }
    if (typeof v.do === 'string') {
      err(path, 'unpublishable', `${JSON.stringify(v.do)} is an action of one host's engine — a published widget runs only declared capabilities`, '{ "run": { app, capability } }, or keep this widget as a file in its app')
    }
    for (const [k, x] of Object.entries(v)) visit(x, at(path, k))
  }
  visit(spec, '/spec')
}

function unknownKey(err, path, key, allowed) {
  const near = nearest(key, allowed)
  err(at(path, key), 'unknown-prop', `unknown key ${JSON.stringify(key)}`,
    near ? `did you mean ${JSON.stringify(near)}?` : `allowed: ${allowed.join(', ')}`)
}

function checkSizing(sizing, err) {
  if (!isObj(sizing)) { err('/sizing', 'missing-prop', 'sizing is required: { desktop: {w,h}, mobile: {w,h}, tablet?, min? }'); return }
  for (const k of Object.keys(sizing)) {
    if (![...SIZING_TIERS, 'min'].includes(k)) unknownKey(err, '/sizing', k, [...SIZING_TIERS, 'min'])
  }
  for (const tier of [...SIZING_TIERS, 'min']) {
    const f = sizing[tier]
    if (f === undefined) {
      if (tier === 'desktop' || tier === 'mobile') err(`/sizing/${tier}`, 'missing-prop', `sizing.${tier} is required`)
      continue
    }
    if (!isObj(f) || !Number.isInteger(f.w) || !Number.isInteger(f.h) || f.w < 1 || f.h < 1) {
      err(`/sizing/${tier}`, 'bad-type', `sizing.${tier} must be { w, h } in whole grid units ≥ 1`)
      continue
    }
    const cols = TIER_COLS[tier] ?? TIER_COLS.desktop
    if (f.w > cols) err(`/sizing/${tier}/w`, 'out-of-range', `${tier} is a ${cols}-column grid; w ${f.w} does not fit`)
    if (f.h > LIMITS.MAX_ROWS) err(`/sizing/${tier}/h`, 'out-of-range', `h ${f.h} is taller than ${LIMITS.MAX_ROWS} rows`)
  }
}

function checkSpec(spec, err, ctx) {
  if (!isObj(spec)) { err('/spec', 'bad-type', 'spec must be an object { frame?, sources?, body }'); return }
  for (const k of Object.keys(spec)) if (!SPEC_KEYS.includes(k)) unknownKey(err, '/spec', k, SPEC_KEYS)

  if (spec.frame !== undefined) {
    if (!isObj(spec.frame)) err('/spec/frame', 'bad-type', 'frame must be an object')
    else checkProps(spec.frame, FRAME, '/spec/frame', err)
  }

  if (spec.sources !== undefined) {
    if (!isObj(spec.sources)) err('/spec/sources', 'bad-type', 'sources must be an object of name → source')
    else for (const [name, s] of Object.entries(spec.sources)) checkSource(name, s, `/spec/sources/${esc(name)}`, err, ctx)
  }

  if (spec.state !== undefined) checkState(spec.state, err)
  if (spec.inputs !== undefined) checkInputs(spec.inputs, err)

  if (spec.body === undefined) { err('/spec/body', 'missing-prop', 'spec.body is required'); return }
  const counter = { nodes: 0, overflowReported: false }
  checkNode(spec.body, '/spec/body', 0, { inForm: false, atRoot: true }, counter, err)
  // The phone's body, where the phone UI genuinely differs: a whole body of its own.
  if (spec.mobile !== undefined) checkNode(spec.mobile, '/spec/mobile', 0, { inForm: false, atRoot: true }, { nodes: 0, overflowReported: false }, err)
}

/** Each source kind's keys — the manifest's SOURCES, plus the `kind` that names it. */
/** spec.state: this widget's own variables — `$state.<name>`, written by `set` and by a
 *  control with `state`. Each instance of the widget has its own. */
function checkState(state, err) {
  if (!isObj(state)) { err('/spec/state', 'bad-type', 'state maps a variable name to { type, default? }'); return }
  for (const [name, d] of Object.entries(state)) {
    const p = `/spec/state/${esc(name)}`
    if (!IDENT.test(name)) err(p, 'bad-name', `state variable ${JSON.stringify(name)} must be an identifier`)
    if (!isObj(d)) { err(p, 'bad-type', '{ "type": "string" | "number" | "boolean" | "json", "default"?: … }'); continue }
    for (const k of Object.keys(d)) if (k !== 'type' && k !== 'default') unknownKey(err, p, k, ['type', 'default'])
    if (!STATE_TYPES.includes(d.type)) { err(`${p}/type`, 'unknown-value', `${JSON.stringify(d.type)} is not a state type`, `one of: ${STATE_TYPES.join(', ')}`); continue }
    if (d.default !== undefined && !fitsType(d.type, d.default)) err(`${p}/default`, 'bad-type', `the default of a ${d.type} must be a ${d.type}`)
  }
}

/** spec.inputs: what a widget is handed by the widget that `use`s it — `$in.<name>`.
 *  Each { type, required?, default? }; a required input has no default. */
function checkInputs(inputs, err) {
  if (!isObj(inputs)) { err('/spec/inputs', 'bad-type', 'inputs maps a name to { type, required?, default? }'); return }
  for (const [name, d] of Object.entries(inputs)) {
    const p = `/spec/inputs/${esc(name)}`
    if (!IDENT.test(name)) err(p, 'bad-name', `input ${JSON.stringify(name)} must be an identifier`)
    if (!isObj(d)) { err(p, 'bad-type', '{ "type": "string" | "number" | "boolean" | "json", "required"?: true, "default"?: … }'); continue }
    for (const k of Object.keys(d)) if (!['type', 'required', 'default'].includes(k)) unknownKey(err, p, k, ['type', 'required', 'default'])
    if (!STATE_TYPES.includes(d.type)) { err(`${p}/type`, 'unknown-value', `${JSON.stringify(d.type)} is not an input type`, `one of: ${STATE_TYPES.join(', ')}`); continue }
    if (d.required !== undefined && typeof d.required !== 'boolean') err(`${p}/required`, 'bad-type', 'required is true or false')
    if (d.required && d.default !== undefined) err(`${p}/default`, 'conflict', 'a required input has no default — the widget that uses it always gives one')
    if (d.default !== undefined && !fitsType(d.type, d.default)) err(`${p}/default`, 'bad-type', `the default of a ${d.type} must be a ${d.type}`)
  }
}

/** Does `v` fit a state/input type? (json fits anything; null fits all.) */
export function fitsType(type, v) {
  return v === null || type === 'json' || (type === 'string' && typeof v === 'string') || (type === 'number' && Number.isFinite(v)) || (type === 'boolean' && typeof v === 'boolean')
}

const SOURCE_KEYS_BY_KIND = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, ['kind', ...Object.keys(s.props)]]))
const APP_ID = /^[a-z][a-z0-9-]{0,39}$/

/** Is `host` one of the suite's, or under one? (`www.` aside.) */
function suiteHost(host, suiteHosts = []) {
  return suiteHosts.some((h) => {
    const bare = String(h).replace(/^www\./, '')
    return host === h || host === bare || host.endsWith(`.${bare}`)
  })
}

function checkSource(name, s, path, err, ctx = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) err(path, 'bad-name', `source name ${JSON.stringify(name)} must be an identifier`)
  if (!isObj(s)) { err(path, 'bad-type', 'a source must be an object'); return }
  /* `from` was the discriminator, and it is also the binding model's `{from}` sugar — two
     meanings of one word in one document. The old same-origin fetch it mostly named is
     refused now, so the fix points at a declared dataset. */
  if (s.kind === undefined && 'from' in s) {
    err(`${path}/from`, 'renamed', 'a source says what it is with `kind` — `from` is the binding model\'s word',
      s.from === 'fetch' ? 'a suite endpoint is { "kind": "dataset", "app", "dataset" }; an external one is { "kind": "fetch", "url": "https://…" }' : '{ "kind": "dataset", "app", "dataset" }')
    return
  }
  if (s.kind === 'hud') {
    err(`${path}/kind`, 'bad-source', 'HUD slices are always in scope — bind { "src": "<slice>" } directly; no source is needed')
    return
  }
  const allowed = SOURCE_KEYS_BY_KIND[s.kind]
  if (!allowed) {
    const near = typeof s.kind === 'string' ? nearest(s.kind, Object.keys(SOURCE_KEYS_BY_KIND)) : null
    err(`${path}/kind`, 'bad-source', `unknown source kind ${JSON.stringify(s.kind)}`, near ? `did you mean ${JSON.stringify(near)}?` : "one of: 'dataset', 'fetch'")
    return
  }
  for (const k of Object.keys(s)) if (!allowed.includes(k)) unknownKey(err, path, k, allowed)
  for (const [k, p] of Object.entries(SOURCES[s.kind].props)) {
    if (p.type !== 'number' || s[k] === undefined) continue
    if (!Number.isFinite(s[k])) err(`${path}/${k}`, 'bad-type', `${k} must be a number`)
    else if (s[k] < p.min || s[k] > p.max) err(`${path}/${k}`, 'out-of-range', `${k} ${s[k]} is outside ${p.min}…${p.max} (${p.doc.split(':')[0]})`)
  }

  if (s.kind === 'dataset') {
    if (typeof s.app !== 'string' || !APP_ID.test(s.app)) err(`${path}/app`, 'missing-prop', 'a dataset source names its app by id (e.g. "lazuros")')
    if (typeof s.dataset !== 'string' || !s.dataset) err(`${path}/dataset`, 'missing-prop', 'a dataset source names the dataset its app declares (e.g. "jobs")')
    if (s.params !== undefined) {
      if (!isObj(s.params)) err(`${path}/params`, 'bad-type', 'params maps a declared filter or path parameter to a value or a binding')
      else for (const [k, b] of Object.entries(s.params)) {
        if (isLiteral(b) || b === null) continue
        const why = bindingProblem(b)
        if (why) err(at(`${path}/params`, k), 'bad-binding', why)
      }
    }
    return
  }

  // kind: 'fetch' — an EXTERNAL public endpoint only.
  let u = null
  try { u = typeof s.url === 'string' ? new URL(s.url) : null } catch { u = null }
  if (!u) {
    err(`${path}/url`, 'bad-url', 'a fetch source is an absolute https URL to an external public endpoint — a relative one is this origin',
      'suite data is { "kind": "dataset", "app", "dataset" }: a widget reads only what an app declares')
  } else if (u.protocol !== 'https:') {
    err(`${path}/url`, 'bad-url', 'a fetch source must be https')
  } else if (suiteHost(u.hostname, ctx.suiteHosts)) {
    err(`${path}/url`, 'suite-url', `${u.hostname} is part of this suite — a widget reads only what an app declares`,
      'bind its dataset: { "kind": "dataset", "app", "dataset" }')
  }
}

function checkNode(node, path, depth, where, counter, err) {
  counter.nodes++
  if (counter.nodes > LIMITS.MAX_NODES) {
    if (!counter.overflowReported) err(path, 'too-many-nodes', `a body may hold at most ${LIMITS.MAX_NODES} nodes`)
    counter.overflowReported = true
    return
  }
  if (depth > LIMITS.MAX_DEPTH) { err(path, 'too-deep', `nodes may nest at most ${LIMITS.MAX_DEPTH} deep`); return }
  if (!isObj(node)) { err(path, 'bad-type', 'a node must be an object with a `t`'); return }

  const spec = NODES[node.t]
  if (!spec) {
    const near = typeof node.t === 'string' ? nearest(node.t, Object.keys(NODES)) : null
    err(`${path}/t`, 'unknown-kind', `unknown node kind ${JSON.stringify(node.t)}`, near ? `did you mean ${JSON.stringify(near)}?` : `one of: ${Object.keys(NODES).join(', ')}`)
    return
  }

  const place = spec.placement ?? {}
  // A control with `state` writes the widget's state, so it sits OUTSIDE any form.
  const formRule = place.outside && node[place.outside] !== undefined ? 'outside' : place.form
  if (formRule === 'inside' && !where.inForm) err(path, 'misplaced', `a ${node.t} with a \`field\` only works inside a form (it writes the form's $form values)`, place.outside ? `outside a form it writes a state variable: { "${place.outside}": "<name>" }` : undefined)
  if (formRule === 'outside' && where.inForm) err(path, 'misplaced', node.t === 'form' || node.t === 'ask' ? 'forms do not nest' : `inside a form a ${node.t} writes $form — give it a \`field\`, not \`${place.outside}\``)
  if (place.root && !where.atRoot) err(path, 'misplaced', `a ${node.t} is a whole card — it sits directly on the widget body (or the root stack)`)

  for (const group of spec.oneOf ?? []) {
    const given = group.filter((k) => node[k] !== undefined)
    if (given.length !== 1) err(path, given.length ? 'conflict' : 'missing-prop', `a ${node.t} takes exactly one of ${group.join(' | ')}${given.length ? ` — it has ${given.join(' and ')}` : ''}`)
  }
  for (const [name, p] of Object.entries(spec.props)) {
    if (p.with && node[name] !== undefined && node[p.with] === undefined) err(at(path, name), 'misplaced', `${name} draws what \`${p.with}\` produced, and this ${node.t} has no ${p.with}`)
  }
  // A row (or a media card) is a link or an action, never both: one tap, one meaning.
  if (node.href !== undefined && isObj(node.on) && Object.keys(spec.events ?? {}).some((e) => node.on[e] !== undefined)) {
    err(at(path, 'on'), 'conflict', `a ${node.t} is a link (href) or an action (on), not both`)
  }

  checkProps(node, spec.props, path, err, ['t'], spec.events)

  const inForm = where.inForm || node.t === 'form'
  // A molecule sits on the body itself, or directly in the body's root stack (the
  // Workshop's shape) — never deeper.
  const childAtRoot = (path === '/spec/body' || path === '/spec/mobile') && node.t === 'stack'
  for (const { name, many } of childProps(node.t)) {
    const v = node[name]
    if (v === undefined) continue
    if (many) {
      if (!Array.isArray(v)) { err(at(path, name), 'bad-type', `${name} must be an array of nodes`); continue }
      v.forEach((c, i) => checkNode(c, `${at(path, name)}/${i}`, depth + 1, { inForm, atRoot: childAtRoot }, counter, err))
    } else {
      // A form's `result` is drawn beside the form, not in it: no control writes there.
      checkNode(v, at(path, name), depth + 1, { inForm: name === 'result' ? where.inForm : inForm, atRoot: false }, counter, err)
    }
  }
}

/** Check an object's keys against a prop table (node props, the frame, an action).
 *  `events`: what an `events` prop may name (the node's manifest `events`). */
function checkProps(obj, props, path, err, reserved = [], events = {}) {
  const allowed = Object.keys(props)
  for (const k of Object.keys(obj)) {
    if (reserved.includes(k)) continue
    if (!props[k]) unknownKey(err, path, k, allowed)
  }
  for (const [name, p] of Object.entries(props)) {
    const v = obj[name]
    const here = at(path, name)
    if (v === undefined) {
      if (p.required) err(here, 'missing-prop', `${name} is required`)
      continue
    }
    switch (p.type) {
      case 'binding': {
        if (isLiteral(v)) {
          if (p.href && typeof v === 'string' && !safeHref(v)) err(here, 'bad-url', `${name} must be http(s), mailto or relative`)
          if (p.values && typeof v === 'string' && !p.values.includes(v)) {
            const near = nearest(v, p.values)
            err(here, 'unknown-value', `${JSON.stringify(v)} is not a known ${name}`, near ? `did you mean ${JSON.stringify(near)}?` : `one of: ${p.values.join(', ')}`)
          }
          break
        }
        const why = bindingProblem(v)
        if (why) err(here, 'bad-binding', why)
        else if (p.href && isObj(v) && 'lit' in v && (typeof v.lit !== 'string' || !safeHref(v.lit))) err(here, 'bad-url', `${name} must be http(s), mailto or relative`)
        else if (p.values) mappedValues(v, p.values, name, here, err)
        break
      }
      case 'tone':
        if (typeof v === 'string') {
          if (!TONES.includes(v)) err(here, 'unknown-value', `${JSON.stringify(v)} is not a tone`, `one of: ${TONES.join(', ')} — or bind it to data`)
        } else {
          const why = bindingProblem(v)
          if (why) err(here, 'bad-binding', why)
          else mappedValues(v, TONES, 'tone', here, err)
        }
        break
      case 'number':
        if (!Number.isFinite(v)) err(here, 'bad-type', `${name} must be a number`)
        else if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) {
          err(here, 'out-of-range', `${name} ${v} is outside ${p.min ?? '−∞'}…${p.max ?? '∞'}`)
        }
        break
      case 'boolean':
        if (typeof v !== 'boolean') err(here, 'bad-type', `${name} must be true or false`)
        break
      case 'string':
        if (typeof v !== 'string') err(here, 'bad-type', `${name} must be a string`)
        break
      case 'field':
        if (typeof v !== 'string' || !IDENT.test(v)) err(here, 'bad-type', `${name} must be a field name (an identifier)`)
        break
      case 'state':
        if (typeof v !== 'string' || !IDENT.test(v)) err(here, 'bad-type', `${name} names a state variable (an identifier, declared in spec.state)`)
        break
      case 'params':
        if (!isObj(v)) { err(here, 'bad-type', `${name} maps a name to a literal or a binding`); break }
        for (const [k, b] of Object.entries(v)) {
          if (isLiteral(b) || b === null) continue
          const why = bindingProblem(b)
          if (why) err(at(here, k), 'bad-binding', why)
        }
        break
      case 'events':
        checkEvents(v, here, err, events)
        break
      case 'action':
        if (typeof v !== 'string' || !ACTION_NAME.test(v)) err(here, 'bad-type', `${name} names a host action as <engine>.<verb> ("player.play")`)
        break
      case 'route': {
        const why = routeProblem(v)
        if (why) err(here, 'bad-route', why)
        break
      }
      case 'widget':
        if (typeof v !== 'string' || !ID_RE.test(v)) err(here, 'bad-type', `${name} names a widget by its id (${LIMITS.ID_PATTERN})`)
        break
      case 'enum':
        if (!p.values.includes(v)) {
          const near = typeof v === 'string' ? nearest(v, p.values) : null
          err(here, 'unknown-value', `${JSON.stringify(v)} is not a valid ${name}`, near ? `did you mean ${JSON.stringify(near)}?` : `one of: ${p.values.join(', ')}`)
        }
        break
      case 'cmd':
        checkCmd(v, here, err)
        break
      case 'pairs':
        if (!Array.isArray(v) || !v.length) { err(here, 'bad-type', `${name} is a non-empty list of { label, value, tone? }`); break }
        v.forEach((pair, i) => {
          const pp = `${here}/${i}`
          if (!isObj(pair)) { err(pp, 'bad-type', 'each item is { label, value, tone? }'); return }
          checkProps(pair, PAIR_PROPS, pp, err)
        })
        break
      case 'node':
      case 'nodes':
        break // walked by checkNode
      default:
        err(here, 'manifest', `the manifest gives ${name} an unknown type ${JSON.stringify(p.type)}`)
    }
  }
}

/** A binding that maps data onto a closed vocabulary (a status onto a tone, a kind
 *  onto an icon) maps onto real members of it — the lookup table and its fallback are
 *  literals, so they can be checked here rather than degrading quietly on screen. */
function mappedValues(v, allowed, name, path, err) {
  if (!isObj(v) || !isObj(v.map)) return
  for (const [k, out] of Object.entries(v.map)) {
    if (typeof out === 'string' && !allowed.includes(out)) {
      const near = nearest(out, allowed)
      err(`${path}/map/${esc(k)}`, 'unknown-value', `${JSON.stringify(out)} is not a ${name}`, near ? `did you mean ${JSON.stringify(near)}?` : `one of: ${allowed.join(', ')}`)
    }
  }
  if (typeof v.fallback === 'string' && !allowed.includes(v.fallback)) {
    err(`${path}/fallback`, 'unknown-value', `${JSON.stringify(v.fallback)} is not a ${name}`, `one of: ${allowed.join(', ')}`)
  }
}

/** `on`: each of the node's events → one action, or an ordered list of them. */
function checkEvents(on, path, err, events) {
  if (!isObj(on)) { err(path, 'bad-type', `on maps an event (${Object.keys(events).join(', ') || 'none here'}) to an action or a list of them`); return }
  for (const [ev, chain] of Object.entries(on)) {
    const here = at(path, ev)
    if (!events[ev]) { unknownKey(err, path, ev, Object.keys(events)); continue }
    const list = Array.isArray(chain) ? chain : [chain]
    if (!list.length) err(here, 'bad-type', 'an event runs at least one action')
    if (list.length > MAX_CHAIN) err(here, 'out-of-range', `an event runs at most ${MAX_CHAIN} actions — a chain, not a program`)
    list.forEach((a, i) => checkAction(a, Array.isArray(chain) ? `${here}/${i}` : here, err))
  }
}

/** One action: a one-key object named by what it does (the manifest's ACTIONS). */
function checkAction(a, path, err) {
  const names = Object.keys(ACTIONS)
  if (!isObj(a)) { err(path, 'bad-type', `an action is one of: ${names.map((n) => `{ "${n}": … }`).join(' ')}`); return }
  const kinds = Object.keys(a).filter((k) => ACTIONS[k])
  if (kinds.length !== 1) {
    const near = kinds.length ? null : Object.keys(a).map((k) => nearest(k, names)).find(Boolean)
    err(path, kinds.length ? 'conflict' : 'unknown-action', kinds.length ? `an action does one thing — this one says ${kinds.join(' and ')}` : `not an action — one of: ${names.join(', ')}`,
      near ? `did you mean ${JSON.stringify(near)}?` : undefined)
    return
  }
  checkProps(a, ACTIONS[kinds[0]].props, path, err)
}

function checkCmd(v, path, err) {
  if (!isObj(v)) { err(path, 'bad-type', 'a command is { app, capability, body? }'); return }
  for (const k of Object.keys(v)) if (!['app', 'capability', 'body'].includes(k)) unknownKey(err, path, k, ['app', 'capability', 'body'])
  if (typeof v.app !== 'string' || !v.app) err(`${path}/app`, 'missing-prop', 'the command names an app')
  if (typeof v.capability !== 'string' || !v.capability) err(`${path}/capability`, 'missing-prop', 'the command names a capability')
  if (v.body !== undefined) {
    if (!isObj(v.body)) { err(`${path}/body`, 'bad-type', 'body maps capability fields to bindings'); return }
    for (const [k, b] of Object.entries(v.body)) {
      if (isLiteral(b) || b === null) continue
      const why = bindingProblem(b)
      if (why) err(at(`${path}/body`, k), 'bad-binding', why)
    }
  }
}

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

import { NODES, FRAME, TONES, ICON_NAMES, COMPONENTS, TIER_COLS, LIMITS, childProps } from './manifest.js'
import { safeHref } from './href.js'
import { FORMATS, CONDITIONS } from '@jkos/weave/binding'

const ID_RE = new RegExp(LIMITS.ID_PATTERN)
const DEF_KEYS = ['id', 'label', 'sizing', 'spec', 'component', 'ai', 'refreshMs', 'allowed_roles']
const SPEC_KEYS = ['frame', 'sources', 'body']
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
 * @param {unknown} def
 * @returns {{path: string, code: string, message: string, fix?: string}[]}
 */
export function validateWidget(def) {
  const out = []
  const err = (path, code, message, fix) => out.push(fix ? { path, code, message, fix } : { path, code, message })

  if (!isObj(def)) { err('', 'not-an-object', 'a widget def must be a JSON object'); return out }

  let size = 0
  try { size = JSON.stringify(def).length } catch { err('', 'not-serializable', 'the def must be plain JSON'); return out }
  if (size > LIMITS.WIDGET_DEF_MAX) {
    err('', 'too-large', `the def is ${size} characters; the limit is ${LIMITS.WIDGET_DEF_MAX}`)
  }

  for (const k of Object.keys(def)) {
    if (!DEF_KEYS.includes(k)) unknownKey(err, '', k, DEF_KEYS)
  }

  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) {
    err('/id', 'bad-id', `id must match ${LIMITS.ID_PATTERN} (lowercase letters, digits, '-' and '_')`)
  }
  if (def.label !== undefined && (typeof def.label !== 'string' || def.label.length > 100)) {
    err('/label', 'bad-type', 'label must be a string of at most 100 characters')
  }
  if (def.ai !== undefined && typeof def.ai !== 'boolean') err('/ai', 'bad-type', 'ai must be a boolean')
  if (def.refreshMs !== undefined && !(Number.isFinite(def.refreshMs) && def.refreshMs >= 0)) {
    err('/refreshMs', 'bad-type', 'refreshMs must be a non-negative number of milliseconds')
  }
  if (def.allowed_roles !== undefined && !(typeof def.allowed_roles === 'string'
    || (Array.isArray(def.allowed_roles) && def.allowed_roles.every((r) => typeof r === 'string')))) {
    err('/allowed_roles', 'bad-type', 'allowed_roles must be an array of role names or a comma string')
  }

  checkSizing(def.sizing, err)

  const hasSpec = def.spec !== undefined
  const hasComponent = def.component !== undefined
  if (hasSpec === hasComponent) {
    err('', 'spec-or-component', 'a def carries exactly one of `spec` (the declarative widget) or `component` (a bespoke one)')
  }
  if (hasComponent && !COMPONENTS.includes(def.component)) {
    err('/component', 'unknown-component', `no bespoke component named ${JSON.stringify(def.component)}`, `one of: ${COMPONENTS.join(', ')}`)
  }
  if (hasSpec) checkSpec(def.spec, err)
  return out
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

function checkSpec(spec, err) {
  if (!isObj(spec)) { err('/spec', 'bad-type', 'spec must be an object { frame?, sources?, body }'); return }
  for (const k of Object.keys(spec)) if (!SPEC_KEYS.includes(k)) unknownKey(err, '/spec', k, SPEC_KEYS)

  if (spec.frame !== undefined) {
    if (!isObj(spec.frame)) err('/spec/frame', 'bad-type', 'frame must be an object')
    else checkProps(spec.frame, FRAME, '/spec/frame', err)
  }

  if (spec.sources !== undefined) {
    if (!isObj(spec.sources)) err('/spec/sources', 'bad-type', 'sources must be an object of name → source')
    else for (const [name, s] of Object.entries(spec.sources)) checkSource(name, s, `/spec/sources/${esc(name)}`, err)
  }

  if (spec.body === undefined) { err('/spec/body', 'missing-prop', 'spec.body is required'); return }
  const counter = { nodes: 0, overflowReported: false }
  checkNode(spec.body, '/spec/body', 0, { inForm: false, atRoot: true }, counter, err)
}

function checkSource(name, s, path, err) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) err(path, 'bad-name', `source name ${JSON.stringify(name)} must be an identifier`)
  if (!isObj(s)) { err(path, 'bad-type', 'a source must be an object'); return }
  if (s.from === 'hud') {
    if (typeof s.key !== 'string') err(`${path}/key`, 'bad-type', 'a hud source names its slice in `key`')
    return
  }
  if (s.from !== 'fetch') { err(`${path}/from`, 'bad-source', `unknown source kind ${JSON.stringify(s.from)}`, "one of: 'fetch', 'hud'"); return }
  for (const k of Object.keys(s)) {
    if (!['from', 'url', 'poll', 'invalidateOn'].includes(k)) unknownKey(err, path, k, ['from', 'url', 'poll', 'invalidateOn'])
  }
  if (typeof s.url !== 'string' || !safeHref(s.url) || /^mailto:/i.test(s.url.trim())) {
    err(`${path}/url`, 'bad-url', 'a fetch source url must be http(s) or relative')
  }
  if (s.poll !== undefined && !(Number.isFinite(s.poll) && s.poll > 0)) err(`${path}/poll`, 'bad-type', 'poll is a number of seconds > 0')
  if (s.invalidateOn !== undefined && !(Array.isArray(s.invalidateOn) && s.invalidateOn.every((k) => typeof k === 'string'))) {
    err(`${path}/invalidateOn`, 'bad-type', 'invalidateOn is an array of resource keys')
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
  if (place.form === 'inside' && !where.inForm) err(path, 'misplaced', `a ${node.t} only works inside a form (it writes the form's $form values)`)
  if (place.form === 'outside' && where.inForm) err(path, 'misplaced', 'forms do not nest')
  if (place.root && !where.atRoot) err(path, 'misplaced', `a ${node.t} is a whole card — it sits directly on the widget body (or the root stack)`)

  checkProps(node, spec.props, path, err, ['t'])

  const inForm = where.inForm || node.t === 'form'
  // A molecule sits on the body itself, or directly in the body's root stack (the
  // Workshop's shape) — never deeper.
  const childAtRoot = path === '/spec/body' && node.t === 'stack'
  for (const { name, many } of childProps(node.t)) {
    const v = node[name]
    if (v === undefined) continue
    if (many) {
      if (!Array.isArray(v)) { err(at(path, name), 'bad-type', `${name} must be an array of nodes`); continue }
      v.forEach((c, i) => checkNode(c, `${at(path, name)}/${i}`, depth + 1, { inForm, atRoot: childAtRoot }, counter, err))
    } else {
      checkNode(v, at(path, name), depth + 1, { inForm, atRoot: false }, counter, err)
    }
  }
}

/** Check an object's keys against a prop table (node props, or the frame). */
function checkProps(obj, props, path, err, reserved = []) {
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
        break
      case 'boolean':
        if (typeof v !== 'boolean') err(here, 'bad-type', `${name} must be true or false`)
        break
      case 'string':
        if (typeof v !== 'string') err(here, 'bad-type', `${name} must be a string`)
        break
      case 'field':
        if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) err(here, 'bad-type', `${name} must be a field name (an identifier)`)
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

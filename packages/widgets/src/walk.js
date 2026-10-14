// walk.js — the one walker over a widget's tree and bindings.
//
// Three copies of this existed, each with its own idea of where children live and
// which bindings count: the renderer's (which slices re-render a card), the tray's
// (which glyph a card gets) and the HUD doc's (does a retired built-in still bind a
// dead slice). They agree now because they are this.

import { NODES, childProps } from './manifest.js'

const isObj = (v) => v !== null && typeof v === 'object'

/**
 * Visit every node in a body, depth-first, parents before children.
 * @param {unknown} node
 * @param {(node: {t: string}, path: string) => void} visit
 * @param {string} [path]
 */
export function walkNodes(node, visit, path = '') {
  if (!isObj(node) || Array.isArray(node) || typeof node.t !== 'string') return
  visit(node, path)
  for (const { name, many } of childProps(node.t)) {
    const v = node[name]
    if (many && Array.isArray(v)) v.forEach((c, i) => walkNodes(c, visit, `${path}/${name}/${i}`))
    else if (!many && v) walkNodes(v, visit, `${path}/${name}`)
  }
}

/**
 * Every data source a value depends on: the `src` of each `{src}` binding anywhere
 * inside it (a condition's operands included), plus the slice a molecule reads without
 * a binding saying so (the manifest's `reads`), plus `$now` for a `fmt: 'ago'` — the
 * one format that reads the clock.
 *
 * `commands: false` skips `cmd` and `on` subtrees. A command's body bindings, and an
 * event's actions, resolve when it is SUBMITTED or fired, against the scope of that
 * moment, not on screen, so they are not display dependencies — else a form defaulting
 * due_date to clock.iso would re-render its card every second. Pass `commands: true`
 * to ask "does this def bind X ANYWHERE".
 *
 * @param {unknown} value a def, spec, node, or any part of one
 * @param {{ commands?: boolean }} [opts]
 * @returns {Set<string>}
 */
export function sourcesOf(value, { commands = false } = {}) {
  const acc = new Set()
  const visit = (v) => {
    if (!isObj(v)) return
    if (Array.isArray(v)) { for (const e of v) visit(e); return }
    if (typeof v.src === 'string') acc.add(v.src)
    // A time measured from NOW depends on the clock, though no binding names it.
    if (v.fmt === 'ago') acc.add('$now')
    if (typeof v.t === 'string' && NODES[v.t]?.reads) [].concat(NODES[v.t].reads).forEach((r) => acc.add(r))
    for (const k in v) if (commands || (k !== 'cmd' && k !== 'on')) visit(v[k])
  }
  visit(value)
  return acc
}

/** Every action in a node's `on`, flattened: [{ event, action }]. */
export function actionsOf(node) {
  if (!isObj(node) || !isObj(node.on)) return []
  return Object.entries(node.on).flatMap(([event, chain]) => [].concat(chain).filter(isObj).map((action) => ({ event, action })))
}

/** A spec's bodies: `body`, and `mobile` (the phone's) when it has one. Anything that asks
 *  what a widget can DO walks both — a command only the phone body has is still one. */
export function bodiesOf(spec) {
  return isObj(spec) ? [spec.body, spec.mobile].filter(isObj) : []
}

/** The ids of the parts a widget draws (`use`), directly. */
export function partsOf(def) {
  const spec = isObj(def) && isObj(def.spec) ? def.spec : def
  const acc = new Set()
  for (const b of bodiesOf(spec)) walkNodes(b, (n) => { if (n.t === 'use' && typeof n.widget === 'string') acc.add(n.widget) })
  return acc
}

/**
 * Every app a widget reaches: the app of each `dataset` source, and of every command
 * in its tree — a form's, a button's, an event's `run` — wherever one sits, and (given
 * `widgets`, every widget by id) everything each part it `use`s reaches. What "is
 * this an AI widget" is DERIVED from: a def used to carry a hand-set `ai` flag, which nothing checked
 * against what it bound, and a widget binding LazurOS with `ai` unset ignored the
 * suite's AI kill switch.
 *
 * @param {unknown} def a widget def (or a spec)
 * @param {Record<string, unknown>} [widgets] every widget by id — to follow `use` into parts
 * @returns {Set<string>}
 */
export function appsOf(def, widgets, seen = new Set()) {
  const acc = new Set()
  const spec = isObj(def) && isObj(def.spec) ? def.spec : def
  if (!isObj(spec)) return acc
  // A part reaches what it reaches: a LazurOS part inside a card makes the card AI-backed.
  if (widgets) {
    for (const id of partsOf(spec)) {
      if (seen.has(id) || !widgets[id]) continue
      seen.add(id)
      for (const app of appsOf(widgets[id], widgets, seen)) acc.add(app)
    }
  }
  for (const s of Object.values(isObj(spec.sources) ? spec.sources : {})) {
    if (isObj(s) && s.kind === 'dataset' && typeof s.app === 'string') acc.add(s.app)
  }
  const add = (cmd) => { if (isObj(cmd) && typeof cmd.app === 'string' && cmd.app) acc.add(cmd.app) }
  for (const b of bodiesOf(spec)) walkNodes(b, (n) => {
    add(n.cmd)
    for (const { action } of actionsOf(n)) add(action.run)
  })
  return acc
}

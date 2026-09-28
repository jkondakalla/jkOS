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
 * inside it, plus the slice a molecule reads without a binding saying so (the
 * manifest's `reads`).
 *
 * `commands: false` skips `cmd` subtrees. A command's body bindings resolve at SUBMIT
 * time against the scope of that render, not on screen, so they are not display
 * dependencies — else a form defaulting due_date to clock.iso would re-render its
 * card every second. Pass `commands: true` to ask "does this def bind X ANYWHERE".
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
    if (typeof v.t === 'string' && NODES[v.t]?.reads) acc.add(NODES[v.t].reads)
    for (const k in v) if (commands || k !== 'cmd') visit(v[k])
  }
  visit(value)
  return acc
}

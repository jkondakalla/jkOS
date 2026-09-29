// @jkos/widgets — the vocabulary holds itself together, and the validator says no.
//
//   node packages/widgets/test/widgets.mjs      (the package's `test`; the gate runs it)
//
// 1. The manifest is self-consistent: every prop has a known type, every enum lists its
//    values, every placement is a known rule, and every kind's `example` — the node the
//    Workshop drops in and the doc an agent copies — is itself a valid widget body
//    (controls checked inside a form, since that is the only place they may sit).
// 2. The validator refuses what the renderer cannot or must not draw, and names the
//    place: an unknown kind (with the likely intended one), a typo'd prop, a missing
//    required prop, a control outside a form, a nested form, a molecule off the root, a
//    javascript: href, an unknown tone, a footprint wider than its tier, a def too big
//    to store, a tree too deep or too large to render.
// 3. The walker finds every source a def binds, skips command bodies only when asked,
//    and sees the slice a molecule reads without a binding.
// 4. safeHref: the href rule the validator and the renderer share.
import { NODES, FRAME, KINDS, LIMITS, TONES, childProps, validateWidget, sourcesOf, walkNodes, safeHref } from '../src/index.js'

let pass = 0, fail = 0
const ok = (cond, msg, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.error(`  ✗ ${msg} ${extra}`) } }

const PROP_TYPES = new Set(['binding', 'tone', 'number', 'boolean', 'string', 'enum', 'field', 'cmd', 'node', 'nodes'])
const sizing = { desktop: { w: 3, h: 3 }, mobile: { w: 2, h: 3 } }
const def = (body, extra = {}) => ({ id: 'probe', label: 'Probe', sizing, spec: { body }, ...extra })
const problems = (d) => validateWidget(d)
const has = (d, path, code) => problems(d).some((p) => p.path === path && p.code === code)

// ── 1. the manifest ─────────────────────────────────────────────────────────
console.log('1 · the manifest is self-consistent')
for (const [t, spec] of Object.entries(NODES)) {
  for (const [name, p] of Object.entries(spec.props)) {
    ok(PROP_TYPES.has(p.type), `${t}.${name} has a known type (${p.type})`)
    if (p.type === 'enum') ok(Array.isArray(p.values) && p.values.length > 0, `${t}.${name} lists its enum values`)
  }
  ok(childProps(t).filter((c) => c.many).length <= 1, `${t} has at most one ordered-children prop`)
  const pl = spec.placement ?? {}
  ok(Object.keys(pl).every((k) => k === 'form' || k === 'root') && [undefined, 'inside', 'outside'].includes(pl.form), `${t}'s placement is a known rule`)
  ok(spec.example?.t === t, `${t}'s example is a ${t}`)
  // A control's example is checked where a control may sit; a form's/button's example
  // names no app yet (the Workshop's inspector picks it), so only that problem may show.
  const body = pl.form === 'inside'
    ? { t: 'form', cmd: { app: 'beigeboard', capability: 'createItem' }, submit: 'GO', children: [spec.example] }
    : spec.example
  const errs = problems(def(body)).filter((e) => !(e.code === 'missing-prop' && /\/cmd\/(app|capability)$/.test(e.path)))
  ok(errs.length === 0, `${t}'s example is a valid body`, JSON.stringify(errs))
}
ok(Object.values(FRAME).every((p) => PROP_TYPES.has(p.type)), 'every frame prop has a known type')
ok(KINDS.length === Object.keys(NODES).length && KINDS.every((k) => NODES[k]), 'KINDS lists every node kind, in order')

// ── 2. the validator refuses, and names the place ──────────────────────────
console.log('2 · the validator refuses what the renderer must not draw')
ok(problems(def({ t: 'metric', value: { src: 'systems', path: 'up' } })).length === 0, 'a minimal valid def passes')
ok(has(def({ t: 'metrc', value: 1 }), '/spec/body/t', 'unknown-kind'), 'an unknown kind is refused')
ok(problems(def({ t: 'metrc', value: 1 }))[0]?.fix === 'did you mean "metric"?', '…and the likely intended kind is suggested')
ok(problems(def({ t: 'metric', valeu: 1 })).some((p) => p.path === '/spec/body/valeu' && p.fix === 'did you mean "value"?'), 'a typo\'d prop is refused with the intended one')
ok(has(def({ t: 'metric' }), '/spec/body/value', 'missing-prop'), 'a missing required prop is refused')
ok(has(def({ t: 'input', field: 'x' }), '/spec/body', 'misplaced'), 'a control outside a form is refused')
ok(has(def({ t: 'form', cmd: { app: 'a', capability: 'b' }, submit: 'S', children: [{ t: 'form', cmd: { app: 'a', capability: 'b' }, submit: 'S', children: [] }] }), '/spec/body/children/0', 'misplaced'), 'a nested form is refused')
ok(has(def({ t: 'stack', children: [{ t: 'row', children: [{ t: 'calendar' }] }] }), '/spec/body/children/0/children/0', 'misplaced'), 'a molecule off the root is refused')
ok(problems(def({ t: 'stack', children: [{ t: 'calendar' }] })).length === 0, 'a molecule in the root stack is fine')
for (const href of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x']) {
  ok(has(def({ t: 'link', text: 'x', href }), '/spec/body/href', 'bad-url'), `a literal ${JSON.stringify(href)} href is refused`)
}
ok(has(def({ t: 'link', text: 'x', href: { lit: 'javascript:alert(1)' } }), '/spec/body/href', 'bad-url'), 'a {lit} javascript: href is refused')
ok(has({ ...def({ t: 'text', text: 'x' }), spec: { frame: { href: 'javascript:alert(1)' }, body: { t: 'text', text: 'x' } } }, '/spec/frame/href', 'bad-url'), 'a javascript: frame href is refused')
ok(problems(def({ t: 'link', text: 'x', href: { src: 'row', path: 'url' } })).length === 0, 'a data-bound href passes (safeHref guards it at render)')
ok(has(def({ t: 'dot', tone: 'green' }), '/spec/body/tone', 'unknown-value'), 'an unknown tone is refused')
ok(TONES.every((tone) => problems(def({ t: 'dot', tone })).length === 0), 'every tone passes')
ok(has(def({ t: 'text', text: 'x', variant: 'huge' }), '/spec/body/variant', 'unknown-value'), 'an unknown enum value is refused')
ok(has(def({ t: 'text', text: { src: '' } }), '/spec/body/text', 'bad-binding'), 'a malformed binding is refused')
ok(has(def({ t: 'text', text: 'x' }, { sizing: { desktop: { w: 13, h: 3 }, mobile: { w: 2, h: 3 } } }), '/sizing/desktop/w', 'out-of-range'), 'a footprint wider than its tier is refused')
ok(has(def({ t: 'text', text: 'x' }, { sizing: { desktop: { w: 3, h: 3 } } }), '/sizing/mobile', 'missing-prop'), 'a missing tier footprint is refused')
ok(has(def({ t: 'text', text: 'x' }, { id: 'Has Spaces' }), '/id', 'bad-id'), 'a malformed id is refused')
ok(has({ id: 'x', sizing }, '', 'spec-or-component'), 'a def with neither spec nor component is refused')
ok(has({ id: 'x', sizing, component: 'nope' }, '/component', 'unknown-component'), 'an unknown bespoke component is refused')
ok(has(def({ t: 'text', text: 'x'.repeat(LIMITS.WIDGET_DEF_MAX) }), '', 'too-large'), 'a def over the size limit is refused')
let deep = { t: 'text', text: 'leaf' }
for (let i = 0; i < LIMITS.MAX_DEPTH + 2; i++) deep = { t: 'stack', children: [deep] }
ok(problems(def(deep)).some((p) => p.code === 'too-deep'), 'a tree nested past the depth limit is refused')
const wide = { t: 'stack', children: Array.from({ length: LIMITS.MAX_NODES + 5 }, () => ({ t: 'divider' })) }
ok(problems(def(wide)).filter((p) => p.code === 'too-many-nodes').length === 1, 'a tree with too many nodes is refused, once')
ok(has(def({ t: 'text', text: 'x' }, { spec: { body: { t: 'text', text: 'x' }, sources: { feed: { from: 'fetch', url: 'javascript:alert(1)' } } } }), '/spec/sources/feed/url', 'bad-url'), 'a fetch source with a non-http url is refused')
ok(problems('nope').length === 1 && problems('nope')[0].code === 'not-an-object', 'a non-object is refused outright')

// ── 3. the walker ────────────────────────────────────────────────────────────
console.log('2b · derived bindings — map, fmt and the conditions (weave\'s one binding model)')
const STATUS = { src: '$', path: 'status' }
ok(problems(def({ t: 'dot', tone: { ...STATUS, map: { DONE: 'ok', FAILED: 'danger' }, fallback: 'muted' } })).length === 0, 'a status mapped onto tones passes')
ok(has(def({ t: 'dot', tone: { ...STATUS, map: { DONE: 'green' } } }), '/spec/body/tone/map/DONE', 'unknown-value'), '…a mapped value that is not a tone is refused, at its own pointer')
ok(has(def({ t: 'dot', tone: { ...STATUS, map: { DONE: 'ok' }, fallback: 'grey' } }), '/spec/body/tone/fallback', 'unknown-value'), '…and so is a fallback that is not one')
ok(has(def({ t: 'icon', name: { ...STATUS, map: { DONE: 'chek' } } }), '/spec/body/name/map/DONE', 'unknown-value'), 'an icon map onto an unknown icon is refused')
ok(problems(def({ t: 'text', text: { src: '$', path: 'created_at', fmt: 'ago' } })).length === 0, 'a formatted binding passes')
ok(problems(def({ t: 'text', text: { src: '$', path: 'at', fmt: 'agoo' } })).some((p) => p.code === 'bad-binding' && /did you mean "ago"/.test(p.message)), 'an unknown fmt is refused, with the likely one')
ok(has(def({ t: 'text', text: { ...STATUS, map: { A: { nested: 1 } } } }), '/spec/body/text', 'bad-binding'), 'a map whose values are not scalars is refused')
ok(problems(def({ t: 'when', cond: { eq: [STATUS, 'DONE'] }, then: { t: 'text', text: 'x' } })).length === 0, 'an eq condition passes')
ok(problems(def({ t: 'when', cond: { in: [STATUS, ['DONE', 'FAILED']] }, then: { t: 'text', text: 'x' } })).length === 0, 'an in condition over a literal list passes')
ok(problems(def({ t: 'when', cond: { not: { eq: [STATUS, 'DONE'] } }, then: { t: 'text', text: 'x' } })).length === 0, 'conditions nest')
ok(has(def({ t: 'when', cond: { eq: [STATUS] }, then: { t: 'text', text: 'x' } }), '/spec/body/cond', 'bad-binding'), 'an eq with one operand is refused')
ok(has(def({ t: 'when', cond: { in: [STATUS, 'DONE'] }, then: { t: 'text', text: 'x' } }), '/spec/body/cond', 'bad-binding'), 'an in over a non-list is refused')
ok(has(def({ t: 'when', cond: { eq: [{ src: '' }, 1] }, then: { t: 'text', text: 'x' } }), '/spec/body/cond', 'bad-binding'), 'a malformed operand is refused')
ok(problems(def({ t: 'text', text: { src: '$', path: 'x', fmat: 'ago' } })).some((p) => /did you mean "fmt"/.test(p.message)), 'a typo\'d binding key names the intended one')
ok(sourcesOf(def({ t: 'when', cond: { not: { eq: [{ src: 'today', path: 'n' }, 1] } }, then: { t: 'text', text: 'x' } })).has('today'), 'the walker finds a source inside a condition')

console.log('3 · one walker')
const spec = {
  frame: { source: { src: 'today', path: 'progressLabel' } },
  body: { t: 'stack', children: [
    { t: 'calendar' },
    { t: 'list', from: { src: 'systems', path: 'rows' }, item: { t: 'text', text: { src: '$', path: 'name' } } },
    { t: 'form', cmd: { app: 'beigeboard', capability: 'createItem', body: { due: { src: 'clock', path: 'iso' } } }, submit: 'ADD', children: [] },
  ] },
}
const display = sourcesOf(spec)
ok(['today', 'systems', '$', 'cal'].every((s) => display.has(s)), 'sourcesOf finds bindings and the molecule\'s slice', JSON.stringify([...display]))
ok(!display.has('clock'), 'a command body is not a display dependency')
ok(sourcesOf(spec, { commands: true }).has('clock'), '…but is found when commands are included')
const seen = []
walkNodes(spec.body, (n, path) => seen.push(`${n.t}@${path}`))
ok(JSON.stringify(seen) === JSON.stringify(['stack@', 'calendar@/children/0', 'list@/children/1', 'text@/children/1/item', 'form@/children/2']), 'walkNodes visits every node with its path', JSON.stringify(seen))

// ── 4. hrefs ─────────────────────────────────────────────────────────────────
console.log('4 · the href rule')
for (const h of ['https://x.test/', '/widgets', 'mailto:a@b.test', '#top']) ok(safeHref(h) === h, `keeps ${JSON.stringify(h)}`)
for (const h of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:x', 'data:,x', 'vbscript:x']) ok(safeHref(h) === undefined, `refuses ${JSON.stringify(h)}`)

console.log(`\n@jkos/widgets: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

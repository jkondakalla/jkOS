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
import { NODES, FRAME, KINDS, LIMITS, TONES, ACTIONS, childProps, validateWidget, sourcesOf, walkNodes, safeHref, appsOf,
  routeProblem, matchRoute, fillRoute, routeTable, pageFor } from '../src/index.js'
import { checkBindings } from '../src/semantic.js'

let pass = 0, fail = 0
const ok = (cond, msg, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.error(`  ✗ ${msg} ${extra}`) } }

const PROP_TYPES = new Set(['binding', 'tone', 'number', 'boolean', 'string', 'enum', 'field', 'cmd', 'pairs', 'node', 'nodes', 'state', 'events', 'params', 'action', 'route'])
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
  ok(!!spec.props.on === !!spec.events, `${t}: an \`on\` prop and a list of events come together`)
  for (const g of spec.oneOf ?? []) ok(g.every((k) => spec.props[k] && !spec.props[k].required), `${t}: each of oneOf ${g.join('|')} is an optional prop`)
  for (const [name, p] of Object.entries(spec.props)) if (p.with) ok(!!spec.props[p.with], `${t}.${name}: \`with\` names a prop of ${t}`)
  const pl = spec.placement ?? {}
  ok(Object.keys(pl).every((k) => ['form', 'root', 'outside'].includes(k)) && [undefined, 'inside', 'outside'].includes(pl.form)
    && (pl.outside === undefined || !!spec.props[pl.outside]), `${t}'s placement is a known rule`)
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
for (const [name, a] of Object.entries(ACTIONS)) {
  ok(a.props[name]?.required === true, `the ${name} action is named by its own required key`)
  ok(Object.values(a.props).every((p) => PROP_TYPES.has(p.type)), `the ${name} action's props have known types`)
  const errs = problems(def({ t: 'button', text: 'GO', on: { press: a.example } }, { spec: { state: { open: { type: 'boolean' } }, body: { t: 'button', text: 'GO', on: { press: a.example } } } }))
  ok(errs.length === 0, `the ${name} action's example is a valid action`, JSON.stringify(errs))
}

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
ok(has({ id: 'x', sizing }, '/spec', 'missing-prop'), 'a def without a spec is refused')
ok(problems({ id: 'screen', spec: { body: { t: 'text', text: 'x' } } }).length === 0, 'sizing is optional — a widget that is not placed on a grid (a screen, a part) has none')

console.log('2a · published: only declared server contracts')
const pub = (spec, extra = {}) => validateWidget({ id: 'pub', label: 'Pub', sizing, spec, ...extra }, { published: true })
const pubHas = (spec, path, code, extra) => pub(spec, extra).some((p) => p.path === path && p.code === code)
const JOBS = { jobs: { kind: 'dataset', app: 'lazuros', dataset: 'jobs' } }
ok(pub({ sources: JOBS, body: { t: 'rows', from: { src: 'jobs' }, title: { src: '$', path: 'title' }, empty: { src: '$sources', path: 'jobs.state' } } }).length === 0,
  'a published widget binding its own dataset (and the renderer\'s $, $sources) passes')
ok(pubHas({ body: { t: 'metric', value: { src: 'systems', path: 'up' } } }, '/spec/body/value', 'unpublishable'), "a published widget binding a host's slice is refused, at the binding")
ok(pubHas({ frame: { href: { src: 'origins', path: 'kouros' } }, body: { t: 'text', text: 'x' } }, '/spec/frame/href', 'unpublishable'), '…in its frame too')
ok(pubHas({ body: { t: 'button', text: 'GO', cmd: { app: 'beigeboard', capability: 'createItem', body: { due: { src: 'clock', path: 'iso' } } } } }, '/spec/body/cmd/body/due', 'unpublishable'), "…and in a command's body")
ok(pubHas({ body: { t: 'calendar' } }, '/spec/body', 'unpublishable'), 'a published molecule is refused — it reads its host\'s state')
ok(pubHas({ body: { t: 'text', text: 'x' } }, '/sizing', 'missing-prop', { sizing: undefined }), 'a published widget is placed, so its sizing is required')
ok(problems(def({ t: 'metric', value: { src: 'systems', path: 'up' } })).length === 0, 'the same slice binding in a FILE passes — a file is its host\'s')
ok(has({ id: 'x', sizing, component: 'focus' }, '/component', 'retired'), 'the retired `component` hatch is refused…')
ok(problems({ id: 'x', sizing, component: 'bb-week' })[0]?.fix === '{ "spec": { "body": { "t": "week" } } }', '…naming the molecule it became')
ok(problems(def({ t: 'focus' })).length === 0 && problems(def({ t: 'week' })).length === 0, 'focus and week are molecules')
ok(has(def({ t: 'stack', children: [{ t: 'row', children: [{ t: 'week' }] }] }), '/spec/body/children/0/children/0', 'misplaced'), '…placed like one (on the root)')
ok(JSON.stringify([...sourcesOf({ t: 'week' })].sort()) === '["items","todayIso"]', "a molecule reading two slices reports both (the walker reads the manifest's `reads`)")
ok(has(def({ t: 'text', text: 'x'.repeat(LIMITS.WIDGET_DEF_MAX) }), '', 'too-large'), 'a def over the size limit is refused')
let deep = { t: 'text', text: 'leaf' }
for (let i = 0; i < LIMITS.MAX_DEPTH + 2; i++) deep = { t: 'stack', children: [deep] }
ok(problems(def(deep)).some((p) => p.code === 'too-deep'), 'a tree nested past the depth limit is refused')
const wide = { t: 'stack', children: Array.from({ length: LIMITS.MAX_NODES + 5 }, () => ({ t: 'divider' })) }
ok(problems(def(wide)).filter((p) => p.code === 'too-many-nodes').length === 1, 'a tree with too many nodes is refused, once')
const withSources = (sources, ctx) => validateWidget({ id: 'probe', label: 'Probe', sizing, spec: { body: { t: 'text', text: 'x' }, sources } }, ctx)
const srcHas = (sources, path, code, ctx) => withSources(sources, ctx).some((p) => p.path === path && p.code === code)
ok(srcHas({ feed: { kind: 'fetch', url: 'javascript:alert(1)' } }, '/spec/sources/feed/url', 'bad-url'), 'a fetch source with a non-http url is refused')
ok(srcHas({ jobs: { kind: 'fetch', url: '/api/lazuros/jobs' } }, '/spec/sources/jobs/url', 'bad-url'), 'a RELATIVE fetch (this origin) is refused — a widget reads only what an app declares')
ok(srcHas({ feed: { kind: 'fetch', url: 'http://api.example.com/x.json' } }, '/spec/sources/feed/url', 'bad-url'), 'a plain-http fetch is refused')
const HOSTS = { suiteHosts: ['jkos.net', 'staging.jkos.net'] }
ok(srcHas({ items: { kind: 'fetch', url: 'https://beigeboard.jkos.net/api/items' } }, '/spec/sources/items/url', 'suite-url', HOSTS), 'a fetch to a suite subdomain is refused, given the suite hosts')
ok(srcHas({ items: { kind: 'fetch', url: 'https://jkos.net/api/beigeboard/items' } }, '/spec/sources/items/url', 'suite-url', HOSTS), '…and to the apex')
ok(withSources({ wx: { kind: 'fetch', url: 'https://api.open-meteo.com/v1/forecast', poll: 900 } }, HOSTS).length === 0, 'an external public https fetch passes')
ok(withSources({ jobs: { kind: 'dataset', app: 'lazuros', dataset: 'jobs', params: { job_id: { src: '$result', path: 'job_id' }, status: 'DONE' }, poll: 8 } }).length === 0, 'a dataset source with bound params passes')
ok(srcHas({ jobs: { from: 'fetch', url: '/api/lazuros/jobs' } }, '/spec/sources/jobs/from', 'renamed'), 'the old `from` discriminator is refused, naming `kind`')
ok(withSources({ jobs: { from: 'fetch', url: '/api/x' } })[0]?.fix?.includes('"kind": "dataset"'), '…pointing a suite endpoint at a dataset')
ok(srcHas({ t: { kind: 'hud', key: 'today' } }, '/spec/sources/t/kind', 'bad-source'), 'a hud source is refused — slices are always in scope')
ok(withSources({ d: { kind: 'datset', app: 'x', dataset: 'y' } }).some((p) => p.fix === 'did you mean "dataset"?'), 'a typo\'d kind names the intended one')
ok(srcHas({ d: { kind: 'dataset', dataset: 'jobs' } }, '/spec/sources/d/app', 'missing-prop'), 'a dataset source without its app is refused')
ok(srcHas({ d: { kind: 'dataset', app: 'lazuros', dataset: 'jobs', url: '/x' } }, '/spec/sources/d/url', 'unknown-prop'), 'a key another kind uses is refused')
ok(srcHas({ d: { kind: 'dataset', app: 'lazuros', dataset: 'jobs', params: { job_id: { src: '' } } } }, '/spec/sources/d/params/job_id', 'bad-binding'), 'a malformed param binding is refused')
ok(problems('nope').length === 1 && problems('nope')[0].code === 'not-an-object', 'a non-object is refused outright')
ok(withSources({ s: { kind: 'dataset', app: 'kouros', dataset: 'search', params: { q: { src: '$form', path: 'q' } }, debounce: 300 } }).length === 0, 'a dataset source may debounce (ms)')
ok(srcHas({ s: { kind: 'dataset', app: 'kouros', dataset: 'search', debounce: 10 } }, '/spec/sources/s/debounce', 'out-of-range'), "…within the manifest's bounds")
ok(srcHas({ wx: { kind: 'fetch', url: 'https://api.example.com/x', debounce: 300 } }, '/spec/sources/wx/debounce', 'unknown-prop'), '…and only a dataset: a fetch has no params to settle')
ok(srcHas({ d: { kind: 'dataset', app: 'lazuros', dataset: 'jobs', poll: 0 } }, '/spec/sources/d/poll', 'out-of-range'), 'a poll of 0 seconds is refused')

// ── 3. the walker ────────────────────────────────────────────────────────────
ok(has(def({ t: 'stack', gap: 400, children: [] }), '/spec/body/gap', 'out-of-range'), "a number outside the manifest's bounds is refused (a 400px gap)")
ok(problems(def({ t: 'stack', gap: 12, children: [] })).length === 0, '…one inside them passes')

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

const CMD = { app: 'lazuros', capability: 'query' }
ok(problems(def({ t: 'form', cmd: CMD, submit: 'ASK', children: [{ t: 'input', field: 'text' }], result: { t: 'text', text: { src: '$result', path: 'response' } } })).length === 0, 'a form may draw what its command produced in `result`')
ok(problems(def({ t: 'button', text: 'GO', cmd: CMD, result: { t: 'text', text: { src: '$job', path: 'status' } } })).length === 0, '…and so may a button')
ok(has(def({ t: 'form', cmd: CMD, submit: 'ASK', children: [], result: { t: 'input', field: 'x' } }), '/spec/body/result', 'misplaced'), 'a control in a form\'s result slot is refused — the result is drawn beside the form, not in it')

console.log('2c · state and events')
const S = { q: { type: 'string', default: '' }, open: { type: 'boolean', default: false } }
const withState = (body, state = S) => ({ id: 'probe', label: 'Probe', spec: { state, body } })
const sHas = (body, path, code, state) => problems(withState(body, state)).some((p) => p.path === path && p.code === code)
ok(problems(withState({ t: 'stack', children: [{ t: 'input', state: 'q', placeholder: 'Search…' }, { t: 'toggle', state: 'open', label: 'Open' }] })).length === 0,
  'a control with `state` sits outside any form — it writes the widget\'s own state')
ok(sHas({ t: 'input', field: 'q' }, '/spec/body', 'misplaced'), '…one with `field` still needs a form')
ok(sHas({ t: 'form', cmd: CMD, submit: 'GO', children: [{ t: 'input', state: 'q' }] }, '/spec/body/children/0', 'misplaced'), "…and inside a form a control writes $form, never state")
ok(sHas({ t: 'input' }, '/spec/body', 'missing-prop'), 'a control names exactly one of field | state…')
ok(sHas({ t: 'form', cmd: CMD, submit: 'GO', children: [{ t: 'input', field: 'q', state: 'q' }] }, '/spec/body/children/0', 'conflict'), '…never both')
ok(sHas({ t: 'text', text: 'x' }, '/spec/state/q/type', 'unknown-value', { q: { type: 'text' } }), 'a state variable has a known type')
ok(sHas({ t: 'text', text: 'x' }, '/spec/state/n/default', 'bad-type', { n: { type: 'number', default: 'zero' } }), "…and a default of that type")
ok(sHas({ t: 'text', text: 'x' }, '/spec/state/1q', 'bad-name', { '1q': { type: 'string' } }), '…and an identifier for a name')
const flip = { set: 'open', to: { not: { src: '$state', path: 'open' } } }
ok(problems(withState({ t: 'button', text: 'MORE', on: { press: flip } })).length === 0, 'a button may set state instead of running a command')
ok(problems(withState({ t: 'button', text: 'SAVE', on: { press: [{ run: CMD }, flip] } })).length === 0, '…or run a chain of actions')
ok(sHas({ t: 'button', text: 'GO' }, '/spec/body', 'missing-prop'), 'a button has a cmd or an on.press — something must happen')
ok(sHas({ t: 'button', text: 'GO', cmd: CMD, on: { press: flip } }, '/spec/body', 'conflict'), '…exactly one of them')
ok(sHas({ t: 'button', text: 'GO', on: { press: flip }, result: { t: 'text', text: 'x' } }, '/spec/body/result', 'misplaced'), "a button's result draws what its cmd produced — none without one")
ok(sHas({ t: 'button', text: 'GO', on: { tap: flip } }, '/spec/body/on/tap', 'unknown-prop'), "an event the node does not have is refused")
ok(problems(withState({ t: 'button', text: 'GO', on: { tap: flip } }))[0]?.fix === 'allowed: press', '…naming the ones it has')
ok(sHas({ t: 'button', text: 'GO', on: { press: { toggle: 'open' } } }, '/spec/body/on/press', 'unknown-action'), 'an action that is not one is refused')
ok(sHas({ t: 'button', text: 'GO', on: { press: { set: 'open', to: true, run: CMD } } }, '/spec/body/on/press', 'conflict'), 'an action does one thing')
ok(sHas({ t: 'button', text: 'GO', on: { press: [] } }, '/spec/body/on/press', 'bad-type'), 'an event runs at least one action')
ok(sHas({ t: 'button', text: 'GO', on: { press: Array.from({ length: 9 }, () => flip) } }, '/spec/body/on/press', 'out-of-range'), '…and at most eight — a chain, not a program')
ok(sHas({ t: 'button', text: 'GO', on: { press: { set: 'open' } } }, '/spec/body/on/press/to', 'missing-prop'), "an action's props are checked like a node's")
const rowsOn = { t: 'rows', from: { src: 'x' }, title: { src: '$', path: 't' }, on: { select: flip } }
ok(problems(withState(rowsOn)).length === 0, 'a row may be an action (on.select)')
ok(sHas({ ...rowsOn, href: { src: '$', path: 'url' } }, '/spec/body/on', 'conflict'), '…or a link — never both')
ok(problems(withState({ t: 'form', cmd: CMD, submit: 'GO', children: [], on: { done: flip } })).length === 0, 'a form may act once its command is done')
ok(problems(withState({ t: 'button', text: 'END', on: { press: { do: 'focus.clear' } } })).length === 0, 'a button may fire a host action (do)')
ok(sHas({ t: 'button', text: 'END', on: { press: { do: 'clearFocus' } } }, '/spec/body/on/press/do', 'bad-type'), "…named <engine>.<verb>")
ok(pubHas({ body: { t: 'button', text: 'END', on: { press: { do: 'focus.clear' } } } }, '/spec/body/on/press', 'unpublishable'), "a published widget fires no host action — it is one host's engine")

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
console.log('3b · what a widget reaches (AI-backed is derived, never declared)')
const reaching = { id: 'r', sizing, spec: {
  sources: { jobs: { kind: 'dataset', app: 'lazuros', dataset: 'jobs' }, wx: { kind: 'fetch', url: 'https://api.example.com/x' } },
  body: { t: 'stack', children: [
    { t: 'form', cmd: { app: 'beigeboard', capability: 'createItem' }, submit: 'ADD', children: [] },
    { t: 'list', from: { src: 'jobs' }, item: { t: 'button', text: 'GO', cmd: { app: 'kouros', capability: 'x' } } },
  ] } } }
ok(JSON.stringify([...appsOf(reaching)].sort()) === '["beigeboard","kouros","lazuros"]', 'appsOf: every dataset source\'s app and every command\'s, however deep')
ok(appsOf({ id: 'c', sizing, spec: { body: { t: 'text', text: 'x' } } }).size === 0, 'appsOf: a widget that reaches no app reaches none')
ok(appsOf({ id: 'e', spec: { body: { t: 'button', text: 'ASK', on: { press: [{ set: 'q', to: '' }, { run: { app: 'lazuros', capability: 'query' } }] } } } }).has('lazuros'),
  "appsOf: an event's `run` reaches its app too — the AI kill switch is derived from it")
ok(!sourcesOf({ t: 'button', text: 'GO', on: { press: { set: 'x', to: { src: 'clock', path: 'iso' } } } }).has('clock'), 'sourcesOf: an event resolves when it fires — not a display dependency')
ok(has({ ...reaching, ai: true }, '/ai', 'derived'), 'a hand-set `ai` is refused — it is derived from what the widget binds')

console.log('3c · the second tier: bindings against what the apps declare')
const DOCS = {
  lz: {
    capabilities: { capabilities: [
      { id: 'ask', body: [{ name: 'text', type: 'string', required: true }], returns: [{ name: 'job_id', type: 'string' }], resolves: [{ name: 'response', type: 'text' }] },
      { id: 'note', body: [{ name: 'title', type: 'string', required: true }, { name: 'kind', type: 'string', required: true, default: 'task' }], returns: [{ name: 'id', type: 'number' }] },
    ] },
    datasets: { datasets: [
      { id: 'jobs', path: '/jobs', filters: [{ name: 'job_id' }, { name: 'status' }], item: [{ name: 'id', type: 'string' }, { name: 'status', type: 'string' }, { name: 'result', type: 'json', item: [{ name: 'response', type: 'text' }] }] },
      { id: 'one', path: '/one/:id', cardinality: 'one', item: [{ name: 'total', type: 'number' }] },
      { id: 'home', path: '/home', cardinality: 'one', item: [{ name: 'recent', type: 'json', item: [{ name: 'title', type: 'string' }] }] },
      { id: 'radio', path: '/radio', filters: [{ name: 'seed', required: true }] },
    ] },
  },
}
const SLICES = { clock: { type: 'json', item: { hm: { type: 'string' } } }, todayIso: { type: 'date' } }
const t2 = (spec) => checkBindings({ id: 'p', sizing, spec }, { docs: DOCS, slices: SLICES })
const t2has = (spec, path, code) => t2(spec).some((p) => p.path === path && p.code === code)
const JOBS_SRC = { jobs: { kind: 'dataset', app: 'lz', dataset: 'jobs' } }
ok(t2({ sources: JOBS_SRC, body: { t: 'list', from: { src: 'jobs' }, item: { t: 'text', text: { src: '$', path: 'result.response' } } } }).length === 0, 'a row field, and one inside a declared json item, bind')
ok(t2has({ sources: JOBS_SRC, body: { t: 'list', from: { src: 'jobs' }, item: { t: 'text', text: { src: '$', path: 'statsu' } } } }, '/spec/body/item/text', 'undeclared-path'), 'a row field nobody declares is refused')
ok(t2({ sources: JOBS_SRC, body: { t: 'list', from: { src: 'jobs' }, item: { t: 'text', text: { src: '$', path: 'statsu' } } } })[0]?.fix === 'did you mean "status"?', '…naming the declared one')
ok(t2has({ body: { t: 'text', text: { src: 'clock', path: 'hmm' } } }, '/spec/body/text', 'undeclared-path'), 'a slice field nobody declares is refused')
ok(t2has({ body: { t: 'text', text: { src: 'todayIso', path: 'year' } } }, '/spec/body/text', 'undeclared-path'), 'a path below a scalar is refused')
ok(t2({ body: { t: 'text', text: { src: 'clokc', path: 'hm' } } }).some((p) => p.code === 'unknown-source' && p.fix === 'did you mean "clock"?'), 'an unknown source is refused, with the likely one')
ok(t2has({ body: { t: 'when', cond: { eq: [{ src: 'clock', path: 'nope' }, 1] }, then: { t: 'text', text: 'x' } } }, '/spec/body/cond', 'undeclared-path'), "a condition's operands are checked")
ok(t2has({ sources: JOBS_SRC, body: { t: 'text', text: { src: 'jobs', path: 'status' } } }, '/spec/body/text', 'undeclared-path'), "a list read as if it were a row is refused (bind it to a list's from)")
ok(t2has({ sources: { j: { kind: 'dataset', app: 'lz', dataset: 'jobz' } }, body: { t: 'text', text: 'x' } }, '/spec/sources/j/dataset', 'undeclared'), 'a dataset the app does not declare is refused')
ok(t2has({ sources: { j: { kind: 'dataset', app: 'lz', dataset: 'jobs', params: { state: 'DONE' } } }, body: { t: 'text', text: 'x' } }, '/spec/sources/j/params/state', 'undeclared'), 'a parameter the dataset does not honour is refused')
ok(t2has({ sources: { o: { kind: 'dataset', app: 'lz', dataset: 'one' } }, body: { t: 'text', text: 'x' } }, '/spec/sources/o/params', 'missing-param'), 'a path parameter left unfilled is refused')
ok(t2has({ sources: { r: { kind: 'dataset', app: 'lz', dataset: 'radio' } }, body: { t: 'text', text: 'x' } }, '/spec/sources/r/params', 'missing-param'), 'a required filter left unset is refused')
ok(t2({ sources: { o: { kind: 'dataset', app: 'lz', dataset: 'one', params: { id: 1 } } }, body: { t: 'text', text: { src: 'o', path: 'total' } } }).length === 0, 'a one-document dataset binds its fields directly')
ok(t2has({ sources: { j: { kind: 'dataset', app: 'lz', dataset: 'jobs', params: { status: 'DONE' }, debounce: 300 } }, body: { t: 'text', text: 'x' } }, '/spec/sources/j/debounce', 'debounce-unbound'), 'a debounce over only literal params is refused — nothing ever changes for it to wait on')
ok(t2({ sources: { j: { kind: 'dataset', app: 'lz', dataset: 'jobs', params: { status: { src: 'clock', path: 'hm' } }, debounce: 300 } }, body: { t: 'text', text: 'x' } }).length === 0, '…one over a bound param passes')
const form = (cmd, children, result) => ({ body: { t: 'form', cmd, submit: 'GO', children, ...(result ? { result } : {}) } })
ok(t2(form({ app: 'lz', capability: 'note', body: { title: { src: '$form', path: 'title' } } }, [{ t: 'input', field: 'title' }])).length === 0, 'a form binding what its input writes passes (a defaulted required field need not be bound)')
ok(t2has(form({ app: 'lz', capability: 'note', body: { title: { src: '$form', path: 'titel' } } }, [{ t: 'input', field: 'title' }]), '/spec/body/cmd/body/title', 'undeclared-path'), '$form.<field> that no control writes is refused')
ok(t2has(form({ app: 'lz', capability: 'note', body: { titel: 'x' } }, []), '/spec/body/cmd/body/titel', 'undeclared'), 'a body field the capability does not take is refused')
ok(t2has(form({ app: 'lz', capability: 'note', body: {} }, []), '/spec/body/cmd/body', 'missing-field'), 'a required body field nothing binds is refused')
ok(t2has(form({ app: 'lz', capability: 'nope' }, []), '/spec/body/cmd/capability', 'undeclared'), 'a capability the app does not declare is refused')
ok(t2(form({ app: 'lz', capability: 'ask', body: { text: 'hi' } }, [], { t: 'text', text: { src: '$result', path: 'response' } })).length === 0, "an async command's $result is what it RESOLVES to")
ok(t2has(form({ app: 'lz', capability: 'ask', body: { text: 'hi' } }, [], { t: 'text', text: { src: '$result', path: 'job_id' } }), '/spec/body/result/text', 'undeclared-path'), '…never its job handle')
ok(t2(form({ app: 'lz', capability: 'ask', body: { text: 'hi' } }, [], { t: 'text', text: { src: '$job', path: 'phase' } })).length === 0, '$job carries phase/status/result/error')
ok(t2has(form({ app: 'lz', capability: 'note', body: { title: 'x' } }, [], { t: 'text', text: { src: '$form', path: 'title' } }), '/spec/body/result/text', 'unknown-source'), 'a result slot is drawn beside the form: $form is not in its scope')

const ST = { q: { type: 'string' }, open: { type: 'boolean' } }
ok(t2({ state: ST, body: { t: 'input', state: 'q' } }).length === 0, '$state: a control writes a declared variable')
ok(t2has({ state: ST, body: { t: 'input', state: 'qq' } }, '/spec/body/state', 'undeclared'), '…one nobody declared is refused')
ok(t2({ state: ST, body: { t: 'input', state: 'qq' } })[0]?.fix === 'did you mean "q"?', '…naming the declared one')
ok(t2has({ state: ST, body: { t: 'button', text: 'x', on: { press: { set: 'opne', to: true } } } }, '/spec/body/on/press/set', 'undeclared'), 'a `set` of an undeclared variable is refused')
ok(t2has({ state: ST, body: { t: 'text', text: { src: '$state', path: 'query' } } }, '/spec/body/text', 'undeclared-path'), '$state.<name> must be declared')
ok(t2has({ state: ST, body: { t: 'button', text: 'x', on: { press: { set: 'q', to: { src: 'clock', path: 'mm' } } } } }, '/spec/body/on/press/to', 'undeclared-path'), "a set's value is checked like any binding")
const NOTE = { app: 'lz', capability: 'note', body: { title: 'x' } }
ok(t2({ state: ST, body: { t: 'button', text: 'x', on: { press: [{ run: NOTE }, { set: 'q', to: { src: '$result', path: 'id' } }] } } }).length === 0,
  "the actions after a `run` read what it produced as $result")
ok(t2has({ state: ST, body: { t: 'button', text: 'x', on: { press: [{ run: NOTE }, { set: 'q', to: { src: '$result', path: 'idd' } }] } } }, '/spec/body/on/press/1/to', 'undeclared-path'),
  '…checked against what the capability declares it returns')
ok(t2has({ state: ST, body: { t: 'button', text: 'x', on: { press: [{ set: 'q', to: { src: '$result', path: 'id' } }, { run: NOTE }] } } }, '/spec/body/on/press/0/to', 'unknown-source'),
  '…and not before it runs')
ok(t2has({ body: { t: 'button', text: 'x', on: { press: { run: { app: 'lz', capability: 'note' } } } } }, '/spec/body/on/press/run/body', 'missing-field'), "a `run` is checked like any command (its required fields)")
ok(t2({ sources: JOBS_SRC, state: ST, body: { t: 'rows', from: { src: 'jobs' }, title: { src: '$', path: 'status' }, on: { select: { set: 'q', to: { src: '$', path: 'id' } } } } }).length === 0,
  "a row's event reads that row as $")
ok(t2({ state: ST, body: { t: 'form', cmd: NOTE, submit: 'GO', children: [], on: { done: { set: 'q', to: { src: '$result', path: 'id' } } } } }).length === 0,
  "a form's `done` reads what its command produced")
const HOST = { 'player.play': { label: 'Play', args: [{ name: 'id', type: 'number', required: true }, { name: 'from', type: 'number' }], returns: [{ name: 'queued', type: 'number' }] } }
const t2h = (spec) => checkBindings({ id: 'p', spec }, { docs: DOCS, slices: SLICES, actions: HOST })
const t2hHas = (spec, path, code) => t2h(spec).some((p) => p.path === path && p.code === code)
const play = (a) => ({ state: ST, body: { t: 'button', text: 'PLAY', on: { press: a } } })
ok(t2h(play([{ do: 'player.play', with: { id: 7 } }, { set: 'q', to: { src: '$result', path: 'queued' } }])).length === 0, 'a host action its host declares passes, and what it returns is $result after it')
ok(t2hHas(play({ do: 'player.pley', with: { id: 7 } }), '/spec/body/on/press/do', 'undeclared'), 'an action the host does not declare is refused…')
ok(t2h(play({ do: 'player.pley', with: { id: 7 } }))[0]?.fix === 'did you mean "player.play"?', '…naming the declared one')
ok(t2hHas(play({ do: 'player.play', with: { id: 7, form: 1 } }), '/spec/body/on/press/with/form', 'undeclared'), 'an argument it does not take is refused')
ok(t2hHas(play({ do: 'player.play' }), '/spec/body/on/press/with', 'missing-field'), 'a required argument nothing binds is refused')
ok(t2hHas(play({ do: 'player.play', with: { id: { src: 'clock', path: 'hmm' } } }), '/spec/body/on/press/with/id', 'undeclared-path'), "an argument's binding is checked")
ok(t2hHas(play([{ do: 'player.play', with: { id: 7 } }, { set: 'q', to: { src: '$result', path: 'qeued' } }]), '/spec/body/on/press/1/to', 'undeclared-path'), "…and $result after it is what it declares it returns")
ok(t2has(play({ do: 'player.play', with: { id: 7 } }), '/spec/body/on/press/do', 'undeclared'), 'a host that declares no actions refuses every do')

console.log('3d · patterns')
ok(problems(def({ t: 'facts', items: [{ label: 'High', value: { src: 'weather', path: 'hiLabel' }, tone: 'accent' }] })).length === 0, 'facts takes a list of { label, value, tone? }')
ok(has(def({ t: 'facts', items: [] }), '/spec/body/items', 'bad-type'), '…never an empty one')
ok(has(def({ t: 'facts', items: [{ label: 'x' }] }), '/spec/body/items/0/value', 'missing-prop'), '…each with a value')
ok(has(def({ t: 'facts', items: [{ label: 'x', value: 1, tone: 'green' }] }), '/spec/body/items/0/tone', 'unknown-value'), '…and a real tone')
ok(has(def({ t: 'form', cmd: CMD, submit: 'S', children: [{ t: 'ask', cmd: CMD }] }), '/spec/body/children/0', 'misplaced'), 'an ask carries its own form, so it is never inside one')
ok(has(def({ t: 'rows', from: { src: 'x' }, title: 't', icon: 'chek' }), '/spec/body/icon', 'unknown-value'), "a rows icon names a real icon")
const ROWS = { sources: JOBS_SRC, body: { t: 'rows', from: { src: 'jobs' }, title: { src: '$', path: 'status' }, detail: { src: '$', path: 'result.response' }, mark: { src: '$', path: 'status', map: { DONE: 'ok' }, fallback: 'muted' } } }
ok(t2(ROWS).length === 0, "rows' per-row props are checked against a ROW of `from` ($)")
ok(t2has({ ...ROWS, body: { ...ROWS.body, title: { src: '$', path: 'titel' } } }, '/spec/body/title', 'undeclared-path'), '…so a row field nobody declares is refused')
ok(t2has({ ...ROWS, body: { ...ROWS.body, from: { src: 'jobs' }, empty: { src: '$', path: 'status' } } }, '/spec/body/empty', 'unknown-source'), "…while a node-level prop (empty) has no $ — it is not per row")
ok(t2({ body: { t: 'ask', cmd: { app: 'lz', capability: 'ask' }, answer: { src: '$result', path: 'response' } } }).length === 0, "ask: the question is the capability's `text`, and the answer reads what it RESOLVES to")
ok(t2has({ body: { t: 'ask', cmd: { app: 'lz', capability: 'ask' }, answer: { src: '$result', path: 'job_id' } } }, '/spec/body/answer', 'undeclared-path'), '…never the job handle')
ok(t2has({ body: { t: 'ask', cmd: { app: 'lz', capability: 'ask' }, field: 'q' } }, '/spec/body/cmd/body/q', 'undeclared'), "ask: a field the capability does not take is refused")
ok(t2has({ body: { t: 'facts', items: [{ label: 'x', value: { src: 'clock', path: 'hmm' } }] } }, '/spec/body/items/0/value', 'undeclared-path'), 'facts: each value binding is checked')
const HOME = { h: { kind: 'dataset', app: 'lz', dataset: 'home' } }
const recent = (extra = {}) => ({ t: 'feed', from: { src: 'h', path: 'recent' }, text: { src: '$', path: 'title' }, ...extra })
ok(t2has({ sources: HOME, body: recent() }, '/spec/body/empty', 'silent-empty'), 'a list INSIDE one document with no `empty` is refused — the source is not empty, so the card would be blank')
ok(t2({ sources: HOME, body: recent({ empty: 'Nothing yet.' }) }).length === 0, '…one that says its own empty passes')
ok(t2({ sources: HOME, body: { t: 'when', cond: { src: 'h', path: 'recent' }, then: recent(), else: { t: 'text', text: 'Nothing yet.' } } }).length === 0, '…as does one under a `when` on that same list')
ok(t2has({ sources: HOME, body: { t: 'when', cond: { src: 'h', path: 'recent' }, then: { t: 'text', text: 'x' }, else: recent() } }, '/spec/body/else/empty', 'silent-empty'), "…but not one in the `when`'s else")
ok(t2(ROWS).length === 0, "a list that IS its source (a 'many' dataset) needs no `empty` of its own — the frame draws an empty source")

console.log('3e · routes — a page, its $route, and go')
for (const r of ['/', '/books', '/books/:id', '/a/:x/b/:y', '/v1.2/x_y-z']) ok(routeProblem(r) === null, `${r} is a route`)
for (const r of ['books', '/books/', '/Books', '/a//b', '/:id/:id', '/a b', 7]) ok(routeProblem(r) !== null, `${JSON.stringify(r)} is not`)
ok(JSON.stringify(matchRoute('/books/:id', '/books/a%20b')) === '{"id":"a b"}', 'matchRoute: a param is decoded')
ok(JSON.stringify(matchRoute('/books/:id', '/books/7/?x=1#y')) === '{"id":"7"}', 'matchRoute: the query, the hash and one trailing / are ignored')
ok(matchRoute('/books/:id', '/books') === null && matchRoute('/books/:id', '/albums/7') === null, 'matchRoute: a different shape or literal does not match')
ok(JSON.stringify(matchRoute('/', '/')) === '{}', 'matchRoute: the root matches the root')
ok(fillRoute('/books/:id', { id: 'a/b c' }) === '/books/a%2Fb%20c', 'fillRoute: a param is encoded — it can never add a segment')
ok(fillRoute('/books/:id', {}) === null && fillRoute('/books/:id', { id: '' }) === null, 'fillRoute: a missing param builds no path (never /books/undefined)')
const RT = routeTable([{ id: 'home', route: '/' }, { id: 'book', route: '/books/:id' }, { id: 'new', route: '/books/new' }, { id: 'card' }])
ok(RT.problems.length === 0 && RT.routes.size === 3, 'routeTable: every page by its route; a widget with no route is no page')
ok(routeTable([{ id: 'a', route: '/books/:id' }, { id: 'b', route: '/books/:slug' }]).problems.length === 1, 'routeTable: two patterns that answer the same paths conflict')
ok(pageFor(RT.routes, '/books/new')?.id === 'new' && pageFor(RT.routes, '/books/9')?.params.id === '9', 'pageFor: the most literal route wins, whatever order the files came in')
ok(pageFor(RT.routes, '/nowhere') === null, 'pageFor: a path no page answers is null')
const page = (body, extra = {}) => ({ id: 'book', label: 'Book', route: '/books/:id', spec: { body }, ...extra })
ok(problems(page({ t: 'text', text: { src: '$route', path: 'id' } })).length === 0, 'a page declares its route')
ok(problems(page({ t: 'text', text: 'x' }, { route: '/books/' })).some((p) => p.path === '/route' && p.code === 'bad-route'), '…a real one')
ok(problems(page({ t: 'text', text: 'x' }, { sizing })).some((p) => p.path === '/route' && p.code === 'conflict'), 'a page is a screen, not a HUD card — never both route and sizing')
ok(validateWidget(page({ t: 'text', text: 'x' }), { published: true }).some((p) => p.path === '/route' && p.code === 'unpublishable'), 'a page is never published')
const goTo = (a) => ({ t: 'button', text: 'OPEN', on: { press: a } })
ok(problems(withState(goTo({ go: '/books/:id', params: { id: 7 } }))).length === 0, 'a button may go to a page')
ok(sHas(goTo({ go: 'books' }), '/spec/body/on/press/go', 'bad-route'), '…by a route pattern')
ok(pubHas({ body: goTo({ go: '/books/:id', params: { id: 7 } }) }, '/spec/body/on/press', 'unpublishable'), 'a published widget does not go — it links out with an href')
const PAGES = ['/', '/books/:id']
const t2p = (spec, extra = {}) => checkBindings({ id: 'p', ...extra, spec }, { docs: DOCS, slices: SLICES, pages: PAGES })
const t2pHas = (spec, path, code, extra) => t2p(spec, extra).some((p) => p.path === path && p.code === code)
ok(t2p({ body: { t: 'text', text: { src: '$route', path: 'id' } } }, { route: '/books/:id' }).length === 0, "a page reads its route's params as $route")
ok(t2pHas({ body: { t: 'text', text: { src: '$route', path: 'slug' } } }, '/spec/body/text', 'undeclared-path', { route: '/books/:id' }), '…only the ones its route names')
ok(t2pHas({ body: { t: 'text', text: { src: '$route', path: 'id' } } }, '/spec/body/text', 'unknown-source'), 'a widget that is no page has no $route')
ok(t2p({ body: goTo({ go: '/books/:id', params: { id: 7 } }) }).length === 0, 'a go to a page its app has passes')
ok(t2pHas({ body: goTo({ go: '/book/:id', params: { id: 7 } }) }, '/spec/body/on/press/go', 'undeclared'), 'a go to a route no page answers is refused…')
ok(t2p({ body: goTo({ go: '/book/:id', params: { id: 7 } }) })[0]?.fix === 'did you mean "/books/:id"?', '…naming the likely one')
ok(t2pHas({ body: goTo({ go: '/books/:id' }) }, '/spec/body/on/press/params', 'missing-param'), 'a go fills every :param of its route')
ok(t2pHas({ body: goTo({ go: '/books/:id', params: { id: 7, page: 2 } }) }, '/spec/body/on/press/params/page', 'undeclared'), '…and nothing else')

console.log('4 · the href rule')
for (const h of ['https://x.test/', '/widgets', 'mailto:a@b.test', '#top']) ok(safeHref(h) === h, `keeps ${JSON.stringify(h)}`)
for (const h of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:x', 'data:,x', 'vbscript:x']) ok(safeHref(h) === undefined, `refuses ${JSON.stringify(h)}`)

console.log(`\n@jkos/widgets: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

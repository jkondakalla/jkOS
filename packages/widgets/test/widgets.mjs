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
import { NODES, FRAME, KINDS, LIMITS, TONES, childProps, validateWidget, sourcesOf, walkNodes, safeHref, appsOf } from '../src/index.js'
import { checkBindings } from '../src/semantic.js'

let pass = 0, fail = 0
const ok = (cond, msg, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.error(`  ✗ ${msg} ${extra}`) } }

const PROP_TYPES = new Set(['binding', 'tone', 'number', 'boolean', 'string', 'enum', 'field', 'cmd', 'pairs', 'node', 'nodes'])
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
ok(has({ id: 'x', sizing }, '/spec', 'missing-prop'), 'a def without a spec is refused')
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

console.log('4 · the href rule')
for (const h of ['https://x.test/', '/widgets', 'mailto:a@b.test', '#top']) ok(safeHref(h) === h, `keeps ${JSON.stringify(h)}`)
for (const h of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:x', 'data:,x', 'vbscript:x']) ok(safeHref(h) === undefined, `refuses ${JSON.stringify(h)}`)

console.log(`\n@jkos/widgets: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

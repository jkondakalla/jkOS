// manifest.js — THE widget vocabulary, as data.
//
// Every kind of node an ORDECK widget can be built from, declared once: its props and
// their types, where it may sit, what it reads, how the Workshop names it, and a
// working example. Everything else is DERIVED from this file:
//
//   • the TypeScript `WidgetNode` union ORDECK renders against (gen → nodes.gen.ts), so
//     tsc refuses a renderer map that misses a kind or keeps a dead one;
//   • the validator (validate.js) — jkAuth refuses a publish that breaks it, and the
//     gate refuses a committed widget file that does;
//   • the Workshop's catalog, defaults and placement rules;
//   • the one tree walker (walk.js), which knows where children live because this
//     file says so.
//
// Before this file, adding a primitive was six hand edits (the TS union, the renderer
// map, the Workshop catalog, its defaults, its placement rule, the Inspector) with
// nothing holding them together, and an agent writing a spec had a 24-variant union
// and a throwaway script to check it against.
//
// Pure data, no imports, ESM — the same shape as @jkos/weave/src/shared/binding.js, so
// Vite bundles it for the browser and the no-bundler Node backends (jkAuth) require()
// it through Node's require(ESM) interop (node >= 20.19).

/* ── Prop types ──────────────────────────────────────────────────────────────
 *   binding   a literal (string/number/boolean) or a Binding ({lit} | {src,path?,fallback?})
 *   tone      a Tone, or a Binding that resolves to one
 *   number · boolean · string
 *   enum      one of `values`
 *   field     a form field name (the key a control writes into $form)
 *   cmd       a CommandRef {app, capability, body?: Record<string, Binding>}
 *   pairs     a list of { label: Binding, value: Binding, tone?: tone } (a facts grid)
 *   node      one child node (a slot)
 *   nodes     an ordered list of child nodes
 */

/** The status palette a tone names. Semantic constants, never accent-derived (DESIGN §2). */
export const TONES = ['ok', 'warn', 'danger', 'muted', 'accent']

/** The curated line-icon set. An unknown name renders the `dot` fallback. */
export const ICON_NAMES = [
  'sun', 'moon', 'cloud', 'rain', 'snow', 'bolt', 'check', 'book', 'clock',
  'calendar', 'activity', 'star', 'alert', 'dot',
]

/** The escape hatch a def used to take instead of a spec — `component: '<name>'`, a
 *  bespoke React card nothing could edit, validate or express as a file. Retired: each
 *  is a manifest molecule now (focus → { t: 'focus' }, bb-week → { t: 'week' }), and
 *  a stored def naming one is repaired on load (ORDECK hud/state.ts). */
export const RETIRED_COMPONENTS = { focus: 'focus', 'bb-week': 'week' }

/** Grid columns per viewport tier — the width ceiling a footprint is held to. */
export const TIER_COLS = { desktop: 12, tablet: 6, mobile: 2 }

/** Limits a def is held to. WIDGET_DEF_MAX is also baked into jkAuth's
 *  widget_registry trigger (migration 023). */
export const LIMITS = {
  WIDGET_DEF_MAX: 20000,   // serialized characters
  MAX_DEPTH: 24,           // node nesting
  MAX_NODES: 400,          // nodes in one body
  MAX_ROWS: 40,            // a footprint's height, in grid rows
  ID_PATTERN: '^[a-z0-9][a-z0-9_-]{0,63}$',
}

/* What a command answered, drawn under it. An async command (its capability declares
   `resolves`) is FOLLOWED through its app's common-shape jobs dataset until it ends, so
   the slot shows the answer itself, not a job id. */
const RESULT_DOC = 'drawn once the command has answered: $result is what it produced (an async command is followed until it ends), $job is { phase: pending|done|failed|lost, status, error }'

const JUSTIFY = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end']
const ALIGN = ['flex-start', 'flex-end', 'center', 'baseline', 'stretch', 'start', 'end']

/**
 * Every node kind, in the Workshop's catalog order.
 *
 *   kind       atom | layout | logic | molecule | control | pattern   (what sort of part it
 *              is). A PATTERN is a whole, finished layout for one common kind of card —
 *              the polish comes from it, not from the author.
 *   label/hint the Workshop's name for it, and one line on what it is for
 *   props      name → { type, required?, values?, doc?, row?, result? } — `row`: a binding
 *              into `$`, each row of the node's `from`; `result`: into `$result`/`$job`
 *   placement  { form: 'inside' | 'outside' } — a control only inside a form, a form
 *              never inside one; { root: true } — only directly on the card's root
 *   reads      the HUD slice(s) a molecule reads straight from scope (no binding says so)
 *   example    a working node, and the default the Workshop drops in
 */
export const NODES = {
  metric: {
    kind: 'atom', label: 'Metric', hint: 'big number + unit',
    props: {
      value: { type: 'binding', required: true },
      unit: { type: 'binding' },
      sub: { type: 'binding', doc: 'caption pinned to the right' },
      size: { type: 'number', min: 12, max: 72, default: 30, doc: "the number's font-size in px — small inline stats vs hero" },
    },
    example: { t: 'metric', value: { src: 'systems', path: 'up' }, unit: '' },
  },
  gauge: {
    kind: 'atom', label: 'Gauge', hint: 'circular % ring',
    props: {
      value: { type: 'binding', required: true },
      max: { type: 'binding' },
      label: { type: 'binding' },
      size: { type: 'number', min: 40, max: 160, default: 76, doc: "the ring's outer diameter in px" },
    },
    example: { t: 'gauge', value: { src: 'systems', path: 'up' }, max: { src: 'systems', path: 'total' } },
  },
  bar: {
    kind: 'atom', label: 'Progress bar', hint: 'value vs max',
    props: {
      value: { type: 'binding', required: true },
      max: { type: 'binding' },
    },
    example: { t: 'bar', value: { src: 'systems', path: 'up' }, max: { src: 'systems', path: 'total' } },
  },
  sparkline: {
    kind: 'atom', label: 'Sparkline', hint: 'tiny trend line over an array',
    props: {
      from: { type: 'binding', required: true, doc: 'the array to plot' },
      path: { type: 'string', doc: 'plucks a number from each element (e.g. weather.slots → temp)' },
      height: { type: 'number', min: 12, max: 80, default: 28 },
      tone: { type: 'tone' },
    },
    example: { t: 'sparkline', from: { src: 'weather', path: 'slots' }, path: 'temp' },
  },
  keyval: {
    kind: 'atom', label: 'Key / value', hint: 'name left, value right',
    props: {
      label: { type: 'binding', required: true },
      value: { type: 'binding', required: true },
      tone: { type: 'tone' },
    },
    example: { t: 'keyval', label: 'Name', value: 'Value', tone: 'muted' },
  },
  list: {
    kind: 'layout', label: 'List', hint: 'repeat a template over an array',
    props: {
      from: { type: 'binding', required: true, doc: 'the array; each element is `$` inside `item`' },
      item: { type: 'node', required: true },
      empty: { type: 'binding', doc: 'shown when the array is empty' },
      dir: { type: 'enum', values: ['col', 'row'] },
      cols: { type: 'number', min: 1, max: 4, default: 1, doc: 'wraps a column list into an N-column grid (dense fact lists)' },
    },
    example: {
      t: 'list', from: { src: 'systems', path: 'rows' }, empty: 'NOTHING',
      item: { t: 'keyval', label: { src: '$', path: 'name' }, value: { src: '$', path: 'detail' } },
    },
  },
  pill: {
    kind: 'atom', label: 'Status pill', hint: 'small coloured badge',
    props: { text: { type: 'binding', required: true }, tone: { type: 'tone' } },
    example: { t: 'pill', text: 'OK', tone: 'ok' },
  },
  dot: {
    kind: 'atom', label: 'Status dot', hint: 'coloured indicator',
    props: { tone: { type: 'tone' }, pulse: { type: 'boolean' } },
    example: { t: 'dot', tone: 'ok' },
  },
  text: {
    kind: 'atom', label: 'Text', hint: 'heading or body line',
    props: {
      text: { type: 'binding', required: true },
      variant: { type: 'enum', values: ['title', 'body', 'sub', 'mono', 'note'], doc: "note: the suite's set, italic off-state voice (a signed-out or empty line)" },
      grow: { type: 'boolean', doc: 'take the remaining width and ellipsize' },
    },
    example: { t: 'text', text: 'Heading', variant: 'title' },
  },
  label: {
    kind: 'atom', label: 'Eyebrow label', hint: 'small uppercase caption',
    props: { text: { type: 'binding', required: true }, size: { type: 'enum', values: ['md', 'sm', 'xs'] } },
    example: { t: 'label', text: 'LABEL', size: 'md' },
  },
  icon: {
    kind: 'atom', label: 'Icon', hint: 'a line glyph (sun, check, book…)',
    props: {
      name: { type: 'binding', required: true, values: ICON_NAMES, doc: 'one of ICON_NAMES' },
      tone: { type: 'tone' },
      size: { type: 'number', min: 12, max: 64, default: 24 },
    },
    example: { t: 'icon', name: 'sun', tone: 'accent' },
  },
  divider: {
    kind: 'atom', label: 'Divider', hint: 'rule, optional caption',
    props: { label: { type: 'binding' } },
    example: { t: 'divider' },
  },
  link: {
    kind: 'atom', label: 'Link button', hint: 'opens a URL',
    props: {
      text: { type: 'binding', required: true },
      href: { type: 'binding', required: true, href: true, doc: 'http(s), mailto or relative — any other scheme renders no link' },
    },
    example: { t: 'link', text: 'Open', href: 'https://jkos.net' },
  },
  time: {
    kind: 'atom', label: 'Big clock', hint: 'large time + meta lines',
    props: {
      value: { type: 'binding', required: true },
      seconds: { type: 'binding' },
      sub: { type: 'binding' },
      sub2: { type: 'binding' },
    },
    example: {
      t: 'time', value: { src: 'clock', path: 'hm' }, seconds: { src: 'clock', path: 'ss' },
      sub: { src: 'clock', path: 'dateLine' }, sub2: { src: 'clock', path: 'utcLine' },
    },
  },
  row: {
    kind: 'layout', label: 'Row', hint: 'lay children side by side',
    props: {
      gap: { type: 'number', min: 0, max: 40, default: 8 },
      justify: { type: 'enum', values: JUSTIFY },
      align: { type: 'enum', values: ALIGN },
      grow: { type: 'boolean' },
      children: { type: 'nodes', required: true },
    },
    example: { t: 'row', gap: 8, children: [] },
  },
  stack: {
    kind: 'layout', label: 'Stack', hint: 'group children vertically',
    props: {
      gap: { type: 'number', min: 0, max: 40, default: 8 },
      grow: { type: 'boolean' },
      justify: { type: 'enum', values: JUSTIFY, doc: 'distributes children along the column (space-between pins the last to the bottom edge)' },
      children: { type: 'nodes', required: true },
    },
    example: { t: 'stack', gap: 8, children: [] },
  },
  when: {
    kind: 'logic', label: 'Condition', hint: 'show a branch only when true',
    props: {
      cond: { type: 'binding', required: true, doc: 'truthy → then; [] "" 0 "false" "0" are falsy' },
      then: { type: 'node', required: true },
      else: { type: 'node' },
    },
    example: { t: 'when', cond: { src: 'today', path: 'showTasks' }, then: { t: 'stack', gap: 8, children: [] } },
  },
  calendar: {
    kind: 'molecule', label: 'Calendar', hint: 'month grid (cal slice)',
    props: {}, placement: { root: true }, reads: 'cal',
    example: { t: 'calendar' },
  },
  weather: {
    kind: 'molecule', label: 'Weather', hint: 'full weather card',
    props: {}, placement: { root: true }, reads: 'weather',
    example: { t: 'weather' },
  },
  focus: {
    kind: 'molecule', label: 'Focus', hint: 'the one item in focus, with END FOCUS (focus slice)',
    props: {}, placement: { root: true }, reads: 'focus',
    example: { t: 'focus' },
  },
  week: {
    kind: 'molecule', label: 'Week', hint: 'the seven-day time grid (@jkos/cards)',
    props: {}, placement: { root: true }, reads: ['items', 'todayIso'],
    example: { t: 'week' },
  },
  /* ── Patterns — one node, a finished card body ───────────────────────────
   * Each is the shape a common card already takes, drawn once, well: the type scale,
   * the spacing, the accent, and what happens when it is narrow (container queries in
   * widgets.css). A list pattern's per-row props are bindings into `$`, the row. */
  stat: {
    kind: 'pattern', label: 'Stat', hint: 'one headline number, with its context',
    props: {
      value: { type: 'binding', required: true },
      label: { type: 'binding', doc: 'what the number is, above it' },
      unit: { type: 'binding' },
      delta: { type: 'binding', doc: 'the change, beside it ("+3", "−12%")' },
      deltaTone: { type: 'tone' },
      sub: { type: 'binding', doc: 'one line of context under it' },
      trend: { type: 'binding', doc: 'an array to draw as a sparkline under it' },
      trendPath: { type: 'string', doc: 'plucks the number from each trend element' },
    },
    example: { t: 'stat', label: 'Systems up', value: { src: 'systems', path: 'up' }, unit: { src: 'systems', path: 'total', fmt: 'number' }, sub: { src: 'systems', path: 'summary' } },
  },
  meter: {
    kind: 'pattern', label: 'Meter', hint: 'a labelled bar: how far along',
    props: {
      value: { type: 'binding', required: true },
      max: { type: 'binding', doc: 'default 1 (value is a fraction)' },
      label: { type: 'binding' },
      detail: { type: 'binding', doc: 'right of the label ("3 / 5", "60%")' },
      tone: { type: 'tone', doc: 'the fill (default the accent)' },
    },
    example: { t: 'meter', label: 'Today', value: { src: 'today', path: 'progress' }, detail: { src: 'today', path: 'progressLabel' } },
  },
  rows: {
    kind: 'pattern', label: 'Rows', hint: 'a dense list: mark · lead · title · detail',
    props: {
      from: { type: 'binding', required: true, doc: 'the rows; every per-row prop below binds into `$`' },
      title: { type: 'binding', required: true, row: true },
      lead: { type: 'binding', row: true, doc: 'a short leading column (a time, a rank)' },
      mark: { type: 'tone', row: true, doc: "a status dot's tone" },
      icon: { type: 'binding', row: true, values: ICON_NAMES, doc: 'a leading glyph instead of the dot' },
      detail: { type: 'binding', row: true, doc: 'trailing, dim' },
      sub: { type: 'binding', row: true, doc: 'a second line under the title' },
      href: { type: 'binding', row: true, href: true, doc: 'the row links here' },
      progress: { type: 'binding', row: true, doc: 'a thin bar under the title: how far along — a fraction, or out of `total`' },
      total: { type: 'binding', row: true, doc: 'what `progress` is out of (default 1): a duration beside a position' },
      empty: { type: 'binding', doc: 'when there are no rows (the frame draws an empty SOURCE itself; a list inside one document needs this)' },
      max: { type: 'number', min: 1, max: 100, doc: 'rows shown; the rest become "+N more" (the list scrolls within its card)' },
    },
    example: {
      t: 'rows', from: { src: 'today', path: 'tasks' }, lead: { src: '$', path: 'timeLabel' },
      title: { src: '$', path: 'title' }, mark: { src: '$', path: 'tone' },
    },
  },
  feed: {
    kind: 'pattern', label: 'Feed', hint: 'what happened, newest first, with when',
    props: {
      from: { type: 'binding', required: true, doc: 'the events; every per-event prop binds into `$`' },
      text: { type: 'binding', required: true, row: true },
      at: { type: 'binding', row: true, doc: "when — an instant, drawn as 'ago' unless the binding formats it" },
      icon: { type: 'binding', row: true, values: ICON_NAMES },
      tone: { type: 'tone', row: true },
      detail: { type: 'binding', row: true, doc: 'a second, dim line' },
      empty: { type: 'binding' },
      max: { type: 'number', min: 1, max: 100 },
    },
    example: { t: 'feed', from: { src: 'notifications', path: 'items' }, text: { src: '$', path: 'text' }, icon: { src: '$', path: 'icon' }, tone: { src: '$', path: 'tone' }, detail: { src: '$', path: 'detail' } },
  },
  facts: {
    kind: 'pattern', label: 'Facts', hint: 'a grid of named values',
    props: {
      items: { type: 'pairs', required: true, doc: '[{ label, value, tone? }] — each a literal or a binding' },
      cols: { type: 'number', min: 1, max: 4, default: 2, doc: 'columns (one when narrow)' },
    },
    example: { t: 'facts', items: [{ label: 'High', value: { src: 'weather', path: 'hiLabel' } }, { label: 'Low', value: { src: 'weather', path: 'loLabel' } }] },
  },
  media: {
    kind: 'pattern', label: 'Media', hint: 'art, a title, and where it is',
    props: {
      image: { type: 'binding', href: true, doc: 'the art (an http(s) or relative URL)' },
      title: { type: 'binding', required: true },
      subtitle: { type: 'binding' },
      meta: { type: 'binding', doc: 'a small line under them (a time, a count)' },
      progress: { type: 'binding' },
      max: { type: 'binding', doc: 'default 1' },
      href: { type: 'binding', href: true },
    },
    example: { t: 'media', title: { src: 'focus', path: 'title' }, subtitle: { src: 'focus', path: 'timeLabel' } },
  },
  ask: {
    kind: 'pattern', label: 'Ask', hint: 'one question, its answer drawn under it',
    props: {
      cmd: { type: 'cmd', required: true, doc: 'the question is sent as `field` in its body' },
      field: { type: 'field', doc: 'default "text"' },
      placeholder: { type: 'binding' },
      submit: { type: 'binding', doc: 'default "ASK"' },
      answer: { type: 'binding', result: true, doc: 'what to show from $result when it is done (default $result.response)' },
    },
    placement: { form: 'outside' },
    example: { t: 'ask', cmd: { app: 'lazuros', capability: 'query' }, placeholder: 'Ask…' },
  },

  form: {
    kind: 'control', label: 'Action form', hint: 'inputs that submit a command',
    props: {
      cmd: { type: 'cmd', required: true },
      submit: { type: 'binding', required: true, doc: "the submit button's label" },
      children: { type: 'nodes', required: true },
      result: { type: 'node', doc: RESULT_DOC },
    },
    placement: { form: 'outside' },
    example: { t: 'form', cmd: { app: '', capability: '' }, submit: 'SUBMIT', children: [] },
  },
  button: {
    kind: 'control', label: 'Action button', hint: 'one tap runs a command',
    props: {
      text: { type: 'binding', required: true }, cmd: { type: 'cmd', required: true }, tone: { type: 'tone' },
      result: { type: 'node', doc: RESULT_DOC },
    },
    example: { t: 'button', text: 'GO', cmd: { app: '', capability: '' } },
  },
  input: {
    kind: 'control', label: 'Form input', hint: 'text/number/date field',
    props: {
      field: { type: 'field', required: true },
      placeholder: { type: 'binding' },
      itype: { type: 'enum', values: ['text', 'number', 'date', 'time'] },
    },
    placement: { form: 'inside' },
    example: { t: 'input', field: 'value', placeholder: 'Value…' },
  },
  select: {
    kind: 'control', label: 'Form select', hint: 'pick from options',
    props: {
      field: { type: 'field', required: true },
      options: { type: 'binding', required: true, list: true, doc: 'an array of strings or {value, label}' },
      placeholder: { type: 'binding' },
    },
    placement: { form: 'inside' },
    example: { t: 'select', field: 'choice', options: { lit: ['A', 'B'] }, placeholder: 'Pick…' },
  },
  toggle: {
    kind: 'control', label: 'Form toggle', hint: 'on/off checkbox',
    props: { field: { type: 'field', required: true }, label: { type: 'binding' } },
    placement: { form: 'inside' },
    example: { t: 'toggle', field: 'flag', label: 'Flag' },
  },
}

/** Where a widget's named data comes from (spec.sources), by `kind`. The renderer reads
 *  each through @jkos/widget-render's sources.ts; the validator holds a source to these
 *  props, and the second tier holds a dataset source to what its app declares. */
export const SOURCES = {
  dataset: {
    label: 'Dataset', hint: 'a dataset its app declares (its DatasetDoc) — how a widget reads suite data',
    props: {
      app: { type: 'string', required: true, doc: 'the app, by id ("kouros")' },
      dataset: { type: 'string', required: true, doc: 'the dataset it declares ("discoverHome")' },
      params: { type: 'params', doc: "fills the path's :params and the declared filters — each a literal or a binding" },
      poll: { type: 'number', min: 1, max: 86400, doc: 'seconds: re-read on a timer, for changes no capability announces' },
      debounce: { type: 'number', min: 50, max: 5000, doc: 'ms: when a bound param changes, wait this long for it to settle before re-reading (a search box)' },
    },
  },
  fetch: {
    label: 'External fetch', hint: 'an EXTERNAL public https endpoint — never a suite host',
    props: {
      url: { type: 'string', required: true, doc: 'absolute https; a relative URL or any suite host is refused' },
      poll: { type: 'number', min: 1, max: 86400, doc: 'seconds' },
    },
  },
}

/** Card chrome around a body. Captions are bindings so they can show live values. */
export const FRAME = {
  eyebrow: { type: 'binding' },
  source: { type: 'binding' },
  href: { type: 'binding', href: true },
  chrome: { type: 'boolean', doc: 'bordered card surface (default true); false for raw-on-background' },
  empty: { type: 'binding', doc: "what the card says when every source answered nothing (default 'Nothing here yet.') — the frame draws loading, offline and signed-out itself" },
}

/** The node kinds, in catalog order. */
export const KINDS = Object.keys(NODES)

/** The prop names of `t` that hold child nodes, and whether each holds one or many. */
export function childProps(t) {
  const spec = NODES[t]
  if (!spec) return []
  return Object.entries(spec.props)
    .filter(([, p]) => p.type === 'node' || p.type === 'nodes')
    .map(([name, p]) => ({ name, many: p.type === 'nodes', required: !!p.required }))
}

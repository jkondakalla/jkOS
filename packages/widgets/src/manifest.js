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

/** Bespoke React components a def may name instead of a spec. The escape hatch. */
export const COMPONENTS = ['focus', 'bb-week']

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
 *   kind       atom | layout | logic | molecule | control   (what sort of part it is)
 *   label/hint the Workshop's name for it, and one line on what it is for
 *   props      name → { type, required?, values?, doc? }
 *   placement  { form: 'inside' | 'outside' } — a control only inside a form, a form
 *              never inside one; { root: true } — only directly on the card's root
 *   reads      the HUD slice a molecule reads straight from scope (no binding says so)
 *   example    a working node, and the default the Workshop drops in
 */
export const NODES = {
  metric: {
    kind: 'atom', label: 'Metric', hint: 'big number + unit',
    props: {
      value: { type: 'binding', required: true },
      unit: { type: 'binding' },
      sub: { type: 'binding', doc: 'caption pinned to the right' },
      size: { type: 'number', doc: "the number's font-size in px (default 30) — small inline stats vs hero" },
    },
    example: { t: 'metric', value: { src: 'systems', path: 'up' }, unit: '' },
  },
  gauge: {
    kind: 'atom', label: 'Gauge', hint: 'circular % ring',
    props: {
      value: { type: 'binding', required: true },
      max: { type: 'binding' },
      label: { type: 'binding' },
      size: { type: 'number', doc: "the ring's outer diameter in px (default 76)" },
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
      height: { type: 'number' },
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
      cols: { type: 'number', doc: 'wraps a column list into an N-column grid (dense fact lists)' },
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
      variant: { type: 'enum', values: ['title', 'body', 'sub', 'mono'] },
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
      size: { type: 'number' },
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
      gap: { type: 'number' },
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
      gap: { type: 'number' },
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
      options: { type: 'binding', required: true, doc: 'an array of strings or {value, label}' },
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

/** Card chrome around a body. Captions are bindings so they can show live values. */
export const FRAME = {
  eyebrow: { type: 'binding' },
  source: { type: 'binding' },
  href: { type: 'binding', href: true },
  chrome: { type: 'boolean', doc: 'bordered card surface (default true); false for raw-on-background' },
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

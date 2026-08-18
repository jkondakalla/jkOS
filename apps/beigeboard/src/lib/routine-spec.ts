/**
 * routine-spec.ts — the routine document, on the client.
 *
 * THE MIRROR. The authoritative implementation is the backend's
 * `backend/src/routine-spec.js`; read it first, because every design decision and
 * every "why" is written down there and deliberately not repeated here. This file
 * is a faithful port of the two halves the browser needs:
 *
 *     NORMALISE — fill defaults, resolve library refs, clamp
 *     RENDER    — a spec + a cycle index → the concrete session
 *
 * VALIDATION IS NOT MIRRORED, on purpose. Errors and lint are the server's answer
 * and come back on the write; a second opinion computed here could disagree with
 * the one that actually decides, which is worse than having none.
 *
 * WHY A MIRROR AT ALL, given the suite's one-source rule. The occurrence carries
 * its prescription already rendered, so the daily surfaces need none of this. The
 * FORGE does: it previews a spec the user is editing and has not saved, so there is
 * nothing on the server to ask about yet — and a round trip per keystroke is not a
 * design, it is a delay. The duplication is therefore real and is paid for by
 * `pnpm check:routine` (test/routine-spec.mjs), which drives THIS file and the
 * backend's through the same matrix of specs × cycles and fails the build on the
 * first disagreement. A mirror with a conformance test is the pattern this pair
 * already uses (backend/src/routines.js ↔ lib/routines.ts).
 *
 * Kept free of React and of the DOM so the gate can transpile and call it directly.
 */

export const SPEC_VERSION = 1

/* ── The closed vocabularies (see the backend file for what each one is for) ── */

export const UNITS = ['reps', 'sec', 'min', 'm', 'km', 'mi', 'pages', 'count', 'kcal', 'g', 'ml']
export const LOAD_UNITS = ['lb', 'kg', 'bw', 'band', 'level', 'plate', '%']
export const PROGRESSIONS = ['fixed', 'linear', 'double', 'ladder', 'percent', 'autoregulated']
export const DRIVES = ['load', 'target', 'sets', 'variant']
export const ADVANCE_ON = ['completion', 'calendar']
export const PHASE_REPEAT = ['loop', 'hold']
export const BLOCKS = ['warmup', 'main', 'accessory', 'cooldown']
export const COLLECTIONS = ['exercise', 'recipe', 'practice', 'study', 'chore', 'custom']
export const CADENCES = ['weekly', 'every_n_days', 'monthly', 'rolling', 'rrule']
export const MEASURES = ['sessions', 'volume', 'target', 'load']
export const WINDOWS = ['week', 'month', 'year', 'all']
export const MAX_RULES = 6

export const LIMITS = {
  steps: 40, phases: 12, variants: 12, ladder: 52, vars: 24, tags: 12,
  spec: 20000, prescription: 20000, performed: 20000,
  sets: 40, title: 200, notes: 2000, key: 60,
}

/** One-line human labels for the cadence modes — the forge's picker. */
export const CADENCE_LABEL: Record<string, string> = {
  weekly: 'on chosen weekdays',
  every_n_days: 'every N days',
  monthly: 'a day of the month',
  rolling: 'N times per rolling 7 days',
  rrule: 'an RFC 5545 rule (advanced)',
}

/** What a routine can contribute to its goal. */
export const MEASURE_LABEL: Record<string, string> = {
  sessions: 'sessions kept',
  volume: 'sets × target',
  target: 'the target, summed',
  load: 'tonnage (load × sets × target)',
}

/** One-line human labels for the progression types — the editor's dropdown, and
 *  the only place the vocabulary is described in prose on this side. */
export const PROGRESSION_LABEL: Record<string, string> = {
  fixed: 'never changes',
  linear: 'add a fixed amount each time',
  double: 'climb the rep range, then add load',
  ladder: 'follow a written table',
  percent: 'a creeping % of a stored max',
  autoregulated: 'advance only when you earn it',
}

/* ── Small pure helpers (ports) ───────────────────────────────────────────── */

const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function num(v: any, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : fallback
}
function int(v: any, fallback: number | null = null, lo = -1e9, hi = 1e9): number | null {
  const n = num(v, null)
  if (n === null) return fallback
  return clamp(Math.trunc(n), lo, hi)
}
function str(v: any, cap = LIMITS.title, fallback: string | null = null): string | null {
  if (v === null || v === undefined) return fallback
  const s = String(v).trim().slice(0, cap)
  return s === '' ? fallback : s
}
function pick(v: any, list: string[], fallback: any) {
  const s = v === null || v === undefined ? '' : String(v).trim().toLowerCase()
  return list.includes(s) ? s : fallback
}

export function slugify(v: any, fallback = 'step'): string {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.key)
  return s || fallback
}

export function humanize(slug: any): string {
  return String(slug || '')
    .split(/[-_\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Step'
}

function roundTo(n: number, to: number): number {
  if (!to || to <= 0) return n
  return Math.round(Math.round(n / to) * to * 1000) / 1000
}

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface Progression {
  type: string
  drives?: string
  increment?: number
  every?: number
  cap?: number | null
  floor?: number | null
  range?: [number, number]
  values?: number[]
  repeat?: string
  of?: string
  start?: number
}
export interface Contributes {
  measure: string; step: string | null; target: number; window: string; label: string | null
}
export interface Metric {
  measure: string; step: string | null; unit: string; label: string | null
  target: number; value: number; pct: number; window: string; from: string
}
export interface Cadence {
  type: string
  n?: number; day?: number | string
  rrule?: string; freq?: string; interval?: number
  byday?: number[]; bymonthday?: number[]; count?: number | null; until?: string | null
  rrule_error?: string
}
export interface SeriesPoint {
  cycle: number; date: string | null; completed: boolean; deload: boolean
  prescribed: number | null; performed: number | null; met: boolean | null
}
export interface Step {
  key: string
  ref: string | null
  collection: string | null
  title: string
  block: string
  group: string | null
  unit: string
  sets: number
  target: number | null
  load: number | null
  load_unit: string | null
  rest: number | null
  variants: string[]
  variant_index: number
  variant_every: number
  promote_on_cap: boolean
  progression: Progression[]
  notes: string | null
}
export interface Phase {
  name: string; cycles: number; intensity: number; sets_delta: number; notes: string | null
}
export interface Spec {
  v: number
  intent: string | null
  advance_on: string
  deload_every: number
  deload_factor: number
  round_load: number
  vars: Record<string, number>
  phases: Phase[]
  phase_repeat: string
  contributes: Contributes | null
  steps: Step[]
}
export interface RenderedStep {
  key: string; title: string; base_title: string; block: string; group: string | null
  variant: string | null; variant_index: number | null
  sets: number | null; target: number | null; unit: string
  load: number | null; load_unit: string | null; rest: number | null
  notes: string | null; line: string
}
export interface Prescription {
  v: number; cycle: number; phase: string | null; phase_cycle: number
  deload: boolean; deload_forced: boolean; sv: number | null
  steps: RenderedStep[]; line: string
}
export type Resolve = (slug: string, collection: string | null) => any

/* ── Normalisation ────────────────────────────────────────────────────────── */

export function emptySpec(): Spec {
  return {
    v: SPEC_VERSION, intent: null, advance_on: 'completion',
    deload_every: 0, deload_factor: 0.6, round_load: 5,
    vars: {}, phases: [], phase_repeat: 'loop', contributes: null, steps: [],
  }
}

/** A step's rules, always an ARRAY (see the backend's normalizeProgressions for
 *  why). `fixed` IS the empty array — nothing downstream branches on "one or many". */
function normalizeProgressions(raw: any, step: any): Progression[] {
  const list = Array.isArray(raw) ? raw : (raw === null || raw === undefined ? [] : [raw])
  const out: Progression[] = []
  for (const entry of list.slice(0, MAX_RULES)) {
    const rule = normalizeProgression(entry, step)
    if (rule.type !== 'fixed') out.push(rule)
  }
  return out
}

function normalizeProgression(raw: any, step: any): Progression {
  if (raw === null || raw === undefined) return { type: 'fixed' }
  const src = isObj(raw) ? raw : { type: raw }
  const type = pick(str(src.type, 40), PROGRESSIONS, 'fixed')
  if (type === 'fixed') return { type: 'fixed' }

  const inferredDrives = num(step?.load, null) !== null ? 'load' : 'target'
  const drives = pick(src.drives ?? src.field, DRIVES, inferredDrives)

  const range = Array.isArray(src.range) ? src.range : null
  const lo = int(range?.[0] ?? src.min ?? src.from, null)
  const hi = int(range?.[1] ?? src.max ?? src.to, null)

  const defaultIncrement = type === 'percent' ? 0.025
    : (drives === 'variant' || drives === 'sets') ? 1
    : 5

  const out: Progression = {
    type,
    drives,
    increment: num(src.increment ?? src.step ?? src.by, defaultIncrement)!,
    every: int(src.every ?? src.per, 1, 1, 365)!,
    cap: num(src.cap ?? src.ceiling ?? src.limit, null),
    floor: num(src.floor ?? src.least, null),
  }

  if (type === 'double' || type === 'autoregulated') {
    if (lo === null || hi === null || hi <= lo) out.range = [5, 8]
    else out.range = [lo, clamp(hi, lo + 1, lo + 200)]
    out.drives = 'target'
  }

  if (type === 'ladder') {
    const values = (Array.isArray(src.values) ? src.values : [])
      .map((v: any) => num(v, null)).filter((v: any) => v !== null).slice(0, LIMITS.ladder)
    out.values = values as number[]
    out.repeat = pick(src.repeat, PHASE_REPEAT, 'hold')
    if (!values.length) return { type: 'fixed' }
  }

  if (type === 'percent') {
    out.of = slugify(src.of ?? src.var ?? src.max ?? '', '')
    out.start = num(src.start ?? src.from, 0.6)!
    if (out.cap === null) out.cap = 0.95
    if (!out.of) return { type: 'fixed' }
  }

  return out
}

function normalizeStep(raw: any, index: number, resolve?: Resolve): Step {
  const src = isObj(raw) ? raw : { title: String(raw ?? '') }

  const ref = str(src.ref ?? src.library ?? src.from, LIMITS.key)
  const collection = pick(src.collection, COLLECTIONS, null)
  const entry = ref && typeof resolve === 'function' ? (resolve(slugify(ref), collection) || null) : null
  const d = isObj(entry?.defaults) ? entry.defaults : {}

  const title = str(src.title ?? src.name ?? entry?.title, LIMITS.title)
    || (ref ? humanize(ref) : `Step ${index + 1}`)
  const key = slugify(src.key ?? src.id ?? ref ?? title, `step-${index + 1}`)

  const rawVariants = Array.isArray(src.variants) ? src.variants
    : Array.isArray(entry?.variants) ? entry.variants : []
  const variants = rawVariants
    .map((v: any) => str(isObj(v) ? v.title ?? v.name : v, LIMITS.title))
    .filter(Boolean).slice(0, LIMITS.variants) as string[]

  const unit = pick(src.unit ?? entry?.unit ?? d.unit, UNITS, 'reps')
  const loadRaw = num(src.load ?? d.load, null)
  const loadUnit = pick(src.load_unit ?? entry?.load_unit ?? d.load_unit, LOAD_UNITS,
    loadRaw !== null ? 'lb' : null)

  return {
    key,
    ref: ref ? slugify(ref) : null,
    collection: collection || pick(entry?.collection, COLLECTIONS, null),
    title,
    block: pick(src.block, BLOCKS, 'main'),
    group: str(src.group, 8),
    unit,
    sets: int(src.sets ?? d.sets, 1, 1, LIMITS.sets)!,
    target: num(src.target ?? src.reps ?? src.value ?? d.target ?? d.reps, null),
    load: loadRaw,
    load_unit: loadUnit,
    rest: int(src.rest ?? d.rest, null, 0, 3600),
    variants,
    variant_index: variants.length
      ? clamp(int(src.variant_index ?? d.variant_index, 0, 0, variants.length - 1)!, 0, variants.length - 1)
      : 0,
    variant_every: int(src.variant_every ?? d.variant_every, 0, 0, 999)!,
    promote_on_cap: src.promote_on_cap === true || src.promote_on_cap === 1
      || d.promote_on_cap === true || d.promote_on_cap === 1,
    progression: normalizeProgressions(src.progression ?? src.progressions ?? d.progression, src),
    notes: str(src.notes ?? src.note ?? entry?.notes, LIMITS.notes),
  }
}

/** Never throws. Accepts an object, a JSON string, or nonsense. */
export function normalizeSpec(raw: any, opts: { resolve?: Resolve } = {}): Spec {
  let src = raw
  if (typeof src === 'string') { try { src = JSON.parse(src) } catch { src = null } }
  if (!isObj(src)) return emptySpec()

  const spec = emptySpec()
  spec.intent = str(src.intent ?? src.goal ?? src.purpose, LIMITS.notes)
  spec.advance_on = pick(src.advance_on ?? src.advance, ADVANCE_ON, 'completion')
  spec.deload_every = int(src.deload_every ?? src.deload, 0, 0, 52)!
  spec.deload_factor = clamp(num(src.deload_factor, 0.6) ?? 0.6, 0.1, 1)
  spec.round_load = clamp(num(src.round_load ?? src.rounding, 5) ?? 5, 0, 100)
  spec.phase_repeat = pick(src.phase_repeat, PHASE_REPEAT, 'loop')

  const vars = isObj(src.vars ?? src.variables) ? (src.vars ?? src.variables) : {}
  for (const [k, v] of Object.entries(vars).slice(0, LIMITS.vars)) {
    const n = num(v, null)
    if (n !== null) spec.vars[slugify(k, 'var')] = n
  }

  spec.contributes = normalizeContributes(src.contributes ?? src.metric)

  const phases = Array.isArray(src.phases) ? src.phases : []
  spec.phases = phases.slice(0, LIMITS.phases).map((p: any, i: number) => {
    const s = isObj(p) ? p : { name: String(p ?? '') }
    return {
      name: str(s.name ?? s.title, LIMITS.title) || `Phase ${i + 1}`,
      cycles: int(s.cycles ?? s.length ?? s.weeks, 4, 1, 520)!,
      intensity: clamp(num(s.intensity ?? s.factor, 1) ?? 1, 0.1, 3),
      sets_delta: int(s.sets_delta ?? s.sets_offset, 0, -20, 20)!,
      notes: str(s.notes, LIMITS.notes),
    }
  })

  const steps = Array.isArray(src.steps) ? src.steps
    : Array.isArray(src.exercises) ? src.exercises
    : Array.isArray(src.items) ? src.items : []
  const seen = new Set<string>()
  spec.steps = steps.slice(0, LIMITS.steps).map((s: any, i: number) => {
    const step = normalizeStep(s, i, opts.resolve)
    if (seen.has(step.key)) {
      let n = 2
      while (seen.has(`${step.key}-${n}`)) n++
      step.key = `${step.key}-${n}`
    }
    seen.add(step.key)
    return step
  })

  return spec
}

/** A routine's contribution to its goal — a MEASUREMENT, never percent-complete
 *  (a routine has no total). See the backend's normalizeContributes. */
function normalizeContributes(raw: any): Contributes | null {
  if (!isObj(raw)) return null
  const target = num(raw.target ?? raw.goal, null)
  if (target === null || target <= 0) return null
  return {
    measure: pick(raw.measure ?? raw.metric, MEASURES, 'sessions'),
    step: raw.step ? (slugify(raw.step, '') || null) : null,
    target,
    window: pick(raw.window ?? raw.per, WINDOWS, 'month'),
    label: str(raw.label, LIMITS.title),
  }
}

/* ── Render ───────────────────────────────────────────────────────────────── */

export function phaseAt(spec: Spec, cycle: number) {
  const phases = spec?.phases || []
  const c = Math.max(0, int(cycle, 0)!)
  if (!phases.length) return { name: null as string | null, index: 0, cycle: c, intensity: 1, sets_delta: 0 }

  const total = phases.reduce((n, p) => n + p.cycles, 0)
  let at = c
  if (at >= total) {
    if (spec.phase_repeat === 'hold') {
      const last = phases[phases.length - 1]
      return { name: last.name, index: phases.length - 1, cycle: at - (total - last.cycles), intensity: last.intensity, sets_delta: last.sets_delta }
    }
    at = at % total
  }
  let acc = 0
  for (let i = 0; i < phases.length; i++) {
    if (at < acc + phases[i].cycles) {
      return { name: phases[i].name, index: i, cycle: at - acc, intensity: phases[i].intensity, sets_delta: phases[i].sets_delta }
    }
    acc += phases[i].cycles
  }
  const last = phases[phases.length - 1]
  return { name: last.name, index: phases.length - 1, cycle: 0, intensity: last.intensity, sets_delta: last.sets_delta }
}

export function isDeload(spec: Spec, cycle: number): boolean {
  const n = spec?.deload_every || 0
  if (!n) return false
  return (Math.max(0, int(cycle, 0)!) + 1) % n === 0
}

/** Fold every rule on a step. Last writer of a field wins; variant shifts ADD. */
function progressionAt(step: Step, cycle: number, earned?: number) {
  const rules = Array.isArray(step.progression) ? step.progression : []
  const out: any = { sets: null, target: null, load: null, variant_shift: 0 }
  for (const rule of rules) {
    const moved = ruleAt(step, rule, cycle, earned)
    if (moved.sets !== null) out.sets = moved.sets
    if (moved.target !== null) out.target = moved.target
    if (moved.load !== null) out.load = moved.load
    if (moved.__fraction) out.__fraction = true
    out.variant_shift += moved.variant_shift || 0
  }
  return out
}

/** How many ladder rungs a capped load rule has bought, and where the load sits
 *  inside the current rung. See the backend's promoteAtCap. */
export function promoteAtCap(base: number, inc: number, cap: number | null | undefined, tier: number) {
  if (cap === null || cap === undefined || !inc || inc <= 0) return { tier, shift: 0 }
  const perRung = Math.floor((cap - base) / inc) + 1
  if (perRung <= 0) return { tier, shift: 0 }
  return { tier: tier % perRung, shift: Math.floor(tier / perRung) }
}

function ruleAt(step: Step, rule: Progression, cycle: number, earned?: number) {
  const p = rule || { type: 'fixed' }
  const c = Math.max(0, int(cycle, 0)!)
  const none: any = { sets: null, target: null, load: null, variant_shift: 0 }
  if (p.type === 'fixed') return none

  const baseOf = (field?: string) => {
    if (field === 'load') return num(step.load, 0) ?? 0
    if (field === 'target') return num(step.target, 0) ?? 0
    if (field === 'sets') return num(step.sets, 1) ?? 1
    return 0
  }
  const bound = (v: number) => {
    let out = v
    if (p.floor !== null && p.floor !== undefined) out = Math.max(p.floor, out)
    if (p.cap !== null && p.cap !== undefined) out = Math.min(p.cap, out)
    return out
  }
  const emit = (field: string | undefined, value: number) => {
    if (field === 'variant') return { ...none, variant_shift: Math.trunc(value) }
    return { ...none, [field as string]: value }
  }

  if (p.type === 'linear') {
    let n = Math.floor(c / (p.every || 1))
    if (step.promote_on_cap && p.drives === 'load') {
      const base = baseOf('load')
      const { tier, shift } = promoteAtCap(base, p.increment || 0, p.cap, n)
      if (shift) return { ...none, load: base + (p.increment || 0) * tier, variant_shift: shift }
      n = tier
    }
    return emit(p.drives, bound(baseOf(p.drives) + (p.increment || 0) * n))
  }

  if (p.type === 'ladder') {
    const vals = p.values || []
    if (!vals.length) return none
    const i = p.repeat === 'loop' ? c % vals.length : Math.min(c, vals.length - 1)
    return emit(p.drives, bound(vals[i]))
  }

  if (p.type === 'percent') {
    const frac = Math.min(p.cap ?? 0.95, (p.start ?? 0.6) + (p.increment || 0) * Math.floor(c / (p.every || 1)))
    return { ...none, load: frac, __fraction: true }
  }

  if (p.type === 'double' || p.type === 'autoregulated') {
    const clock = p.type === 'autoregulated'
      ? Math.max(0, int(earned === null || earned === undefined ? c : earned, 0)!)
      : c
    const [lo, hi] = p.range || [5, 8]
    const span = Math.max(1, hi - lo + 1)
    const rung = clock % span
    let tier = Math.floor(clock / span)
    let shift = 0
    const base = num(step.load, null)
    if (step.promote_on_cap && base !== null) {
      const p2 = promoteAtCap(base, p.increment || 0, p.cap, tier)
      tier = p2.tier; shift = p2.shift
    }
    let load = base
    if (load !== null) {
      load = load + (p.increment || 0) * tier
      if (!shift && p.cap !== null && p.cap !== undefined) load = Math.min(p.cap, load)
      if (p.floor !== null && p.floor !== undefined) load = Math.max(p.floor, load)
    }
    return { sets: null, target: lo + rung, load, variant_shift: shift }
  }

  return none
}

export function renderStep(spec: Spec, step: Step, cycle: number, ctx: any = {}): RenderedStep {
  const ph = ctx.phase || phaseAt(spec, cycle)
  const deload = ctx.deload === undefined ? isDeload(spec, cycle) : ctx.deload
  const moved = progressionAt(step, cycle, ctx.earned)

  let sets = moved.sets !== null ? moved.sets : step.sets
  let target = moved.target !== null ? moved.target : step.target
  let load = moved.load !== null ? moved.load : step.load

  if (moved.__fraction) {
    const pct = step.progression.find((p) => p.type === 'percent')
    const max = pct ? spec.vars?.[pct.of as string] : undefined
    load = max === undefined ? null : max * moved.load
  }

  const scale = (ph.intensity || 1) * (deload ? (spec.deload_factor ?? 0.6) : 1)
  if (load !== null && scale !== 1) load = load * scale
  if (sets !== null) sets = Math.max(1, Math.round(sets) + (ph.sets_delta || 0))
  if (deload && sets !== null) sets = Math.max(1, Math.round(sets * (spec.deload_factor ?? 0.6)))

  if (load !== null) load = Math.max(0, roundTo(load, spec.round_load ?? 5))
  if (target !== null) target = Math.max(0, Math.round(target * 100) / 100)

  const vi = step.variants.length
    ? clamp(
      step.variant_index
      + (step.variant_every > 0 ? Math.floor(cycle / step.variant_every) : 0)
      + (moved.variant_shift || 0),
      0, step.variants.length - 1,
    )
    : 0

  const out: RenderedStep = {
    key: step.key,
    title: step.variants.length ? step.variants[vi] : step.title,
    base_title: step.title,
    block: step.block,
    group: step.group,
    variant: step.variants.length ? step.variants[vi] : null,
    variant_index: step.variants.length ? vi : null,
    sets, target, unit: step.unit,
    load, load_unit: step.load_unit, rest: step.rest,
    notes: step.notes,
    line: '',
  }
  out.line = stepLine(out)
  return out
}

export function renderCycle(spec: Spec, cycle: number, ctx: any = {}): Prescription {
  const s = spec && Array.isArray(spec.steps) ? spec : emptySpec()
  const c = Math.max(0, int(cycle, 0)!)
  const ph = phaseAt(s, c)
  /* `ctx.deload` forces this one session light (or normal) regardless of the
     programme's own cadence — the per-occurrence `deload_override`. */
  const deload = ctx.deload === true ? true : (ctx.deload === false ? false : isDeload(s, c))
  const earned = isObj(ctx.earned) ? ctx.earned : {}

  const order = new Map(BLOCKS.map((b, i) => [b, i]))
  const steps = s.steps
    .map((step, i) => ({ step, i }))
    .sort((a, b) => (order.get(a.step.block) ?? 99) - (order.get(b.step.block) ?? 99) || a.i - b.i)
    .map(({ step }) => renderStep(s, step, c, { phase: ph, deload, earned: earned[step.key] }))

  const out: Prescription = {
    v: SPEC_VERSION,
    sv: int(ctx.spec_version, null, 0, 1e9),
    cycle: c, phase: ph.name, phase_cycle: ph.cycle,
    deload,
    deload_forced: ctx.deload === true && !isDeload(s, c),
    steps, line: '',
  }
  out.line = sessionLine(out)
  return out
}

/* ── Display strings (ports — see the backend note on why they live in one place) */

export function stepLine(r: Partial<RenderedStep>): string {
  const parts: string[] = []
  const count = r.target !== null && r.target !== undefined
  const showUnit = r.unit && r.unit !== 'reps' && r.unit !== 'count'

  if ((r.sets ?? 0) > 1 && count) parts.push(`${r.sets} × ${r.target}${showUnit ? ` ${r.unit}` : ''}`)
  else if (count) parts.push(`${r.target}${showUnit ? ` ${r.unit}` : ''}`)
  else if ((r.sets ?? 0) > 1) parts.push(`${r.sets} sets`)

  if (r.load !== null && r.load !== undefined && r.load_unit !== 'bw') {
    parts.push(`@ ${r.load}${r.load_unit ? ` ${r.load_unit}` : ''}`)
  } else if (r.load_unit === 'bw') {
    parts.push('@ bodyweight')
  }
  return parts.join(' ') || '—'
}

export function sessionLine(p: Pick<Prescription, 'phase' | 'cycle' | 'deload' | 'steps'>): string {
  const bits: string[] = []
  if (p.phase) bits.push(p.phase)
  bits.push(`session ${p.cycle + 1}`)
  if (p.deload) bits.push('deload')
  bits.push(`${p.steps.length} step${p.steps.length === 1 ? '' : 's'}`)
  return bits.join(' · ')
}

export function summarize(spec: Spec | null): string | null {
  if (!spec || !spec.steps?.length) return null
  const bits = [`${spec.steps.length} step${spec.steps.length === 1 ? '' : 's'}`]
  const kinds = [...new Set(spec.steps.flatMap((s) => s.progression.map((p) => p.type)))]
  if (kinds.length) bits.push(kinds.join('/'))
  if (spec.phases.length) bits.push(spec.phases.map((p) => p.name).join(' → '))
  if (spec.deload_every) bits.push(`deload every ${spec.deload_every}`)
  return bits.join(' · ')
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE CADENCE — ports of parseCadence / expandCadence / describeCadence.

   Mirrored because the forge previews an UNSAVED cadence: change "every 3 days" to
   "every 5" and the dates under it have to move before anything is written. The
   conformance gate drives both copies through the same windows.
   ══════════════════════════════════════════════════════════════════════════════ */

const isoOf = (d: Date) => d.toISOString().slice(0, 10)
const parseISO = (s: string) => new Date(`${s}T00:00:00Z`)
export const shiftDays = (s: string, n: number) => {
  const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return isoOf(d)
}
export function isoWeekStart(s: string) {
  const dow = parseISO(s).getUTCDay()
  return shiftDays(s, -(dow === 0 ? 6 : dow - 1))
}
export const daysBetween = (a: string, b: string) =>
  Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)

const RRULE_DAYS: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 }
const RRULE_UNSUPPORTED = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYMONTH', 'EXDATE', 'RDATE', 'WKST']

function parseRRule(text: string): Cadence {
  const src = String(text || '').replace(/^RRULE:/i, '').trim()
  const parts = new Map<string, string>()
  for (const chunk of src.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq < 0) continue
    parts.set(chunk.slice(0, eq).trim().toUpperCase(), chunk.slice(eq + 1).trim())
  }
  const unsupported = RRULE_UNSUPPORTED.filter((k) => parts.has(k))
  const freq = String(parts.get('FREQ') || '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq) || unsupported.length) {
    return { type: 'weekly', rrule_error: unsupported.length
      ? `unsupported: ${unsupported.join(', ')}`
      : `unsupported FREQ '${freq || '(none)'}'` }
  }
  const byday = String(parts.get('BYDAY') || '').split(',').map((d) => d.trim().toUpperCase()).filter(Boolean)
  if (byday.some((d) => !(d in RRULE_DAYS))) {
    return { type: 'weekly', rrule_error: 'ordinal BYDAY (e.g. 2MO) is not supported' }
  }
  const untilRaw = String(parts.get('UNTIL') || '').trim()
  const until = /^\d{8}/.test(untilRaw)
    ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`
    : (/^\d{4}-\d{2}-\d{2}$/.test(untilRaw) ? untilRaw : null)

  return {
    type: 'rrule', rrule: src, freq,
    interval: clamp(int(parts.get('INTERVAL'), 1, 1, 365)!, 1, 365),
    byday: byday.map((d) => RRULE_DAYS[d]),
    bymonthday: String(parts.get('BYMONTHDAY') || '').split(',')
      .map((v) => int(v, null, 1, 31)).filter((v) => v !== null) as number[],
    count: int(parts.get('COUNT'), null, 1, 1000),
    until,
  }
}

export function parseCadence(rule: any): Cadence {
  const raw = String(rule || '').trim()
  if (!raw) return { type: 'weekly' }
  const i = raw.indexOf(':')
  const type = pick(i < 0 ? raw : raw.slice(0, i), CADENCES, null)
  const arg = i < 0 ? '' : raw.slice(i + 1).trim()
  if (!type || type === 'weekly') return { type: 'weekly' }
  if (type === 'every_n_days') return { type, n: clamp(int(arg, 2, 1, 365)!, 1, 365) }
  if (type === 'rolling') return { type, n: clamp(int(arg, 1, 1, 21)!, 1, 21) }
  if (type === 'monthly') {
    if (arg.toLowerCase() === 'last') return { type, day: 'last' }
    return { type, day: clamp(int(arg, 1, 1, 31)!, 1, 31) }
  }
  if (type === 'rrule') return parseRRule(arg)
  return { type: 'weekly' }
}

export function formatCadence(c: Cadence | null): string {
  if (!c || !c.type || c.type === 'weekly') return ''
  if (c.type === 'every_n_days') return `every_n_days:${c.n}`
  if (c.type === 'rolling') return `rolling:${c.n}`
  if (c.type === 'monthly') return `monthly:${c.day}`
  if (c.type === 'rrule') return `rrule:${c.rrule}`
  return ''
}

export function expandCadence(
  cadence: Cadence | null,
  { from, to, anchor, days = [], floats = 0 }:
    { from: string; to: string; anchor?: string; days?: number[]; floats?: number },
): Array<{ date: string | null; week: string; float?: boolean; index?: number }> {
  const c = cadence || { type: 'weekly' }
  const out: Array<{ date: string | null; week: string; float?: boolean; index?: number }> = []
  const push = (date: string) => { if (date >= from && date <= to) out.push({ date, week: isoWeekStart(date) }) }
  const pushFloat = (week: string, index: number) => {
    if (shiftDays(week, 6) < from || week > to) return
    out.push({ date: null, week, float: true, index })
  }
  const start = anchor && anchor <= from ? anchor : from

  if (c.type === 'weekly') {
    for (let wk = isoWeekStart(from); wk <= to; wk = shiftDays(wk, 7)) {
      for (const off of days) push(shiftDays(wk, off))
      for (let i = 0; i < floats; i++) pushFloat(wk, i)
    }
    return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  }

  if (c.type === 'every_n_days') {
    const n = c.n!
    const gap = daysBetween(anchor || from, from)
    let cursor = shiftDays(anchor || from, Math.max(0, Math.ceil(gap / n)) * n)
    while (cursor <= to) { push(cursor); cursor = shiftDays(cursor, n) }
    return out
  }

  if (c.type === 'monthly') {
    const d0 = parseISO(from)
    for (let m = 0; m <= 14; m++) {
      const probe = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1))
      const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate()
      const day = c.day === 'last' ? lastDay : Math.min(c.day as number, lastDay)
      const date = isoOf(new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), day)))
      if (date > to) break
      push(date)
    }
    return out
  }

  if (c.type === 'rolling') {
    let cursor = anchor && anchor <= to ? anchor : start
    while (cursor <= to) {
      for (let i = 0; i < c.n!; i++) pushFloat(cursor, i)
      cursor = shiftDays(cursor, 7)
    }
    return out
  }

  if (c.type === 'rrule') {
    let emitted = 0
    const limit = c.until && c.until < to ? c.until : to
    if (c.freq === 'DAILY') {
      const gap = daysBetween(anchor || from, from)
      let cursor = shiftDays(anchor || from, Math.max(0, Math.ceil(gap / c.interval!)) * c.interval!)
      while (cursor <= limit && (c.count === null || emitted < c.count!)) {
        push(cursor); emitted++
        cursor = shiftDays(cursor, c.interval!)
      }
    } else if (c.freq === 'WEEKLY') {
      const offsets = c.byday!.length ? c.byday! : [((parseISO(anchor || from).getUTCDay() + 6) % 7)]
      const anchorWeek = isoWeekStart(anchor || from)
      for (let wk = isoWeekStart(from); wk <= limit; wk = shiftDays(wk, 7)) {
        if (Math.round(daysBetween(anchorWeek, wk) / 7) % c.interval! !== 0) continue
        for (const off of offsets) {
          if (c.count !== null && emitted >= c.count!) break
          const date = shiftDays(wk, off)
          if (date < from || date > limit) continue
          push(date); emitted++
        }
      }
    } else if (c.freq === 'MONTHLY') {
      const d0 = parseISO(from)
      const daysOfMonth = c.bymonthday!.length ? c.bymonthday! : [parseISO(anchor || from).getUTCDate()]
      for (let m = 0; m <= 14 && (c.count === null || emitted < c.count!); m++) {
        const probe = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1))
        if (m % c.interval! !== 0) continue
        const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate()
        for (const dd of daysOfMonth) {
          const date = isoOf(new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), Math.min(dd, lastDay))))
          if (date < from || date > limit) continue
          if (c.count !== null && emitted >= c.count!) break
          push(date); emitted++
        }
      }
    }
    return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  }

  return out
}

const ordinal = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th')

export function describeCadence(cadence: Cadence | null, days: number[] = []): string {
  const c = cadence || { type: 'weekly' }
  const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  if (c.type === 'weekly') return days.length ? days.map((d) => NAMES[d]).join(' · ') : 'any day'
  if (c.type === 'every_n_days') return c.n === 1 ? 'every day' : `every ${c.n} days`
  if (c.type === 'rolling') return `${c.n}× per rolling 7 days`
  if (c.type === 'monthly') return c.day === 'last' ? 'last day of the month' : `the ${c.day}${ordinal(c.day as number)} of the month`
  if (c.type === 'rrule') return `RRULE · ${c.rrule}`
  return 'any day'
}

/* ══════════════════════════════════════════════════════════════════════════════
   ANALYTICS — ports of metricOf / seriesFor
   ══════════════════════════════════════════════════════════════════════════════ */

export function amountOf(rendered: any, logged: any, measure: string): number {
  const sets = Array.isArray(logged?.sets) ? logged.sets.filter((s: any) => s.value !== null) : []
  if (measure === 'sessions') return 1
  if (sets.length) {
    if (measure === 'target') return sets.reduce((n: number, s: any) => n + (s.value || 0), 0)
    if (measure === 'volume') return sets.length * (sets.reduce((n: number, s: any) => n + (s.value || 0), 0) / sets.length || 0)
    if (measure === 'load') return sets.reduce((n: number, s: any) => n + (s.value || 0) * (s.load ?? rendered?.load ?? 0), 0)
  }
  const t = rendered?.target ?? 0
  const st = rendered?.sets ?? 1
  if (measure === 'target') return t * st
  if (measure === 'volume') return t * st
  if (measure === 'load') return t * st * (rendered?.load ?? 0)
  return 0
}

export function windowStart(windowName: string, date: string): string {
  if (windowName === 'all') return ''
  if (windowName === 'week') return isoWeekStart(date)
  if (windowName === 'year') return `${date.slice(0, 4)}-01-01`
  return `${date.slice(0, 7)}-01`
}

export function metricOf(spec: Spec, occurrences: any[], today: string): Metric | null {
  const c = spec?.contributes
  if (!c) return null
  const from = windowStart(c.window, today)
  const step = c.step ? spec.steps.find((s) => s.key === c.step) : null

  let value = 0
  for (const o of occurrences || []) {
    if (!o.completed) continue
    const when = o.due_date || o.week_start || ''
    if (when < from) continue
    if (c.measure === 'sessions') { value += 1; continue }
    const rx = prescriptionOf(o)
    const perf = performedOf(o)
    const rows = rx ? rx.steps.filter((s) => !c.step || s.key === c.step) : []
    for (const r of rows) value += amountOf(r, perf?.steps?.[r.key], c.measure)
  }
  value = Math.round(value * 100) / 100
  return {
    measure: c.measure,
    step: c.step,
    unit: c.measure === 'sessions' ? 'sessions'
      : c.measure === 'load' ? (step?.load_unit || 'load')
      : (step?.unit || 'reps'),
    label: c.label,
    target: c.target,
    value,
    pct: c.target > 0 ? Math.min(100, Math.round((value / c.target) * 100)) : 0,
    window: c.window,
    from,
  }
}

export function seriesFor(spec: Spec, occurrences: any[], stepKey: string, measure = 'load'): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (const o of occurrences || []) {
    const rx = prescriptionOf(o)
    if (!rx) continue
    const r = rx.steps.find((s) => s.key === stepKey)
    if (!r) continue
    const perf = performedOf(o)
    const logged = perf?.steps?.[stepKey]
    const sets = Array.isArray(logged?.sets) ? logged.sets.filter((s: any) => s.value !== null) : []

    const prescribed: any = measure === 'load' ? r.load
      : measure === 'target' ? r.target
      : measure === 'sets' ? r.sets
      : amountOf(r, null, measure)
    let performed: any = null
    if (o.completed) {
      if (sets.length) {
        performed = measure === 'load' ? (sets.reduce((n: number, s: any) => n + (s.load ?? r.load ?? 0), 0) / sets.length)
          : measure === 'target' ? (sets.reduce((n: number, s: any) => n + (s.value || 0), 0) / sets.length)
          : measure === 'sets' ? sets.length
          : amountOf(r, logged, measure)
      } else if (logged?.done !== false) {
        performed = prescribed
      }
    }
    out.push({
      cycle: rx.cycle,
      date: o.due_date || o.week_start || null,
      completed: !!o.completed,
      deload: !!rx.deload,
      prescribed: prescribed === null || prescribed === undefined ? null : Math.round(prescribed * 100) / 100,
      performed: performed === null || performed === undefined ? null : Math.round(performed * 100) / 100,
      met: logged ? stepWasMet(perf, stepKey) : null,
    })
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.cycle - b.cycle)
}

/** Did this occurrence earn `stepKey` an advance? (port — see the backend). */
export function stepWasMet(performed: any, stepKey: string): boolean {
  const e = performed?.steps?.[stepKey]
  if (!e) return true
  if (e.met !== null && e.met !== undefined) return !!e.met
  if (e.done === false) return false
  return true
}

/** PER-SET LOGGING. Derived rather than asked — a person who has just typed six
 *  real numbers should not then be asked a seventh question they have answered.
 *  Generous by design: every LOGGED set must reach the target, but an unlogged row
 *  is not held against you. `null` means "nothing to judge", which the caller must
 *  keep distinct from `false`. */
export function metFromSets(rendered: any, sets: any[]): boolean | null {
  const rows = (Array.isArray(sets) ? sets : []).filter((s) => s && s.value !== null && s.value !== undefined)
  if (!rows.length) return null
  const target = rendered?.target
  if (target === null || target === undefined) return true
  return rows.every((s) => Number(s.value) >= Number(target))
}

/** The blank set sheet the card draws, pre-filled with the prescription so logging
 *  "as prescribed" is a tap rather than transcription. */
export function blankSets(rendered: any) {
  const n = clamp(int(rendered?.sets, 1, 1, LIMITS.sets)!, 1, LIMITS.sets)
  return Array.from({ length: n }, () => ({
    value: rendered?.target ?? null,
    load: rendered?.load ?? null,
  }))
}

/* ── Reading what the engine already wrote ────────────────────────────────────
   The daily surfaces never render anything: an occurrence arrives with its
   prescription already computed, and these two just unwrap it safely. Tolerant of
   a malformed column for the same reason every other reader in this app is — this
   drives a render, and a parse error must show an absence, not a blank screen. */

export function prescriptionOf(occurrence: any): Prescription | null {
  const raw = occurrence?.prescription
  if (!raw) return null
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw
    return p && Array.isArray(p.steps) ? p : null
  } catch { return null }
}

export function performedOf(occurrence: any): any {
  const raw = occurrence?.performed
  if (!raw) return null
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw
    return isObj(p) ? p : null
  } catch { return null }
}

/** Did the user log this step as done? `undefined` means "not logged either way",
 *  which is a third state the UI has to draw — an unticked step in a session you
 *  haven't started is not the same as one you skipped. */
export function stepStatus(performed: any, key: string): { done?: boolean; met?: boolean; note?: string } {
  const e = performed?.steps?.[key]
  return isObj(e) ? e : {}
}

/** The patch that records one step, merged onto whatever is already logged.
 *  Returned rather than written so the caller owns the round trip — the same shape
 *  every other edit in this app takes.
 *
 *  IT ALSO STAMPS WHEN AND IN WHAT ORDER (migration 13). `performed.steps` is an
 *  object, so the order the steps were actually done in is not recoverable from it
 *  — and the order a session is performed in, versus the order it was prescribed
 *  in, is one of the few things a training log can say that the plan cannot. So the
 *  crossing itself is recorded here, at the only place that can see it: this
 *  function is handed the OLD entry and the new patch in the same breath.
 *
 *  ⚠️ ON THE EDGE, NOT ON EVERY PATCH. logStep is called for every edit to a step —
 *  ticking it, marking it short, typing a set, writing a note. Stamping `at`
 *  unconditionally would make it "when did you last touch this row", which is a
 *  different fact, is not the one anything wants, and would be indistinguishable
 *  from the real one after the fact. Guarded to the done false→true crossing, it
 *  means "when this got done" and nothing else.
 *
 *  And CLEARED on the way back down, for the same reason the completed_at trigger
 *  clears: un-ticking a step is the retraction of a completion, not a completion at
 *  a slightly different time, and a stamp left behind would date something that did
 *  not happen. */
export function logStep(
  performed: any,
  key: string,
  patch: { done?: boolean; met?: boolean; note?: string; sets?: any[] },
) {
  const base = isObj(performed) ? performed : { v: SPEC_VERSION, steps: {} }
  const steps = isObj(base.steps) ? base.steps : {}
  const prev = isObj(steps[key]) ? steps[key] : {}
  const next: any = { ...prev, ...patch }

  if (patch.done === true && prev.done !== true) {
    next.at = new Date().toISOString()
    /* One past the highest issued so far — a POSITION, not a count of steps, so it
       survives a step being logged, un-logged and logged again (which is a real
       thing people do mid-session, and which must not renumber the steps around
       it). The seeded 0 is what makes an empty log — and a log full of entries
       written before this field existed — start at 1 rather than at -Infinity. */
    next.seq = 1 + Math.max(0, ...Object.values(steps).map((e: any) => Number(e?.seq) || 0))
  } else if (patch.done === false && prev.done === true) {
    next.at = undefined
    next.seq = undefined
  }

  return {
    ...base,
    v: SPEC_VERSION,
    steps: { ...steps, [key]: next },
  }
}

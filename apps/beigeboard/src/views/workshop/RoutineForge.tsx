/**
 * RoutineForge — the whole of one standing order.
 *
 * The CADENCE BAND at the head answers "how often" (./cadence — the seven days
 * with their record/plan split, the weekly target, the streak, which goal it hangs
 * under). Everything below answers "what, and how does it get harder" — the half
 * that makes a routine a routine and not a repeating task.
 *
 * The two used to be two screens behind two badges. They are one routine, and the
 * band writes straight through onUpdateItem while the document below is Save-gated,
 * because a click on a weekday is a decision about the schedule and should never be
 * held hostage by an unsaved spec.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LAYOUT, AND WHY
 *
 * LEFT — the document you are authoring: the steps, then the programme (cadence,
 * phases, deload, the named numbers, what this feeds).
 *
 * RIGHT — a tabbed rail, and the tabs are three different questions about the
 * same rules:
 *
 *   LADDER    what the rules SAY WILL happen — the next N sessions, rendered live
 *             as numbers. This is the load-bearing one. A progression rule is a
 *             claim about the future that is very easy to get wrong in a way no
 *             validator can catch: "+10 lb a session" is legal, plausible, and has
 *             you squatting 400 lb by November. Nothing in a form of rules can show
 *             you that; eight rendered sessions can, at a glance. It is also the
 *             repair tool for an AI-written routine, which is the case this whole
 *             format is shaped around.
 *   HISTORY   what actually HAS happened — prescribed against performed, per step.
 *             The gap between those two lines opening is the most useful signal a
 *             training log carries and is invisible in either alone.
 *   REVISIONS which document each past session was following. A prescription is
 *             frozen on purpose, so March keeps saying 5 × 5; this is how March
 *             explains itself.
 *
 * The rail is TABBED rather than stacked because all three want the same column and
 * none of them is small. Stacking them put the thing you are checking below the
 * fold of the thing you are editing, which defeats the point of live rendering.
 *
 * IT RENDERS LOCALLY, NOT OVER THE WIRE. The ladder is computed by the spec mirror
 * (lib/routine-spec.ts) against the spec being edited — which has not been saved and
 * therefore does not exist on the server to ask about. That the mirror and the
 * engine agree is not assumed; it is enforced by `pnpm check:routine`, which drives
 * both through the same matrix. Read the mirror's header before touching either.
 *
 * IT IS THE FORGE PANE ITSELF. There is no board to go back to and no ← exit: the
 * rail is always beside it, and picking anything else on the rail is the way out.
 * The one thing that DOES float over it is the library shelf, and that is owned by
 * WorkshopView so this component never unmounts and an unsaved document survives
 * the trip.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { FONT_HEAD, isoDate } from '../../lib/theme'
import { Press, Bubble, Rule, TButton, Well, Chip, Bar, Check } from '@jkos/ui'
import { ProgressChart } from '../../components/ProgressChart'
/* The field chrome and the rule editor live in ./parts — the library browser and
   the paste pane are the same kind of dense editor and want the same controls,
   and importing them out of here would have made those two files and this one
   import each other. */
import { MONO, Field, NumField, SelectField, NUM_W, RuleRow } from './parts'
import { CadenceBand } from './cadence'
import {
  normalizeSpec, renderCycle, summarize, slugify,
  parseCadence, formatCadence, describeCadence, expandCadence,
  metricOf, seriesFor,
  UNITS, LOAD_UNITS, DRIVES, BLOCKS, ADVANCE_ON, CADENCES, MEASURES, WINDOWS,
  CADENCE_LABEL, MEASURE_LABEL, LIMITS, MAX_RULES,
  type Spec, type Step, type Progression,
} from '../../lib/routine-spec'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/* The document's own panels (WHEN IT FIRES, the scaling block, a step) read as
   the milestone branch row does — a flat hairline card on --hub-bg-3 — not as
   a .jk-well. A well's --hub-accent-press is an EMPHASIS move (an alert, a
   picked state) and in dark mode that is a real emissive glow; stacking four
   of them down one column just to hold form fields turned the whole document
   into a wall of amber halation. */
const PANEL: React.CSSProperties = {
  display: 'block',
  border: '1px solid var(--hub-line)',
  borderRadius: 'var(--hub-radius-sm)',
  background: 'var(--hub-bg-3)',
}

type Tab = 'ladder' | 'history' | 'revisions'

export function RoutineForge({
  routine, items, goals, api, today, readonly,
  onToggle, onUpdateItem, onDelete, onOpenShelf, shelfCount,
}: any) {
  /* The spec is held NORMALISED in local state, not as the raw column. Normalising
     on every keystroke would fight the user (a half-typed number is not a number);
     normalising once on load and then editing the normalised object means every
     field already exists and no edit has to invent one. */
  const [spec, setSpec] = useState<Spec>(() => normalizeSpec(routine?.spec))
  const [cadenceDays, setCadenceDays] = useState<string>(() => routine?.cadence_days || '')
  const [cadenceRule, setCadenceRule] = useState<string>(() => routine?.cadence_rule || '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [warnings, setWarnings] = useState<any[]>([])
  const [library, setLibrary] = useState<any[] | null>(null)
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState('exercise')
  const [horizon, setHorizon] = useState(8)
  const [tab, setTab] = useState<Tab>('ladder')
  const [revisions, setRevisions] = useState<any[] | null>(null)
  const [chartMeasure, setChartMeasure] = useState('load')
  /* The full shelf is OWNED BY THE WORKSHOP, not by this pane. The inline picker
     below is faster when you know the name; the shelf is for when you do not — and
     it is the only place an entry's ladder and default progression can be READ
     before you commit a step to them. It opens as an overlay over the whole forge
     (WorkshopView), so this component never unmounts and the unsaved document
     survives the trip. Handing it an onPick is what makes it a PICKER rather than
     the browsable shelf; the same surface does both, so the two cannot drift. */
  const openShelf = () => onOpenShelf?.((entry: any) => {
    addStep(entry)
    /* Re-read the local copy the inline picker resolves against: the browser is a
       full editor, and an entry may have been added, renamed or given a ladder
       while it was open. Resolving against a stale copy is how a step arrives
       without the defaults it was just given. */
    api?.get('/api/library').then((r: any) => setLibrary(r?.entries || [])).catch(() => { /* keep what we had */ })
  })

  useEffect(() => {
    setSpec(normalizeSpec(routine?.spec))
    setCadenceDays(routine?.cadence_days || '')
    setCadenceRule(routine?.cadence_rule || '')
    setDirty(false); setWarnings([]); setRevisions(null)
  }, [routine?.id])

  /* The library is fetched once and kept — it is the vocabulary, it changes rarely,
     and the picker has to feel instant or people will type steps by hand and lose
     every default the library exists to supply. */
  useEffect(() => {
    let live = true
    api?.get('/api/library').then((r: any) => { if (live) setLibrary(r?.entries || []) }).catch(() => { if (live) setLibrary([]) })
    return () => { live = false }
  }, [api])

  // Revisions are fetched lazily — most sessions in the forge never open the tab.
  useEffect(() => {
    if (tab !== 'revisions' || revisions !== null || !api) return
    api.get(`/api/routines/${routine.id}/revisions`)
      .then((r: any) => setRevisions(r?.revisions || []))
      .catch(() => setRevisions([]))
  }, [tab, revisions, api, routine?.id])

  const edit = (fn: (draft: Spec) => void) => {
    setSpec((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Spec
      fn(next)
      return next
    })
    setDirty(true)
  }
  const editStep = (i: number, fn: (s: Step) => void) => edit((d) => { fn(d.steps[i]) })

  const save = async () => {
    if (readonly) return
    setSaving(true)
    try {
      /* One PATCH carries the document AND the cadence, because they are one edit
         from the user's point of view and two round trips would reconcile the
         horizon twice — the second against a half-applied routine. */
      const res = await onUpdateItem?.(routine.id, {
        spec,
        cadence_days: cadenceDays,
        cadence_rule: cadenceRule || null,
      })
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : [])
      setRevisions(null)          // the save just made one
      setDirty(false)
    } finally { setSaving(false) }
  }

  const addStep = (entry?: any) => edit((d) => {
    if (d.steps.length >= LIMITS.steps) return
    const raw = entry
      ? { ref: entry.slug, collection: entry.collection, title: entry.title }
      : { title: 'New step', sets: 3, target: 10 }
    // Round-trip the one new step through the normaliser so it arrives with the
    // library's unit, rest, ladder and default progression already resolved —
    // exactly what the server would have done with the same `ref`.
    const resolve = (slug: string) => (library || []).find((e) => e.slug === slug) || null
    const one = normalizeSpec({ steps: [raw] }, { resolve }).steps[0]
    let key = one.key
    let n = 2
    while (d.steps.some((s) => s.key === key)) key = `${one.key}-${n++}`
    d.steps.push({ ...one, key })
  })

  const sessions = useMemo(
    () => Array.from({ length: horizon }, (_, i) => renderCycle(spec, i)),
    [spec, horizon],
  )

  /* The cadence, previewed the same way the ladder is: the actual dates the rule
     produces over the next fortnight. A rule is unreadable and a list of dates is
     not, which matters most for exactly the modes (every_n_days, RRULE) that cannot
     be drawn as a weekly row. */
  const cadence = useMemo(() => parseCadence(cadenceRule), [cadenceRule])
  const days = useMemo(
    () => String(cadenceDays || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    [cadenceDays],
  )
  const cadenceDates = useMemo(() => {
    const from = today || isoDate(new Date())
    const to = new Date(`${from}T00:00:00Z`)
    to.setUTCDate(to.getUTCDate() + 27)
    return expandCadence(cadence, {
      from, to: to.toISOString().slice(0, 10),
      anchor: String(routine?.created_at || from).slice(0, 10),
      days,
      floats: Math.max(0, (routine?.cadence_count ?? days.length) - days.length),
    })
  }, [cadence, days, today, routine?.created_at, routine?.cadence_count])

  /* The occurrences this routine has produced — the input to both the goal metric
     and the history charts. Read off the items already in memory; nothing here
     fetches, because the board already has them. */
  const occurrences = useMemo(
    () => (items || []).filter((it: any) => it.parent_id === routine.id && String(it.ext_ref || '').startsWith('routine:')),
    [items, routine.id],
  )
  const metric = useMemo(() => metricOf(spec, occurrences, today || isoDate(new Date())), [spec, occurrences, today])

  const shown = useMemo(() => {
    const list = (library || []).filter((e) => e.collection === collection)
    const q = query.trim().toLowerCase()
    if (!q) return list.slice(0, 60)
    return list.filter((e) =>
      e.title.toLowerCase().includes(q) || e.slug.includes(q)
      || (Array.isArray(e.tags) && e.tags.some((t: string) => t.toLowerCase().includes(q))),
    ).slice(0, 60)
  }, [library, collection, query])

  const collections = useMemo(() => [...new Set((library || []).map((e) => e.collection))], [library])

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Head ── */}
      <div className="mo-item" style={{ flex: 'none', padding: '16px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE FORGE · ROUTINE</span>
          <span className="mono-eyebrow">HOW OFTEN · WHAT THE SESSION IS · HOW IT GETS HARDER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '1.85rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
            {routine.title}
          </span>
          <span className="mono-eyebrow" style={{ marginBottom: 5 }}>
            {(summarize(spec) || 'NO STEPS YET').toUpperCase()}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {dirty && <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>UNSAVED</span>}
            {!readonly && (
              <TButton onClick={save} disabled={!dirty || saving} style={{ cursor: dirty ? 'pointer' : 'default' }}>
                {saving ? 'Saving…' : 'Save'}
              </TButton>
            )}
            <TButton quiet onClick={openShelf} style={{ cursor: 'pointer' }}>
              ◧ Library{shelfCount == null ? '' : ` · ${shelfCount}`}
            </TButton>
          </div>
        </div>

        {/* ── The cadence, above the document ────────────────────────────────
            HOW OFTEN and WHAT IT IS were two screens behind two badges until the
            workshop became one bench; they are one routine, and the band is the
            half of it that fits in a header. Everything here writes straight
            through onUpdateItem — no Save — because a click on a weekday is a
            decision about the schedule, and the Save button below belongs to the
            DOCUMENT. Pairing them would mean an unsaved spec could hold a cadence
            change hostage. */}
        <div style={{ marginTop: 16 }}>
          <CadenceBand
            routine={routine}
            items={items}
            goals={goals}
            today={today}
            readonly={readonly}
            onToggle={onToggle}
            onUpdateItem={onUpdateItem}
            onDelete={onDelete}
          />
        </div>
      </div>
      <Rule style={{ margin: '4px 28px 0' }} />

      {/* The LINT the server returned. Shown here and nowhere else because this is
          the only screen where the answer is actionable — and because a routine
          that is valid but never progresses has no other symptom. */}
      {warnings.length > 0 && (
        <div style={{ padding: '10px 28px 0' }}>
          <Well style={{ padding: '8px 10px', display: 'block' }}>
            <div className="mono-eyebrow" style={{ marginBottom: 4 }}>SAVED — WORTH A LOOK</div>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>
                <span style={{ fontFamily: MONO, fontSize: 10 }}>{w.path || 'spec'}</span> — {w.message}
              </div>
            ))}
          </Well>
        </div>
      )}

      <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '14px 28px 20px', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(300px, 0.7fr)', gap: 22, alignItems: 'start' }}>

          {/* ══ Left: the document ═══════════════════════════════════════════ */}
          <div style={{ minWidth: 0 }}>
            <span className="mono-eyebrow">THE STEPS</span>
            <div style={{ marginTop: 8 }}>
              {spec.steps.map((s, i) => (
                <StepEditor
                  key={s.key}
                  step={s}
                  index={i}
                  count={spec.steps.length}
                  vars={Object.keys(spec.vars)}
                  readonly={readonly}
                  onEdit={(fn: any) => editStep(i, fn)}
                  onMove={(dir: number) => edit((d) => {
                    const j = i + dir
                    if (j < 0 || j >= d.steps.length) return
                    const [x] = d.steps.splice(i, 1)
                    d.steps.splice(j, 0, x)
                  })}
                  onRemove={() => edit((d) => { d.steps.splice(i, 1) })}
                />
              ))}
            </div>

            {!readonly && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <TButton quiet onClick={() => setPicker((p) => !p)} style={{ padding: '7px 11px', cursor: 'pointer' }}>
                  {picker ? '× Close library' : '+ From the library'}
                </TButton>
                <TButton quiet onClick={() => addStep()} style={{ padding: '7px 11px', borderStyle: 'dashed', cursor: 'pointer' }}>
                  + Blank step
                </TButton>
                {/* The quick picker above is for when you know the name. This is for
                    when you do not — and it is where an entry's ladder, rest and
                    default progression can be read before a step inherits them. */}
                <TButton quiet onClick={openShelf} title="Browse the whole library — read an entry's ladder and defaults before you use it" style={{ padding: '7px 11px', cursor: 'pointer', marginLeft: 'auto' }}>
                  ⤢ Browse the library
                </TButton>
              </div>
            )}

            {/* ── The library picker ─────────────────────────────────────────
                The vocabulary a step is built from. Picking from here rather than
                typing supplies the unit, the rest interval, the difficulty ladder
                and a sane default progression — the tacit knowledge that makes the
                difference between a valid routine and a good one. */}
            {picker && !readonly && (
              <Well style={{ display: 'block', padding: 10, marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  {collections.map((c) => (
                    <Chip
                      key={c}
                      className="jk-hit"
                      solid={c === collection}
                      onClick={() => setCollection(c)}
                      style={{ fontFamily: MONO, fontSize: 9.5, padding: '2px 8px', cursor: 'pointer' }}
                    >
                      {String(c).toUpperCase()}
                    </Chip>
                  ))}
                  <Field
                    type="search" value={query} placeholder="search…"
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ marginLeft: 'auto', width: 150 }}
                  />
                </div>
                {library === null && <div className="mono-eyebrow">LOADING…</div>}
                {library !== null && shown.length === 0 && <div className="mono-eyebrow">NOTHING MATCHES</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 5, maxHeight: 260, overflowY: 'auto' }}>
                  {shown.map((e) => (
                    <Press
                      key={`${e.collection}:${e.slug}`}
                      className="jk-hit"
                      onClick={() => { addStep(e); setPicker(false); setQuery('') }}
                      title={e.notes || e.title}
                      style={{
                        display: 'block', textAlign: 'left', padding: '5px 7px', cursor: 'pointer',
                        border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-xs)',
                      }}
                    >
                      <div style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 12 }}>{e.title}</div>
                      <div className="mono-eyebrow">
                        {e.unit || 'reps'}{e.variants?.length ? ` · ${e.variants.length} RUNGS` : ''}
                      </div>
                    </Press>
                  ))}
                </div>
              </Well>
            )}

            {/* ══ The programme ═══════════════════════════════════════════════ */}
            <div style={{ marginTop: 22 }}>
              <span className="mono-eyebrow">THE PROGRAM</span>

              {/* ── WHEN ───────────────────────────────────────────────────── */}
              <div style={{ ...PANEL, padding: 10, marginTop: 8 }}>
                <div className="mono-eyebrow" style={{ marginBottom: 6 }}>WHEN IT FIRES</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <SelectField
                    value={cadence.type} disabled={readonly}
                    onChange={(e) => {
                      const t = e.target.value
                      setCadenceRule(t === 'weekly' ? '' : formatCadence(
                        t === 'every_n_days' ? { type: t, n: 3 }
                        : t === 'rolling' ? { type: t, n: 3 }
                        : t === 'monthly' ? { type: t, day: 1 }
                        : { type: 'rrule', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' },
                      ))
                      setDirty(true)
                    }}
                  >
                    {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
                  </SelectField>

                  {/* Weekly keeps the day toggles — the only mode a weekly grid can
                      actually draw, and the one almost every routine uses. */}
                  {cadence.type === 'weekly' && (
                    <span style={{ display: 'inline-flex', gap: 3 }}>
                      {DAY_LETTERS.map((d, off) => (
                        <Chip
                          key={off}
                          className="jk-hit"
                          solid={days.includes(off)}
                          onClick={readonly ? undefined : () => {
                            const next = days.includes(off) ? days.filter((x) => x !== off) : [...days, off]
                            setCadenceDays(next.sort((a, b) => a - b).join(','))
                            setDirty(true)
                          }}
                          style={{ fontFamily: MONO, fontSize: 10, width: 24, padding: '2px 0', textAlign: 'center', cursor: 'pointer' }}
                        >{d}</Chip>
                      ))}
                    </span>
                  )}

                  {(cadence.type === 'every_n_days' || cadence.type === 'rolling') && (
                    <>
                      <NumField
                        min={1} value={cadence.n ?? 3} disabled={readonly}
                        onChange={(e) => { setCadenceRule(formatCadence({ ...cadence, n: Math.max(1, Number(e.target.value) || 1) })); setDirty(true) }}
                        wrapperStyle={NUM_W}
                      />
                      <span className="mono-eyebrow">{cadence.type === 'rolling' ? '× PER 7 DAYS' : 'DAYS'}</span>
                    </>
                  )}

                  {cadence.type === 'monthly' && (
                    <SelectField
                      value={String(cadence.day ?? 1)} disabled={readonly}
                      onChange={(e) => { setCadenceRule(formatCadence({ ...cadence, day: e.target.value === 'last' ? 'last' : Number(e.target.value) })); setDirty(true) }}
                    >
                      {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>day {i + 1}</option>)}
                      <option value="last">last day</option>
                    </SelectField>
                  )}

                  {cadence.type === 'rrule' && (
                    <Field
                      value={cadence.rrule ?? ''} disabled={readonly}
                      placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH"
                      onChange={(e) => { setCadenceRule(`rrule:${e.target.value}`); setDirty(true) }}
                      style={{ flex: '1 1 260px' }}
                    />
                  )}
                </div>

                <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
                    {describeCadence(cadence, days).toUpperCase()}
                  </span>
                  {/* The dates the rule actually produces. A rule is unreadable and a
                      list of dates is not — which matters most for exactly the modes
                      that cannot be drawn as a weekly row. */}
                  <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                    NEXT: {cadenceDates.filter((d) => d.date).slice(0, 6).map((d) => d.date!.slice(5)).join('  ') || '—'}
                    {cadenceDates.some((d) => d.float) ? `  ·  ${cadenceDates.filter((d) => d.float).length} FLOATING` : ''}
                  </span>
                </div>
                {cadence.rrule_error && (
                  <div className="mono-eyebrow" style={{ marginTop: 4, color: 'var(--color-accent)' }}>
                    {cadence.rrule_error.toUpperCase()} — FALLING BACK TO WEEKLY
                  </div>
                )}
              </div>

              {/* ── HOW IT SCALES ──────────────────────────────────────────── */}
              <div style={{ ...PANEL, padding: 10, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    <span className="mono-eyebrow">A CYCLE IS</span>
                    <SelectField
                      value={spec.advance_on} disabled={readonly}
                      onChange={(e) => edit((d) => { d.advance_on = e.target.value })}
                      title="completion = a session you DID (missing a week does not advance you) · calendar = a week that elapsed"
                    >
                      {ADVANCE_ON.map((v) => <option key={v} value={v}>{v === 'completion' ? 'a session you did' : 'a week that passed'}</option>)}
                    </SelectField>
                  </label>
                  <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    <span className="mono-eyebrow">DELOAD EVERY</span>
                    <NumField
                      min={0} max={52} value={spec.deload_every} disabled={readonly}
                      onChange={(e) => edit((d) => { d.deload_every = Math.max(0, Math.min(52, Number(e.target.value) || 0)) })}
                      wrapperStyle={NUM_W}
                      title="Every Nth session is lighter and shorter. 0 = never. You can also take any single session easy from its card."
                    />
                    <span className="mono-eyebrow">{spec.deload_every ? 'SESSIONS' : '(NEVER)'}</span>
                  </label>
                  <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    <span className="mono-eyebrow">ROUND LOAD TO</span>
                    <NumField
                      min={0} step={0.5} value={spec.round_load} disabled={readonly}
                      onChange={(e) => edit((d) => { d.round_load = Math.max(0, Number(e.target.value) || 0) })}
                      wrapperStyle={NUM_W}
                    />
                  </label>
                </div>

                <Rule style={{ margin: '9px 0' }} />

                <div className="mono-eyebrow" style={{ marginBottom: 5 }}>PHASES — EACH SCALES THE WHOLE SESSION</div>
                {spec.phases.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Field
                      value={p.name} disabled={readonly}
                      onChange={(e) => edit((d) => { d.phases[i].name = e.target.value })}
                      style={{ width: 110 }}
                    />
                    <span className="mono-eyebrow">FOR</span>
                    <NumField
                      min={1} value={p.cycles} disabled={readonly}
                      onChange={(e) => edit((d) => { d.phases[i].cycles = Math.max(1, Number(e.target.value) || 1) })}
                      wrapperStyle={NUM_W}
                    />
                    <span className="mono-eyebrow">SESSIONS ·</span>
                    <NumField
                      step={0.05} min={0.1} value={p.intensity} disabled={readonly}
                      onChange={(e) => edit((d) => { d.phases[i].intensity = Number(e.target.value) || 1 })}
                      wrapperStyle={NUM_W}
                      title="Multiplies every load in the session"
                    />
                    <span className="mono-eyebrow">× LOAD</span>
                    {!readonly && (
                      <TButton quiet onClick={() => edit((d) => { d.phases.splice(i, 1) })} style={{ padding: '1px 7px', cursor: 'pointer' }}>×</TButton>
                    )}
                  </div>
                ))}
                {!readonly && spec.phases.length < LIMITS.phases && (
                  <TButton
                    quiet
                    onClick={() => edit((d) => { d.phases.push({ name: `Phase ${d.phases.length + 1}`, cycles: 4, intensity: 1, sets_delta: 0, notes: null }) })}
                    style={{ padding: '2px 8px', marginTop: 3, cursor: 'pointer' }}
                  >+ phase</TButton>
                )}

                <Rule style={{ margin: '9px 0' }} />

                <div className="mono-eyebrow" style={{ marginBottom: 5 }}>
                  NAMED NUMBERS — WHAT A % PROGRESSION IS A % OF
                </div>
                {Object.entries(spec.vars).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, minWidth: 120 }}>{k}</span>
                    <NumField
                      value={v} disabled={readonly}
                      onChange={(e) => edit((d) => { d.vars[k] = Number(e.target.value) || 0 })}
                      wrapperStyle={NUM_W}
                    />
                    {!readonly && (
                      <TButton quiet onClick={() => edit((d) => { delete d.vars[k] })} style={{ padding: '1px 7px', cursor: 'pointer' }}>×</TButton>
                    )}
                  </div>
                ))}
                {!readonly && (
                  <NewVar onAdd={(name: string, value: number) => edit((d) => { d.vars[slugify(name, 'var')] = value })} />
                )}
              </div>

              {/* ── WHAT IT FEEDS ──────────────────────────────────────────── */}
              <div style={{ ...PANEL, padding: 10, marginTop: 8 }}>
                <div className="mono-eyebrow" style={{ marginBottom: 5 }}>
                  WHAT IT CONTRIBUTES TO ITS GOAL
                </div>
                {/* A routine never finishes, so it cannot contribute percent-complete
                    without corrupting the goal's done/total. It contributes a
                    MEASUREMENT instead — "run 100 km this month". */}
                {!spec.contributes ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                      NOTHING YET — A ROUTINE MEASURES, IT DOES NOT COMPLETE
                    </span>
                    {!readonly && (
                      <TButton
                        quiet
                        onClick={() => edit((d) => {
                          d.contributes = { measure: 'sessions', step: null, target: 12, window: 'month', label: null }
                        })}
                        style={{ padding: '2px 8px', cursor: 'pointer' }}
                      >+ measure something</TButton>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SelectField
                        value={spec.contributes.measure} disabled={readonly}
                        onChange={(e) => edit((d) => { d.contributes!.measure = e.target.value })}
                      >
                        {MEASURES.map((m) => <option key={m} value={m}>{MEASURE_LABEL[m]}</option>)}
                      </SelectField>
                      <span className="mono-eyebrow">OF</span>
                      <SelectField
                        value={spec.contributes.step ?? ''} disabled={readonly}
                        onChange={(e) => edit((d) => { d.contributes!.step = e.target.value || null })}
                      >
                        <option value="">the whole session</option>
                        {spec.steps.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
                      </SelectField>
                      <span className="mono-eyebrow">TOWARD</span>
                      <NumField
                        min={1} value={spec.contributes.target} disabled={readonly}
                        onChange={(e) => edit((d) => { d.contributes!.target = Math.max(1, Number(e.target.value) || 1) })}
                        wrapperStyle={NUM_W}
                      />
                      <span className="mono-eyebrow">PER</span>
                      <SelectField
                        value={spec.contributes.window} disabled={readonly}
                        onChange={(e) => edit((d) => { d.contributes!.window = e.target.value })}
                      >
                        {WINDOWS.map((w) => <option key={w} value={w}>{w === 'all' ? 'all time' : w}</option>)}
                      </SelectField>
                      {!readonly && (
                        <TButton quiet onClick={() => edit((d) => { d.contributes = null })} style={{ padding: '1px 7px', cursor: 'pointer' }}>×</TButton>
                      )}
                    </div>
                    {metric && (
                      <div style={{ marginTop: 7 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span className="seg" style={{ fontSize: 15 }}>{metric.value}</span>
                          <span className="mono-eyebrow">/ {metric.target} {metric.unit.toUpperCase()} THIS {metric.window.toUpperCase()}</span>
                        </div>
                        <Bar value={metric.pct / 100} tint={routine.accent || 'var(--color-accent)'} height={5} radius={3} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ══ Right: the rail ══════════════════════════════════════════════ */}
          <div style={{ minWidth: 0, position: 'sticky', top: 0 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {(['ladder', 'history', 'revisions'] as Tab[]).map((t) => (
                <Chip
                  key={t}
                  className="jk-hit"
                  solid={tab === t}
                  onClick={() => setTab(t)}
                  style={{ fontFamily: MONO, fontSize: 9.5, padding: '3px 9px', cursor: 'pointer' }}
                >{t.toUpperCase()}</Chip>
              ))}
            </div>

            {tab === 'ladder' && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="mono-eyebrow">THE NEXT {horizon} SESSIONS</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <TButton quiet onClick={() => setHorizon((h) => Math.max(4, h - 4))} style={{ padding: '1px 7px', cursor: 'pointer' }}>−</TButton>
                    <TButton quiet onClick={() => setHorizon((h) => Math.min(32, h + 4))} style={{ padding: '1px 7px', cursor: 'pointer' }}>+</TButton>
                  </div>
                </div>
                <div className="mono-eyebrow" style={{ marginTop: 3, color: 'var(--color-faint)' }}>
                  RENDERED FROM THE RULES — THIS IS WHAT THE ENGINE WILL MINT
                </div>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {spec.steps.length === 0 && (
                    <div className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
                      ADD A STEP AND THE LADDER APPEARS
                    </div>
                  )}
                  {spec.steps.length > 0 && sessions.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '6px 9px',
                        border: '1px solid var(--color-line)',
                        borderRadius: 'var(--hub-radius-xs)',
                        background: s.deload ? 'color-mix(in srgb, var(--hub-bg-4) 55%, transparent)' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span className="seg" style={{ fontSize: 12 }}>{String(i + 1).padStart(2, '0')}</span>
                        <span className="mono-eyebrow">
                          {[s.phase, s.deload ? 'DELOAD' : null].filter(Boolean).join(' · ').toUpperCase() || ''}
                        </span>
                      </div>
                      {s.steps.map((st) => (
                        <div key={st.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}>
                            {st.title}
                          </span>
                          <span style={{ fontFamily: MONO, color: 'var(--color-ink)' }}>{st.line}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'history' && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                  <span className="mono-eyebrow">PLAN vs DONE</span>
                  <SelectField
                    value={chartMeasure}
                    onChange={(e) => setChartMeasure(e.target.value)}
                    wrapperStyle={{ marginLeft: 'auto' }}
                  >
                    <option value="load">load</option>
                    <option value="target">target</option>
                    <option value="sets">sets</option>
                    <option value="volume">volume</option>
                  </SelectField>
                </div>
                <div className="mono-eyebrow" style={{ color: 'var(--color-faint)', marginBottom: 8 }}>
                  WHERE THE LINES SEPARATE, THE PROGRAM IS ASKING FOR SOMETHING YOU ARE NOT DOING
                </div>
                {spec.steps.length === 0 && <div className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>NO STEPS YET</div>}
                {spec.steps.map((s) => (
                  <ProgressChart
                    key={s.key}
                    title={s.title}
                    unit={chartMeasure === 'load' ? s.load_unit : chartMeasure === 'sets' ? 'sets' : s.unit}
                    tint={routine.accent || 'var(--color-accent)'}
                    points={seriesFor(spec, occurrences, s.key, chartMeasure)}
                  />
                ))}
              </>
            )}

            {tab === 'revisions' && (
              <>
                <span className="mono-eyebrow">THE DOCUMENT OVER TIME</span>
                <div className="mono-eyebrow" style={{ color: 'var(--color-faint)', marginTop: 3, marginBottom: 8 }}>
                  EVERY SESSION STAMPS THE REVISION IT FOLLOWED — THIS IS WHERE A FROZEN NUMBER EXPLAINS ITSELF
                </div>
                {revisions === null && <div className="mono-eyebrow">LOADING…</div>}
                {revisions?.length === 0 && <div className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>NO HISTORY YET</div>}
                {(revisions || []).map((r) => (
                  <div
                    key={r.version}
                    style={{
                      padding: '6px 9px', marginBottom: 5,
                      border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-xs)',
                      background: r.current ? 'color-mix(in srgb, var(--hub-bg-4) 55%, transparent)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="seg" style={{ fontSize: 12 }}>v{r.version}</span>
                      {r.current && <Bubble tone="secondary" style={{ fontSize: 8, padding: '1px 6px' }}>CURRENT</Bubble>}
                      <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>
                        {String(r.created_at || '').slice(0, 10)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>{r.summary || '—'}</div>
                    {r.note && <div className="mono-eyebrow">{r.note}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── One step ───────────────────────────────────────────────────────────────
 * The dose on one line, then the RULES — plural, because a step commonly gets
 * harder in more than one way at once (reps every session, a harder movement every
 * six weeks, a fourth set in the second month). Each rule is its own row so the
 * clocks stay visibly separate; folding them into one line is what made the
 * single-rule version unreadable at every width worth supporting. */
function StepEditor({ step, index, count, vars, readonly, onEdit, onMove, onRemove }: any) {
  const set = (k: string, v: any) => onEdit((s: Step) => { (s as any)[k] = v })
  const setRule = (ri: number, k: string, v: any) => onEdit((s: Step) => { (s.progression[ri] as any)[k] = v })

  return (
    <div style={{ ...PANEL, padding: '8px 10px', marginBottom: 6 }}>
      {/* Line 1 — identity */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Field
          display value={step.title} disabled={readonly}
          onChange={(e) => set('title', e.target.value)}
          style={{ flex: '1 1 150px' }}
        />
        <SelectField value={step.block} disabled={readonly} onChange={(e) => set('block', e.target.value)}>
          {BLOCKS.map((b) => <option key={b} value={b}>{b}</option>)}
        </SelectField>
        {!readonly && (
          <>
            <TButton quiet onClick={() => onMove(-1)} disabled={index === 0} style={{ padding: '1px 6px', cursor: 'pointer' }}>↑</TButton>
            <TButton quiet onClick={() => onMove(1)} disabled={index === count - 1} style={{ padding: '1px 6px', cursor: 'pointer' }}>↓</TButton>
            <TButton quiet onClick={onRemove} style={{ padding: '1px 6px', cursor: 'pointer' }}>×</TButton>
          </>
        )}
      </div>

      {/* Line 2 — the dose */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 5 }}>
        <NumField min={1} value={step.sets} disabled={readonly}
          onChange={(e) => set('sets', Math.max(1, Number(e.target.value) || 1))} wrapperStyle={NUM_W} title="Sets" />
        <span className="mono-eyebrow">×</span>
        <NumField value={step.target ?? ''} disabled={readonly} placeholder="—"
          onChange={(e) => set('target', e.target.value === '' ? null : Number(e.target.value))} wrapperStyle={NUM_W} title="Target per set" />
        <SelectField value={step.unit} disabled={readonly} onChange={(e) => set('unit', e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </SelectField>
        <span className="mono-eyebrow">@</span>
        <NumField step={0.5} value={step.load ?? ''} disabled={readonly} placeholder="—"
          onChange={(e) => set('load', e.target.value === '' ? null : Number(e.target.value))} wrapperStyle={NUM_W} title="Starting load" />
        <SelectField value={step.load_unit ?? ''} disabled={readonly} onChange={(e) => set('load_unit', e.target.value || null)}>
          <option value="">—</option>
          {LOAD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </SelectField>
        <span className="mono-eyebrow">REST</span>
        <NumField min={0} value={step.rest ?? ''} disabled={readonly} placeholder="—"
          onChange={(e) => set('rest', e.target.value === '' ? null : Number(e.target.value))} wrapperStyle={NUM_W} />
      </div>

      {/* The rules */}
      <div style={{ marginTop: 6 }}>
        {step.progression.length === 0 && (
          <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>NEVER GETS HARDER</span>
        )}
        {step.progression.map((p: Progression, ri: number) => (
          <RuleRow
            key={ri}
            rule={p} variants={step.variants} vars={vars} readonly={readonly}
            onSet={(k: string, v: any) => setRule(ri, k, v)}
            onRemove={() => onEdit((s: Step) => { s.progression.splice(ri, 1) })}
          />
        ))}
        {!readonly && step.progression.length < MAX_RULES && (
          <TButton
            quiet
            onClick={() => onEdit((s: Step) => {
              // A new rule defaults to moving whatever is NOT already being moved,
              // so adding a second rule to a load progression offers reps rather
              // than a duplicate that would immediately be linted.
              const taken = new Set(s.progression.map((r) => r.drives))
              const drives = DRIVES.find((d) => !taken.has(d) && (d !== 'variant' || s.variants.length > 1)) || 'target'
              s.progression.push({ type: 'linear', drives, increment: drives === 'load' ? 5 : 1, every: 1, cap: null, floor: null })
            })}
            style={{ padding: '2px 8px', marginTop: 3, cursor: 'pointer' }}
          >+ rule</TButton>
        )}
      </div>

      {/* The ladder — the second axis of difficulty, and the only one a bodyweight
          step has. Edited as a comma list because it is a short ordered list of
          names and any richer control would be more chrome than content. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <span className="mono-eyebrow">LADDER</span>
        <Field
          value={step.variants.join(', ')} disabled={readonly} placeholder="easiest, …, hardest"
          onChange={(e) => onEdit((s: Step) => {
            s.variants = e.target.value.split(',').map((v) => v.trim()).filter(Boolean).slice(0, LIMITS.variants)
            s.variant_index = Math.min(s.variant_index, Math.max(0, s.variants.length - 1))
          })}
          style={{ flex: '1 1 200px' }}
        />
        {step.variants.length > 1 && (
          <>
            <span className="mono-eyebrow">START AT</span>
            <SelectField value={step.variant_index} disabled={readonly}
              onChange={(e) => set('variant_index', Number(e.target.value))}>
              {step.variants.map((v: string, i: number) => <option key={i} value={i}>{v}</option>)}
            </SelectField>
            <span className="mono-eyebrow">CLIMB EVERY</span>
            <NumField min={0} value={step.variant_every} disabled={readonly}
              onChange={(e) => set('variant_every', Math.max(0, Number(e.target.value) || 0))} wrapperStyle={NUM_W}
              title="0 = never climb on a clock" />
            {/* PROMOTE ON CAP — the ladder climbs on an ACHIEVEMENT rather than a
                clock: hit the load cap, take a harder variation, reset the load.
                Offered only when there is a ladder to climb. */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: readonly ? 'default' : 'pointer' }}
              title="When a capped load rule tops out, climb the ladder instead of pinning">
              <Check checked={step.promote_on_cap} disabled={readonly}
                onChange={(next) => set('promote_on_cap', next)} />
              <span className="mono-eyebrow">CLIMB AT THE CAP</span>
            </label>
          </>
        )}
        {step.ref && <Bubble tone="secondary" style={{ fontSize: 8, padding: '2px 6px' }}>{step.ref.toUpperCase()}</Bubble>}
      </div>
    </div>
  )
}

/** Adding a named number. Its own component only so the two fields can hold their
 *  own draft state without every keystroke re-rendering the whole forge. */
function NewVar({ onAdd }: any) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const commit = () => {
    if (!name.trim() || value === '') return
    onAdd(name, Number(value) || 0)
    setName(''); setValue('')
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
      <Field value={name} placeholder="squat_max" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ width: 120 }} />
      <NumField value={value} placeholder="225" onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()} wrapperStyle={NUM_W} />
      <TButton quiet onClick={commit} style={{ padding: '2px 8px', cursor: 'pointer' }}>+ number</TButton>
    </div>
  )
}

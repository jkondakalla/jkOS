/**
 * SessionCard — one occurrence's PRESCRIPTION and its LOG, side by side.
 *
 * This is the surface the routine primitive actually exists for. Everything else —
 * the document, the library, the progression engine — converges on one question a
 * person asks while standing in a gym: what am I doing today, and did I do it?
 *
 * TWO COLUMNS OF MEANING, ONE ROW PER STEP.
 *   · the PRESCRIPTION is what the engine rendered at this occurrence's cycle.
 *     Read-only here on purpose: it is a fact written at mint, not a field. Editing
 *     it would mean editing the plan you are being measured against, which is the
 *     one thing a training log must not let you do casually.
 *   · the LOG is what you did. Two taps: done, and — only when the step has a
 *     target to miss — hit / missed. That second tap is not decoration: it is the
 *     input `autoregulated` progression reads, so marking a step missed is what
 *     stops the load marching past what you can lift.
 *
 * WHY "MISSED" IS A SEPARATE TAP FROM "NOT DONE". An unticked step in a session you
 * have not started yet is not the same as one you tried and failed, and the engine
 * treats them differently (routine-spec.js `stepWasMet`: silence means you met it,
 * because logging every set is a habit people keep for a week and then drop). So
 * the card has to be able to say "done but short" without that being the same
 * gesture as "haven't got there yet".
 *
 * Nothing here computes a prescription. The occurrence arrives with it rendered
 * (routines.js writes it at mint and re-renders the future on every reconcile), so
 * this component only unwraps and draws — which is why a peer app showing the same
 * row needs no routine code at all.
 */
import React, { useEffect, useRef, useState } from 'react'
import { FONT_HEAD } from '../lib/theme'
import { Chip, Press, Bubble, Rule, TButton, NumField } from '@jkos/ui'
import {
  prescriptionOf, performedOf, stepStatus, logStep, metFromSets, blankSets,
  type RenderedStep,
} from '../lib/routine-spec'

const MONO = 'var(--hub-font-mono)'

/** How long a set field waits after the last keystroke before it writes. Long
 *  enough to swallow a held arrow key or a run of stepper clicks, short enough
 *  that looking away from the screen for a moment has already saved. */
const WRITE_DEBOUNCE_MS = 400

const BLOCK_LABEL: Record<string, string> = {
  warmup: 'WARM-UP', main: 'MAIN', accessory: 'ACCESSORY', cooldown: 'COOL-DOWN',
}

export function SessionCard({ occurrence, tint, readonly, onUpdateItem, onDeload }: any) {
  /* ONE rest timer for the whole card, not one per step. A rest timer is a
     property of the session — you are resting, not resting-from-a-particular-row —
     and N independent countdowns would be N things ticking and no answer to
     "how long since my last set". */
  const [rest, setRest] = useState<{ key: string; until: number; len: number } | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!rest) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [rest])

  const rx = prescriptionOf(occurrence)
  if (!rx || !rx.steps.length) return null

  const performed = performedOf(occurrence)

  /* WHEN THE SESSION ACTUALLY STARTED (migration 13).
     `scheduled_time` is the plan; this is the only record of the actual, and it
     exists solely because a routine that quietly happens ninety minutes late every
     time looks identical to one running on schedule from every other column.

     Written ONCE and never overwritten — a session has one start — and folded into
     the patch the interaction was already sending rather than fired as its own
     PATCH: touching a session card must stay one round trip, which is the whole
     reason the set log is debounced two functions down. */
  const opening = () => (occurrence.started_at ? null : { started_at: new Date().toISOString() })
  const write = (patch: any) => onUpdateItem?.(occurrence.id, { ...opening(), ...patch })

  /* One write per tap, merged onto whatever is already logged. The merge lives in
     the spec mirror (logStep) rather than here so the log's shape has one author —
     the card never constructs the JSON itself. */
  const log = (key: string, patch: any) => {
    if (readonly) return
    write({ performed: logStep(performed, key, patch) })
  }

  /* Blocks are a flat tag on each step, already sorted by the render. Grouped here
     only for the heading — no nesting in the data, no nesting in the draw. */
  const groups: Array<{ block: string; steps: RenderedStep[] }> = []
  for (const s of rx.steps) {
    const last = groups[groups.length - 1]
    if (last && last.block === s.block) last.steps.push(s)
    else groups.push({ block: s.block, steps: [s] })
  }

  const doneCount = rx.steps.filter((s) => stepStatus(performed, s.key).done).length
  const restLeft = rest ? Math.max(0, Math.ceil((rest.until - Date.now()) / 1000)) : 0

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE SESSION</span>
        <span className="mono-eyebrow">{rx.line.toUpperCase()}</span>
        <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>
          {doneCount}/{rx.steps.length} LOGGED
        </span>
      </div>

      {/* A deload is the one thing about a session worth saying before its steps:
          it looks like a bad day on the board and is in fact the plan. The two
          cases are named apart because they mean different things — one is the
          programme working, the other is you deciding. */}
      {rx.deload && (
        <Bubble tone="secondary" style={{ fontSize: 9, padding: '3px 8px', marginBottom: 8 }}>
          {rx.deload_forced ? 'TAKING THIS ONE EASY — costs no progress' : 'DELOAD — lighter on purpose'}
        </Bubble>
      )}

      {/* THE REST TIMER. Counts down from the step's own rest interval, started by
          logging a set. Deliberately unpersisted: a rest is a fact about the next
          ninety seconds, and a timer that survived a reload would be lying about
          when it started. */}
      {rest && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8,
          padding: '5px 9px', borderRadius: 'var(--hub-radius-xs)',
          border: `1px solid ${restLeft > 0 ? tint || 'var(--color-accent)' : 'var(--color-line)'}`,
          background: restLeft > 0 ? 'color-mix(in srgb, var(--jk-tint, var(--color-accent)) 9%, transparent)' : 'transparent',
        }}>
          <span className="mono-eyebrow">{restLeft > 0 ? 'REST' : 'GO'}</span>
          <span className="seg" style={{ fontSize: 16, minWidth: 46 }}>
            {restLeft > 0 ? `${Math.floor(restLeft / 60)}:${String(restLeft % 60).padStart(2, '0')}` : '0:00'}
          </span>
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--color-line)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, background: tint || 'var(--color-accent)',
              width: `${rest.len ? Math.max(0, (restLeft / rest.len) * 100) : 0}%`,
              transition: 'width 250ms linear',
            }} />
          </div>
          <TButton quiet onClick={() => setRest(null)} style={{ padding: '1px 7px', cursor: 'pointer' }}>×</TButton>
        </div>
      )}

      {groups.map((g, gi) => (
        <div key={`${g.block}-${gi}`} style={{ marginBottom: 10 }}>
          {groups.length > 1 && (
            <div className="mono-eyebrow" style={{ marginBottom: 5 }}>{BLOCK_LABEL[g.block] || g.block.toUpperCase()}</div>
          )}
          {g.steps.map((s) => (
            <StepRow
              key={s.key}
              step={s}
              status={stepStatus(performed, s.key)}
              tint={tint}
              readonly={readonly}
              onLog={(patch: any) => log(s.key, patch)}
              onRest={() => s.rest ? setRest({ key: s.key, until: Date.now() + s.rest * 1000, len: s.rest }) : null}
            />
          ))}
        </div>
      ))}

      <Rule style={{ margin: '2px 0 8px' }} />
      {!readonly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <TButton
            quiet
            onClick={() => {
              // "All as prescribed" — the honest fast path, and the one that keeps
              // the log truthful for people who would otherwise log nothing.
              //
              // Folded through logStep one step at a time rather than assembled
              // here, because the log has ONE author (see `log` above) and this was
              // the one place that quietly wasn't going through it: it rebuilt
              // `steps` wholesale, which both discarded any sets and notes already
              // typed and — now that logStep stamps them — would have produced the
              // only completed steps in the app with no `at` and no `seq` on them.
              let next = performed
              for (const s of rx.steps) next = logStep(next, s.key, { done: true, met: true })
              write({ performed: next })
            }}
            style={{ padding: '3px 9px', cursor: 'pointer' }}
          >
            all as prescribed
          </TButton>
          {/* TAKE IT EASY. Not a PATCH the caller follows with a reload: the server
              also gives a deloaded session NO RUNG on the cycle ladder, so the
              sessions after it shift back and re-render in the same request. */}
          {!occurrence.completed && onDeload && (
            <TButton
              quiet
              onClick={() => onDeload(occurrence.id, !rx.deload_forced)}
              title="Render this one lighter. It spends no progress — the sessions after it stay where they are."
              style={{ padding: '3px 9px', cursor: 'pointer' }}
            >
              {rx.deload_forced ? 'back to full' : 'take it easy'}
            </TButton>
          )}
          <TButton
            quiet
            onClick={() => onUpdateItem?.(occurrence.id, { performed: null })}
            style={{ padding: '3px 9px', cursor: 'pointer', marginLeft: 'auto' }}
          >
            clear log
          </TButton>
        </div>
      )}
    </div>
  )
}

/* ── One step ───────────────────────────────────────────────────────────────
 * Prescription on the left (a fact), log on the right (a decision). The row is a
 * grid rather than a flex line so every step's numbers align down the card —
 * scanning a column of "3 × 5" is the whole reason to print them. */
function StepRow({ step, status, tint, readonly, onLog, onRest }: any) {
  const [sheet, setSheet] = useState(false)
  const done = !!status.done
  /* `met` is only meaningful for a step that HAS something to hit. A cool-down
     stretch with no target cannot be "short", so it gets no second tap and the row
     stays a single decision. */
  const scoreable = step.target !== null && step.target !== undefined
  const missed = done && status.met === false
  const logged: any[] = Array.isArray(status.sets) && status.sets.length ? status.sets : blankSets(step)

  /* THE DRAFT, AND WHY THE WRITE IS DEBOUNCED.
     A set field is the one surface here you *hold* rather than tap: the arrow keys
     repeat, the stepper carets get clicked in runs, and a load is dialled in rather
     than typed once. Sending the patch straight from onChange turned each of those
     into its own round trip — dozens of PATCHes in a few seconds, each one also
     costing the routine refetch that ticking an occurrence requires. So the typed
     value lives locally while the hand is still moving, and only the value the
     person settled on is written.

     The draft shadows the logged sets while a write is queued and is dropped the
     moment nothing is pending — at which point the props ARE the truth, including
     when the truth came from somewhere else entirely (`clear log`, the server's
     re-render). Nothing here decides what a set means; it only decides when to
     send. */
  const [draft, setDraft] = useState<any[] | null>(null)
  const sets = draft ?? logged

  const pending = useRef<any[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const commit = () => {
    clearTimeout(timer.current)
    const next = pending.current
    if (!next) return
    pending.current = null
    /* `met` is computed from what was typed rather than asked as a separate
       question: someone who has just entered six real numbers has already answered
       it, and asking again is how a log becomes a chore people abandon. */
    const met = metFromSets(step, next)
    onLog({ sets: next, done: true, ...(met === null ? {} : { met }) })
  }
  /* The flush has to see the CURRENT props — `onLog` closes over the occurrence's
     log as it was at render — so unmount goes through a ref rather than capturing
     the first commit. Without this, closing the sheet mid-edit loses the last
     number typed, which is the one failure a training log cannot have. */
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])

  useEffect(() => {
    if (draft && !pending.current) setDraft(null)
  }, [logged, draft])

  /* Writing one set writes the WHOLE sheet plus the derived verdict, in one patch. */
  const writeSet = (i: number, field: 'value' | 'load', raw: string) => {
    if (readonly) return
    const next = sets.map((s, j) => (j === i ? { ...s, [field]: raw === '' ? null : Number(raw) } : { ...s }))
    setDraft(next)
    pending.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(() => commitRef.current(), WRITE_DEBOUNCE_MS)
  }

  /* Leaving the field is a decision, so it writes immediately rather than waiting
     out the timer — and starts the rest, which is what leaving a set field means. */
  const settleSet = () => { commitRef.current(); onRest() }

  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
        padding: '6px 8px', marginBottom: 4,
        border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-xs)',
        background: done ? 'color-mix(in srgb, var(--jk-tint, var(--color-accent)) 7%, transparent)' : 'transparent',
        opacity: done && !missed ? 0.85 : 1,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 13,
          textDecoration: done && !missed ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {step.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--color-ink)' }}>{step.line}</span>
          {step.rest ? <span className="mono-eyebrow">REST {step.rest}s</span> : null}
          {/* The variant is named as well as printed in the title, because "which
              rung am I on" is the question a ladder exists to answer. */}
          {step.variant && step.variant !== step.base_title
            ? <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>{step.base_title.toUpperCase()} LADDER</span>
            : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {/* THE SET SHEET. Opt-in per step, because most steps most days are a
            single tick — offering N number fields to someone who wants to record
            "did it" is the fastest way to make them record nothing. When it IS
            opened it pre-fills with the prescription, so agreeing with the plan is
            a tap and only the deviations get typed. */}
        {!readonly && scoreable && (step.sets ?? 1) >= 1 && (
          <Press
            className="jk-hit"
            title={sheet ? 'Hide the sets' : 'Log each set'}
            onClick={() => setSheet((v) => !v)}
            style={{
              fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.06em',
              padding: '3px 6px', cursor: 'pointer',
              color: status.sets?.length ? 'var(--color-accent)' : 'var(--color-faint)',
              border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-xs)',
            }}
          >
            {sheet ? '×' : 'SETS'}
          </Press>
        )}
        {done && scoreable && (
          <Chip
            className="jk-hit"
            title={missed ? 'Logged short — the progression will hold here' : 'Hit the target — this earns the next rung'}
            solid={!missed}
            spent={missed}
            tint={tint}
            onClick={readonly ? undefined : () => onLog({ met: missed })}
            style={{ fontFamily: MONO, fontSize: 10, padding: '2px 7px', cursor: readonly ? 'default' : 'pointer' }}
          >
            {missed ? 'SHORT' : 'HIT'}
          </Chip>
        )}
        <Press
          className="jk-hit"
          title={done ? 'Logged — click to un-log' : 'Log this step as done'}
          onClick={readonly ? undefined : () => onLog({ done: !done, met: done ? undefined : true })}
          style={{
            width: 26, height: 26, display: 'grid', placeItems: 'center',
            border: `1px solid ${done ? tint || 'var(--color-accent)' : 'var(--color-line)'}`,
            borderRadius: 'var(--hub-radius-xs)',
            background: done ? tint || 'var(--color-accent)' : 'transparent',
            color: done ? 'var(--color-on-accent)' : 'var(--color-faint)',
            fontFamily: MONO, fontSize: 12, cursor: readonly ? 'default' : 'pointer',
          }}
        >
          {done ? '✓' : ''}
        </Press>
      </div>

      {/* The sheet spans the whole row, below both columns — one line per set,
          value and load side by side. Logging a set STARTS THE REST TIMER, because
          that is when the rest actually starts and asking for a second tap to say
          so is the kind of friction that empties a log. */}
      {sheet && !readonly && (
        <div style={{ gridColumn: '1 / -1', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {sets.map((st, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono-eyebrow" style={{ width: 22 }}>{i + 1}</span>
              <NumField
                size="sm" inputMode="decimal" value={st.value ?? ''} placeholder={String(step.target ?? '')}
                onChange={(e) => writeSet(i, 'value', e.target.value)}
                onBlur={settleSet}
                wrapperStyle={setField} title={step.unit}
              />
              <span className="mono-eyebrow">{step.unit}</span>
              {step.load_unit && step.load_unit !== 'bw' && (
                <>
                  <span className="mono-eyebrow">@</span>
                  <NumField
                    size="sm" inputMode="decimal" step="0.5" value={st.load ?? ''} placeholder={String(step.load ?? '')}
                    onChange={(e) => writeSet(i, 'load', e.target.value)}
                    onBlur={settleSet}
                    wrapperStyle={setField}
                  />
                  <span className="mono-eyebrow">{step.load_unit}</span>
                </>
              )}
              {/* The prescription, restated per row — so a short set is visible as
                  short without the reader holding the target in their head. */}
              {st.value !== null && step.target !== null && Number(st.value) < Number(step.target) && (
                <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
                  −{Math.round((Number(step.target) - Number(st.value)) * 100) / 100}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Width of a per-set entry. On the WRAPPER, not the input — the stepper carets
 *  are part of the group, the same rule the workshop's NUM_W follows. */
const setField: React.CSSProperties = { width: 58 }

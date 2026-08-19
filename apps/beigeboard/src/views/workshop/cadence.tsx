/**
 * cadence.tsx — the CADENCE half of a routine, as two surfaces.
 *
 * A routine has two halves that used to live on two different screens: HOW OFTEN
 * (the seven days, the target, the streak) and WHAT IT IS (the document — steps,
 * progression, phases; ./RoutineForge). The cadence half was a whole board — one
 * row per routine, seven columns for the week — sitting behind its own badge next
 * to the goals board.
 *
 * IT IS NOT A BOARD ANY MORE. The workshop is one bench: a rail of goals over
 * standing orders, and one forge pane showing whichever you picked. That leaves
 * the cadence nowhere to be a full-page grid, and it did not need to be — the
 * all-routines-at-once week read was a view of seven columns you could not act on
 * without first finding the row, and the row is now the thing you select. So the
 * cadence comes apart into the two pieces the bench actually has room for:
 *
 *   RoutineCard  the rail entry — dot · title · streak · a 7-segment week strip.
 *                Read-only, and deliberately: the rail is for CHOOSING, and a rail
 *                that also commits weekdays makes every click ambiguous.
 *   CadenceBand  the strip at the head of the routine's forge, where all of it is
 *                actionable — the seven cells over the seven weekday switches, the
 *                rule that drives them, the weekly target, the time, which goal it
 *                hangs under, park/delete.
 *
 * THE RECORD/PLAN SPLIT IS NOW TWO ROWS, NOT ONE ROW WITH TWO MEANINGS.
 *
 *   the CELLS    THIS WEEK, as it happened. Clicking ticks or un-ticks the session
 *                on that date, or puts back one you struck out. Seven dates.
 *   the LETTERS  THE PLAN. Clicking commits or drops that WEEKDAY in the cadence,
 *                which repeats every week — so it adds or removes the matching
 *                cell in every future week, not just the one on screen. Seven
 *                weekdays. This is the whole of what used to be a separate WHEN IT
 *                FIRES panel down in the document, moved to the row that was
 *                already drawing the seven letters as decoration.
 *
 * IT USED TO BE ONE ROW, and the rule was "a cell with an occurrence today or in
 * the past is the record, anything else is the plan". That reads fine as a
 * sentence and fails on the one day you use most: TODAY ALWAYS HAS AN OCCURRENCE
 * on a day the routine fires, so today's cell was permanently claimed by the
 * record and there was NO WAY, anywhere in the app, to add or drop the current
 * weekday. The two meanings were also never distinguishable by looking — the same
 * 34px square did both, and which one you got depended on the date.
 *
 * Two rows costs 18px and removes the ambiguity completely: the row you click
 * decides what you are editing, and every weekday is editable every day.
 *
 * A STRUCK-OUT cell keeps its third meaning, put this session back. It has to live
 * on the cell the delete emptied, because that is the only place the decision is
 * visible, and it is the only way to undo a delete.
 *
 * Occurrences are ordinary tasks (backend/src/routines.js mints them), so
 * everything else already works: they appear on Today and Week, they drag, they
 * carry the routine's accent, and ticking one here is the same write as ticking it
 * there.
 */
import React, { useMemo } from 'react'
import { FONT_HEAD } from '../../lib/theme'
import {
  cadenceDays, weeklyTarget, floatCount, weekCells, floatsOf,
  occurrencesOf, attainment, streakOf, toggleDay, toggleSkip, cadencePatch,
  addDays, weekStart,
  type Cell,
} from '../../lib/routines'
import {
  normalizeSpec, summarize, metricOf,
  parseCadence, formatCadence, describeCadence, expandCadence,
  CADENCES, CADENCE_LABEL,
} from '../../lib/routine-spec'
import { Bubble, Chip, TButton, Bar, TimeField } from '@jkos/ui'
import { Field, NumField, SelectField, NUM_W } from './parts'

const MONO = 'var(--hub-font-mono)'
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DOW_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/* ── The rail entry ─────────────────────────────────────────────────────────
 * The goal card's sibling, and shaped to rhyme with it on purpose: same box, same
 * serif title, same .seg readout on the right. The two differences are the two
 * facts that separate the shapes — the goal's dot is ROUND and a routine's is
 * SQUARE (a thing with an end vs a thing with a rhythm), and where the goal shows
 * a percentage bar the routine shows a seven-slot week, because a routine has no
 * total to be a fraction of. */
export function RoutineCard({ routine, items, goals, today, selected, delay, onClick }: any) {
  const tint = routine.accent || 'var(--color-accent)'
  const parked = (routine.status || 'active') !== 'active'
  const wk = useMemo(() => weekStart(today), [today])
  const cells = useMemo(() => weekCells(routine, items, wk, today), [routine, items, wk, today])
  const streak = useMemo(() => streakOf(routine, items, today), [routine, items, today])
  const cadence = useMemo(() => parseCadence(routine.cadence_rule), [routine.cadence_rule])
  const goal = goals?.find((g: any) => g.id === routine.parent_id) || null
  const spec = useMemo(() => normalizeSpec(routine.spec), [routine.spec])

  /* The cadence line: the RULE if there is one worth naming (every_n_days, monthly,
     rolling, RRULE all say things seven cells cannot), otherwise the plain weekly
     count — which the cells already show, so repeating it in words would be noise. */
  const line = cadence.type !== 'weekly'
    ? describeCadence(cadence).toUpperCase()
    : `${weeklyTarget(routine)}×/WK${routine.scheduled_time ? ` · ${routine.scheduled_time}` : ''}`

  return (
    <div
      className={`jk-hit mo-item${selected ? ' jk-well' : ''}`}
      onClick={onClick}
      role="button"
      aria-pressed={selected}
      style={{
        border: '1px solid var(--hub-line)', borderRadius: 'var(--hub-radius)', padding: '12px 15px',
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
        opacity: parked ? 0.55 : 1,
        animationDelay: delay, ['--jk-tint' as string]: tint,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: tint, flex: 'none', alignSelf: 'center' }} />
        <span style={{
          fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.015em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {routine.title}
        </span>
        {parked && <Bubble tone="secondary" style={{ fontSize: 8, padding: '2px 7px' }}>PARKED</Bubble>}
        <span className="seg" style={{ marginLeft: 'auto', fontSize: 15 }}>{streak}</span>
        <span className="mono-eyebrow" style={{ fontSize: 8 }}>IN A ROW</span>
      </div>
      <WeekStrip cells={cells} tint={tint} height={7} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span className="mono-eyebrow">{line}</span>
        <span className="mono-eyebrow" style={{
          marginLeft: 'auto', opacity: 0.8, maxWidth: 170,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {goal ? goal.title.toUpperCase() : (summarize(spec) || 'NO STEPS YET').toUpperCase()}
        </span>
      </div>
    </div>
  )
}

/* ── The week, as a read-only strip ─────────────────────────────────────────
 * The .jk-vu segment vocabulary, one segment per day. `rest` and `miss` are the two
 * faces a slot strip needs that a value meter does not (see hub.css): "nothing was
 * asked here" has to read quieter than "something was asked and did not happen", or
 * a routine looks kept on a day it was never due. */
export function WeekStrip(
  { cells, tint, height = 7, style }:
  { cells: Cell[]; tint: string; height?: number; style?: React.CSSProperties },
) {
  return (
    /* The segments are `flex: 1`, so the strip is only as wide as its parent lets
       it be — dropped into a flex ROW with no basis it collapses to seven hairs.
       Callers in a row hand it an explicit width; the rail, where it is the full
       width of the card, hands it nothing. */
    <span className="jk-vu" style={{ height, ['--jk-tint' as string]: tint, ...style }} aria-hidden="true">
      {cells.map((c) => (
        <span
          key={c.iso}
          className={`jk-vu-seg${c.state === 'done' ? ' on' : c.state === 'missed' ? ' miss' : c.state === 'off' ? ' rest' : ''}`}
        />
      ))}
    </span>
  )
}

/* ── The actionable cadence, at the head of the forge ────────────────────── */
export function CadenceBand({
  routine, items, goals, today, readonly,
  onToggle, onUpdateItem, onDelete,
}: any) {
  const tint = routine.accent || 'var(--color-accent)'
  const parked = (routine.status || 'active') !== 'active'
  /* Always THIS week. The old board could page back and forth because it was a
     week grid and paging was the only way to see any other week; a band at the head
     of a document is answering "where am I now", and a prev/next pair there would
     put the forge in a past week with a live Save button under it. History belongs
     to the forge's own HISTORY tab, which is built for it. */
  const wk = useMemo(() => weekStart(today), [today])
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wk, i)), [wk])
  const cells = useMemo(() => weekCells(routine, items, wk, today), [routine, items, wk, today])
  const meter = useMemo(() => attainment(routine, items, wk), [routine, items, wk])
  const streak = useMemo(() => streakOf(routine, items, today), [routine, items, today])
  const floats = useMemo(() => floatsOf(routine, items, wk), [routine, items, wk])
  const spec = useMemo(() => normalizeSpec(routine.spec), [routine.spec])
  const cadence = useMemo(() => parseCadence(routine.cadence_rule), [routine.cadence_rule])
  const committed = useMemo(() => cadenceDays(routine), [routine.cadence_days])
  const metric = useMemo(
    () => metricOf(spec, occurrencesOf(routine, items), today),
    [spec, routine, items, today],
  )
  const goal = goals?.find((g: any) => g.id === routine.parent_id) || null
  const target = weeklyTarget(routine)
  const weekly = cadence.type === 'weekly'

  /* The dates the rule actually produces, over the next four weeks. A rule is
     unreadable and a list of dates is not, which matters most for exactly the
     modes that cannot be drawn as a row of seven weekdays. Rendered from the
     SAVED routine (the mirror in lib/routine-spec, same code the engine's rules
     are checked against) — every control in this band writes through immediately,
     so there is no unsaved cadence for it to disagree with. */
  const upcoming = useMemo(() => {
    const to = new Date(`${today}T00:00:00Z`)
    to.setUTCDate(to.getUTCDate() + 27)
    return expandCadence(cadence, {
      from: today,
      to: to.toISOString().slice(0, 10),
      anchor: String(routine?.created_at || today).slice(0, 10),
      days: committed,
      floats: Math.max(0, target - committed.length),
    })
  }, [cadence, committed, today, routine?.created_at, target])

  /* Every write in this band goes through `cadencePatch`, which attaches the
     park/resume rider (lib/routines) — a routine that stops asking for anything
     parks itself, and one that starts asking again comes back. */
  const patch = (changes: Record<string, any>) => {
    if (readonly) return
    onUpdateItem?.(routine.id, cadencePatch(routine, changes))
  }

  /* THE CELLS ARE THE RECORD, and only the record. They used to double as the
     weekday switch, which is why today — the one date that always has an
     occurrence on a day the routine fires — could never be added or dropped.
     The switch is the letter row below. */
  const onCell = (cell: Cell) => {
    if (readonly) return
    if (cell.occurrence && (cell.isPast || cell.isToday)) onToggle?.(cell.occurrence.id)
    else if (cell.state === 'skipped') patch({ cadence_skips: toggleSkip(routine, cell.iso) })
  }

  const setTarget = (n: number) => {
    // Never below the committed days: the target is what the routine ASKS FOR, and
    // asking for less than you already committed to would silently mean nothing.
    // Clearing the surplus is done by un-committing days, not by the stepper.
    patch({ cadence_count: Math.max(committed.length, Math.min(21, n)) })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap', ['--jk-tint' as string]: tint }}>
      {/* WHEN IT FIRES — the whole of it. This week's record on top, the weekly
          switches under it, the rule that drives them under that. */}
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 5, width: 268 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {cells.map((cell) => (
            <DayCell key={cell.iso} cell={cell} tint={tint} readonly={readonly} onClick={() => onCell(cell)} />
          ))}
        </div>

        {/* THE SWITCHES. Only weekly draws them, because they ARE the weekly rule's
            parameter — under "every 3 days" there is no weekday to commit, and
            seven dead switches under a rule that ignores them is worse than none.
            The cells above stay in every mode: whatever the rule, it still mints
            sessions onto dates, and those dates are still this week. */}
        {weekly ? (
          <div style={{ display: 'flex', gap: 5 }}>
            {DOW.map((letter, off) => {
              const on = committed.includes(off)
              return (
                <Chip
                  key={off}
                  className="jk-hit"
                  solid={on}
                  off={!on}
                  tint={tint}
                  title={on
                    ? `Runs every ${DOW_NAME[off]}. Click to stop scheduling ${DOW_NAME[off]}s.`
                    : `Click to run this every ${DOW_NAME[off]}, starting this week.`}
                  onClick={readonly ? undefined : () => patch({ cadence_days: toggleDay(routine, off) })}
                  style={{
                    width: 34, padding: '3px 0', textAlign: 'center',
                    borderRadius: 'var(--hub-radius-xs)',
                    cursor: readonly ? 'default' : 'pointer',
                    fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em',
                  }}
                >
                  {letter}
                </Chip>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 5 }}>
            {dates.map((iso, i) => (
              <span key={iso} className="mono-eyebrow" style={{ width: 34, textAlign: 'center', fontSize: 8, color: 'var(--color-faint)' }}>
                {DOW[i]}
              </span>
            ))}
          </div>
        )}

        {/* Today, named by LIGHT and not pigment (DESIGN doctrine) — and now as a
            rule under the column rather than as the letter's own colour, because
            the letter is a switch with two faces of its own and cannot carry a
            third meaning in its ink. */}
        <div style={{ display: 'flex', gap: 5 }}>
          {dates.map((iso) => (
            <span
              key={iso}
              style={{
                width: 34, height: 2, borderRadius: 1,
                background: iso === today ? 'var(--color-accent)' : 'transparent',
                boxShadow: iso === today ? 'var(--accent-halo)' : undefined,
              }}
            />
          ))}
        </div>

        {/* THE RULE. This was a WHEN IT FIRES panel a screen further down, next to
            the progression fields — which put the thing that decides WHICH DAYS
            nowhere near the seven days it decides. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
          <SelectField
            value={cadence.type}
            disabled={readonly}
            wrapperStyle={{ flex: '1 1 150px', minWidth: 150 }}
            onChange={(e) => {
              const t = e.target.value
              patch({
                cadence_rule: t === 'weekly' ? null : formatCadence(
                  t === 'every_n_days' ? { type: t, n: 3 }
                  : t === 'rolling' ? { type: t, n: 3 }
                  : t === 'monthly' ? { type: t, day: 1 }
                  : { type: 'rrule', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' },
                ),
              })
            }}
          >
            {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
          </SelectField>

          {(cadence.type === 'every_n_days' || cadence.type === 'rolling') && (
            <>
              <NumField
                min={1} value={cadence.n ?? 3} disabled={readonly}
                onChange={(e) => patch({ cadence_rule: formatCadence({ ...cadence, n: Math.max(1, Number(e.target.value) || 1) }) })}
                wrapperStyle={NUM_W}
              />
              <span className="mono-eyebrow">{cadence.type === 'rolling' ? 'A WEEK' : 'DAYS APART'}</span>
            </>
          )}

          {cadence.type === 'monthly' && (
            <SelectField
              value={String(cadence.day ?? 1)} disabled={readonly}
              onChange={(e) => patch({ cadence_rule: formatCadence({ ...cadence, day: e.target.value === 'last' ? 'last' : Number(e.target.value) }) })}
            >
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>day {i + 1}</option>)}
              <option value="last">last day</option>
            </SelectField>
          )}

          {cadence.type === 'rrule' && (
            <Field
              value={cadence.rrule ?? ''} disabled={readonly}
              placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH"
              onChange={(e) => patch({ cadence_rule: `rrule:${e.target.value}` })}
              style={{ flex: '1 1 100%', minWidth: 0 }}
            />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
            {describeCadence(cadence, committed).toUpperCase()}
          </span>
        </div>
        <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
          NEXT: {upcoming.filter((d) => d.date).slice(0, 4).map((d) => d.date!.slice(5)).join('  ') || 'NOTHING SCHEDULED'}
          {upcoming.some((d) => d.float) ? `  ·  ${upcoming.filter((d) => d.float).length} UNDATED` : ''}
        </span>
        {cadence.rrule_error && (
          <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
            {cadence.rrule_error.toUpperCase()} — RUNNING THE WEEKDAYS ABOVE INSTEAD
          </span>
        )}
      </div>

      {/* The week's attainment, and the streak. */}
      <div style={{ flex: '1 1 200px', minWidth: 180, maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="mono-eyebrow">THIS WEEK</span>
          <span className="seg" style={{ marginLeft: 'auto', fontSize: 15 }}>{meter.done}/{meter.target}</span>
        </div>
        <Bar value={meter.target ? meter.done / meter.target : 0} tint={tint} height={6} radius={3} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="mono-eyebrow">{streak > 0 ? `${streak} IN A ROW` : 'NO STREAK'}</span>
          {floatCount(routine) > 0 && (
            <span className="mono-eyebrow" style={{ marginLeft: 'auto', color: 'var(--color-accent)' }}>
              {floats.filter((f: any) => !f.completed).length} ON THE BENCH
            </span>
          )}
        </div>
        {metric && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} title={`Toward this routine's goal, this ${metric.window}`}>
            <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
              {metric.value}/{metric.target} {metric.unit.toUpperCase()}
            </span>
            <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>{metric.pct}%</span>
          </div>
        )}
      </div>

      {/* The rules that are not a click on a day. */}
      <div style={{ flex: '1 1 260px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TimeField
            size="sm"
            value={routine.scheduled_time || ''}
            disabled={readonly}
            onChange={(e) => patch({ scheduled_time: e.target.value || null })}
            style={{ letterSpacing: '0.06em' }}
          />
          {/* The weekly target. Above the committed days it becomes FLOAT — the
              engine benches the surplus for the week so "3× a week, any days" is
              plannable without a second mechanism. */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <TButton quiet disabled={readonly} onClick={() => setTarget(target - 1)} style={{ padding: '1px 6px', cursor: 'pointer' }}>−</TButton>
            <span className="mono-eyebrow" style={{ minWidth: 42, textAlign: 'center' }}>{target}×/WK</span>
            <TButton quiet disabled={readonly} onClick={() => setTarget(target + 1)} style={{ padding: '1px 6px', cursor: 'pointer' }}>+</TButton>
          </span>
        </div>
        <SelectField
          value={routine.parent_id ?? ''}
          disabled={readonly}
          onChange={(e) => patch({ parent_id: e.target.value === '' ? null : Number(e.target.value) })}
          wrapperStyle={{ maxWidth: 220 }}
          style={{ letterSpacing: '0.08em', textTransform: 'uppercase', color: goal ? undefined : 'var(--color-faint)' }}
        >
          <option value="">not part of a goal</option>
          {goals?.map((g: any) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </SelectField>
        {!readonly && (
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Park/resume by hand. The same status the empty-schedule rider writes
                — parking here leaves the schedule intact, so the routine comes back
                exactly as you left it. */}
            <TButton
              quiet
              title={parked
                ? 'Start minting sessions from this routine again.'
                : 'Stop minting sessions. The schedule is kept, and nothing already on the board is removed.'}
              onClick={() => onUpdateItem?.(routine.id, { status: parked ? 'active' : 'parked' })}
              style={{ padding: '1px 7px', cursor: 'pointer' }}
            >
              {parked ? 'resume' : 'park'}
            </TButton>
            <TButton quiet onClick={() => onDelete?.(routine.id)} style={{ padding: '1px 7px', cursor: 'pointer' }}>
              delete
            </TButton>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── One cell ───────────────────────────────────────────────────────────────
 * Every state is drawn through the <Chip> primitive rather than by hand, so the
 * paper/CRT flip (a saturated fill is INK on paper and a LIGHT SOURCE on the tube
 * — see .jk-chip-solid's dark override) comes for free and can't drift. The two
 * states with no occurrence are the exception: they are absences, and an absence
 * is drawn as an outline, not as a chip with no content. */
function DayCell({ cell, tint, readonly, onClick }: { cell: Cell; tint: string; readonly?: boolean; onClick: () => void }) {
  /* Only a cell with something to change is clickable. `off`, `idle` and
     `planned` are all "nothing has happened on this date yet" — they used to
     toggle the WEEKDAY, which is now the switch row's job, and a square that
     silently rewrites every future week is exactly the ambiguity that split
     these into two rows. */
  const live = !readonly && (cell.state === 'skipped' || (!!cell.occurrence && (cell.isPast || cell.isToday)))
  const common: React.CSSProperties = {
    width: 34, height: 34, display: 'grid', placeItems: 'center',
    cursor: live ? 'pointer' : 'default',
    fontFamily: MONO, fontSize: 12,
  }
  const title = {
    done: 'Done. Click to un-tick it.',
    open: 'Due today, not ticked yet. Click to tick it.',
    missed: 'This session was never ticked. Click to tick it now.',
    planned: 'Scheduled. There is nothing to tick until the day comes.',
    idle: 'This weekday is scheduled, but no session was ever created for this date.',
    skipped: 'You deleted this session. Click to put it back.',
    off: 'Not scheduled. Turn the weekday on below to run this every week.',
  }[cell.state]

  if (cell.state === 'off' || cell.state === 'idle' || cell.state === 'skipped') {
    /* The struck-out cell is the one empty cell that is a DECISION, so it is drawn
       as a struck mark and not as a dashed absence: solid hairline (the decision
       is made), the routine's own tint (it is still this routine's day), and the
       strike itself for what happened to it. */
    const skipped = cell.state === 'skipped'
    return (
      <div
        className={live ? 'jk-hit' : undefined}
        title={title}
        onClick={live ? onClick : undefined}
        style={{
          ...common,
          borderRadius: 'var(--hub-radius-xs)',
          border: skipped
            ? '1px solid var(--color-line)'
            : `1px dashed ${cell.state === 'idle' ? 'color-mix(in srgb, var(--jk-tint) 55%, transparent)' : 'var(--color-line)'}`,
          color: 'var(--color-faint)',
          /* Today is marked by LIGHT, not pigment — the brightest stock, never a
             mid-tone tint (DESIGN doctrine). Held to a WASH of it rather than the
             full stock: at full strength an empty cell on today read as a filled
             one, and `filled` is the vocabulary the occurrence states own. */
          background: cell.isToday ? 'color-mix(in srgb, var(--hub-bg-4) 62%, transparent)' : 'transparent',
          opacity: cell.isPast ? 0.5 : 1,
        }}
      >
        {skipped ? '–' : cell.state === 'idle' ? '·' : ''}
      </div>
    )
  }

  return (
    <Chip
      className={live ? 'jk-hit' : undefined}
      title={title}
      solid={cell.state === 'done' || cell.state === 'open'}
      live={cell.state === 'open'}
      done={cell.state === 'done'}
      spent={cell.state === 'missed'}
      tint={tint}
      onClick={live ? onClick : undefined}
      style={common}
    >
      {cell.state === 'done' ? '✓' : cell.state === 'missed' ? '×' : ''}
    </Chip>
  )
}

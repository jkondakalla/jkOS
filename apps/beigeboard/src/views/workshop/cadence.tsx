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
 *                actionable — the seven cells with their record/plan split, the
 *                weekly target, the time, which goal it hangs under, park/delete.
 *
 * THE RECORD/PLAN SPLIT (inherited verbatim from the old board, because it is the
 * part that was right). A cell is either a RECORD or a PLAN, and which one follows
 * from the cell itself:
 *
 *   · a cell with an occurrence, today or in the past → THE RECORD. Clicking ticks
 *     it (or un-ticks it). This is the back-fill every habit tracker needs.
 *   · anything else → THE PLAN. Clicking commits or un-commits that WEEKDAY in the
 *     cadence, which repeats every week — so it also adds/removes the matching
 *     cells in every future week, not just the one on screen.
 *
 * The split is not a mode anyone has to hold in their head: you cannot tick a day
 * with nothing on it, and you cannot re-plan a day that has already happened, so at
 * any cell exactly one of the two is meaningful. A STRUCK-OUT cell is neither — the
 * weekday is already committed, so un-committing it would undo every week to fix
 * one date — and gets the third meaning, put this session back, which is the only
 * way to undo a delete and therefore has to live on the cell the delete emptied.
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
  occurrencesOf, attainment, streakOf, toggleDay, toggleSkip, addDays, weekStart,
  type Cell,
} from '../../lib/routines'
import { normalizeSpec, summarize, metricOf, parseCadence, describeCadence } from '../../lib/routine-spec'
import { Bubble, Chip, TButton, Bar, TimeField, SelectField } from '@jkos/ui'

const MONO = 'var(--hub-font-mono)'
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

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
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wk, i)), [wk])
  const cells = useMemo(() => weekCells(routine, items, wk, today), [routine, items, wk, today])
  const meter = useMemo(() => attainment(routine, items, wk), [routine, items, wk])
  const streak = useMemo(() => streakOf(routine, items, today), [routine, items, today])
  const floats = useMemo(() => floatsOf(routine, items, wk), [routine, items, wk])
  const spec = useMemo(() => normalizeSpec(routine.spec), [routine.spec])
  const cadence = useMemo(() => parseCadence(routine.cadence_rule), [routine.cadence_rule])
  const metric = useMemo(
    () => metricOf(spec, occurrencesOf(routine, items), today),
    [spec, routine, items, today],
  )
  const goal = goals?.find((g: any) => g.id === routine.parent_id) || null
  const target = weeklyTarget(routine)
  const offGrid = cadence.type !== 'weekly'

  const onCell = (cell: Cell) => {
    if (readonly) return
    const isRecord = cell.occurrence && (cell.isPast || cell.isToday)
    if (isRecord) onToggle?.(cell.occurrence.id)
    else if (cell.state === 'skipped') onUpdateItem?.(routine.id, { cadence_skips: toggleSkip(routine, cell.iso) })
    else onUpdateItem?.(routine.id, { cadence_days: toggleDay(routine, cell.offset) })
  }

  const setTarget = (n: number) => {
    const days = cadenceDays(routine).length
    // Never below the committed days: the target is what the routine ASKS FOR, and
    // asking for less than you already committed to would silently mean nothing.
    // Clearing the surplus is done by un-committing days, not by the stepper.
    onUpdateItem?.(routine.id, { cadence_count: Math.max(days, Math.min(21, n)) })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap', ['--jk-tint' as string]: tint }}>
      {/* The seven cells, with their weekday letters under them. */}
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {cells.map((cell) => (
            <DayCell key={cell.iso} cell={cell} tint={tint} readonly={readonly} onClick={() => onCell(cell)} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {days.map((iso, i) => {
            const isToday = iso === today
            return (
              <span key={iso} style={{ width: 34, textAlign: 'center' }}>
                {/* Today is named by LIGHT, not pigment (DESIGN doctrine): the letter
                    brightens and takes the accent rather than the cell being filled
                    with a mid-tone tint that would flatten the states above it. */}
                <span className="mono-eyebrow" style={{
                  fontSize: 8,
                  color: isToday ? 'var(--color-accent)' : 'var(--color-faint)',
                  textShadow: isToday ? 'var(--accent-halo-text)' : undefined,
                }}>
                  {DOW[i]}
                </span>
              </span>
            )
          })}
        </div>
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
            onChange={(e) => onUpdateItem?.(routine.id, { scheduled_time: e.target.value || null })}
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
          size="sm"
          value={routine.parent_id ?? ''}
          disabled={readonly}
          onChange={(e) => onUpdateItem?.(routine.id, { parent_id: e.target.value === '' ? null : Number(e.target.value) })}
          wrapperStyle={{ maxWidth: 220 }}
          style={{ letterSpacing: '0.08em', textTransform: 'uppercase', color: goal ? undefined : 'var(--color-faint)' }}
        >
          <option value="">no goal</option>
          {goals?.map((g: any) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </SelectField>
        {offGrid && (
          <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
            {describeCadence(cadence).toUpperCase()}
          </span>
        )}
        {!readonly && (
          <div style={{ display: 'flex', gap: 6 }}>
            <TButton
              quiet
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
  const common: React.CSSProperties = {
    width: 34, height: 34, display: 'grid', placeItems: 'center',
    cursor: readonly ? 'default' : 'pointer',
    fontFamily: MONO, fontSize: 12,
  }
  const title = {
    done: 'Kept — click to un-tick',
    open: 'Today — click to tick',
    missed: 'Missed — click to tick it anyway',
    planned: 'Planned — click to drop this weekday',
    idle: 'Committed, nothing scheduled here',
    skipped: 'Struck out — click to put this session back',
    off: 'Click to commit this weekday, every week',
  }[cell.state]

  if (cell.state === 'off' || cell.state === 'idle' || cell.state === 'skipped') {
    /* The struck-out cell is the one empty cell that is a DECISION, so it is drawn
       as a struck mark and not as a dashed absence: solid hairline (the decision
       is made), the routine's own tint (it is still this routine's day), and the
       strike itself for what happened to it. */
    const skipped = cell.state === 'skipped'
    return (
      <div
        className="jk-hit"
        title={title}
        onClick={readonly ? undefined : onClick}
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
      className="jk-hit"
      title={title}
      solid={cell.state === 'done' || cell.state === 'open'}
      live={cell.state === 'open'}
      done={cell.state === 'done'}
      spent={cell.state === 'missed'}
      tint={tint}
      onClick={readonly ? undefined : onClick}
      style={common}
    >
      {cell.state === 'done' ? '✓' : cell.state === 'missed' ? '×' : ''}
    </Chip>
  )
}

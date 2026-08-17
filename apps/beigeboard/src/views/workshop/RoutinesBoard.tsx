/**
 * RoutinesBoard — the Workshop's second badge: the cadence board.
 *
 * The Forge breaks a GOAL into a finite tree of one-off tasks. A routine is the
 * other half of planning and does not fit that shape at all: it has no finish
 * line, no rollup, and it is never "done" — it is a commitment to a rhythm.
 * So it gets its own board rather than another node type in the tree.
 *
 * WHAT THE GRID IS. One ROW per routine, seven columns for the week. The columns
 * are the axis a habit is actually judged on — did it happen this many times —
 * which is why this is a lane board and not another hour grid: the time of day is
 * a detail of the routine (it rides the row's meta line), the FREQUENCY is the
 * subject. Each cell is one occurrence.
 *
 * ONE CLICK, TWO MEANINGS, AND THE RULE THAT KEEPS THEM APART. A cell is either a
 * RECORD or a PLAN, and which one it is follows from the cell itself:
 *
 *   · a cell with an occurrence, today or in the past → THE RECORD. Clicking ticks
 *     it (or un-ticks it). This is the back-fill every habit tracker needs.
 *   · anything else → THE PLAN. Clicking commits or un-commits that WEEKDAY in the
 *     cadence, which repeats every week — so it also adds/removes the matching
 *     cells in every future week, not just the one on screen.
 *
 * The split is not a mode the user has to hold in their head: you cannot tick a
 * day that has nothing on it, and you cannot re-plan a day that has already
 * happened, so at any given cell exactly one of the two is meaningful. The header
 * says both in one line anyway.
 *
 * Occurrences are ordinary tasks (backend/src/routines.js mints them), so
 * everything else about them already works: they appear on Today and Week, they
 * drag, they carry the routine's accent, and ticking one here is the same write as
 * ticking it there.
 */
import React, { useMemo, useState } from 'react'
import { FONT_HEAD, localDate } from '../../lib/theme'
import {
  getRoutines, cadenceDays, weeklyTarget, floatCount, weekCells, floatsOf,
  occurrencesOf, attainment, streakOf, toggleDay, addDays, weekStart,
  type Cell,
} from '../../lib/routines'
import { normalizeSpec, summarize, metricOf, parseCadence, describeCadence } from '../../lib/routine-spec'
import { RoutineForge } from './RoutineForge'
import { Press, Bubble, Chip, TButton, Rule, Bar } from '@jkos/ui'
import { stagger } from '@jkos/design'

const MONO = 'var(--hub-font-mono)'
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/* Name column · seven day cells · the meters. Declared once and spent on both the
   column head and every row, because a head that can drift out of alignment with
   the cells it labels is the one bug a board like this must not have.
   The SLACK GOES TO THE WEEK, not to the name: the days are the subject, so they
   take `1fr` each and the name column is capped. Given the slack instead, the name
   stretched to half the page and stranded the seven cells against the right edge
   as an unreadable strip. */
const GRID = 'minmax(215px, 290px) repeat(7, minmax(44px, 1fr)) 178px'
const GAP = 6

export function RoutinesBoard({
  items, today, readonly, api, onSelect, onToggle, onAddItem, onUpdateItem, onDelete,
}: any) {
  const [cursor, setCursor] = useState(() => weekStart(today))
  /* The forge replaces this board rather than floating over it. A full pane, not an
     overlay: the .jk-panel overlay primitive has cost this app two silent
     "clicking does nothing" bugs, and a document editor is somewhere you GO, not
     something you peek at over the thing it belongs to. */
  const [forgeId, setForgeId] = useState<number | null>(null)
  const routines = useMemo(() => getRoutines(items), [items])
  const goals = useMemo(() => items.filter((it: any) => it.kind === 'goal'), [items])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(cursor, i)), [cursor])
  const range = useMemo(() => {
    const a = localDate(days[0]); const b = localDate(days[6])
    const f = (d: Date, withMonth: boolean) =>
      withMonth ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : String(d.getDate())
    return a.getMonth() === b.getMonth()
      ? `${f(a, true)} – ${f(b, false)}`
      : `${f(a, true)} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }, [days])

  const addRoutine = async () => {
    if (readonly) return
    await onAddItem?.({
      kind: 'routine', scope: 'week', status: 'active', source: 'bb',
      title: 'New routine', cadence_days: '', position: routines.length,
    })
  }

  /* THE one write of the cadence encoding — see toggleDay in lib/routines. */
  const commitDay = (routine: any, offset: number) => {
    if (readonly) return
    onUpdateItem?.(routine.id, { cadence_days: toggleDay(routine, offset) })
  }

  const kept = routines.filter((r: any) => (r.status || 'active') === 'active').length

  const forging = forgeId === null ? null : routines.find((r: any) => r.id === forgeId) || null
  if (forging) {
    return (
      <RoutineForge
        routine={forging}
        items={items}
        today={today}
        api={api}
        readonly={readonly}
        onUpdateItem={onUpdateItem}
        onClose={() => setForgeId(null)}
      />
    )
  }

  return (
    // `flex: 1` — a flex child of the badge switcher in WorkshopView (see the
    // matching note on the goals board).
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Head ── */}
      <div className="mo-item" style={{ flex: 'none', padding: '16px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE CADENCE</span>
          <span className="mono-eyebrow">
            TICK WHAT YOU DID · CLICK AN EMPTY SLOT TO COMMIT THAT WEEKDAY, EVERY WEEK
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 12 }}>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '1.85rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
            {range}
          </span>
          <span className="mono-eyebrow" style={{ marginBottom: 5 }}>
            {String(kept).padStart(2, '0')} ACTIVE · {String(routines.length - kept).padStart(2, '0')} PARKED
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <TButton quiet onClick={() => setCursor((c) => addDays(c, -7))}>← Prev</TButton>
            <TButton onClick={() => setCursor(weekStart(today))}>This week</TButton>
            <TButton quiet onClick={() => setCursor((c) => addDays(c, 7))}>Next →</TButton>
          </div>
        </div>
      </div>
      <Rule style={{ margin: '4px 28px 0' }} />

      <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '14px 28px 20px', overflowY: 'auto' }}>
        {/* ── Column head ── */}
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: GAP, alignItems: 'end', marginBottom: 8 }}>
          <span className="mono-eyebrow">ROUTINE</span>
          {days.map((iso, i) => {
            const isToday = iso === today
            return (
              <div key={iso} style={{ textAlign: 'center' }}>
                {/* Today is named by LIGHT, not pigment (DESIGN doctrine): the
                    column head brightens and takes the accent rather than being
                    filled with a mid-tone tint that would flatten the cells. */}
                <div className="jk-lab jk-lab-xs" style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-muted)', textShadow: isToday ? 'var(--accent-halo-text)' : undefined }}>
                  {DOW[i]}
                </div>
                <div className="seg" style={{ fontSize: 12, color: isToday ? 'var(--color-ink)' : 'var(--color-faint)' }}>
                  {localDate(iso).getDate()}
                </div>
              </div>
            )
          })}
          <span className="mono-eyebrow" style={{ textAlign: 'right' }}>KEPT · STREAK</span>
        </div>

        {routines.map((r: any, i: number) => (
          <RoutineRow
            key={r.id}
            routine={r}
            items={items}
            goals={goals}
            wkStart={cursor}
            today={today}
            readonly={readonly}
            delay={stagger(i, 90, 60)}
            onSelect={onSelect}
            onToggle={onToggle}
            onUpdateItem={onUpdateItem}
            onDelete={onDelete}
            onForge={() => setForgeId(r.id)}
            onCommitDay={(off: number) => commitDay(r, off)}
          />
        ))}

        {!readonly && (
          <TButton quiet onClick={addRoutine} style={{ padding: 11, borderStyle: 'dashed', marginTop: 10, cursor: 'pointer' }}>
            + New routine
          </TButton>
        )}
      </div>
    </div>
  )
}

/* ── One routine ────────────────────────────────────────────────────────── */

function RoutineRow({
  routine, items, goals, wkStart, today, readonly, delay,
  onSelect, onToggle, onUpdateItem, onDelete, onForge, onCommitDay,
}: any) {
  const tint = routine.accent || 'var(--color-accent)'
  const parked = (routine.status || 'active') !== 'active'
  const cells = useMemo(() => weekCells(routine, items, wkStart, today), [routine, items, wkStart, today])
  const meter = useMemo(() => attainment(routine, items, wkStart), [routine, items, wkStart])
  const streak = useMemo(() => streakOf(routine, items, today), [routine, items, today])
  const floats = useMemo(() => floatsOf(routine, items, wkStart), [routine, items, wkStart])
  const goal = goals.find((g: any) => g.id === routine.parent_id) || null
  const target = weeklyTarget(routine)
  /* The document in one line. A routine with steps says what it is made of; one
     without says so plainly, because "this routine has no content yet" is the
     single most useful thing the board can tell you about it. */
  const spec = useMemo(() => normalizeSpec(routine.spec), [routine.spec])
  const summary = useMemo(() => summarize(spec), [spec])
  /* The cadence in words. It used to be readable straight off the seven cells; with
     every_n_days / monthly / rolling / RRULE in the vocabulary the cells can no
     longer tell the whole truth, so the row says it. */
  const cadence = useMemo(() => parseCadence(routine.cadence_rule), [routine.cadence_rule])
  const offGrid = cadence.type !== 'weekly'
  /* What this routine contributes to its goal — a MEASUREMENT, never a percentage,
     because a routine has no total to be a fraction of. */
  const metric = useMemo(
    () => metricOf(spec, occurrencesOf(routine, items), today),
    [spec, routine, items, today],
  )

  /* The record/plan split — see the note at the top of the file. */
  const onCell = (cell: Cell) => {
    if (readonly) return
    const isRecord = cell.occurrence && (cell.isPast || cell.isToday)
    if (isRecord) onToggle?.(cell.occurrence.id)
    else onCommitDay(cell.offset)
  }

  const setTarget = (n: number) => {
    const days = cadenceDays(routine).length
    // Never below the committed days: the target is what the routine ASKS FOR, and
    // asking for less than you already committed to would silently mean nothing.
    // Clearing the surplus is done by un-committing days, not by the stepper.
    const next = Math.max(days, Math.min(21, n))
    onUpdateItem?.(routine.id, { cadence_count: next })
  }

  return (
    <div
      className="mo-item"
      style={{
        display: 'grid', gridTemplateColumns: GRID, gap: GAP, alignItems: 'center',
        padding: '9px 12px', marginBottom: 7,
        border: '1px solid var(--hub-line)', borderRadius: 'var(--hub-radius-sm)',
        background: 'var(--hub-bg-3)',
        opacity: parked ? 0.55 : 1,
        animationDelay: delay,
        ['--jk-tint' as string]: tint,
      }}
    >
      {/* Name + meta */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: tint, flex: 'none', alignSelf: 'center' }} />
          <Press
            variant="ink"
            onClick={() => onSelect?.(routine)}
            style={{
              fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.01em',
              cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {routine.title}
          </Press>
          {parked && <Bubble tone="secondary" style={{ fontSize: 8, padding: '2px 7px' }}>PARKED</Bubble>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="time"
            value={routine.scheduled_time || ''}
            disabled={readonly}
            onChange={(e) => onUpdateItem?.(routine.id, { scheduled_time: e.target.value || null })}
            style={{
              fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: 'var(--color-muted)',
              background: 'transparent', border: '1px solid var(--color-line)', borderRadius: 3,
              padding: '2px 5px', outline: 'none',
            }}
          />
          {/* The weekly target. Above the committed days it becomes FLOAT — the
              engine benches the surplus for the week so "3× a week, any days" is
              plannable without a second mechanism. */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <TButton quiet disabled={readonly} onClick={() => setTarget(target - 1)} style={{ padding: '1px 6px', cursor: 'pointer' }}>−</TButton>
            <span className="mono-eyebrow" style={{ minWidth: 42, textAlign: 'center' }}>{target}×/WK</span>
            <TButton quiet disabled={readonly} onClick={() => setTarget(target + 1)} style={{ padding: '1px 6px', cursor: 'pointer' }}>+</TButton>
          </span>
          {floatCount(routine) > 0 && (
            <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
              {floats.filter((f: any) => !f.completed).length} ON THE BENCH
            </span>
          )}
          <select
            value={routine.parent_id ?? ''}
            disabled={readonly}
            onChange={(e) => onUpdateItem?.(routine.id, { parent_id: e.target.value === '' ? null : Number(e.target.value) })}
            style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: goal ? 'var(--color-ink)' : 'var(--color-faint)',
              background: 'transparent', border: '1px solid var(--color-line)', borderRadius: 3,
              padding: '2px 4px', maxWidth: 150, outline: 'none',
            }}
          >
            <option value="">no goal</option>
            {goals.map((g: any) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        {/* The document, and the way in to it. A routine with no steps is a title on
            a schedule — the one thing worth saying about it is that it has nothing
            in it yet, so the empty state is the prompt. */}
        {offGrid && (
          <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
            {describeCadence(cadence).toUpperCase()}
          </span>
        )}
        <Press
          variant="ink"
          className="jk-hit"
          onClick={() => onForge?.()}
          title="Open the forge — what the session is, and how it gets harder"
          style={{
            fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: summary ? 'var(--color-muted)' : 'var(--color-accent)',
            cursor: 'pointer', textAlign: 'left',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {summary || '+ give it steps'}
        </Press>
      </div>

      {/* The seven cells */}
      {cells.map((cell) => (
        <DayCell key={cell.iso} cell={cell} tint={tint} readonly={readonly} onClick={() => onCell(cell)} />
      ))}

      {/* Meters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="seg" style={{ fontSize: 14 }}>{meter.done}/{meter.target}</span>
          <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>
            {streak > 0 ? `${streak} IN A ROW` : 'NO STREAK'}
          </span>
        </div>
        <Bar value={meter.target ? meter.done / meter.target : 0} tint={tint} height={5} radius={3} />
        {metric && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} title={`Toward this routine's goal, this ${metric.window}`}>
            <span className="mono-eyebrow" style={{ color: 'var(--color-accent)' }}>
              {metric.value}/{metric.target} {metric.unit.toUpperCase()}
            </span>
            <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>{metric.pct}%</span>
          </div>
        )}
        {!readonly && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
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
    height: 34, display: 'grid', placeItems: 'center',
    cursor: readonly ? 'default' : 'pointer',
    fontFamily: MONO, fontSize: 12,
  }
  const title = {
    done: 'Kept — click to un-tick',
    open: 'Today — click to tick',
    missed: 'Missed — click to tick it anyway',
    planned: 'Planned — click to drop this weekday',
    idle: 'Committed, nothing scheduled here',
    off: 'Click to commit this weekday, every week',
  }[cell.state]

  if (cell.state === 'off' || cell.state === 'idle') {
    return (
      <div
        className="jk-hit"
        title={title}
        onClick={readonly ? undefined : onClick}
        style={{
          ...common,
          borderRadius: 'var(--hub-radius-xs)',
          border: `1px dashed ${cell.state === 'idle' ? 'color-mix(in srgb, var(--jk-tint) 55%, transparent)' : 'var(--color-line)'}`,
          color: 'var(--color-faint)',
          /* Today is marked by LIGHT, not pigment — the brightest stock, never a
             mid-tone tint (DESIGN doctrine). Held to a WASH of it rather than the
             full stock: at full strength an empty cell on today read as a filled
             one, and `filled` is the vocabulary the occurrence states own. */
          background: cell.isToday ? 'color-mix(in srgb, var(--hub-bg-4) 62%, transparent)' : 'transparent',
          opacity: cell.isPast ? 0.5 : 1,
        }}
      >
        {cell.state === 'idle' ? '·' : ''}
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

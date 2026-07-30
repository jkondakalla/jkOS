/**
 * TodayView — the prototype's Today (Full Press rebuild).
 *
 * Left pane: the single-day timeline, composed straight from the @jkos/cards
 * DayView (grid mode) with BeigeBoard's DragProvider adapter + accent/source
 * resolvers — so the timeline, now-line, drag-to-create and framed lane are the
 * same kit chrome the Week/Calendar tabs ride. No bespoke timeline here.
 *
 * Right rail (--jk-rail): two jk-sheet cards — "The bench" (tasks committed to
 * this week with no day yet) and "Goals in press" (mini goal rollups). The
 * carried / adrift / next planning intelligence is GONE (Full Press Wave 0 #2 —
 * the pipeline that fits the forge gets designed later; a seam for it is marked
 * below).
 *
 * Both panes sit INSIDE the page canvas (App.tsx's .jk-canvas) — see DESIGN.md
 * §6, "The canvas". There is no page foot: the colophon that used to close the
 * measure is gone (it read as a distraction below the day rather than as an
 * anchor under it), and the canvas keeps the bottom margin itself.
 */
import React, { useMemo } from 'react'
import { Calendar } from '@jkos/cards'
import { Sheet, Chip, Press, Check, Bar } from '@jkos/ui'
import { MO_DELAYS } from '@jkos/design'
import { FONT_HEAD, weekStart, sourceOf, sourceTintOf, localDate } from '../lib/theme'
import { getAccent, getProgress, getLooseTasks } from '../lib/seed'
import { useDrag } from '../providers/DragProvider'

export function TodayView(props: any) {
  const { items, today, onSelect, onToggle, selectedId, readonly, setView } = props
  const dnd = useDrag()
  const weekIso = weekStart(today)

  const resolvers = {
    accentOf: (it: any) => getAccent(it, items),
    sourceColorOf: sourceTintOf,
  }

  // The bench: tasks committed to THIS week (week_start = this Monday) with no day
  // assigned yet. Open ones first; completed ones linger struck-through so a just-
  // ticked task doesn't vanish out from under the pointer.
  const bench = useMemo(
    () =>
      items
        .filter((it: any) => it.kind === 'task' && it.week_start === weekIso && !it.due_date)
        .sort((a: any, b: any) => Number(a.completed) - Number(b.completed)),
    [items, weekIso],
  )
  const benchDone = bench.filter((t: any) => t.completed).length

  // Goals in press: the active goals, with leaf-rollup progress.
  const goals = useMemo(
    () =>
      items
        .filter((it: any) => it.kind === 'goal' && (it.status || 'active') === 'active')
        .slice(0, 3),
    [items],
  )

  // Loose leaves: every task filed under no goal. See getLooseTasks — undated,
  // unbenched loose tasks had no screen at all before this section existed, so
  // this deliberately lists ALL of them (not just the invisible ones): the value
  // is one place that answers "what isn't filed?", and a row that also appears on
  // the timeline says its own whereabouts in its state chip.
  const loose = useMemo(() => getLooseTasks(items), [items])
  const looseOpen = loose.filter((t: any) => !t.completed).length

  return (
    // Still a column around the two-pane row, even now that the foot it was
    // wrapped for is gone: it is the seam anything spanning BOTH panes hangs on
    // (the colophon will want re-siting, and a planning strip is specced), and
    // collapsing it would make that a layout change rather than one more child.
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* ── Left: the single-day timeline (kit DayView, grid mode) ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-line)', minHeight: 0 }}>
          <Calendar
            view="day"
            dayMode="grid"
            items={items}
            today={today}
            date={today}
            selectedId={selectedId}
            readonly={readonly}
            onSelect={onSelect}
            onToggle={onToggle}
            onAddItem={props.onAddItem}
            onUpdateItem={props.onUpdateItem}
            drag={dnd}
            createSource="bb"
            resolvers={resolvers}
          />
        </div>

        {/* ── Right rail: the sheet ── */}
        <aside
          className="jk-scroll"
          // --jk-rail, not a bespoke 388: one rail weight across the suite (Today's
          // sheet, Workshop's goals), and the touch tiers retune it in one place.
          // The rail is a pane INSIDE the canvas now, so its right edge is the
          // sheet's edge rather than the window's.
          style={{ width: 'var(--jk-rail)', flex: 'none', display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 22px', minHeight: 0, overflowY: 'auto' }}
        >
          {/* The bench */}
          <Sheet className="mo-item" style={{ borderRadius: 'var(--hub-radius)', padding: '16px 18px', display: 'flex', flexDirection: 'column', minHeight: 0, animationDelay: `${MO_DELAYS.railFirst}ms` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span className="jk-lab jk-lab-sm" style={{ color: 'var(--color-accent)' }}>The bench</span>
              <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>
                {bench.length === 0 ? 'EMPTY' : `${benchDone} OF ${bench.length} DONE`}
              </span>
            </div>
            {/* NOTE (Full Press Wave 0 #2): a new planning pipeline will feed this rail
                (what belongs on the bench this week). Until then it reads the raw
                week_start / no-day commit. Hook the pipeline in here. */}
            {bench.length === 0 ? (
              <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-faint)', margin: '4px 0 0', lineHeight: 1.4 }}>
                Nothing benched for the week. Park a task here from the workshop.
              </p>
            ) : (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 4 }}>
                {bench.map((t: any) => {
                  const tint = getAccent(t, items) || 'var(--color-accent)'
                  return (
                    <Chip
                      key={t.id}
                      solid={false}
                      done={t.completed}
                      tint={tint}
                      onClick={() => onSelect?.(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', flex: 'none', cursor: 'pointer' }}
                    >
                      <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                        <Check
                          checked={!!t.completed}
                          onChange={readonly ? undefined : () => onToggle?.(t.id, !t.completed)}
                          tint={tint}
                          style={{ fontSize: 11 }}
                        />
                      </span>
                      <Press
                        variant="ink"
                        style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 13, color: t.completed ? 'var(--color-faint)' : 'var(--color-ink)', textDecoration: t.completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {t.title}
                      </Press>
                      {t.source && t.source !== 'bb' && (
                        <span className="mono-eyebrow" style={{ marginLeft: 'auto', flex: 'none', fontSize: 8 }}>{sourceOf(t.source).label}</span>
                      )}
                    </Chip>
                  )
                })}
              </div>
            )}
          </Sheet>

          {/* Goals in press */}
          <Sheet className="mo-item" style={{ borderRadius: 'var(--hub-radius)', padding: '16px 18px', animationDelay: `${MO_DELAYS.railSecond}ms` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <span className="jk-lab jk-lab-sm" style={{ color: 'var(--color-accent)' }}>Goals in press</span>
              <button
                className="jk-hit mono-eyebrow"
                onClick={() => setView?.('tasks')}
                style={{ marginLeft: 'auto', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, background: 'transparent', border: 'none' }}
              >
                WORKSHOP →
              </button>
            </div>
            {goals.length === 0 ? (
              <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-faint)', margin: 0, lineHeight: 1.4 }}>
                No goals in the press yet. Forge one in the workshop.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                {goals.map((g: any) => {
                  const prog = getProgress(g, items)
                  const tint = g.accent || 'var(--color-accent)'
                  const meta = [g.target_date ? `DUE ${fmtTarget(g.target_date)}` : 'ONGOING', g.category]
                    .filter(Boolean)
                    .join(' · ')
                    .toUpperCase()
                  return (
                    <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>{g.title}</span>
                        <span className="seg" style={{ marginLeft: 'auto', fontSize: 14 }}>{prog.pct}%</span>
                      </div>
                      <Bar value={prog.pct / 100} tint={tint} height={5} radius={3} />
                      <span className="mono-eyebrow">{meta || `${prog.done}/${prog.total} LEAVES`}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Sheet>

          {/* Loose leaves — the unfiled pile. A "leaf" is already this app's word
              for a terminal task in a goal's breakdown; a LOOSE leaf is the print
              term for a sheet that was never bound into a signature, which is
              exactly what these are. The section stays mounted when empty: an
              empty inbox is information (nothing is adrift), and a section that
              only exists when something is wrong can't be checked. */}
          <Sheet className="mo-item" style={{ borderRadius: 'var(--hub-radius)', padding: '16px 18px', animationDelay: `${MO_DELAYS.railSecond + 60}ms` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span className="jk-lab jk-lab-sm" style={{ color: 'var(--color-accent)' }}>Loose leaves</span>
              <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>
                {loose.length === 0 ? 'ALL FILED' : `${String(looseOpen).padStart(2, '0')} UNFILED`}
              </span>
            </div>
            {loose.length === 0 ? (
              <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-faint)', margin: 0, lineHeight: 1.4 }}>
                Every task is filed under a goal. Nothing loose.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {loose.map((t: any) => {
                  const tint = getAccent(t, items) || 'var(--color-accent)'
                  const state = looseState(t, today)
                  return (
                    <Chip
                      key={t.id}
                      solid={false}
                      done={t.completed}
                      tint={tint}
                      onClick={() => onSelect?.(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', flex: 'none', cursor: 'pointer' }}
                    >
                      <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                        <Check
                          checked={!!t.completed}
                          onChange={readonly ? undefined : () => onToggle?.(t.id, !t.completed)}
                          tint={tint}
                          style={{ fontSize: 11 }}
                        />
                      </span>
                      <Press
                        variant="ink"
                        style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 13, color: t.completed ? 'var(--color-faint)' : 'var(--color-ink)', textDecoration: t.completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {t.title}
                      </Press>
                      {/* Where the row already lives, so a task that IS on the
                          timeline doesn't read as a duplicate. Overdue is the one
                          state that takes accent — it's the only one that's a
                          problem rather than a location. */}
                      <span
                        className="mono-eyebrow"
                        style={{ marginLeft: 'auto', flex: 'none', fontSize: 8, color: state.urgent ? 'var(--color-accent)' : undefined }}
                      >{state.label}</span>
                    </Chip>
                  )
                })}
              </div>
            )}
          </Sheet>

        </aside>
      </div>

    </div>
  )
}

/** Where a loose task currently sits, as one annotation. `urgent` marks the one
 *  state that is a problem rather than a place, so only that one spends accent. */
function looseState(t: any, today: string): { label: string; urgent: boolean } {
  if (t.completed) return { label: 'DONE', urgent: false }
  if (t.due_date) {
    if (t.due_date < today) return { label: 'OVERDUE', urgent: true }
    if (t.due_date === today) return { label: 'TODAY', urgent: false }
    return { label: fmtTarget(t.due_date).toUpperCase(), urgent: false }
  }
  if (t.week_start) return { label: 'BENCHED', urgent: false }
  return { label: 'NO DATE', urgent: false }
}

function fmtTarget(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

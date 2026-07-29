/**
 * TodayView — the prototype's Today (Full Press rebuild).
 *
 * Left pane: the single-day timeline, composed straight from the @jkos/cards
 * DayView (grid mode) with BeigeBoard's DragProvider adapter + accent/source
 * resolvers — so the timeline, now-line, drag-to-create and framed lane are the
 * same kit chrome the Week/Calendar tabs ride. No bespoke timeline here.
 *
 * Right rail (388px): two jk-sheet cards — "The bench" (tasks committed to this
 * week with no day yet) and "Goals in press" (mini goal rollups) — capped by a
 * jk-colophon. The carried / adrift / next planning intelligence is GONE (Full
 * Press Wave 0 #2 — the pipeline that fits the forge gets designed later; a seam
 * for it is marked below).
 */
import React, { useMemo } from 'react'
import { Calendar } from '@jkos/cards'
import { Sheet, Colophon, Chip, Press, Check, Bar } from '@jkos/ui'
import { MO_DELAYS } from '@jkos/design'
import { FONT_HEAD, weekStart, sourceOf } from '../lib/theme'
import { getAccent, getProgress } from '../lib/seed'
import { useDrag } from '../providers/DragProvider'

export function TodayView(props: any) {
  const { items, today, onSelect, onToggle, selectedId, readonly, setView } = props
  const dnd = useDrag()
  const weekIso = weekStart(today)

  const resolvers = {
    accentOf: (it: any) => getAccent(it, items),
    sourceColorOf: (s?: string) => sourceOf(s ?? '').hex,
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

  return (
    <div style={{ height: '100%', display: 'flex', minHeight: 0 }}>
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
        style={{ width: 388, flex: 'none', display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 22px', minHeight: 0, overflowY: 'auto' }}
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

        <Colophon className="mo-item" style={{ marginTop: 'auto', fontSize: '0.82rem', animationDelay: `${MO_DELAYS.railColophon}ms` }}>the sheet holds what the day forgot</Colophon>
      </aside>
    </div>
  )
}

function fmtTarget(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

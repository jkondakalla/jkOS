import React, { useState, useEffect, useRef, useMemo } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, isoDate, addDays, fmtTime, halate, sourceOf } from '../lib/theme'
import { useDrag } from '../providers/DragProvider'
import { getAccent } from '../lib/seed'
import { Eyebrow, Checkbox } from '../components/SharedComponents'

const DOW       = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CV_BAR_H  = 20
const CV_BAR_GAP = 2
const CV_DAY_NUM = 24

function layoutBars(events: any[], weekDays: string[]) {
  const wStart = weekDays[0], wEnd = weekDays[weekDays.length - 1]
  const bars = events
    .filter(ev => { const evEnd = ev.end_date || ev.due_date; return ev.due_date <= wEnd && evEnd >= wStart })
    .map(ev => {
      const evEnd = ev.end_date || ev.due_date
      const sc = ev.due_date < wStart ? 0 : Math.max(0, weekDays.indexOf(ev.due_date))
      let ec = weekDays.length - 1
      if (evEnd <= wEnd) { for (let i = weekDays.length - 1; i >= 0; i--) { if (weekDays[i] <= evEnd) { ec = i; break } } }
      return { ev, startCol: sc, endCol: ec, continuesLeft: ev.due_date < wStart, continuesRight: evEnd > wEnd }
    })
    .sort((a, b) => a.startCol !== b.startCol ? a.startCol - b.startCol : (b.endCol - b.startCol) - (a.endCol - a.startCol))

  const laneEnds: number[] = []
  for (const bar of bars as any[]) {
    let lane = laneEnds.findIndex(end => end < bar.startCol)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(-Infinity) }
    laneEnds[lane] = bar.endCol
    bar.lane = lane
  }
  return bars
}

function monthStart(iso: string) { const d = localDate(iso); return isoDate(new Date(d.getFullYear(), d.getMonth(), 1)) }
function monthEnd(iso: string)   { const d = localDate(iso); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
function addMonths(iso: string, n: number) { const d = localDate(iso); return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1)) }
function monthLabel(iso: string) { return localDate(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

function buildGrid(iso: string) {
  const ms     = monthStart(iso)
  const startD = localDate(ms)
  const dow0   = (startD.getDay() + 6) % 7
  const grid: { iso: string; inMonth: boolean }[] = []
  const d = new Date(startD)
  d.setDate(d.getDate() - dow0)
  for (let i = 0; i < 42; i++) {
    grid.push({ iso: isoDate(d), inMonth: d.getMonth() === startD.getMonth() })
    d.setDate(d.getDate() + 1)
  }
  return grid
}

export function CalendarView({ items, today, onSelect, onToggle, onUpdateItem, onAddItem, selectedId, onWeekJump }: any) {
  const { drag, beginDrag } = useDrag()

  const [cursor,   setCursor]   = useState(() => monthStart(today))
  const [quickAdd, setQuickAdd] = useState<string | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (quickAdd && quickRef.current) quickRef.current.focus() }, [quickAdd])

  const grid = useMemo(() => buildGrid(cursor), [cursor])

  const alldayEvents = useMemo(() => items.filter((it: any) => it.kind === 'event' && !it.scheduled_time), [items])

  const byDay = useMemo(() => {
    const out: Record<string, any[]> = {}
    items.forEach((it: any) => {
      if (it.kind !== 'task' && it.kind !== 'event') return
      if (it.kind === 'event' && !it.scheduled_time) return
      const key = it.due_date || '__none__'
      if (!out[key]) out[key] = []
      out[key].push(it)
    })
    return out
  }, [items])

  const unscheduled = byDay['__none__'] || []

  const beginDragChip = (e: React.MouseEvent, item: any) => {
    e.preventDefault()
    if (drag) return
    beginDrag(item, 'cell', ({ overDay, overZone }: any) => {
      if (overZone === 'cell' && overDay && overDay !== item.due_date) {
        onUpdateItem(item.id, { due_date: overDay })
      }
    })
  }

  const beginDragBar = (e: React.MouseEvent, bar: any) => {
    e.preventDefault()
    e.stopPropagation()
    const ev = bar.ev
    beginDrag(ev, 'allday', ({ overDay, overZone }: any) => {
      if (overZone === 'cell' && overDay && overDay !== ev.due_date) {
        const delta = Math.round((new Date(overDay).getTime() - new Date(ev.due_date).getTime()) / 86400000)
        const updates: any = { due_date: addDays(ev.due_date, delta) }
        if (ev.end_date) updates.end_date = addDays(ev.end_date, delta)
        onUpdateItem(ev.id, updates)
      }
    })
  }

  const anyDrag = !!drag

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', background: 'var(--color-paper)' }}>

      <aside style={{
        width: 220, flexShrink: 0,
        borderRight: `1px solid var(--color-line)`,
        background: 'var(--color-paper-2)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid var(--color-line)` }}>
          <Eyebrow>Unscheduled · {unscheduled.length}</Eyebrow>
          <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)', margin: '4px 0 0', lineHeight: 1.35 }}>
            Drag onto a date to schedule
          </p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {unscheduled.length === 0 ? (
            <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-faint)', margin: '12px 4px' }}>
              Nothing left to place.
            </p>
          ) : unscheduled.map((it: any) => (
            <CalTaskChip
              key={it.id} item={it}
              accent={getAccent(it, items)}
              isDragging={(drag as any)?.item?.id === it.id}
              isSelected={selectedId === it.id}
              onSelect={onSelect} onToggle={onToggle}
              onMouseDown={(e: React.MouseEvent) => beginDragChip(e, it)}
            />
          ))}
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 24px 12px',
          borderBottom: `1px solid var(--color-line)`,
          background: 'var(--color-paper)', flexShrink: 0,
        }}>
          <h2 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 26, margin: 0, letterSpacing: '-0.02em', color: 'var(--color-ink)' }}>
            <em style={{ color: 'var(--color-accent)', fontStyle: 'italic', textShadow: '0 0 16px var(--color-accent-glow)' }}>
              {monthLabel(cursor)}
            </em>
          </h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setCursor(c => addMonths(c, -1))} style={navBtn(false)}>‹</button>
            <button onClick={() => setCursor(monthStart(today))}     style={navBtn(true)}>This month</button>
            <button onClick={() => setCursor(c => addMonths(c, 1))}  style={navBtn(false)}>›</button>
          </div>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          borderBottom: `1px solid var(--color-line)`, background: 'var(--color-paper-2)', flexShrink: 0,
        }}>
          {DOW.map(d => (
            <div key={d} style={{
              fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted)',
              padding: '6px 10px', borderRight: d !== 'Sun' ? `1px solid var(--color-line)` : 'none',
            }}>{d}</div>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {Array.from({ length: 6 }, (_, wi) => {
            const weekCells = grid.slice(wi * 7, (wi + 1) * 7)
            const weekDays  = weekCells.map(c => c.iso)
            const bars      = layoutBars(alldayEvents, weekDays) as any[]
            const barLanes  = bars.length > 0 ? Math.max(...bars.map((b: any) => b.lane)) + 1 : 0
            const barZoneH  = barLanes * (CV_BAR_H + CV_BAR_GAP) + (barLanes > 0 ? 6 : 0)

            return (
              <div key={wi} style={{
                flex: 1, position: 'relative',
                display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                borderBottom: wi < 5 ? `1px solid var(--color-line-strong)` : 'none',
                minHeight: 90 + barZoneH,
              }}>
                {barLanes > 0 && (
                  <div style={{
                    position: 'absolute', top: CV_DAY_NUM, left: 0, right: 0,
                    height: barZoneH, zIndex: 2,
                  }}>
                    {bars.map((bar: any) => {
                      const s = sourceOf(bar.ev.source)
                      const isDraggingThis = (drag as any)?.item?.id === bar.ev.id
                      return (
                        <div
                          key={bar.ev.id}
                          onMouseDown={e => beginDragBar(e, bar)}
                          onClick={e => { e.stopPropagation(); if (!drag) onSelect(bar.ev) }}
                          style={{
                            position: 'absolute',
                            left:  `calc(${(bar.startCol / 7) * 100}% + ${bar.continuesLeft  ? 0 : 2}px)`,
                            width: `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - ${bar.continuesLeft ? 0 : 2}px - ${bar.continuesRight ? 0 : 2}px)`,
                            top:    bar.lane * (CV_BAR_H + CV_BAR_GAP) + 2,
                            height: CV_BAR_H,
                            background: `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.09) 100%), ${s.hex}`,
                            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 6px rgba(0,0,0,0.35)`,
                            borderTopLeftRadius:  bar.continuesLeft  ? 0 : 2,
                            borderBottomLeftRadius: bar.continuesLeft ? 0 : 2,
                            borderTopRightRadius:  bar.continuesRight ? 0 : 2,
                            borderBottomRightRadius: bar.continuesRight ? 0 : 2,
                            display: 'flex', alignItems: 'center',
                            paddingLeft: bar.continuesLeft ? 4 : 6,
                            paddingRight: bar.continuesRight ? 0 : 6,
                            overflow: 'hidden',
                            cursor: 'grab',
                            opacity: isDraggingThis ? 0.35 : 1,
                            outline: selectedId === bar.ev.id ? `2px solid var(--color-accent)` : 'none',
                            outlineOffset: -2,
                            userSelect: 'none',
                            transition: 'opacity 0.1s',
                          }}
                        >
                          <span style={{
                            fontFamily: FONT_BODY, fontSize: 10, fontWeight: 500,
                            color: 'rgba(255,255,255,0.95)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                          }}>
                            {!bar.continuesLeft && bar.ev.title}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {weekCells.map((cell, ci) => {
                  const cellItems = byDay[cell.iso] || []
                  const isToday   = cell.iso === today
                  const isOver    = (drag as any)?.overZone === 'cell' && (drag as any)?.overDay === cell.iso
                  const isTarget  = anyDrag && cell.inMonth

                  return (
                    <div
                      key={cell.iso}
                      data-drop-zone="cell"
                      data-drop-day={cell.iso}
                      onClick={e => {
                        if (e.target === e.currentTarget && cell.inMonth && !anyDrag) {
                          setQuickAdd(cell.iso)
                        }
                      }}
                      style={{
                        borderRight: ci < 6 ? `1px solid var(--color-line-strong)` : 'none',
                        background: isOver
                          ? `var(--color-accent)18`
                          : isToday
                          ? `var(--color-accent-soft)55`
                          : !cell.inMonth
                          ? 'rgba(0,0,0,0.04)'
                          : 'var(--color-paper)',
                        outline: isOver
                          ? `1px dashed var(--color-accent)`
                          : isTarget
                          ? `1px dashed var(--color-accent-glow)`
                          : 'none',
                        outlineOffset: -1,
                        padding: `${CV_DAY_NUM + barZoneH + 2}px 6px 6px`,
                        cursor: anyDrag ? (cell.inMonth ? 'copy' : 'default') : cell.inMonth ? 'text' : 'default',
                        transition: 'background 0.08s',
                        userSelect: 'none',
                      }}
                    >
                      <div
                        onClick={e => { e.stopPropagation(); onWeekJump?.(cell.iso) }}
                        style={{
                          position: 'absolute',
                          top: 5, left: `calc(${(ci / 7) * 100}% + 6px)`,
                          fontFamily: FONT_NUM, fontSize: 14,
                          color: isToday ? 'var(--color-accent)' : !cell.inMonth ? 'var(--color-faint)' : 'var(--color-muted)',
                          fontStyle: isToday ? 'italic' : 'normal',
                          fontWeight: isToday ? 500 : 400,
                          textShadow: isToday ? '0 0 10px var(--color-accent-glow)' : 'none',
                          lineHeight: 1, cursor: 'pointer', zIndex: 3,
                        }}
                        title="Open in Week view"
                      >
                        {localDate(cell.iso).getDate()}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {cellItems.slice(0, 4).map((it: any) => (
                          <CalTaskChip
                            key={it.id} item={it}
                            accent={getAccent(it, items)}
                            isDragging={(drag as any)?.item?.id === it.id}
                            isSelected={selectedId === it.id}
                            onSelect={onSelect} onToggle={onToggle}
                            compact
                            onMouseDown={(e: React.MouseEvent) => beginDragChip(e, it)}
                          />
                        ))}
                        {cellItems.length > 4 && (
                          <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: 'var(--color-faint)', fontStyle: 'italic', paddingLeft: 4 }}>
                            +{cellItems.length - 4} more
                          </span>
                        )}
                        {quickAdd === cell.iso && (
                          <input
                            ref={quickRef}
                            placeholder="New task…"
                            onBlur={() => setQuickAdd(null)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                onAddItem({ kind: 'task', scope: 'day', due_date: cell.iso, title: (e.target as HTMLInputElement).value.trim() })
                                setQuickAdd(null)
                              }
                              if (e.key === 'Escape') setQuickAdd(null)
                            }}
                            style={{
                              background: 'transparent', border: `1px solid var(--color-accent)`,
                              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11,
                              color: 'var(--color-ink)', outline: 'none', padding: '2px 5px',
                              width: '100%', boxSizing: 'border-box',
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CalTaskChip({ item, accent: inherited, isDragging, isSelected, onSelect, onToggle, compact, onMouseDown }: any) {
  const accent = inherited || item.accent || 'var(--color-muted)'

  if (isDragging) {
    return (
      <div style={{
        height: compact ? 18 : 24,
        background: accent, borderRadius: 4,
        opacity: 0.28, userSelect: 'none', pointerEvents: 'none',
      }} />
    )
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelect(item) }}
      className="day-chip"
      style={{
        display: 'flex', alignItems: 'center', gap: compact ? 4 : 6,
        padding: compact ? '2px 5px 2px 4px' : '5px 8px 5px 6px',
        background: item.completed ? 'transparent' : `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.09) 100%), ${accent}`,
        boxShadow: item.completed ? 'none' : `inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 5px rgba(0,0,0,0.32)`,
        border: item.completed ? `1px solid var(--color-line-strong)` : 'none',
        color: item.completed ? 'var(--color-muted)' : 'rgba(255,255,255,0.93)',
        fontFamily: FONT_BODY, fontSize: compact ? 10 : 11.5,
        cursor: 'grab',
        outline: isSelected ? `1.5px solid var(--color-accent)` : 'none',
        outlineOffset: -1,
        userSelect: 'none', overflow: 'hidden',
      }}
    >
      <Checkbox
        id={item.id} completed={item.completed} onToggle={onToggle}
        color={item.completed ? 'var(--color-muted)' : 'rgba(255,255,255,0.7)'}
        size={compact ? 9 : 11}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: item.completed ? 'line-through' : 'none' }}>
        {item.title}
      </span>
      {!compact && item.scheduled_time && (
        <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 10, opacity: 0.75, flexShrink: 0 }}>
          {fmtTime(item.scheduled_time)}
        </span>
      )}
    </div>
  )
}

function navBtn(primary?: boolean) {
  return {
    background: primary ? 'var(--color-accent)' : 'transparent',
    border: `1px solid ${primary ? 'var(--color-accent)' : 'var(--color-line)'}`,
    color: primary ? 'var(--color-paper)' : 'var(--color-muted)',
    fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase' as const, padding: '6px 14px',
    cursor: 'pointer',
    boxShadow: primary ? `0 0 10px var(--color-accent-glow)` : 'none',
  }
}

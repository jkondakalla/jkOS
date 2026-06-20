import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  FONT_HEAD, FONT_BODY, FONT_NUM,
  localDate, isoDate, addDays, weekStart, fmtTime, fmtWeekday, fmtHourLabel, timeToFrac, sourceOf,
} from '../lib/theme'
import { useDrag, fracToTime, snapFrac } from '../providers/DragProvider'
import { Eyebrow } from '../components/SharedComponents'
import { Press, TButton } from '@jkos/ui'

const WV_FIRST_H = 6
const WV_LAST_H  = 22
const WV_ROW_H   = 48
const WV_LABEL_W = 60

function layoutBars(events: any[], weekDays: string[]) {
  const wkStart = weekDays[0]
  const weekEnd   = weekDays[weekDays.length - 1]
  const bars = events
    .filter(ev => {
      const evEnd = ev.end_date || ev.due_date
      return ev.due_date <= weekEnd && evEnd >= wkStart
    })
    .map(ev => {
      const evEnd = ev.end_date || ev.due_date
      const sc = ev.due_date < wkStart ? 0 : Math.max(0, weekDays.indexOf(ev.due_date))
      let ec = weekDays.length - 1
      if (evEnd <= weekEnd) {
        for (let i = weekDays.length - 1; i >= 0; i--) {
          if (weekDays[i] <= evEnd) { ec = i; break }
        }
      }
      return { ev, startCol: sc, endCol: ec,
               continuesLeft: ev.due_date < wkStart, continuesRight: evEnd > weekEnd }
    })
    .sort((a, b) => a.startCol !== b.startCol
      ? a.startCol - b.startCol
      : (b.endCol - b.startCol) - (a.endCol - a.startCol))

  const laneEnds: number[] = []
  for (const bar of bars as any[]) {
    let lane = laneEnds.findIndex(end => end < bar.startCol)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(-Infinity) }
    laneEnds[lane] = bar.endCol
    bar.lane = lane
  }
  return bars
}

function layoutTimedEvents(events: any[]) {
  if (!events.length) return []
  const items = events.map(ev => ({
    ev,
    start: timeToFrac(ev.scheduled_time),
    end: ev.scheduled_end ? timeToFrac(ev.scheduled_end) : timeToFrac(ev.scheduled_time) + 1,
    slot: 0,
  })).sort((a, b) => a.start !== b.start ? a.start - b.start : b.end - a.end)

  const slotEnds: number[] = []
  for (const it of items) {
    let s = slotEnds.findIndex(end => end <= it.start)
    if (s === -1) { s = slotEnds.length }
    slotEnds[s] = it.end
    it.slot = Math.min(s, 3)
  }

  return items.map(it => {
    const concurrent = items.filter(o => o.start < it.end && o.end > it.start)
    const groupCols  = Math.min(4, Math.max(...concurrent.map(o => o.slot)) + 1)
    return { ev: it.ev, slot: it.slot, totalCols: groupCols }
  })
}

export function WeekView({ items, today, onSelect, onToggle, onAddItem, onUpdateItem, selectedId, weekJumpDate, readonly }: any) {
  const { drag, beginDrag } = useDrag()

  const [cursor, setCursor] = useState(() => weekStart(today))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(cursor, i)), [cursor])

  useEffect(() => { if (weekJumpDate) setCursor(weekJumpDate) }, [weekJumpDate])

  const weekRange = useMemo(() => {
    const a = localDate(days[0]); const b = localDate(days[6])
    return a.getMonth() === b.getMonth()
      ? `${a.toLocaleDateString('en-US', { month: 'long' })} ${a.getDate()} – ${b.getDate()}`
      : `${a.toLocaleDateString('en-US', { month: 'short' })} ${a.getDate()} – ${b.toLocaleDateString('en-US', { month: 'short' })} ${b.getDate()}`
  }, [days])

  const byDay = useMemo(() => {
    const out: any = {}
    days.forEach(d => out[d] = { untimed: [], timed: [] })
    items.forEach((it: any) => {
      if (it.kind !== 'task' && it.kind !== 'event') return
      if (it.kind === 'event' && !it.scheduled_time) return
      if (!out[it.due_date]) return
      if (it.scheduled_time) out[it.due_date].timed.push(it)
      else out[it.due_date].untimed.push(it)
    })
    return out
  }, [items, days])

  const alldayBars = useMemo(() =>
    layoutBars(items.filter((it: any) => it.kind === 'event' && !it.scheduled_time), days),
  [items, days])
  const alldayLanes = alldayBars.length > 0
    ? Math.max(...(alldayBars as any[]).map(b => b.lane)) + 1 : 0

  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(i) }, [])
  const nowFrac = now.getHours() + now.getMinutes() / 60
  const todayCol = days.indexOf(today)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) {
      const target = days.includes(today) ? Math.max(WV_FIRST_H, nowFrac - 1) : 8
      scrollRef.current.scrollTop = (target - WV_FIRST_H) * WV_ROW_H
    }
  }, [cursor])

  const [createPending, setCreatePending] = useState<any>(null)
  const [hoverCol, setHoverCol] = useState<string | null>(null)

  const beginDragUntimed = (e: MouseEvent, item: any) => {
    e.preventDefault()
    beginDrag(item, 'untimed', ({ overDay, overFrac, overZone }: any) => {
      if (overZone === 'timed' && overFrac != null) {
        onUpdateItem(item.id, {
          due_date: overDay,
          scheduled_time: fracToTime(overFrac),
          scheduled_end:  fracToTime(overFrac + 1),
        })
      } else if (overZone === 'untimed' && overDay && overDay !== item.due_date) {
        onUpdateItem(item.id, { due_date: overDay })
      }
    })
  }

  const beginDragTimed = (e: MouseEvent, item: any) => {
    e.preventDefault()
    e.stopPropagation()
    const baseStart = timeToFrac(item.scheduled_time)
    const baseEnd   = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1
    const dur = baseEnd - baseStart
    beginDrag(item, 'timed', ({ overDay, overFrac, overZone }: any) => {
      if (overZone === 'timed' && overFrac != null) {
        onUpdateItem(item.id, {
          due_date: overDay,
          scheduled_time: fracToTime(overFrac),
          scheduled_end:  fracToTime(overFrac + dur),
        })
      } else if (overZone === 'untimed' && overDay) {
        onUpdateItem(item.id, { due_date: overDay, scheduled_time: null, scheduled_end: null })
      }
    }, { startFrac: baseStart })
  }

  const beginResize = (e: MouseEvent, item: any) => {
    e.preventDefault()
    e.stopPropagation()
    const startFrac = timeToFrac(item.scheduled_time)
    beginDrag(item, 'resize', ({ overFrac }: any) => {
      if (overFrac != null && overFrac > startFrac + 0.1) {
        onUpdateItem(item.id, { scheduled_end: fracToTime(overFrac) })
      }
    }, { startFrac })
  }

  const beginDragAllday = (e: MouseEvent, item: any) => {
    e.preventDefault()
    e.stopPropagation()
    beginDrag(item, 'allday', ({ overDay }: any) => {
      if (overDay && overDay !== item.due_date) {
        const delta = Math.round((new Date(overDay).getTime() - new Date(item.due_date).getTime()) / 86400000)
        const updates: any = { due_date: addDays(item.due_date, delta) }
        if (item.end_date) updates.end_date = addDays(item.end_date, delta)
        onUpdateItem(item.id, updates)
      }
    })
  }

  const beginCreate = (e: MouseEvent, dayKey: string, hourFrac: number) => {
    if (readonly) return
    e.preventDefault()
    beginDrag(null, 'create', ({ overFrac, overDay }: any) => {
      const a = hourFrac, b = overFrac ?? hourFrac
      const start = Math.min(a, b)
      const end   = Math.max(a + 0.5, b)
      setCreatePending({
        startDay: overDay || dayKey,
        scheduled_time: fracToTime(start),
        scheduled_end:  fracToTime(end),
      })
    }, { startFrac: hourFrac, startDay: dayKey })
  }

  const anyDrag  = !!drag
  const HOURS = Array.from({ length: WV_LAST_H - WV_FIRST_H + 1 }, (_, i) => i + WV_FIRST_H)
  const totalH = HOURS.length * WV_ROW_H

  return (
    <>
    <div style={{ flex: 1, overflowY: 'auto', background: 'transparent', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, padding: '24px 32px 0', display: 'flex', flexDirection: 'column', maxWidth: 1280, margin: '0 auto', width: '100%' }}>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid var(--color-line)` }}>
          <div>
            <Eyebrow style={{ marginBottom: 4 }}>The week</Eyebrow>
            <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 30, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.04, whiteSpace: 'nowrap' }}>
              <Press large as="em" style={{ fontStyle: 'italic' }}>{weekRange}</Press>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <TButton onClick={() => setCursor(addDays(cursor, -7))} style={{ fontSize: 13, padding: '6px 11px' }}>‹</TButton>
            <TButton onClick={() => setCursor(weekStart(today))} style={{ letterSpacing: '0.14em', padding: '6px 14px' }}>THIS WEEK</TButton>
            <TButton onClick={() => setCursor(addDays(cursor, 7))} style={{ fontSize: 13, padding: '6px 11px' }}>›</TButton>
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--color-paper-2)',
          border: `1px solid var(--color-line)`,
          boxShadow: `inset 0 1px 0 rgba(0,0,0,0.06), inset 0 -1px 0 rgba(255,255,255,0.18)`,
          overflow: 'hidden',
        }}>

          <div style={{
            display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`,
            borderBottom: `1px solid var(--color-line)`, background: 'var(--color-paper)',
          }}>
            <div style={{ borderRight: `1px solid var(--color-line)` }} />
            {days.map((d, i) => {
              const dd = localDate(d)
              const isToday = d === today
              return (
                <div key={d} style={{
                  background: isToday ? 'var(--color-accent-soft)' : 'transparent',
                  borderRight: i < 6 ? `1px solid var(--color-line)` : 'none',
                  padding: '8px 12px 10px',
                }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: isToday ? 'var(--color-accent)' : 'var(--color-muted)', textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                    {dd.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 22, marginTop: 2, color: isToday ? 'var(--color-accent)' : 'var(--color-ink)', fontStyle: isToday ? 'italic' : 'normal', fontWeight: isToday ? 500 : 400, letterSpacing: '-0.02em', textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                    {dd.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {(alldayLanes > 0 || (anyDrag && drag?.mode === 'allday')) && (
            <div style={{
              display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px 1fr`,
              borderBottom: `1px solid var(--color-line)`, background: 'var(--color-paper)', flexShrink: 0,
            }}>
              <div style={{
                borderRight: `1px solid var(--color-line)`,
                fontFamily: FONT_BODY, fontSize: 8, letterSpacing: '0.18em',
                textTransform: 'uppercase', color: 'var(--color-faint)',
                padding: '5px 5px 0 0', textAlign: 'right',
              }}>all‑day</div>
              <div style={{ position: 'relative', height: Math.max(alldayLanes, 1) * 22 + 8, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  {days.map((d, i) => {
                    const isOver   = drag?.overZone === 'allday' && drag?.overDay === d
                    const isTarget = anyDrag && drag?.mode === 'allday'
                    return (
                      <div
                        key={d}
                        data-drop-zone="allday"
                        data-drop-day={d}
                        onClick={(!anyDrag && !readonly) ? () => setCreatePending({ startDay: d, allDay: true, scheduled_time: null, scheduled_end: null }) : undefined}
                        style={{
                          borderRight: i < 6 ? `1px solid var(--color-line)` : 'none',
                          background: isOver ? `color-mix(in srgb, var(--color-accent) 12%, transparent)` : d === today ? `var(--color-accent-soft)` : 'transparent',
                          outline: isOver ? `1px dashed var(--color-accent)` : isTarget ? `1px dashed var(--color-accent-glow)` : 'none',
                          outlineOffset: -2,
                          cursor: anyDrag ? 'copy' : 'pointer',
                          transition: 'background 0.08s',
                        }}
                      />
                    )
                  })}
                </div>
                {(alldayBars as any[]).map(bar => {
                  const s = sourceOf(bar.ev.source)
                  const isDraggingThis = drag?.item?.id === bar.ev.id
                  return (
                    <div
                      key={bar.ev.id}
                      onMouseDown={(e: any) => beginDragAllday(e, bar.ev)}
                      onClick={(e: any) => { e.stopPropagation(); if (!drag) onSelect(bar.ev) }}
                      style={{
                        position: 'absolute',
                        left:  `calc(${(bar.startCol / 7) * 100}% + ${bar.continuesLeft  ? 0 : 2}px)`,
                        width: `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - ${bar.continuesLeft ? 0 : 2}px - ${bar.continuesRight ? 0 : 2}px)`,
                        top: bar.lane * 22 + 4, height: 18,
                        background: `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.09) 100%), ${s.hex}`,
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 6px rgba(0,0,0,0.35)`,
                        borderTopLeftRadius:    bar.continuesLeft  ? 0 : 'var(--hub-radius-sm)',
                        borderBottomLeftRadius: bar.continuesLeft  ? 0 : 'var(--hub-radius-sm)',
                        borderTopRightRadius:   bar.continuesRight ? 0 : 'var(--hub-radius-sm)',
                        borderBottomRightRadius:bar.continuesRight ? 0 : 'var(--hub-radius-sm)',
                        display: 'flex', alignItems: 'center',
                        paddingLeft: bar.continuesLeft ? 4 : 6,
                        paddingRight: bar.continuesRight ? 0 : 6,
                        cursor: 'grab', overflow: 'hidden',
                        opacity: isDraggingThis ? 0.35 : 1,
                        outline: selectedId === bar.ev.id ? `2px solid var(--color-accent)` : 'none',
                        outlineOffset: -2,
                        userSelect: 'none',
                        transition: 'opacity 0.1s',
                      }}
                    >
                      <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.95)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {!bar.continuesLeft && bar.ev.title}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{
            display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`,
            borderBottom: `1px solid var(--color-line)`, background: 'var(--color-paper)', minHeight: 56,
          }}>
            <div style={{
              borderRight: `1px solid var(--color-line)`,
              fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.18em',
              textTransform: 'uppercase', color: 'var(--color-faint)',
              padding: '6px 6px 0 0', textAlign: 'right',
            }}>untimed</div>
            {days.map((d, i) => {
              const dayItems = byDay[d]?.untimed || []
              const isOver   = drag?.overZone === 'untimed' && drag?.overDay === d
              const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed')
              return (
                <div
                  key={d}
                  data-drop-zone="untimed"
                  data-drop-day={d}
                  style={{
                    borderRight: i < 6 ? `1px solid var(--color-line)` : 'none',
                    background: isOver ? `color-mix(in srgb, var(--color-accent) 12%, transparent)` : d === today ? `var(--color-accent-soft)` : 'transparent',
                    outline: isOver ? `1px dashed var(--color-accent)` : isTarget ? `1px dashed var(--color-accent-glow)` : 'none',
                    outlineOffset: -2,
                    padding: 4,
                    display: 'flex', flexDirection: 'column', gap: 3,
                    transition: 'background 0.08s',
                  }}
                >
                  {dayItems.map((it: any) => (
                    <UntimedChip
                      key={it.id} item={it}
                      isSelected={selectedId === it.id}
                      isDragging={drag?.item?.id === it.id}
                      onSelect={onSelect} onToggle={onToggle}
                      onMouseDown={(e: any) => beginDragUntimed(e, it)}
                    />
                  ))}
                </div>
              )
            })}
          </div>

          <div
            ref={scrollRef}
            data-hour-scroll
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}
          >
            <div style={{
              display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`,
              height: totalH, position: 'relative',
            }}>
              <div style={{ position: 'relative', borderRight: `1px solid var(--color-line)`, background: 'var(--color-paper)' }}>
                {HOURS.map((h, i) => (
                  <div key={h} style={{
                    position: 'absolute', top: i * WV_ROW_H, left: 0, right: 0, height: WV_ROW_H,
                    fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 10.5, color: 'var(--color-muted)',
                    textAlign: 'right', padding: '3px 6px 0 0',
                  }}>{i === 0 ? '' : fmtHourLabel(h)}</div>
                ))}
              </div>

              {days.map((d, i) => {
                const timedLayout = layoutTimedEvents(byDay[d]?.timed || [])
                const isToday = d === today
                const isOver  = drag?.overZone === 'timed' && drag?.overDay === d
                const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed' || drag?.mode === 'create')
                const isHover = hoverCol === d && !anyDrag && !readonly

                const showPreview = isOver && drag?.overFrac != null && (
                  drag?.mode === 'create' || drag?.mode === 'untimed' || drag?.mode === 'timed'
                )

                return (
                  <div
                    key={d}
                    data-drop-zone="timed"
                    data-drop-day={d}
                    data-frac-base={WV_FIRST_H}
                    data-frac-scale={WV_ROW_H}
                    onMouseEnter={() => setHoverCol(d)}
                    onMouseLeave={() => setHoverCol(c => (c === d ? null : c))}
                    onMouseDown={(e: any) => {
                      if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset?.gridBg) return
                      // getBoundingClientRect() already accounts for the container's scroll
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const frac = snapFrac(WV_FIRST_H + (e.clientY - r.top) / WV_ROW_H)
                      beginCreate(e, d, frac)
                    }}
                    style={{
                      position: 'relative',
                      borderRight: i < 6 ? `1px solid var(--color-line)` : 'none',
                      background: isOver ? `color-mix(in srgb, var(--color-accent) 12%, transparent)` : isToday ? `var(--color-accent-soft)` : isHover ? `color-mix(in srgb, var(--color-accent) 6%, transparent)` : 'var(--color-paper)',
                      outline: isTarget && !isToday ? `1px solid var(--color-accent-glow)` : 'none',
                      outlineOffset: -1,
                      cursor: anyDrag ? 'copy' : readonly ? 'default' : 'crosshair',
                      transition: 'background 0.12s',
                    }}
                  >
                    {HOURS.map((h, idx) => (
                      <div key={h} data-grid-bg style={{
                        position: 'absolute', left: 0, right: 0, top: idx * WV_ROW_H, height: WV_ROW_H,
                        borderBottom: idx < HOURS.length - 1 ? `1px solid var(--color-line-strong)` : 'none',
                        pointerEvents: 'none',
                      }}>
                        <div data-grid-bg style={{
                          position: 'absolute', left: 0, right: 0, top: WV_ROW_H / 2,
                          borderTop: `1px dotted var(--color-line-strong)`, opacity: 0.4,
                        }} />
                      </div>
                    ))}

                    {timedLayout.map(({ ev: item, slot, totalCols }) => {
                      const isMine = drag?.item?.id === item.id
                      const isRsz  = isMine && drag?.mode === 'resize'
                      return (
                        <TimeBlock
                          key={item.id} item={item}
                          slot={slot} totalCols={totalCols}
                          isSelected={selectedId === item.id}
                          isDragging={isMine}
                          isResizing={isRsz}
                          liveOverride={
                            isMine && drag?.mode === 'timed' && drag?.overFrac != null
                              ? { start: drag.overFrac }
                              : isMine && isRsz && drag?.overFrac != null
                              ? { end: drag.overFrac }
                              : null
                          }
                          onSelect={onSelect} onToggle={onToggle}
                          onBeginDrag={(e: any) => beginDragTimed(e, item)}
                          onBeginResize={(e: any) => beginResize(e, item)}
                        />
                      )
                    })}

                    {showPreview && <TimelinePreview drag={drag} />}

                    {isToday && nowFrac >= WV_FIRST_H && nowFrac <= WV_LAST_H + 1 && (
                      <div style={{
                        position: 'absolute', top: (nowFrac - WV_FIRST_H) * WV_ROW_H,
                        left: 0, right: 0, height: 1, background: 'var(--color-accent)', zIndex: 12, pointerEvents: 'none',
                        boxShadow: 'var(--accent-halo)',
                      }}>
                        <span className="now-dot" style={{
                          position: 'absolute', left: -4, top: -3,
                          width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)',
                          boxShadow: 'var(--accent-halo)',
                        }} />
                        <span style={{
                          position: 'absolute', right: 6, top: -8,
                          fontFamily: FONT_BODY, fontSize: 8, letterSpacing: '0.22em',
                          textTransform: 'uppercase', color: 'var(--color-accent)',
                          background: 'var(--color-paper)', padding: '1px 5px',
                          textShadow: 'var(--accent-halo-text)',
                          border: `1px solid var(--color-accent)`,
                        }}>● rec</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>

    {createPending && (
      <CreateDialog
        pending={createPending}
        onSubmit={(title: string) => {
          if (createPending.allDay) {
            onAddItem({ kind: 'event', scope: 'day', source: 'bb', due_date: createPending.startDay, title })
          } else {
            onAddItem({
              kind: 'task', scope: 'day',
              due_date: createPending.startDay,
              scheduled_time: createPending.scheduled_time,
              scheduled_end:  createPending.scheduled_end,
              title,
            })
          }
          setCreatePending(null)
        }}
        onCancel={() => setCreatePending(null)}
      />
    )}
    </>
  )
}

function TimelinePreview({ drag }: any) {
  const { mode, startFrac, overFrac, item } = drag
  if (overFrac == null) return null

  let start: number, end: number, color: string, label: string

  if (mode === 'create') {
    start = Math.min(startFrac ?? overFrac, overFrac)
    end   = Math.max((startFrac ?? overFrac) + 0.5, overFrac)
    color = 'var(--color-accent)'
    label = `${fmtTime(fracToTime(start))} – ${fmtTime(fracToTime(end))}`
  } else if (mode === 'timed' && item) {
    const baseStart = timeToFrac(item.scheduled_time)
    const baseEnd   = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1
    const dur = baseEnd - baseStart
    start = overFrac
    end   = overFrac + dur
    color = item.accent || (item.source ? sourceOf(item.source)?.hex : null) || 'var(--color-accent)'
    label = item.title
  } else {
    start = overFrac
    end   = overFrac + 1
    color = 'var(--color-accent)'
    label = `${fmtTime(fracToTime(start))} – ${fmtTime(fracToTime(end))}`
  }

  const top    = (start - WV_FIRST_H) * WV_ROW_H
  const height = Math.max(24, (end - start) * WV_ROW_H)

  return (
    <div style={{
      position: 'absolute', left: 4, right: 4, top, height,
      borderRadius: 'var(--hub-radius-soft)',
      background: mode === 'timed' ? `${color}CC` : `${color}55`,
      border: `1px dashed ${color}`,
      borderTop: mode === 'timed' ? `2px solid rgba(255,255,255,0.3)` : `1px dashed ${color}`,
      boxShadow: `0 0 12px ${color}44`,
      pointerEvents: 'none', zIndex: 6,
    }}>
      <div style={{
        padding: '3px 8px',
        fontFamily: mode === 'timed' ? FONT_BODY : FONT_NUM,
        fontStyle: mode === 'timed' ? 'normal' : 'italic',
        fontWeight: mode === 'timed' ? 500 : 400,
        fontSize: 11,
        color: mode === 'timed' ? 'rgba(255,255,255,0.9)' : (mode === 'create' ? 'var(--color-paper)' : 'var(--color-ink)'),
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</div>
      {mode === 'timed' && height >= 36 && (
        <div style={{
          padding: '1px 8px',
          fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 9.5,
          color: 'rgba(255,255,255,0.65)',
        }}>{fmtTime(fracToTime(start))} – {fmtTime(fracToTime(end))}</div>
      )}
    </div>
  )
}

function CreateDialog({ pending, onSubmit, onCancel }: any) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const handle = () => { if (title.trim()) onSubmit(title.trim()); else onCancel() }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'rgba(10,8,6,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(2px)',
    }}>
      <div onClick={(e: any) => e.stopPropagation()} className="modal-in" style={{
        width: 'min(460px, 90vw)', background: 'var(--color-paper-2)',
        border: `1px solid var(--color-line)`,
        borderRadius: 'var(--hub-radius-lg)',
        boxShadow: `0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent)`,
        padding: '22px 26px 24px',
      }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--color-accent)', textShadow: 'var(--accent-halo-text)', marginBottom: 10 }}>
          {pending.allDay
            ? `${fmtWeekday(pending.startDay)} · all‑day event`
            : `${fmtWeekday(pending.startDay)} · ${fmtTime(pending.scheduled_time)} – ${fmtTime(pending.scheduled_end)}`}
        </div>
        <input
          ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handle(); if (e.key === 'Escape') onCancel() }}
          placeholder="What needs to happen…"
          style={{
            width: '100%', background: 'transparent', border: 'none',
            borderBottom: `1px solid var(--color-line)`,
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 22,
            color: 'var(--color-ink)', outline: 'none', padding: '4px 0 10px',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ background: 'transparent', border: `1px solid var(--color-line)`, fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handle} className="btn-action" style={{ background: 'var(--color-accent)', border: 'none', color: 'var(--color-paper)', fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '8px 20px', cursor: 'pointer', boxShadow: 'var(--accent-halo)' }}>Add →</button>
        </div>
      </div>
    </div>
  )
}

function UntimedChip({ item, isSelected, isDragging, onSelect, onToggle, onMouseDown }: any) {
  const accent = item.accent || 'var(--color-muted)'

  if (isDragging) {
    return (
      <div style={{
        height: 18, background: accent, borderRadius: 'var(--hub-radius-sm)',
        opacity: 0.28, flexShrink: 0,
        userSelect: 'none', pointerEvents: 'none',
      }} />
    )
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onClick={() => onSelect(item)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '2px 6px 2px 5px',
        borderRadius: 'var(--hub-radius-sm)',
        background: item.completed ? 'var(--color-paper)' : `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.09) 100%), ${accent}`,
        boxShadow: item.completed ? 'none' : `inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 4px rgba(0,0,0,0.3)`,
        color: item.completed ? 'var(--color-muted)' : 'rgba(255,255,255,0.95)',
        fontFamily: FONT_BODY, fontSize: 10.5,
        cursor: 'grab',
        outline: isSelected ? `1.5px solid var(--color-accent)` : 'none',
        outlineOffset: -1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        textDecoration: item.completed ? 'line-through' : 'none',
        userSelect: 'none',
      }}
    >
      <span
        onMouseDown={(e: any) => e.stopPropagation()}
        onClick={(e: any) => { e.stopPropagation(); onToggle(item.id, item.completed) }}
        style={{
          width: 9, height: 9, flexShrink: 0,
          border: `1px solid ${item.completed ? 'var(--color-muted)' : 'rgba(255,255,255,0.7)'}`,
          background: item.completed ? 'var(--color-muted)' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 6, color: 'var(--color-paper)', lineHeight: 1,
        }}
      >{item.completed ? '✓' : ''}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
    </div>
  )
}

function TimeBlock({ item, isSelected, isDragging, isResizing, liveOverride, slot = 0, totalCols = 1, onSelect, onToggle, onBeginDrag, onBeginResize }: any) {
  const isEvent = item.kind === 'event'
  const accent = item.accent || (isEvent && sourceOf(item.source).hex) || 'var(--color-accent)'

  const baseStart = timeToFrac(item.scheduled_time)
  const baseEnd   = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1
  const start = liveOverride?.start ?? baseStart
  const end   = liveOverride?.end   ?? (liveOverride?.start != null ? liveOverride.start + (baseEnd - baseStart) : baseEnd)
  const top    = (start - WV_FIRST_H) * WV_ROW_H
  const height = Math.max(18, (end - start) * WV_ROW_H)
  const showTime = height >= 32
  const leftPct  = (slot / totalCols) * 100
  const rightPct = ((totalCols - slot - 1) / totalCols) * 100

  if (isDragging && !isResizing) {
    return (
      <div style={{
        position: 'absolute',
        left: `calc(${leftPct}% + 2px)`, right: `calc(${rightPct}% + 2px)`,
        top, height: Math.min(height, 22),
        background: accent, borderRadius: 'var(--hub-radius-soft)',
        opacity: 0.28, zIndex: 8, pointerEvents: 'none', userSelect: 'none',
      }} />
    )
  }

  return (
    <div
      onMouseDown={onBeginDrag}
      onClick={(e: any) => { e.stopPropagation(); if (!isDragging) onSelect(item) }}
      style={{
        position: 'absolute',
        left: `calc(${leftPct}% + 2px)`, right: `calc(${rightPct}% + 2px)`,
        top, height,
        background: `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.09) 100%), ${accent}`,
        borderTop: `2px solid rgba(255,255,255,0.28)`,
        borderRadius: 'var(--hub-radius-soft)',
        outline: isSelected ? `2px solid var(--color-accent)` : 'none',
        outlineOffset: -2,
        boxShadow: isSelected
          ? `inset 0 1px 0 rgba(255,255,255,0.22), 0 3px 10px rgba(0,0,0,0.4), 0 0 0 1px var(--color-paper), 0 0 0 3px var(--color-accent)`
          : `inset 0 1px 0 rgba(255,255,255,0.22), 0 3px 10px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.25)`,
        overflow: 'hidden', cursor: 'grab',
        opacity: item.completed ? 0.55 : 1,
        zIndex: 4,
        userSelect: 'none',
      }}
    >
      <div style={{ padding: '3px 7px 8px', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {!isEvent && (
            <span
              onMouseDown={(e: any) => e.stopPropagation()}
              onClick={(e: any) => { e.stopPropagation(); onToggle(item.id, item.completed) }}
              style={{
                width: 10, height: 10, flexShrink: 0,
                border: `1px solid rgba(255,255,255,0.7)`,
                background: item.completed ? 'rgba(255,255,255,0.85)' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, color: accent, lineHeight: 1,
              }}
            >{item.completed ? '✓' : ''}</span>
          )}
          <span style={{
            flex: 1, minWidth: 0, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 500,
            color: 'rgba(255,255,255,0.95)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textDecoration: item.completed ? 'line-through' : 'none',
          }}>{item.title}</span>
        </div>
        {showTime && (
          <div style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 9.5, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
            {fmtTime(item.scheduled_time)}{item.scheduled_end ? ` – ${fmtTime(item.scheduled_end)}` : ''}
          </div>
        )}
      </div>
      <div
        onMouseDown={onBeginResize}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ width: 20, height: 1.5, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
          <div style={{ width: 20, height: 1.5, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
        </div>
      </div>
    </div>
  )
}


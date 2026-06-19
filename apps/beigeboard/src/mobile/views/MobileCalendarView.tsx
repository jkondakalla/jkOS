import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, isoDate, localDate, fmtTime, fmtFull, sourceOf } from '../../lib/theme'
import { getAccent } from '../../lib/seed'
import { Eyebrow, RecLamp, Checkbox } from '../components/MobileWidgets'

/**
 * Mobile Calendar View — month grid with day details below
 */

export interface MobileCalendarViewProps {
  items: any[]
  today: string
  onSelect: (item: any) => void
  onToggle: (id: number) => void
  onUpdate: (id: number, patch: any) => void
  onAddOnDate: (date: string) => void
}

export function MobileCalendarView({
  items,
  today,
  onSelect,
  onToggle,
  onUpdate,
  onAddOnDate,
}: MobileCalendarViewProps) {
  const [sel, setSel] = useState(today)
  const base = localDate(today)
  const [ym, setYm] = useState({ y: base.getFullYear(), m: base.getMonth() })
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const reschedule = (id: number, iso: string) => {
    const it = items.find((x) => x.id === id)
    if (it && it.due_date !== iso && onUpdate) onUpdate(id, { due_date: iso })
    setSel(iso)
    setDragId(null)
    setDragOver(null)
  }

  const first = new Date(ym.y, ym.m, 1)
  const startOffset = (first.getDay() + 6) % 7 // Mon-first
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(isoDate(new Date(ym.y, ym.m, day)))
  while (cells.length % 7 !== 0) cells.push(null)

  const itemsByDay = (iso: string) => items.filter((it) => it.due_date === iso)
  const selItems = itemsByDay(sel).sort((a: any, b: any) =>
    (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz')
  )

  const shift = (n: number) => {
    let m = ym.m + n
    let y = ym.y
    if (m < 0) {
      m = 11
      y--
    }
    if (m > 11) {
      m = 0
      y++
    }
    setYm({ y, m })
  }

  const monthName = new Date(ym.y, ym.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="bb-scroll" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: '22px 18px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <button
            onClick={() => shift(-1)}
            className="bb-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-ink)',
              cursor: 'pointer',
              fontSize: 20,
              padding: 4,
            }}
          >
            ‹
          </button>
          <div style={{ textAlign: 'center' }}>
            <Eyebrow style={{ marginBottom: 3 }}>Calendar</Eyebrow>
            <div
              style={{
                fontFamily: FONT_HEAD,
                fontWeight: 500,
                fontStyle: 'italic',
                fontSize: 22,
                color: 'var(--color-ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {monthName}
            </div>
          </div>
          <button
            onClick={() => shift(1)}
            className="bb-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-ink)',
              cursor: 'pointer',
              fontSize: 20,
              padding: 4,
            }}
          >
            ›
          </button>
        </div>

        {/* weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                fontFamily: FONT_BODY,
                fontSize: 9,
                letterSpacing: '0.12em',
                color: 'var(--color-faint)',
                fontWeight: 500,
              }}
            >
              {w}
            </div>
          ))}
        </div>

        {/* grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7,1fr)',
            gap: 3,
            padding: 6,
            background: false ? 'transparent' : 'rgba(0,0,0,0.22)',
            border: false ? 'none' : `1px solid ${'var(--color-line)'}`,
            borderRadius: false ? 0 : 4,
          }}
        >
          {cells.map((iso, i) => {
            if (!iso)
              return (
                <div
                  key={i}
                  style={{
                    aspectRatio: '1 / 1.05',
                  }}
                />
              )

            const dayItems = itemsByDay(iso)
            const isToday = iso === today
            const isSel = iso === sel
            const dots = dayItems
              .slice(0, 4)
              .map((it) => (it.kind === 'event' ? it.accent || sourceOf(it.source).hex : getAccent(it, items) || 'var(--color-muted)'))
            const isDropTarget = dragId != null && dragOver === iso
            const draggedItem = dragId != null ? items.find((x: any) => x.id === dragId) : null
            const isDragSource = draggedItem && draggedItem.due_date === iso

            return (
              <button
                key={i}
                onClick={() => setSel(iso)}
                className="bb-btn"
                onDragOver={(e) => {
                  if (dragId != null) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOver !== iso) setDragOver(iso)
                  }
                }}
                onDragLeave={() => setDragOver((o) => (o === iso ? null : o))}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId != null) reschedule(dragId, iso)
                }}
                style={{
                  aspectRatio: '1 / 1.05',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 3,
                  padding: '5px 0 0',
                  cursor: 'pointer',
                  position: 'relative',
                  background: isDropTarget
                    ? false
                      ? 'rgba(200,57,26,0.16)'
                      : 'rgba(224,72,40,0.22)'
                    : isSel
                      ? false
                        ? 'rgba(200,57,26,0.10)'
                        : 'rgba(224,72,40,0.14)'
                      : 'transparent',
                  border: isDropTarget ? `1px dashed ${'var(--color-accent)'}` : isSel ? `1px solid ${'var(--color-accent)'}` : `1px solid transparent`,
                  borderRadius: false ? 4 : 2,
                  boxShadow: isDropTarget ? '0 0 8px var(--color-accent-glow)' : 'none',
                  opacity: dragId != null && !isDropTarget && isDragSource ? 0.55 : 1,
                  transition: 'background 0.12s, border-color 0.12s',
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_NUM,
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: isToday ? 'var(--color-accent)' : 'var(--color-ink)',
                    fontWeight: isToday ? 600 : 400,
                    textShadow: isToday ? 'var(--accent-halo-text)' : 'none',
                  }}
                >
                  {localDate(iso).getDate()}
                </span>
                <span style={{ display: 'flex', gap: 2, height: 5, alignItems: 'center' }}>
                  {dots.map((c, j) => (
                    <span
                      key={j}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: c,
                        boxShadow: `0 0 4px ${c}66`,
                      }}
                    />
                  ))}
                </span>
              </button>
            )
          })}
        </div>

        {/* selected day agenda */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <Eyebrow color={sel === today ? 'var(--color-accent)' : 'var(--color-muted)'}>{fmtFull(sel)}</Eyebrow>
            {sel === today && <RecLamp size={6} />}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => onAddOnDate && onAddOnDate(sel)}
              className="bb-btn"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-accent)',
                textShadow: 'var(--accent-halo-text)',
                cursor: 'pointer',
                fontFamily: FONT_BODY,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 0',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add
            </button>
          </div>
          {selItems.length === 0 ? (
            <button
              onClick={() => onAddOnDate && onAddOnDate(sel)}
              className="bb-btn"
              style={{
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: 2,
                border: `1px dashed ${'var(--color-line)'}`,
                background: 'transparent',
                color: 'var(--color-faint)',
                fontFamily: FONT_HEAD,
                fontStyle: 'italic',
                fontSize: 15,
                padding: '14px 14px',
              }}
            >
              Nothing scheduled — tap to lay down a task…
            </button>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                borderTop: `1px solid ${'var(--color-line-strong)'}`,
                paddingTop: 10,
              }}
            >
              {selItems.map((it: any) => {
                const isEvent = it.kind === 'event'
                const accent = isEvent ? it.accent || sourceOf(it.source).hex : getAccent(it, items) || 'var(--color-muted)'
                const beingDragged = dragId === it.id
                return (
                  <div
                    key={it.id}
                    className="bb-row"
                    onClick={() => onSelect(it)}
                    draggable={!isEvent}
                    onDragStart={(e) => {
                      if (isEvent) return
                      setDragId(it.id)
                      e.dataTransfer.effectAllowed = 'move'
                      try {
                        e.dataTransfer.setData('text/plain', String(it.id))
                      } catch (err) {}
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setDragOver(null)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '8px 6px',
                      cursor: isEvent ? 'pointer' : 'grab',
                      borderLeft: `2px solid ${accent}`,
                      paddingLeft: 8,
                      opacity: beingDragged ? 0.4 : 1,
                      background: beingDragged
                        ? false
                          ? 'rgba(120,90,50,0.06)'
                          : 'rgba(255,240,200,0.04)'
                        : 'transparent',
                    }}
                  >
                    {!isEvent && (
                      <span
                        aria-hidden="true"
                        style={{
                          color: 'var(--color-faint)',
                          fontSize: 11,
                          lineHeight: 1,
                          letterSpacing: '-1px',
                          cursor: 'grab',
                          flexShrink: 0,
                          userSelect: 'none',
                        }}
                      >
                        ⠿
                      </span>
                    )}
                    {!isEvent ? (
                      <Checkbox id={it.id} completed={it.completed} onToggle={onToggle} color={accent} size={14} />
                    ) : (
                      <span style={{ width: 14, textAlign: 'center', fontSize: 9, color: accent }}>◇</span>
                    )}
                    <span
                      style={{
                        flex: 1,
                        fontFamily: FONT_HEAD,
                        fontSize: 15,
                        color: it.completed ? 'var(--color-muted)' : 'var(--color-ink)',
                        textDecoration: it.completed ? 'line-through' : 'none',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontStyle: isEvent ? 'italic' : 'normal',
                      }}
                    >
                      {it.title}
                    </span>
                    {it.scheduled_time && (
                      <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 11.5, color: accent, whiteSpace: 'nowrap' }}>
                        {fmtTime(it.scheduled_time)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

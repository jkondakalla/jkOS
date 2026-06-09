import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, fmtTime, getGreeting } from '../../lib/theme'
import { getAccent, getAncestors } from '../../lib/seed'
import { Eyebrow, RecLamp, Checkbox } from '../components/MobileWidgets'

/**
 * Mobile Today View — home screen with bold layout
 */

export interface MobileTodayViewProps {
  items: any[]
  today: string
  onSelect: (item: any) => void
  onToggle: (id: number) => void
  onAdd: () => void
}

export function MobileTodayView({ items, today, onSelect, onToggle, onAdd }: MobileTodayViewProps) {
  const d = localDate(today)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const tasks = items.filter((it: any) => it.kind === 'task')
  const todayAll = tasks.filter((t: any) => t.due_date === today)
  const active = todayAll
    .filter((t: any) => !t.completed)
    .sort((a: any, b: any) => (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz'))
  const done = todayAll.filter((t: any) => t.completed)
  const overdue = tasks.filter((t: any) => t.due_date && t.due_date < today && !t.completed)
  const next = active[0]
  const rest = active.slice(1)
  const pct = todayAll.length ? Math.round((done.length / todayAll.length) * 100) : 0

  return (
    <div className="bb-scroll" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: '26px 20px 30px' }}>
        {/* Masthead */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Eyebrow>{dateStr}</Eyebrow>
            <RecLamp size={6} label="Live" />
          </div>
          <h1
            style={{
              fontFamily: FONT_HEAD,
              fontWeight: 500,
              fontStyle: 'italic',
              fontSize: 46,
              lineHeight: 1,
              margin: '8px 0 0',
              letterSpacing: '-0.025em',
              color: 'var(--color-ink)',
              textShadow: `0 0 8px ${'var(--color-accent)'}66`,
            }}
          >
            {getGreeting()}.
          </h1>
          <p
            style={{
              fontFamily: FONT_HEAD,
              fontStyle: 'italic',
              fontSize: 15,
              color: 'var(--color-muted)',
              margin: '8px 0 0',
              lineHeight: 1.3,
            }}
          >
            {active.length
              ? `${active.length} thing${active.length > 1 ? 's' : ''} on the reel${overdue.length ? `, ${overdue.length} running behind` : ''}.`
              : 'The tape is clear today.'}
          </p>
        </div>

        {/* Day meter */}
        {todayAll.length > 0 && (
          <div style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <Eyebrow>Today</Eyebrow>
              <Eyebrow color={'var(--color-muted)'}>
                {done.length}/{todayAll.length}
              </Eyebrow>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 2,
                padding: 3,
                background: 'rgba(0,0,0,0.4)',
                border: `1px solid ${'var(--color-line)'}`,
                boxShadow: `inset 0 2px 4px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.06)`,
              }}
            >
              {Array.from({ length: 24 }, (_, i) => {
                const isLit = i < Math.round((pct / 100) * 24)
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: 8,
                      background: isLit ? 'var(--color-accent)' : 'rgba(0,0,0,0.5)',
                      opacity: isLit ? 1 : 0.45,
                      transition: 'background 0.2s',
                    }}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Next up (hero) */}
        {next && (
          <div style={{ marginBottom: 28 }}>
            <Eyebrow style={{ marginBottom: 8, color: 'var(--color-faint)' }}>Next up</Eyebrow>
            <NextUpCard item={next} items={items} onSelect={onSelect} onToggle={onToggle} />
          </div>
        )}

        {/* Active tasks list */}
        {rest.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <Eyebrow style={{ marginBottom: 8, color: 'var(--color-faint)' }}>Other things</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rest.map((it: any) => (
                <TaskRow key={it.id} item={it} items={items} onSelect={onSelect} onToggle={onToggle} />
              ))}
            </div>
          </div>
        )}

        {/* Add button */}
        <button
          onClick={onAdd}
          style={{
            width: '100%',
            padding: '12px',
            background: 'var(--color-accent)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 14,
            borderRadius: 4,
            marginTop: 8,
          }}
        >
          + Add task
        </button>

        {/* Completed */}
        {done.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <Eyebrow style={{ marginBottom: 8, color: 'var(--color-faint)' }}>Done</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {done.map((it: any) => (
                <TaskRow key={it.id} item={it} items={items} onSelect={onSelect} onToggle={onToggle} completed />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function NextUpCard({ item, items, onSelect, onToggle }: any) {
  const accent = getAccent(item, items) || 'var(--color-accent)'
  return (
    <div
      onClick={() => onSelect(item)}
      style={{
        padding: '14px 14px',
        border: `2px solid ${accent}`,
        borderRadius: 4,
        background: 'rgba(0,0,0,0.2)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Checkbox id={item.id} completed={item.completed} onToggle={onToggle} color={accent} size={16} />
      <span
        style={{
          flex: 1,
          fontFamily: FONT_HEAD,
          fontSize: 16,
          color: 'var(--color-ink)',
          fontWeight: 500,
        }}
      >
        {item.title}
      </span>
      {item.scheduled_time && <span style={{ fontFamily: FONT_NUM, fontSize: 12, color: accent }}>{fmtTime(item.scheduled_time)}</span>}
    </div>
  )
}

function TaskRow({ item, items, onSelect, onToggle, completed }: any) {
  const accent = getAccent(item, items) || 'var(--color-accent)'
  return (
    <div
      onClick={() => onSelect(item)}
      style={{
        padding: '10px 10px',
        borderLeft: `2px solid ${accent}`,
        paddingLeft: 12,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: completed ? 0.6 : 1,
      }}
    >
      <Checkbox id={item.id} completed={item.completed} onToggle={onToggle} color={accent} size={14} />
      <span
        style={{
          flex: 1,
          fontFamily: FONT_BODY,
          fontSize: 14,
          color: completed ? 'var(--color-muted)' : 'var(--color-ink)',
          textDecoration: completed ? 'line-through' : 'none',
        }}
      >
        {item.title}
      </span>
      {item.scheduled_time && <span style={{ fontFamily: FONT_NUM, fontSize: 11, color: accent }}>{fmtTime(item.scheduled_time)}</span>}
    </div>
  )
}

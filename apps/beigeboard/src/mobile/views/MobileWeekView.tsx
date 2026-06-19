import React from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, fmtTime, weekStart, addDays } from '../../lib/theme'
import { getAccent } from '../../lib/seed'
import { Eyebrow, RecLamp, Checkbox } from '../components/MobileWidgets'

/**
 * Mobile Week View — vertical 7-day agenda
 */

export interface MobileWeekViewProps {
  items: any[]
  today: string
  onSelect: (item: any) => void
  onToggle: (id: number) => void
}

export function MobileWeekView({ items, today, onSelect, onToggle }: MobileWeekViewProps) {
  const start = weekStart(today)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  return (
    <div className="bb-scroll" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: '22px 18px 28px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 20,
            gap: 12,
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <Eyebrow>This week</Eyebrow>
            <h1
              style={{
                fontFamily: FONT_HEAD,
                fontWeight: 500,
                fontSize: 30,
                margin: '6px 0 0',
                letterSpacing: '-0.02em',
                color: 'var(--color-ink)',
                whiteSpace: 'nowrap',
              }}
            >
              7 days
            </h1>
          </div>
          <span
            style={{
              fontFamily: FONT_NUM,
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--color-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {localDate(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
            {localDate(addDays(start, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {days.map((iso) => {
            const isToday = iso === today
            const dayItems = items
              .filter((it: any) => it.due_date === iso)
              .sort((a: any, b: any) => (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz'))
            const d = localDate(iso)

            return (
              <div key={iso}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                  <span
                    style={{
                      fontFamily: FONT_NUM,
                      fontStyle: 'italic',
                      fontSize: 17,
                      color: isToday ? 'var(--color-accent)' : 'var(--color-ink)',
                      minWidth: 26,
                      textShadow: isToday ? 'var(--accent-halo-text)' : 'none',
                    }}
                  >
                    {d.getDate()}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_BODY,
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: isToday ? 'var(--color-accent)' : 'var(--color-muted)',
                      textShadow: isToday ? 'var(--accent-halo-text)' : 'none',
                    }}
                  >
                    {d.toLocaleDateString('en-US', { weekday: 'long' })}
                  </span>
                  {isToday && <RecLamp size={6} label="Today" />}
                  <span style={{ flex: 1, height: 1, background: 'var(--color-line-strong)' }} />
                  {dayItems.length > 0 && (
                    <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: 'var(--color-faint)' }}>
                      {dayItems.length}
                    </span>
                  )}
                </div>

                {dayItems.length === 0 ? (
                  <div
                    style={{
                      paddingLeft: 35,
                      fontFamily: FONT_HEAD,
                      fontStyle: 'italic',
                      fontSize: 13,
                      color: 'var(--color-faint)',
                      opacity: 0.7,
                      paddingBottom: 4,
                    }}
                  >
                    open
                  </div>
                ) : (
                  <div style={{ paddingLeft: 35, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {dayItems.map((it: any) => {
                      const isEvent = it.kind === 'event'
                      const accent = isEvent ? it.accent : getAccent(it, items) || 'var(--color-muted)'
                      return (
                        <div
                          key={it.id}
                          className="bb-row"
                          onClick={() => onSelect(it)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '7px 9px',
                            cursor: 'pointer',
                            borderRadius: false ? 5 : 3,
                            background: isEvent ? (false ? 'rgba(120,90,50,0.05)' : 'rgba(0,0,0,0.22)') : 'transparent',
                            borderLeft: `2px solid ${accent}`,
                          }}
                        >
                          {!isEvent && <Checkbox id={it.id} completed={it.completed} onToggle={onToggle} color={accent} size={14} />}
                          {isEvent && (
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
                            <span
                              style={{
                                fontFamily: FONT_NUM,
                                fontStyle: 'italic',
                                fontSize: 11.5,
                                color: accent,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fmtTime(it.scheduled_time)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ height: 16 }} />
      </div>
    </div>
  )
}

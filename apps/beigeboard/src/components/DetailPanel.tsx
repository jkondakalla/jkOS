import React, { useState, useEffect, useRef } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, sourceOf, fmtTime, fmtFull, localDate, halate } from '../lib/theme'
import { getAncestors, getChildren, getAccent, getProgress } from '../lib/seed'
import { Eyebrow, Checkbox } from './SharedComponents'
import { useHudShelf } from '../lib/jkauth'

export function DetailPanel({ event, items, onClose, onToggle, onDelete, onUpdateItem, setView, setFocusedGoalId }: any) {
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleVal, setTitleVal]         = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitleEditing(false)
    setTitleVal(event?.title || '')
  }, [event?.id])

  useEffect(() => {
    if (titleEditing && titleInputRef.current) titleInputRef.current.focus()
  }, [titleEditing])

  // ORDECK HUD shelf — pin/focus this item onto the dashboard (suite-wide prefs).
  const shelf = useHudShelf()

  if (!event) return null

  const accent = (items && getAccent(event, items)) || (event.source && sourceOf(event.source).hex) || 'var(--color-accent)'
  const isTask      = event.kind === 'task'
  const isGoal      = event.kind === 'goal'
  const isMilestone = event.kind === 'milestone'
  const isEvent     = event.kind === 'event'
  const ancestors = items ? getAncestors(event, items) : []
  const children  = items ? getChildren(event, items)  : []
  const prog      = items ? getProgress(event, items)  : { done: 0, total: 0, pct: 0 }

  // Pin/focus reference for the HUD shelf — {app,id} + a display snapshot.
  const hudRef  = { app: 'beigeboard', id: event.id, label: event.title, deeplink: window.location.origin }
  const focused = shelf.isFocused('beigeboard', event.id)
  const pinned  = shelf.isPinned('beigeboard', event.id)

  const scopeLabel = isGoal ? 'Goal'
    : isMilestone ? 'Checkpoint'
    : isEvent ? 'Event'
    : event.scope === 'subtask' ? 'Smaller step'
    : 'Task'

  return (
    <aside className="panel-enter" style={{
      borderLeft: `1px solid var(--color-line)`,
      background: 'var(--color-paper-2)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        background: accent, color: 'rgba(255,255,255,0.95)',
        padding: '16px 22px 18px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 12, marginBottom: 6,
        }}>
          <div style={{
            fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)',
          }}>{scopeLabel}{isEvent && event.source ? ` · ${sourceOf(event.source).label}` : ''}</div>
          <button
            onClick={onClose} title="Close"
            style={{
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.7)', fontSize: 16,
              cursor: 'pointer', padding: 0, lineHeight: 1,
            }}
          >✕</button>
        </div>
        {titleEditing ? (
          <input
            ref={titleInputRef}
            value={titleVal}
            onChange={e => setTitleVal(e.target.value)}
            onBlur={() => {
              const v = titleVal.trim()
              if (v && v !== event.title) onUpdateItem?.(event.id, { title: v })
              else setTitleVal(event.title)
              setTitleEditing(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setTitleVal(event.title); setTitleEditing(false) }
            }}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.45)',
              fontFamily: FONT_HEAD, fontWeight: 500,
              fontSize: isGoal ? 26 : 22,
              color: 'rgba(255,255,255,0.95)', outline: 'none',
              padding: '2px 0 6px', width: '100%', letterSpacing: '-0.015em',
            }}
          />
        ) : (
          <div
            onClick={() => { setTitleVal(event.title); setTitleEditing(true) }}
            title="Click to edit title"
            style={{
              fontFamily: FONT_HEAD,
              fontStyle: isMilestone ? 'italic' : 'normal',
              fontWeight: 500, fontSize: isGoal ? 26 : 22,
              lineHeight: 1.2, letterSpacing: '-0.015em',
              textDecoration: event.completed ? 'line-through' : 'none',
              opacity: event.completed ? 0.7 : 1,
              cursor: 'text',
            }}
          >{event.title}</div>
        )}
        {event.target && (
          <div style={{
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12.5,
            color: 'rgba(255,255,255,0.72)', marginTop: 5,
          }}>{event.target}</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 24px' }}>
        {ancestors.length > 0 && (
          <Field label="Part of">
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ancestors.slice().reverse().map((a: any, i: number) => {
                const aAccent = getAccent(a, items)
                return (
                  <li key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    paddingLeft: i * 12,
                  }}>
                    {i > 0 && <span style={{ color: 'var(--color-faint)', marginRight: 2 }}>↳</span>}
                    <span style={{
                      fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.2em',
                      textTransform: 'uppercase', color: aAccent || 'var(--color-muted)',
                      border: `1px solid ${(aAccent || 'var(--color-muted)') + '40'}`,
                      borderRadius: 'var(--hub-radius-sm)',
                      padding: '1px 6px', flexShrink: 0,
                    }}>{a.kind === 'goal' ? 'goal' : a.kind === 'milestone' ? 'checkpoint' : 'task'}</span>
                    <span style={{
                      fontFamily: FONT_HEAD,
                      fontStyle: a.kind === 'goal' ? 'normal' : 'italic',
                      fontSize: 14 - Math.min(i, 2), color: 'var(--color-ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{a.title}</span>
                  </li>
                )
              })}
            </ol>
          </Field>
        )}

        {(isTask || isEvent || event.due_date || event.scheduled_time) && (
          <WhenField event={event} isTask={isTask} isEvent={isEvent} onUpdateItem={onUpdateItem} />
        )}

        {event.location && (
          <Field label="Where">
            <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 15, color: 'var(--color-ink)' }}>
              {event.location}
            </div>
          </Field>
        )}

        {event.attendees && (
          <Field label="Attending">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontFamily: FONT_NUM, fontStyle: 'italic',
                fontSize: 30, color: accent, lineHeight: 1,
                textShadow: halate(accent, 'mid'),
              }}>{String(event.attendees).padStart(2, '0')}</span>
              <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)' }}>
                people
              </span>
            </div>
          </Field>
        )}

        {(isTask || isMilestone) && (
          <Field label="Status">
            <button
              onClick={() => onToggle?.(event.id, event.completed)}
              className="btn-action"
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: 'transparent', border: `1px solid var(--color-line)`,
                fontFamily: FONT_BODY, fontSize: 12,
                padding: '9px 14px', color: 'var(--color-ink)', cursor: 'pointer',
                letterSpacing: '0.05em',
              }}
            >
              <Checkbox id={event.id} completed={event.completed} onToggle={onToggle} color={accent} />
              {isMilestone
                ? (event.completed ? 'Passed — reopen' : 'Mark checkpoint passed')
                : (event.completed ? 'Done — mark active' : 'Mark complete')}
            </button>
          </Field>
        )}

        {(isTask || isEvent || isMilestone) && (
          <Field label="On ORDECK">
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => shelf.toggleFocus(hudRef)}
                className="btn-action"
                style={{
                  flex: 1,
                  background: focused ? accent : 'transparent',
                  color: focused ? 'var(--color-paper)' : 'var(--color-muted)',
                  border: `1px solid ${focused ? accent : 'var(--color-line)'}`,
                  fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.12em',
                  textTransform: 'uppercase', padding: '9px 0', cursor: 'pointer',
                }}
              >{focused ? 'Focused — clear' : 'Focus on ORDECK'}</button>
              <button
                onClick={() => shelf.togglePin({ ...hudRef, tone: event.completed ? 'ok' : 'accent' })}
                className="btn-action"
                style={{
                  flex: 1,
                  background: pinned ? accent : 'transparent',
                  color: pinned ? 'var(--color-paper)' : 'var(--color-muted)',
                  border: `1px solid ${pinned ? accent : 'var(--color-line)'}`,
                  fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.12em',
                  textTransform: 'uppercase', padding: '9px 0', cursor: 'pointer',
                }}
              >{pinned ? 'Pinned to HUD' : 'Pin to HUD'}</button>
            </div>
          </Field>
        )}

        {isGoal && (
          <GoalFields event={event} onUpdateItem={onUpdateItem} />
        )}

        {isGoal && (
          <Field label={`Breakdown · ${prog.total > 0 ? `${prog.done}/${prog.total}` : 'open'}`}>
            {prog.total > 0 && (
              <div style={{ height: 2, background: 'var(--color-line-strong)', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${prog.pct}%`, background: accent }} />
              </div>
            )}
            {children.length === 0 ? (
              <div style={{
                padding: '12px 14px', border: `1px dashed var(--color-line)`,
                borderRadius: 'var(--hub-radius-soft)',
                fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)',
              }}>Not broken down yet. Open in the workshop to add steps.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {children.slice(0, 6).map((c: any) => (
                  <li key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 0', borderBottom: `1px solid var(--color-line-strong)`,
                  }}>
                    <span style={{ width: 4, height: 16, background: accent, opacity: 0.5, flexShrink: 0 }} />
                    <span style={{
                      flex: 1, minWidth: 0,
                      fontFamily: c.kind === 'task' ? FONT_BODY : FONT_HEAD,
                      fontStyle: c.kind === 'task' ? 'normal' : 'italic',
                      fontSize: 13, color: c.completed ? 'var(--color-muted)' : 'var(--color-ink)',
                      textDecoration: c.completed ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{c.title}</span>
                  </li>
                ))}
                {children.length > 6 && (
                  <li style={{
                    fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11,
                    color: 'var(--color-muted)', padding: '6px 0',
                  }}>+ {children.length - 6} more</li>
                )}
              </ul>
            )}

            <button
              onClick={() => {
                setFocusedGoalId?.(event.id)
                setView?.('tasks')
              }}
              className="btn-action"
              style={{
                marginTop: 12,
                background: accent, color: 'var(--color-paper)', border: 'none',
                fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.16em',
                textTransform: 'uppercase', padding: '10px 14px', cursor: 'pointer',
                width: '100%',
              }}
            >Open in workshop →</button>
          </Field>
        )}

        {event.notes && (
          <Field label="Notes">
            <p style={{
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
              color: 'var(--color-muted)', margin: 0, lineHeight: 1.5,
            }}>{event.notes}</p>
          </Field>
        )}

        {isEvent && event.source && (
          <Field label="Source">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 10, height: 10, background: sourceOf(event.source).hex,
                borderRadius: '50%',
              }} />
              <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: 'var(--color-ink)' }}>
                {sourceOf(event.source).label}
              </span>
            </div>
          </Field>
        )}

        <div style={{
          display: 'flex', gap: 8, marginTop: 24,
          paddingTop: 16, borderTop: `1px solid var(--color-line-strong)`,
        }}>
          <button
            onClick={() => onDelete?.(event.id)}
            className="btn-action"
            style={{
              flex: 1,
              background: 'transparent', border: `1px solid var(--color-line)`,
              fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--color-muted)',
              padding: '10px 14px', cursor: 'pointer',
            }}
          >Delete</button>
        </div>
      </div>
    </aside>
  )
}

/* Goal definition: the finish line, the horizon, and active/parked/done status. */
function GoalFields({ event, onUpdateItem }: any) {
  const [means, setMeans] = useState(event.done_means || '')
  useEffect(() => { setMeans(event.done_means || '') }, [event.id, event.done_means])

  const status = event.status || 'active'
  const statusBtn = (value: string, label: string) => (
    <button
      key={value}
      onClick={() => onUpdateItem?.(event.id, { status: value })}
      className="btn-action"
      style={{
        flex: 1,
        background: status === value ? 'var(--color-accent)' : 'transparent',
        color: status === value ? 'var(--color-paper)' : 'var(--color-muted)',
        border: `1px solid ${status === value ? 'var(--color-accent)' : 'var(--color-line)'}`,
        fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.14em',
        textTransform: 'uppercase', padding: '8px 0', cursor: 'pointer',
      }}
    >{label}</button>
  )

  return (
    <>
      <Field label="Done means">
        <input
          value={means}
          onChange={e => setMeans(e.target.value)}
          onBlur={() => {
            const v = means.trim()
            if (v !== (event.done_means || '')) onUpdateItem?.(event.id, { done_means: v || null })
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder="A verifiable outcome — how will you know?"
          style={{
            width: '100%', background: 'transparent', border: 'none',
            borderBottom: `1px solid var(--color-line)`,
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
            color: 'var(--color-ink)', outline: 'none', padding: '2px 0 5px',
          }}
        />
      </Field>
      <Field label="Horizon">
        <input
          type="date"
          value={event.target_date || ''}
          onChange={e => onUpdateItem?.(event.id, { target_date: e.target.value || null })}
          style={{
            background: 'transparent', border: `1px solid var(--color-line)`,
            borderRadius: 'var(--hub-radius-sm)',
            fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-ink)',
            padding: '4px 6px', outline: 'none',
          }}
        />
      </Field>
      <Field label="Standing">
        <div style={{ display: 'flex', gap: 6 }}>
          {statusBtn('active', 'Active')}
          {statusBtn('parked', 'Parked')}
          {statusBtn('done',   'Done')}
        </div>
      </Field>
    </>
  )
}

function WhenField({ event, isTask, isEvent, onUpdateItem }: any) {
  const canEdit = (isTask || isEvent) && !!onUpdateItem
  const isAllDayEvent = isEvent && !event.scheduled_time

  const [editing, setEditing] = useState(false)
  const [date,    setDate]    = useState(event.due_date       || '')
  const [endDate, setEndDate] = useState(event.end_date       || '')
  const [start,   setStart]   = useState(event.scheduled_time || '')
  const [end,     setEnd]     = useState(event.scheduled_end  || '')

  useEffect(() => {
    setDate(event.due_date       || '')
    setEndDate(event.end_date    || '')
    setStart(event.scheduled_time || '')
    setEnd(event.scheduled_end   || '')
    setEditing(false)
  }, [event.id])

  const save = () => {
    const updates: any = {
      due_date:       date    || null,
      scheduled_time: start   || null,
      scheduled_end:  end     || null,
    }
    if (isAllDayEvent || (!start && endDate)) {
      updates.end_date = (endDate && endDate !== date) ? endDate : null
    }
    onUpdateItem?.(event.id, updates)
    setEditing(false)
  }

  const clear = () => {
    onUpdateItem?.(event.id, { due_date: null, scheduled_time: null, scheduled_end: null, end_date: null })
    setDate(''); setEndDate(''); setStart(''); setEnd('')
    setEditing(false)
  }

  const inputSty: any = {
    background: 'transparent', border: `1px solid var(--color-line)`,
    borderRadius: 'var(--hub-radius-sm)',
    fontFamily: FONT_BODY, fontSize: 11,
    color: 'var(--color-ink)', padding: '4px 6px', outline: 'none',
  }

  const isMultiDay = event.end_date && event.end_date !== event.due_date

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <Eyebrow>When</Eyebrow>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="jk-sub-link" style={{
            background: 'none', border: 'none',
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11,
            cursor: 'pointer', padding: 0,
          }}>edit</button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputSty, flex: 1 }} />
            {(isAllDayEvent || (!start && !end)) && (
              <>
                <span style={{ color: 'var(--color-faint)', fontSize: 11 }}>→</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  placeholder="End date" style={{ ...inputSty, flex: 1 }} />
              </>
            )}
          </div>
          {!isAllDayEvent && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="time" value={start} onChange={e => setStart(e.target.value)} placeholder="Start" style={{ ...inputSty, flex: 1 }} />
              <span style={{ color: 'var(--color-muted)', alignSelf: 'center', fontSize: 11 }}>–</span>
              <input type="time" value={end}   onChange={e => setEnd(e.target.value)}   placeholder="End"   style={{ ...inputSty, flex: 1 }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <button onClick={save} className="btn-action" style={{
              flex: 1, background: 'var(--color-accent)', color: 'var(--color-paper)', border: 'none',
              fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase', padding: '7px 0', cursor: 'pointer',
            }}>Save</button>
            <button onClick={() => setEditing(false)} style={{
              flex: 1, background: 'transparent', border: `1px solid var(--color-line)`,
              fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--color-muted)', padding: '7px 0', cursor: 'pointer',
            }}>Cancel</button>
            {(event.due_date || event.scheduled_time) && (
              <button onClick={clear} style={{
                background: 'transparent', border: `1px solid var(--color-line)`,
                fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--color-faint)', padding: '7px 10px', cursor: 'pointer',
              }}>Clear</button>
            )}
          </div>
        </div>
      ) : (event.due_date || event.scheduled_time) ? (
        <div onClick={() => canEdit && setEditing(true)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
          {event.due_date && (
            <div style={{ fontFamily: FONT_HEAD, fontSize: 15, color: 'var(--color-ink)', lineHeight: 1.4 }}>
              {isMultiDay
                ? `${fmtFull(event.due_date)} → ${fmtFull(event.end_date)}`
                : fmtFull(event.due_date)}
            </div>
          )}
          {event.scheduled_time && (
            <div style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 14, color: 'var(--color-muted)', marginTop: 3 }}>
              {fmtTime(event.scheduled_time)}{event.scheduled_end ? ` – ${fmtTime(event.scheduled_end)}` : ''}
            </div>
          )}
          {!event.scheduled_time && isTask && (
            <div style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', marginTop: 3 }}>
              Anytime · tap edit to schedule
            </div>
          )}
          {isAllDayEvent && !isMultiDay && (
            <div style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: 'var(--color-faint)', marginTop: 3 }}>
              All day
            </div>
          )}
        </div>
      ) : canEdit ? (
        <button onClick={() => setEditing(true)} style={{
          background: 'transparent', border: `1px dashed var(--color-line)`,
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
          color: 'var(--color-muted)', cursor: 'pointer', padding: '8px 12px', width: '100%', textAlign: 'left',
        }}>+ Schedule this {isEvent ? 'event' : 'task'}</button>
      ) : null}
    </div>
  )
}

function Field({ label, children }: any) {
  return (
    <div style={{ marginBottom: 18 }}>
      <Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>
      {children}
    </div>
  )
}

import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, fmtTime, halate, getGreeting } from '../lib/theme'
import { getAncestors, getAccent } from '../lib/seed'
import { Eyebrow, Checkbox, Plate, RecLamp } from '../components/SharedComponents'

export function TodayView({ items, today, onSelect, onToggle, onAddTask, setView, selectedId, recentlyAdded, readonly }: any) {
  const d = localDate(today)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const allTasks   = items.filter((it: any) => it.kind === 'task')
  const todayAll   = allTasks.filter((t: any) => t.due_date === today)
  const active     = todayAll.filter((t: any) => !t.completed).sort((a: any, b: any) => (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz'))
  const done       = todayAll.filter((t: any) =>  t.completed)
  const overdue    = allTasks.filter((t: any) => t.due_date && t.due_date < today && !t.completed)
  const next       = active[0]
  const rest       = active.slice(1)

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-paper)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 36px 80px' }}>

        <div style={{ marginBottom: 36 }}>
          <Eyebrow style={{ marginBottom: 6 }}>{dateStr}</Eyebrow>
          <h1 style={{
            fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 32, lineHeight: 1,
            margin: 0, letterSpacing: '-0.025em', color: 'var(--color-ink)',
            textShadow: '0 0 5px var(--color-accent-glow)',
          }}>{getGreeting()}</h1>
        </div>

        {next ? (
          <NextCard item={next} items={items} onSelect={onSelect} onToggle={onToggle} />
        ) : todayAll.length === 0 && overdue.length === 0 ? (
          <EmptyDay onAdd={readonly ? null : onAddTask} today={today} />
        ) : (
          <ClearedDay onceMore={() => setView('tasks')} />
        )}

        {overdue.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <Eyebrow color={'var(--color-accent)'} style={{ marginBottom: 10, textShadow: '0 0 10px var(--color-accent-glow)' }}>{overdue.length} overdue</Eyebrow>
              <button onClick={() => setView('week')} style={tinyLink()}>see the week →</button>
            </div>
            <Strip tasks={overdue} items={items} onSelect={onSelect} onToggle={onToggle} muted={false} recentlyAdded={recentlyAdded} />
          </section>
        )}

        {rest.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <Eyebrow>After that · {rest.length} more</Eyebrow>
              <button onClick={() => setView('week')} style={tinyLink()}>the week →</button>
            </div>
            <Strip tasks={rest} items={items} onSelect={onSelect} onToggle={onToggle} recentlyAdded={recentlyAdded} />
          </section>
        )}

        {done.length > 0 && (
          <details style={{ marginTop: 36, opacity: 0.7 }}>
            <summary style={{
              fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.22em',
              textTransform: 'uppercase', color: 'var(--color-muted)', cursor: 'pointer',
              padding: '4px 0',
            }}>{done.length} done today</summary>
            <div style={{ marginTop: 10 }}>
              <Strip tasks={done} items={items} onSelect={onSelect} onToggle={onToggle} muted recentlyAdded={recentlyAdded} />
            </div>
          </details>
        )}

        <footer style={{
          marginTop: 56,
          paddingTop: 18,
          borderTop: `1px solid 'var(--color-line-strong)'`,
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <button onClick={() => setView('week')} style={tinyLink()}>open the week →</button>
          <button onClick={() => setView('tasks')} style={tinyLink()}>open the workshop →</button>
        </footer>
      </div>
    </div>
  )
}

function NextCard({ item, items, onSelect, onToggle }: any) {
  const accent = getAccent(item, items) || 'var(--color-accent)'
  const ancestors = getAncestors(item, items)

  return (
    <Plate accent={accent} style={{ padding: '28px 32px 30px 44px', cursor: 'pointer' }}>
      <article onClick={() => onSelect(item)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RecLamp size={7} label="Next" />
          </div>
          {item.scheduled_time && (
            <span style={{
              fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 14, color: accent,
              textShadow: `0 0 10px ${accent}99`,
              letterSpacing: '0.04em',
            }}>
              {fmtTime(item.scheduled_time)}{item.scheduled_end ? ` – ${fmtTime(item.scheduled_end)}` : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
          <Checkbox id={item.id} completed={item.completed} onToggle={onToggle} color={accent} size={20} />
          <h2 style={{
            flex: 1, fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 36,
            margin: 0, lineHeight: 1.1, letterSpacing: '-0.025em', color: 'var(--color-ink)',
            textDecoration: item.completed ? 'line-through' : 'none',
            textShadow: `0 0 24px ${accent}22`,
          }}>{item.title}</h2>
        </div>

        {ancestors.length > 0 && (
          <div style={{
            marginTop: 18, paddingLeft: 38,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            <span style={{ width: 5, height: 5, background: accent, boxShadow: `0 0 6px ${accent}cc` }} />
            <span style={{
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-muted)',
              lineHeight: 1.3,
            }}>
              {ancestors.slice().reverse().map((a: any) => a.title).join('  ›  ')}
            </span>
          </div>
        )}
      </article>
    </Plate>
  )
}

const AI_ENABLED = (import.meta.env.VITE_BB_AI_ENABLED as string) === 'true'

function EmptyDay({ onAdd, today }: any) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const handle = () => {
    if (!draft.trim()) { setAdding(false); return }
    onAdd({ title: draft.trim(), due_date: today })
    setDraft(''); setAdding(false)
  }

  const handleAI = async () => {
    if (!draft.trim() || aiLoading) return
    setAiLoading(true)
    try {
      const r = await fetch('/api/ai/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: draft.trim(), today }),
      })
      if (!r.ok) throw new Error()
      const parsed = await r.json()
      onAdd({ due_date: today, ...parsed })
      setDraft(''); setAdding(false)
    } catch {
      onAdd({ title: draft.trim(), due_date: today })
      setDraft(''); setAdding(false)
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <article style={{
      padding: '40px 36px',
      border: `1px dashed 'var(--color-line)'`,
      background: 'var(--color-paper-2)',
    }}>
      <Eyebrow style={{ marginBottom: 6 }}>The day is open.</Eyebrow>
      <p style={{
        fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 20,
        color: 'var(--color-ink)', margin: '0 0 20px', lineHeight: 1.3,
      }}>Nothing has been written down yet.</p>

      {onAdd && (adding ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handle()
              if (e.key === 'Escape') { setAdding(false); setDraft('') }
            }}
            placeholder="Describe a task — or let AI parse it…"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              borderBottom: `1px solid 'var(--color-line)'`,
              fontFamily: FONT_HEAD, fontSize: 22, color: 'var(--color-ink)', outline: 'none',
              padding: '6px 2px',
            }}
          />
          {AI_ENABLED && (
          <button
            onClick={handleAI}
            disabled={aiLoading}
            className="btn-action"
            title="Let AI parse this into a structured task"
            style={{
              background: aiLoading ? 'var(--color-paper-2)' : 'transparent',
              color: 'var(--color-accent)', border: `1px solid var(--color-accent-glow)`,
              fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase', padding: '10px 14px',
              cursor: aiLoading ? 'wait' : 'pointer', opacity: aiLoading ? 0.6 : 1,
            }}
          >{aiLoading ? '…' : '✦ AI'}</button>
          )}
          <button onClick={handle} className="btn-action" style={{
            background: 'var(--color-accent)', color: 'var(--color-paper)', border: 'none',
            fontFamily: FONT_BODY, fontSize: 11, letterSpacing: '0.14em',
            textTransform: 'uppercase', padding: '10px 18px', cursor: 'pointer',
          }}>Add →</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="btn-action"
          style={{
            background: 'var(--color-ink)', color: 'var(--color-paper)', border: 'none',
            fontFamily: FONT_BODY, fontSize: 11, letterSpacing: '0.14em',
            textTransform: 'uppercase', padding: '12px 22px', cursor: 'pointer',
          }}
        >+ Write something down</button>
      ))}
    </article>
  )
}

function ClearedDay({ onceMore }: any) {
  return (
    <article style={{
      padding: '40px 36px',
      border: `1px solid 'var(--color-line)'`,
      background: 'var(--color-paper-2)',
    }}>
      <Eyebrow style={{ marginBottom: 6, color: 'var(--color-accent)' }}>Today is clear.</Eyebrow>
      <p style={{
        fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 22,
        color: 'var(--color-ink)', margin: '0 0 16px', lineHeight: 1.3,
      }}>Every task on today's list is done.</p>
      <button
        onClick={onceMore}
        style={{
          background: 'transparent', border: `1px solid var(--color-line)`,
          fontFamily: FONT_BODY, fontSize: 11, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--color-ink)', cursor: 'pointer',
          padding: '10px 18px',
        }}
      >Plan something for tomorrow →</button>
    </article>
  )
}

function Strip({ tasks, items, onSelect, onToggle, muted, recentlyAdded }: any) {
  return (
    <ol style={{
      listStyle: 'none', padding: 0, margin: 0,
      borderTop: `1px solid var(--color-line-strong)`,
      opacity: muted ? 0.55 : 1,
    }}>
      {tasks.map((task: any) => {
        const accent = getAccent(task, items) || 'var(--color-muted)'
        const ancestors = getAncestors(task, items)
        const yearGoal = ancestors[ancestors.length - 1]
        const isNew = recentlyAdded?.has(task.id)

        return (
          <li
            key={task.id}
            className={`task-row${isNew ? ' item-in' : ''}`}
            onClick={() => onSelect(task)}
            style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr auto',
              gap: 12, alignItems: 'center',
              padding: '11px 6px',
              borderBottom: `1px solid var(--color-line-strong)`,
              cursor: 'pointer',
              '--hover-bg': 'var(--color-paper-2)',
            } as any}
          >
            <Checkbox id={task.id} completed={task.completed} onToggle={onToggle} color={accent} size={14} />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: FONT_HEAD, fontSize: 15.5,
                color: task.completed ? 'var(--color-muted)' : 'var(--color-ink)',
                textDecoration: task.completed ? 'line-through' : 'none',
                lineHeight: 1.25,
              }}>{task.title}</div>
              {yearGoal && (
                <div style={{
                  fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5,
                  color: 'var(--color-muted)', marginTop: 2, lineHeight: 1.2,
                }}>{yearGoal.title}</div>
              )}
            </div>
            {task.scheduled_time && (
              <span style={{
                fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12,
                color: accent, whiteSpace: 'nowrap',
              }}>{fmtTime(task.scheduled_time)}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function tinyLink(_?: any): React.CSSProperties {
  return {
    background: 'transparent', border: 'none',
    fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12,
    color: 'var(--color-muted)', cursor: 'pointer', padding: 0,
    textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3,
  }
}

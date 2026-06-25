import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, addDays, fmtTime, getGreeting } from '../lib/theme'
import { getAncestors, getAccent } from '../lib/seed'
import { activeGoals, isAdrift, nextUnscheduled } from '../lib/plan'
import { Eyebrow, Checkbox, Plate, RecLamp } from '../components/SharedComponents'
import { TButton, Well } from '@jkos/ui'

export function TodayView({ items, today, onSelect, onToggle, onAddTask, onUpdateItem, setView, setFocusedGoalId, selectedId, recentlyAdded, readonly, aiEnabled }: any) {
  const d = localDate(today)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const allTasks   = items.filter((it: any) => it.kind === 'task')
  const todayAll   = allTasks.filter((t: any) => t.due_date === today)
  const active     = todayAll.filter((t: any) => !t.completed).sort((a: any, b: any) => (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz'))
  const done       = todayAll.filter((t: any) =>  t.completed)
  const carried    = allTasks.filter((t: any) => t.due_date && t.due_date < today && !t.completed)
  const adrift     = activeGoals(items).filter((g: any) => isAdrift(g, items))
  const next       = active[0]
  const rest       = active.slice(1)

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'transparent' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 36px 80px' }}>

        <div style={{ marginBottom: 36 }}>
          <Eyebrow style={{ marginBottom: 6 }}>{dateStr}</Eyebrow>
          <h1 style={{
            fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 32, lineHeight: 1,
            margin: 0, letterSpacing: '-0.025em', color: 'var(--color-ink)',
            textShadow: 'var(--accent-halo-text)',
          }}>{getGreeting()}</h1>
        </div>

        {next ? (
          <NextCard item={next} items={items} onSelect={onSelect} onToggle={onToggle} />
        ) : todayAll.length === 0 && carried.length === 0 ? (
          <EmptyDay onAdd={readonly ? null : onAddTask} today={today} aiEnabled={aiEnabled} />
        ) : (
          <ClearedDay onceMore={() => setView('tasks')} />
        )}

        {carried.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <Eyebrow color={'var(--color-accent)'} style={{ textShadow: 'var(--accent-halo-text)' }}>
                Carried · {carried.length}
              </Eyebrow>
              <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-faint)' }}>
                slipped past their day — decide, don't drift
              </span>
            </div>
            <CarriedStrip
              tasks={carried} items={items} today={today}
              onSelect={onSelect} onToggle={onToggle} onUpdateItem={onUpdateItem} readonly={readonly}
            />
          </section>
        )}

        {adrift.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <Eyebrow>Adrift · {adrift.length}</Eyebrow>
              <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-faint)' }}>
                goals with nothing on the calendar
              </span>
            </div>
            <AdriftStrip
              goals={adrift} items={items} today={today}
              onUpdateItem={onUpdateItem} readonly={readonly}
              toWorkshop={(g: any) => { setFocusedGoalId?.(g.id); setView('tasks') }}
            />
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
          borderTop: '1px solid var(--color-line-strong)',
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

function EmptyDay({ onAdd, today, aiEnabled }: any) {
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
      // The AI returns `due_date: null` when it finds no date — spreading parsed
      // AFTER `due_date: today` let that null clobber today, so the task created from
      // the empty-today prompt vanished off Today. Default to today only when the AI
      // gave none.
      onAdd({ ...parsed, due_date: parsed.due_date || today })
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
      border: '1px dashed var(--color-line)',
      borderRadius: 'var(--hub-radius-lg)',
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
              borderBottom: '1px solid var(--color-line)',
              fontFamily: FONT_HEAD, fontSize: 22, color: 'var(--color-ink)', outline: 'none',
              padding: '6px 2px',
            }}
          />
          {aiEnabled && (
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
    <Well as="article" style={{ padding: '40px 36px' }}>
      <Eyebrow style={{ marginBottom: 6, color: 'var(--color-accent)', textShadow: 'var(--accent-halo-text)' }}>Today is clear.</Eyebrow>
      <p style={{
        fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 22,
        color: 'var(--color-ink)', margin: '0 0 16px', lineHeight: 1.3,
      }}>Every task on today's list is done.</p>
      <TButton onClick={onceMore} style={{ fontSize: 10, letterSpacing: '0.14em', padding: '10px 16px' }}>
        Plan something for tomorrow →
      </TButton>
    </Well>
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

/* Carried tasks: rescheduling is a decision, not a default. */
function CarriedStrip({ tasks, items, today, onSelect, onToggle, onUpdateItem, readonly }: any) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderTop: '1px solid var(--color-line-strong)' }}>
      {tasks.map((task: any) => {
        const accent = getAccent(task, items) || 'var(--color-muted)'
        const ancestors = getAncestors(task, items)
        const goal = ancestors[ancestors.length - 1]
        return (
          <li
            key={task.id}
            className="task-row"
            onClick={() => onSelect(task)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 6px',
              borderBottom: '1px solid var(--color-line-strong)',
              cursor: 'pointer',
              '--hover-bg': 'var(--color-paper-2)',
            } as any}
          >
            <Checkbox id={task.id} completed={task.completed} onToggle={onToggle} color={accent} size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_HEAD, fontSize: 15.5, color: 'var(--color-ink)', lineHeight: 1.25 }}>
                {task.title}
              </div>
              <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-muted)', marginTop: 2 }}>
                was {localDate(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {goal ? ` · ${goal.title}` : ''}
              </div>
            </div>
            {!readonly && (
              <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                <CarryChip label="today"  onClick={() => onUpdateItem(task.id, { due_date: today })} />
                <CarryChip label="tmrw"   onClick={() => onUpdateItem(task.id, { due_date: addDays(today, 1) })} />
                <CarryPick task={task} onUpdateItem={onUpdateItem} />
                <CarryChip label="let go" muted onClick={() => onUpdateItem(task.id, { due_date: null, scheduled_time: null, scheduled_end: null })} />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function CarryChip({ label, onClick, muted }: any) {
  return (
    <TButton onClick={onClick} quiet={muted} style={{
      fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 8px',
    }}>{label}</TButton>
  )
}

function CarryPick({ task, onUpdateItem }: any) {
  const [open, setOpen] = useState(false)
  if (!open) return <CarryChip label="pick" onClick={() => setOpen(true)} />
  return (
    <input
      type="date" autoFocus
      onChange={e => { if (e.target.value) { onUpdateItem(task.id, { due_date: e.target.value }); setOpen(false) } }}
      onBlur={() => setOpen(false)}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
      style={{
        background: 'transparent', border: '1px solid var(--color-line)',
        fontFamily: FONT_BODY, fontSize: 10, color: 'var(--color-ink)',
        padding: '2px 4px', outline: 'none',
      }}
    />
  )
}

/* Goals that have drifted off the calendar — schedule the next step in one tap. */
function AdriftStrip({ goals, items, today, onUpdateItem, readonly, toWorkshop }: any) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderTop: '1px solid var(--color-line-strong)' }}>
      {goals.map((g: any) => {
        const accent = g.accent || 'var(--color-accent)'
        const candidate = nextUnscheduled(g, items)
        return (
          <li key={g.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 6px',
            borderBottom: '1px solid var(--color-line-strong)',
          }}>
            <span style={{ width: 5, height: 30, background: accent, boxShadow: `0 0 10px ${accent}55`, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_HEAD, fontSize: 15.5, color: 'var(--color-ink)', lineHeight: 1.25 }}>
                {g.title}
              </div>
              {candidate && (
                <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-muted)', marginTop: 2 }}>
                  next up: {candidate.title}
                </div>
              )}
            </div>
            {!readonly && candidate ? (
              <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                <CarryChip label="→ today" onClick={() => onUpdateItem(candidate.id, { due_date: today })} />
                <CarryChip label="→ tmrw"  onClick={() => onUpdateItem(candidate.id, { due_date: addDays(today, 1) })} />
              </span>
            ) : (
              <button onClick={() => toWorkshop(g)} style={tinyLink()}>break it down →</button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/* Navigational links ride the SECONDARY accent — the flat companion to the
   pressed primary used for headings/wordmark (the two-accent system). */
function tinyLink(_?: any): React.CSSProperties {
  return {
    background: 'transparent', border: 'none',
    fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12,
    color: 'var(--color-secondary)', cursor: 'pointer', padding: 0,
    textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3,
  }
}

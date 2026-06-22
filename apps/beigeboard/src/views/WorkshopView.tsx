import React, { useEffect, useRef, useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, TASK_COLORS, localDate, addDays, fmtWeekday } from '../lib/theme'
import { getChildren, getAccent } from '../lib/seed'
import {
  topGoals, milestonesOf, tasksOf, currentMilestone, goalProgress,
  isAdrift, paceOf, milestoneCleared, fmtTarget,
} from '../lib/plan'
import { Eyebrow, Checkbox, Plate } from '../components/SharedComponents'
import { Press, TButton, Pill, Lab, Sheet } from '@jkos/ui'

/*
 * The Workshop — the Breakdown Method, embodied (Documentation/PLANNING_METHOD.md).
 * Define the destination · ladder it to checkpoints · commit the first step to a
 * day · review when checkpoints clear. Only the current milestone is broken down.
 */

export function WorkshopView({
  items, today, onSelect, onToggle, onAddItem, onDelete, onUpdateItem,
  selectedId, focusedGoalId, readonly, aiEnabled,
}: any) {
  const goals    = topGoals(items)
  const active   = goals.filter((g: any) => (g.status || 'active') === 'active')
  const shelved  = goals.filter((g: any) => (g.status || 'active') !== 'active')
  const year     = localDate(today).getFullYear()

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'transparent' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '36px 40px 80px' }}>

        <header style={{ paddingBottom: 20, marginBottom: 24, borderBottom: '1px solid var(--color-line)' }}>
          <Eyebrow>The workshop · {year}</Eyebrow>
          <h1 style={{
            fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 44,
            margin: '8px 0 8px', letterSpacing: '-0.025em', lineHeight: 1.04, color: 'var(--color-ink)',
          }}>
            Break it <Press large as="em" style={{ fontStyle: 'italic' }}>down</Press>.
          </h1>
          <p style={{
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
            color: 'var(--color-muted)', margin: 0, lineHeight: 1.4,
          }}>
            Name the destination · ladder it to checkpoints · put the first step on a day.
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {active.map((g: any, i: number) => (
            <GoalPlate
              key={g.id} goal={g} items={items} index={i + 1} today={today}
              autoFocus={focusedGoalId === g.id}
              onSelect={onSelect} onToggle={onToggle}
              onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
              selectedId={selectedId} readonly={readonly} aiEnabled={aiEnabled}
            />
          ))}

          {!readonly && (
            <GoalForge
              startOpen={active.length === 0}
              today={today}
              goalCount={goals.length}
              onAddItem={onAddItem}
              aiEnabled={aiEnabled}
            />
          )}

          {shelved.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{
                fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.22em',
                textTransform: 'uppercase', color: 'var(--color-muted)', cursor: 'pointer', padding: '4px 0',
              }}>
                {shelved.length} on the shelf
              </summary>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {shelved.map((g: any) => (
                  <div key={g.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', border: '1px solid var(--color-line)',
                    borderRadius: 'var(--hub-radius-lg)',
                    background: 'var(--color-paper-2)', opacity: 0.75,
                  }}>
                    <span style={{
                      fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.2em', textTransform: 'uppercase',
                      color: 'var(--color-muted)', border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-sm)', padding: '2px 7px', flexShrink: 0,
                    }}>{g.status === 'done' ? 'Done' : 'Parked'}</span>
                    <span
                      onClick={() => onSelect(g)}
                      style={{
                        flex: 1, minWidth: 0, fontFamily: FONT_HEAD, fontSize: 16, color: 'var(--color-ink)',
                        textDecoration: g.status === 'done' ? 'line-through' : 'none', cursor: 'pointer',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >{g.title}</span>
                    {!readonly && (
                      <button onClick={() => onUpdateItem(g.id, { status: 'active' })} style={tinyLink()}>
                        bring it back →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── A goal plate: definition, ladder, the current breakdown ───────────── */

function GoalPlate({ goal, items, index, today, autoFocus, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, readonly, aiEnabled }: any) {
  const accent = goal.accent || 'var(--color-accent)'
  const ms     = milestonesOf(goal, items)
  const cur    = currentMilestone(goal, items)
  const prog   = goalProgress(goal, items)
  const pace   = paceOf(goal, items, today)
  const adrift = isAdrift(goal, items)
  const allClear = ms.length > 0 && !cur
  const [openMs, setOpenMs] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [autoFocus])

  return (
    <article
      ref={ref}
      className="bb-goal-well"
      style={{ padding: '24px 28px', '--goal-accent': accent } as React.CSSProperties}
    >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <Lab size="sm" as="span" className="jk-glow-text jk-glow-low" style={{ color: accent, '--jk-glow-color': accent } as React.CSSProperties}>
            {`Goal ${String(index).padStart(2, '0')}`}
          </Lab>
          {goal.target_date && (
            <Lab size="sm" as="span">by {fmtTarget(goal.target_date)}</Lab>
          )}
          {pace && (pace === 'behind' ? (
            <span style={{
              fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--hub-radius-lg)', padding: '2px 7px',
              textShadow: 'var(--accent-halo-text)',
            }}>{pace}</span>
          ) : (
            <Pill><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-ok)', flexShrink: 0 }} />{pace}</Pill>
          ))}
          {adrift && (
            <span className="jk-glow jk-glow-low" style={{
              fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--color-paper)', background: accent, padding: '3px 8px',
              '--jk-glow-color': accent,
            } as React.CSSProperties}>nothing on the calendar</span>
          )}
        </div>

        <h2
          onClick={() => onSelect(goal)}
          style={{
            fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 27, cursor: 'pointer',
            margin: 0, letterSpacing: '-0.02em', lineHeight: 1.12, color: 'var(--color-ink)',
          }}
        >
          {goal.title}
          <span className="jk-glow-text jk-glow-hi" style={{ color: accent, '--jk-glow-color': accent } as React.CSSProperties}>.</span>
        </h2>

        <DoneMeans goal={goal} onUpdateItem={onUpdateItem} readonly={readonly} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
          <div className="bb-prog-track">
            <div className="progress-fill" style={{ width: `${prog.pct}%`, height: '100%', background: accent, boxShadow: `0 0 8px ${accent}66` }} />
          </div>
          <Lab size="sm" as="span">{prog.total > 0 ? `${prog.done}/${prog.total}` : '—'}</Lab>
        </div>

        {/* The ladder */}
        <div style={{ marginTop: 18 }}>
          {ms.length === 0 ? (
            <LadderPrompt goal={goal} onAddItem={onAddItem} readonly={readonly} aiEnabled={aiEnabled} today={today} />
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
              {ms.map((m: any, i: number) => (
                <MilestoneRow
                  key={m.id} m={m} index={i + 1} items={items} today={today} accent={accent}
                  isCurrent={cur?.id === m.id}
                  open={openMs === m.id || (openMs === null && cur?.id === m.id)}
                  onOpen={() => setOpenMs(openMs === m.id ? -1 : m.id)}
                  onSelect={onSelect} onToggle={onToggle}
                  onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
                  selectedId={selectedId} readonly={readonly}
                />
              ))}
            </ol>
          )}

          {/* Loose actions parented straight to the goal (no checkpoint) stay visible */}
          {tasksOf(goal, items).length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: ms.length ? '10px 0 0 44px' : 0 }}>
              {tasksOf(goal, items).map((t: any) => (
                <TaskRow
                  key={t.id} item={t} items={items} today={today} accent={accent} depth={0}
                  onSelect={onSelect} onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem}
                  onAddItem={onAddItem} selectedId={selectedId} readonly={readonly}
                />
              ))}
            </ul>
          )}

          {ms.length > 0 && !readonly && !allClear && (
            <AddInline
              label="+ checkpoint"
              placeholder="A checkpoint you could prove you passed…"
              onSubmit={(title: string) => onAddItem({
                kind: 'milestone', parent_id: goal.id, title, source: 'bb',
                position: (ms[ms.length - 1]?.position ?? ms.length - 1) + 1,
              })}
            />
          )}

          {allClear && (
            <div style={{
              marginTop: 12, padding: '14px 18px',
              border: `1px solid ${accent}55`, background: `${accent}10`,
              borderRadius: 'var(--hub-radius-lg)',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 15, color: 'var(--color-ink)', flex: 1 }}>
                Every checkpoint passed. Call it done?
              </span>
              {!readonly && (
                <button
                  onClick={() => onUpdateItem(goal.id, { status: 'done' })}
                  className="btn-action jk-glow jk-glow-mid"
                  style={{
                    background: accent, color: 'var(--color-paper)', border: 'none',
                    fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.16em',
                    textTransform: 'uppercase', padding: '9px 16px', cursor: 'pointer',
                    '--jk-glow-color': accent,
                  } as React.CSSProperties}
                >Mark the goal done →</button>
              )}
            </div>
          )}
        </div>
    </article>
  )
}

/* ── “Done means …” — the finish line, editable in place ───────────────── */

function DoneMeans({ goal, onUpdateItem, readonly }: any) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(goal.done_means || '')
  useEffect(() => { setDraft(goal.done_means || ''); setEditing(false) }, [goal.id, goal.done_means])

  const commit = () => {
    const v = draft.trim()
    if (v !== (goal.done_means || '')) onUpdateItem(goal.id, { done_means: v || null })
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(goal.done_means || ''); setEditing(false) }
        }}
        placeholder="A verifiable outcome — how will you know it's done?"
        style={{
          display: 'block', width: '100%', marginTop: 8,
          background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
          color: 'var(--color-ink)', outline: 'none', padding: '2px 0',
        }}
      />
    )
  }

  if (goal.done_means) {
    return (
      <p
        onClick={() => !readonly && setEditing(true)}
        title={readonly ? undefined : 'Click to edit'}
        style={{
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
          color: 'var(--color-muted)', margin: '8px 0 0', lineHeight: 1.45, maxWidth: 600,
          cursor: readonly ? 'default' : 'text',
        }}
      >
        Done means: “{goal.done_means}”
      </p>
    )
  }

  if (readonly) return null
  return (
    <button onClick={() => setEditing(true)} style={{ ...tinyLink(), marginTop: 8, display: 'block' }}>
      + define what done means
    </button>
  )
}

/* ── One rung of the ladder ────────────────────────────────────────────── */

function MilestoneRow({ m, index, items, today, accent, isCurrent, open, onOpen, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, readonly }: any) {
  const tasks   = tasksOf(m, items)
  const done    = tasks.filter((t: any) => t.completed).length
  const cleared = milestoneCleared(m, items)
  const state: 'done' | 'current' | 'later' = m.completed ? 'done' : isCurrent ? 'current' : 'later'

  const isCur = state === 'current'

  const inner = (
    <>
      <header
        onClick={onOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: isCur ? '0' : '9px 10px', cursor: 'pointer',
          opacity: state === 'later' ? 0.62 : 1,
        }}
      >
        <Lab size="sm" as="span" className={isCur ? 'jk-glow-text jk-glow-low' : undefined} style={{
          color: state === 'done' ? 'var(--color-faint)' : accent,
          width: 22, flexShrink: 0, textAlign: 'right',
          '--jk-glow-color': accent,
        } as React.CSSProperties}>{String(index).padStart(2, '0')}</Lab>

        <StateGlyph state={state} accent={accent} />

        <span
          onClick={e => { e.stopPropagation(); onSelect(m) }}
          style={{
            flex: 1, minWidth: 0,
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontWeight: 500,
            fontSize: isCur ? 18 : 15.5,
            color: state === 'done' ? 'var(--color-muted)' : 'var(--color-ink)',
            textDecoration: state === 'done' ? 'line-through' : 'none',
            lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{m.title}</span>

        {isCur && (
          <span className="jk-glow-text jk-glow-low" style={{
            fontFamily: 'var(--hub-font-mono)', fontSize: 8.5, letterSpacing: '0.18em',
            textTransform: 'uppercase', fontWeight: 600, color: accent,
            background: `color-mix(in srgb, ${accent} 16%, var(--color-card))`,
            padding: '3px 9px', flexShrink: 0, '--jk-glow-color': accent,
          } as React.CSSProperties}>current</span>
        )}
        {tasks.length > 0 && (
          <Lab size="sm" as="span" style={{ flexShrink: 0 }}>{done}/{tasks.length}</Lab>
        )}
        {!readonly && tasks.length === 0 && !m.completed && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(m.id) }}
            title="Remove checkpoint"
            style={{
              background: 'none', border: 'none', color: 'var(--color-faint)',
              fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: 0.6,
            }}
          >✕</button>
        )}
      </header>

      {cleared && !readonly && (
        <div style={{
          margin: isCur ? '10px 0 0 34px' : '0 10px 10px 44px', padding: '10px 14px',
          border: `1px solid ${accent}66`, background: `${accent}14`,
          borderRadius: 'var(--hub-radius-soft)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13.5, color: 'var(--color-ink)', flex: 1 }}>
            Every action here is done.
          </span>
          <button
            onClick={() => onUpdateItem(m.id, { completed: true })}
            className="btn-action jk-glow jk-glow-mid"
            style={{
              background: accent, color: 'var(--color-paper)', border: 'none',
              fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.16em',
              textTransform: 'uppercase', padding: '7px 13px', cursor: 'pointer',
              '--jk-glow-color': accent,
            } as React.CSSProperties}
          >Checkpoint passed →</button>
        </div>
      )}

      {open && !m.completed && (
        <div style={{ margin: isCur ? '8px 0 0 34px' : '0 10px 10px 44px' }}>
          {isCur && tasks.length === 0 && (
            <p style={{
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12.5,
              color: 'var(--color-muted)', margin: '2px 0 6px', lineHeight: 1.4,
            }}>
              This is the next checkpoint — what are the first few concrete actions?
            </p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tasks.map((t: any) => (
              <TaskRow
                key={t.id} item={t} items={items} today={today} accent={accent} depth={0}
                onSelect={onSelect} onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem}
                onAddItem={onAddItem} selectedId={selectedId} readonly={readonly}
              />
            ))}
          </ul>
          {!readonly && (
            <AddInline
              label="+ next action"
              placeholder="Small enough to finish in one sitting…"
              dayChips today={today}
              onSubmit={(title: string, due?: string | null) => onAddItem({
                kind: 'task', scope: 'day', parent_id: m.id, title, source: 'bb',
                due_date: due || null,
              })}
            />
          )}
        </div>
      )}
    </>
  )

  // The current checkpoint is the brief's prominent sheet card; the rest are flat rows.
  if (isCur) {
    return (
      <li style={{ margin: '8px 0' }}>
        <Sheet style={{ padding: '12px 14px' }}>{inner}</Sheet>
      </li>
    )
  }
  return <li style={{ borderBottom: '1px solid var(--color-line-strong)' }}>{inner}</li>
}

function StateGlyph({ state, accent }: any) {
  if (state === 'done') {
    return (
      <span style={{
        width: 14, height: 14, flexShrink: 0, background: accent,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-paper)', fontSize: 9, lineHeight: 1,
        boxShadow: `0 0 8px ${accent}66`,
      }}>✓</span>
    )
  }
  if (state === 'current') {
    return (
      <span className="now-dot" style={{
        width: 9, height: 9, margin: '0 2.5px', borderRadius: '50%', flexShrink: 0,
        background: accent, boxShadow: `0 0 8px ${accent}aa, 0 0 14px ${accent}55`,
      }} />
    )
  }
  return <span style={{ width: 14, height: 14, flexShrink: 0, border: '1px solid var(--color-line)', opacity: 0.8 }} />
}

/* ── A next action, with one-tap scheduling ────────────────────────────── */

function TaskRow({ item, items, today, accent, depth, onSelect, onToggle, onDelete, onUpdateItem, onAddItem, selectedId, readonly }: any) {
  const subs = getChildren(item, items)
  const a = getAccent(item, items) || accent

  return (
    <li>
      <div
        className="task-row"
        onClick={() => onSelect(item)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: depth === 0 ? '7px 4px' : '5px 4px',
          borderBottom: '1px solid var(--color-line-strong)',
          cursor: 'pointer',
          background: selectedId === item.id ? 'var(--color-accent-soft)' : 'transparent',
          '--hover-bg': 'var(--color-paper-2)',
        } as any}
      >
        <Checkbox id={item.id} completed={item.completed} onToggle={onToggle} size={depth === 0 ? 13 : 11} color={a} />
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_BODY, fontSize: depth === 0 ? 14 : 12.5,
          color: item.completed ? 'var(--color-muted)' : 'var(--color-ink)',
          textDecoration: item.completed ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.title}</span>

        {!item.completed && (
          <DueControl item={item} today={today} accent={a} onUpdateItem={onUpdateItem} readonly={readonly} />
        )}

        {!readonly && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(item.id) }}
            style={{
              background: 'none', border: 'none', color: 'var(--color-faint)',
              fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: 0.6,
            }}
          >✕</button>
        )}
      </div>

      {subs.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginLeft: 16, paddingLeft: 10, borderLeft: '1px solid var(--color-line-strong)' }}>
          {subs.map((s: any) => (
            <TaskRow
              key={s.id} item={s} items={items} today={today} accent={a} depth={depth + 1}
              onSelect={onSelect} onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem}
              onAddItem={onAddItem} selectedId={selectedId} readonly={readonly}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Due chip when scheduled; today/tmrw/pick chips when not. The Commit step. */
function DueControl({ item, today, accent, onUpdateItem, readonly }: any) {
  const [picking, setPicking] = useState(false)

  if (item.due_date) {
    const overdue = item.due_date < today
    return (
      <span
        onClick={e => { if (!readonly) { e.stopPropagation(); setPicking(true) } }}
        title={readonly ? undefined : 'Click to reschedule'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
      >
        {picking ? (
          <DatePick item={item} onUpdateItem={onUpdateItem} onClose={() => setPicking(false)} />
        ) : (
          <span className={overdue ? 'jk-glow-text jk-glow-low' : undefined} style={{
            fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.08em',
            color: overdue ? accent : 'var(--color-muted)',
            '--jk-glow-color': accent,
          } as React.CSSProperties}>
            {item.due_date === today ? 'today' : `${fmtWeekday(item.due_date)} ${localDate(item.due_date).getDate()}`}
          </span>
        )}
      </span>
    )
  }

  if (readonly) return null
  return (
    <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {picking ? (
        <DatePick item={item} onUpdateItem={onUpdateItem} onClose={() => setPicking(false)} />
      ) : (
        <>
          <DayChip label="today" onClick={() => onUpdateItem(item.id, { due_date: today })} />
          <DayChip label="tmrw"  onClick={() => onUpdateItem(item.id, { due_date: addDays(today, 1) })} />
          <DayChip label="pick"  onClick={() => setPicking(true)} />
        </>
      )}
    </span>
  )
}

function DatePick({ item, onUpdateItem, onClose }: any) {
  return (
    <input
      type="date" autoFocus defaultValue={item.due_date || ''}
      onClick={e => e.stopPropagation()}
      onChange={e => { if (e.target.value) { onUpdateItem(item.id, { due_date: e.target.value }); onClose() } }}
      onBlur={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      style={{
        background: 'transparent', border: '1px solid var(--color-line)',
        fontFamily: FONT_BODY, fontSize: 10, color: 'var(--color-ink)',
        padding: '2px 4px', outline: 'none',
      }}
    />
  )
}

function DayChip({ label, onClick }: any) {
  return (
    <TButton onClick={onClick} style={{ fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 7px' }}>
      {label}
    </TButton>
  )
}

/* ── Inline adder (actions / checkpoints) ──────────────────────────────── */

function AddInline({ label, placeholder, onSubmit, dayChips, today }: any) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (due?: string | null) => {
    if (!draft.trim()) { setAdding(false); return }
    onSubmit(draft.trim(), due ?? null)
    setDraft('')
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} style={{ ...tinyLink(), padding: '8px 4px', display: 'block' }}>
        {label}
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px' }}>
      <input
        ref={inputRef} autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setAdding(false); setDraft('') }
        }}
        onBlur={() => { if (!draft.trim()) setAdding(false) }}
        placeholder={placeholder}
        style={{
          flex: 1, background: 'transparent', border: 'none',
          borderBottom: '1px solid var(--color-line)',
          fontFamily: FONT_BODY, fontSize: 13,
          color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
        }}
      />
      {dayChips && draft.trim() && (
        <>
          <DayChip label="→ today" onClick={() => submit(today)} />
          <DayChip label="→ tmrw"  onClick={() => submit(addDays(today, 1))} />
        </>
      )}
    </div>
  )
}

/* ── Ladder prompt for a goal with no checkpoints yet ──────────────────── */

function LadderPrompt({ goal, onAddItem, readonly, aiEnabled, today }: any) {
  const [pending, setPending] = useState<string[]>([])
  const [draft, setDraft]     = useState('')
  const [aiBusy, setAiBusy]   = useState(false)
  const [aiActions, setAiActions] = useState<string[]>([])

  if (readonly) {
    return (
      <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>
        Not laddered down yet.
      </p>
    )
  }

  const add = () => {
    const v = draft.trim()
    if (!v) return
    setPending(p => [...p, v])
    setDraft('')
  }

  const aiDraft = async () => {
    setAiBusy(true)
    try {
      const r = await fetch('/api/ai/breakdown', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: goal.title, done_means: goal.done_means, target_date: goal.target_date }),
      })
      if (!r.ok) throw new Error()
      const d = await r.json()
      if (d.milestones?.length) setPending(d.milestones)
      if (d.first_actions?.length) setAiActions(d.first_actions)
    } catch { /* AI is a convenience — silently stay manual */ }
    finally { setAiBusy(false) }
  }

  const stamp = async () => {
    if (!pending.length) return
    let first: any = null
    for (let i = 0; i < pending.length; i++) {
      const m = await onAddItem({ kind: 'milestone', parent_id: goal.id, title: pending[i], position: i, source: 'bb' })
      if (i === 0) first = m
    }
    if (first) {
      for (let i = 0; i < aiActions.length; i++) {
        await onAddItem({
          kind: 'task', scope: 'day', parent_id: first.id, title: aiActions[i], source: 'bb',
          due_date: i === 0 ? today : null,
        })
      }
    }
    setPending([]); setAiActions([])
  }

  return (
    <div style={{ border: '1px dashed var(--color-line)', borderRadius: 'var(--hub-radius-lg)', padding: '16px 18px', background: 'var(--color-paper-2)' }}>
      <p style={{
        fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
        color: 'var(--color-ink)', margin: '0 0 12px', lineHeight: 1.4,
      }}>
        Ladder it down — name the 2–5 checkpoints you'd pass on the way.
      </p>

      {pending.length > 0 && (
        <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {pending.map((p, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)', width: 20, textAlign: 'right' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ flex: 1, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-ink)' }}>{p}</span>
              <button
                onClick={() => setPending(ps => ps.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 11, cursor: 'pointer', padding: '0 2px' }}
              >✕</button>
            </li>
          ))}
        </ol>
      )}

      {aiActions.length > 0 && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: 'var(--color-muted)', margin: '0 0 10px', lineHeight: 1.4 }}>
          + {aiActions.length} drafted first actions will land under checkpoint 01 (first one lands today).
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={pending.length ? 'Another checkpoint…' : 'The first checkpoint…'}
          style={{
            flex: 1, background: 'transparent', border: 'none',
            borderBottom: '1px solid var(--color-line)',
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
            color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
          }}
        />
        {aiEnabled && pending.length === 0 && (
          <button
            onClick={aiDraft} disabled={aiBusy} className="btn-action"
            title="Let AI draft the ladder — every line stays editable"
            style={{
              background: 'transparent', color: 'var(--color-accent)',
              border: '1px solid var(--color-accent-glow)',
              fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase',
              padding: '7px 12px', cursor: aiBusy ? 'wait' : 'pointer', opacity: aiBusy ? 0.6 : 1,
            }}
          >{aiBusy ? '…' : '✦ draft it'}</button>
        )}
        {pending.length > 0 && (
          <button
            onClick={stamp} className="btn-action"
            style={{
              background: 'var(--color-accent)', color: 'var(--color-paper)', border: 'none',
              fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
              padding: '8px 16px', cursor: 'pointer', boxShadow: '0 0 16px var(--color-accent-glow)',
            }}
          >Stamp the ladder →</button>
        )}
      </div>
    </div>
  )
}

/* ── Forge a new goal: Define → Ladder → Commit in one card ────────────── */

function GoalForge({ startOpen, today, goalCount, onAddItem, aiEnabled }: any) {
  const [open, setOpen]       = useState(!!startOpen)
  const [title, setTitle]     = useState('')
  const [done, setDone]       = useState('')
  const [target, setTarget]   = useState('')
  const [ladder, setLadder]   = useState<string[]>([])
  const [msDraft, setMsDraft] = useState('')
  const [firstAction, setFirstAction] = useState('')
  const [firstDay, setFirstDay]       = useState(today)
  const [aiBusy, setAiBusy]   = useState(false)
  const [saving, setSaving]   = useState(false)

  const accent = TASK_COLORS[goalCount % TASK_COLORS.length].hex
  const canStamp = title.trim().length > 0

  const addMs = () => {
    const v = msDraft.trim()
    if (!v) return
    setLadder(l => [...l, v])
    setMsDraft('')
  }

  const aiDraft = async () => {
    if (!title.trim()) return
    setAiBusy(true)
    try {
      const r = await fetch('/api/ai/breakdown', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), done_means: done.trim() || undefined, target_date: target || undefined }),
      })
      if (!r.ok) throw new Error()
      const d = await r.json()
      if (d.milestones?.length) setLadder(d.milestones)
      if (d.first_actions?.length) setFirstAction(d.first_actions[0])
    } catch { /* stay manual */ }
    finally { setAiBusy(false) }
  }

  const stamp = async () => {
    if (!canStamp || saving) return
    setSaving(true)
    try {
      const goal = await onAddItem({
        kind: 'goal', scope: 'year', status: 'active', source: 'bb',
        title: title.trim(), accent,
        done_means: done.trim() || null,
        target_date: target || null,
        year: localDate(today).getFullYear(),
      })
      if (!goal?.id) return   // create failed — keep the form so the user can retry
      let firstMs: any = null
      for (let i = 0; i < ladder.length; i++) {
        const m = await onAddItem({ kind: 'milestone', parent_id: goal.id, title: ladder[i], position: i, source: 'bb' })
        if (i === 0) firstMs = m
      }
      if (firstAction.trim()) {
        await onAddItem({
          kind: 'task', scope: 'day', parent_id: (firstMs || goal).id,
          title: firstAction.trim(), due_date: firstDay || today, source: 'bb',
        })
      }
      setTitle(''); setDone(''); setTarget(''); setLadder([]); setMsDraft('')
      setFirstAction(''); setFirstDay(today); setOpen(false)
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: '1px dashed var(--color-line)',
          padding: '16px 22px',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
          color: 'var(--color-muted)', cursor: 'pointer', width: '100%', textAlign: 'left',
        }}
      >+ Forge a new goal</button>
    )
  }

  return (
    <Plate accent={accent} style={{ padding: '22px 26px 22px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Eyebrow color={accent}>01 · Define the destination</Eyebrow>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 }}
        >✕</button>
      </div>
      <input
        autoFocus value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What are you reaching for?"
        style={{
          display: 'block', width: '100%', marginTop: 10,
          background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)',
          fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 24, letterSpacing: '-0.02em',
          color: 'var(--color-ink)', outline: 'none', padding: '2px 0 8px',
        }}
      />
      <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <input
          value={done}
          onChange={e => setDone(e.target.value)}
          placeholder="Done means… (a verifiable outcome, not an activity)"
          style={{
            flex: '1 1 320px', background: 'transparent', border: 'none',
            borderBottom: '1px solid var(--color-line)',
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13.5,
            color: 'var(--color-ink)', outline: 'none', padding: '2px 0 5px',
          }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>by</span>
          <input
            type="date" value={target}
            onChange={e => setTarget(e.target.value)}
            style={{
              background: 'transparent', border: '1px solid var(--color-line)',
              fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-ink)',
              padding: '3px 6px', outline: 'none',
            }}
          />
        </label>
      </div>

      {title.trim() && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Eyebrow color={accent}>02 · Ladder it down</Eyebrow>
            {aiEnabled && ladder.length === 0 && (
              <button
                onClick={aiDraft} disabled={aiBusy} className="btn-action"
                title="Let AI draft checkpoints + a first action — every line stays editable"
                style={{
                  background: 'transparent', color: 'var(--color-accent)',
                  border: '1px solid var(--color-accent-glow)',
                  fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase',
                  padding: '6px 11px', cursor: aiBusy ? 'wait' : 'pointer', opacity: aiBusy ? 0.6 : 1,
                }}
              >{aiBusy ? '…' : '✦ draft it'}</button>
            )}
          </div>

          {ladder.length > 0 && (
            <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ladder.map((p, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: accent, width: 20, textAlign: 'right' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ flex: 1, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-ink)' }}>{p}</span>
                  <button
                    onClick={() => setLadder(ps => ps.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 11, cursor: 'pointer', padding: '0 2px' }}
                  >✕</button>
                </li>
              ))}
            </ol>
          )}
          <input
            value={msDraft}
            onChange={e => setMsDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMs() }}
            placeholder={ladder.length ? 'Another checkpoint… (Enter to add)' : 'The first checkpoint you’d pass… (Enter to add)'}
            style={{
              display: 'block', width: '100%', marginTop: 8,
              background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)',
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
              color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
            }}
          />
        </div>
      )}

      {ladder.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <Eyebrow color={accent}>03 · Commit the first step to a day</Eyebrow>
          <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <input
              value={firstAction}
              onChange={e => setFirstAction(e.target.value)}
              placeholder="The very first concrete action…"
              style={{
                flex: '1 1 280px', background: 'transparent', border: 'none',
                borderBottom: '1px solid var(--color-line)',
                fontFamily: FONT_BODY, fontSize: 13.5,
                color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
              }}
            />
            <input
              type="date" value={firstDay}
              onChange={e => setFirstDay(e.target.value)}
              style={{
                background: 'transparent', border: '1px solid var(--color-line)',
                fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-ink)',
                padding: '3px 6px', outline: 'none', flexShrink: 0,
              }}
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={stamp} disabled={!canStamp || saving}
          className={canStamp ? 'btn-action jk-glow jk-glow-mid' : 'btn-action'}
          style={{
            background: canStamp ? accent : 'var(--color-paper-2)',
            color: canStamp ? 'var(--color-paper)' : 'var(--color-faint)',
            border: canStamp ? 'none' : '1px solid var(--color-line)',
            fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase',
            padding: '10px 20px', cursor: canStamp ? 'pointer' : 'default',
            '--jk-glow-color': accent,
            opacity: saving ? 0.6 : 1,
          } as React.CSSProperties}
        >{saving ? 'Stamping…' : 'Stamp the goal →'}</button>
      </div>
    </Plate>
  )
}

function tinyLink(): React.CSSProperties {
  return {
    background: 'transparent', border: 'none',
    fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12,
    color: 'var(--color-faint)', cursor: 'pointer', padding: 0,
    textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3,
  }
}

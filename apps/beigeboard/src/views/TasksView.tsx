import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import ReactDOM from 'react-dom'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, fmtTime, fmtWeekday, weekStart, halate } from '../lib/theme'
import { getChildren, getDescendants, getAccent, getProgress } from '../lib/seed'
import { Eyebrow, Checkbox, VUMeter, ColorPicker, Plate } from '../components/SharedComponents'

/* ── Internal drag context (reparent-only, separate from calendar DragProvider) ── */
const TasksDragCtx = createContext<any>(null)
const useTasksDrag = () => useContext(TasksDragCtx) || {}

const PARENT_OF: Record<string, string> = {
  month:   'year',
  week:    'month',
  day:     'week',
  subtask: 'day',
}

function isValidDrop(dragItem: any, targetItem: any, items: any[]): boolean {
  if (!dragItem || !targetItem) return false
  if (dragItem.id === targetItem.id) return false
  const descs = getDescendants(dragItem, items).map((d: any) => d.id)
  if (descs.includes(targetItem.id)) return false
  if (dragItem.parent_id === targetItem.id) return false
  const want = PARENT_OF[dragItem.scope]
  if (!want) return false
  if (want === 'day') {
    return targetItem.kind === 'task' && targetItem.scope === 'day'
  }
  return targetItem.scope === want
}

export function TasksView({ items, today, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, focusedGoalId, readonly }: any) {
  const yearGoals = items.filter((it: any) => it.scope === 'year')
  const year = localDate(today).getFullYear()

  const [expanded, setExpanded] = useState(() =>
    focusedGoalId ? new Set([focusedGoalId]) : new Set<number>())
  const isOpen = (id: number) => expanded.has(id)
  const toggle = (id: number) => setExpanded(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const expandAll = () => {
    const all = new Set<number>()
    items.forEach((it: any) => {
      if (it.scope === 'year' || it.scope === 'month' || it.scope === 'week') all.add(it.id)
    })
    setExpanded(all)
  }
  const collapseAll = () => setExpanded(new Set<number>())

  const [drag, setDrag] = useState<any>(null)

  const beginDrag = useCallback((e: React.MouseEvent, item: any) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag({ item, pos: { x: e.clientX, y: e.clientY }, hoverId: null })
  }, [])

  useEffect(() => {
    if (!drag) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'

    const onMove = (e: MouseEvent) => {
      const targets = document.querySelectorAll('[data-drop-id]')
      let hoverId: number | null = null
      for (const t of Array.from(targets)) {
        const r = t.getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top  && e.clientY <= r.bottom) {
          const id = parseInt(t.getAttribute('data-drop-id') || '', 10)
          const target = items.find((i: any) => i.id === id)
          if (isValidDrop(drag.item, target, items)) {
            hoverId = id
            break
          }
        }
      }
      setDrag((d: any) => d ? { ...d, pos: { x: e.clientX, y: e.clientY }, hoverId } : d)
    }

    const onUp = () => {
      setDrag((d: any) => {
        if (d?.hoverId && onUpdateItem) {
          onUpdateItem(d.item.id, { parent_id: d.hoverId })
          setExpanded(s => { const n = new Set(s); n.add(d.hoverId); return n })
        }
        return null
      })
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, items, onUpdateItem])

  const dragCtxValue = { drag, beginDrag }

  return (
    <TasksDragCtx.Provider value={dragCtxValue}>
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-paper)' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '36px 40px 80px' }}>

          <header style={{
            paddingBottom: 20, marginBottom: 24, borderBottom: `1px solid 'var(--color-line)'`,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18,
          }}>
            <div>
              <Eyebrow>The workshop · {year}</Eyebrow>
              <h1 style={{
                fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 44,
                margin: '8px 0 8px', letterSpacing: '-0.025em', lineHeight: 1.04, color: 'var(--color-ink)',
              }}>
                The <em style={{
                  fontStyle: 'italic', color: 'var(--color-accent)',
                  textShadow: '0 0 28px var(--color-accent-glow)',
                }}>year</em> ahead.
              </h1>
              <p style={{
                fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
                color: 'var(--color-muted)', margin: 0, lineHeight: 1.4,
              }}>
                Click to break it down. Drag <span style={{ color: 'var(--color-ink)', fontStyle: 'normal' }}>⠿</span> to reparent.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={expandAll}   style={miniBtn()}>Expand all</button>
              <button onClick={collapseAll} style={miniBtn()}>Collapse</button>
            </div>
          </header>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {yearGoals.map((g: any, i: number) => (
              <YearNode
                key={g.id} item={g} items={items} index={i + 1} today={today}
                isOpen={isOpen} toggle={toggle}
                onSelect={onSelect} onToggle={onToggle}
                onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
                selectedId={selectedId} readonly={readonly}
              />
            ))}

            {!readonly && (
              <AddPlate
                label="+ Add a year goal"
                placeholder="A goal you'd be proud of in December…"
                onSubmit={(title: string) => onAddItem({
                  kind: 'goal', scope: 'year', year,
                  title, accent: '#7A6050', source: 'bb',
                })}
              />
            )}
          </div>
        </div>
      </div>

      {drag && <DragPill drag={drag} items={items} />}
    </TasksDragCtx.Provider>
  )
}

function YearNode({ item, items, index, today, isOpen, toggle, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, readonly }: any) {
  const { drag } = useTasksDrag()
  const accent = item.accent || 'var(--color-accent)'
  const prog = getProgress(item, items)
  const months = getChildren(item, items).filter((c: any) => c.scope === 'month')
  const open = isOpen(item.id)
  const isHovered = drag?.hoverId === item.id
  const isValid = drag && isValidDrop(drag.item, item, items)

  return (
    <article style={{ position: 'relative' }}>
      <Plate accent={accent} style={{
        padding: '22px 26px 22px 36px',
        cursor: 'pointer',
        outline: isHovered ? `2px solid ${accent}` : isValid ? `1px dashed ${accent}99` : 'none',
        outlineOffset: -1,
        boxShadow: isHovered ? `0 0 0 1px 'var(--color-paper)', 0 0 32px ${accent}99, inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.18)` : undefined,
        transition: 'outline 0.12s, box-shadow 0.12s',
      }} dataDropId={item.id}>
        <div onClick={() => toggle(item.id)}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 14, marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
              <span style={{
                fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
                textTransform: 'uppercase', color: accent,
                textShadow: halate(accent, 'low'),
              }}>{`Goal ${String(index).padStart(2, '0')} · Year`}</span>
              {item.target && (
                <>
                  <span style={{ color: 'var(--color-faint)', opacity: 0.6 }}>·</span>
                  <span style={{
                    fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)',
                  }}>{item.target}</span>
                </>
              )}
            </div>
            <ExpandToggle open={open} count={months.length} childLabel="month" accent={accent}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggle(item.id) }} />
          </div>

          <h2 style={{
            fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 28,
            margin: 0, letterSpacing: '-0.025em', lineHeight: 1.12, color: 'var(--color-ink)',
          }}>
            {item.title}
            <span style={{ color: accent, textShadow: halate(accent, 'hi') }}>.</span>
          </h2>

          {item.notes && (
            <p style={{
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
              color: 'var(--color-muted)', margin: '8px 0 0', lineHeight: 1.45, maxWidth: 600,
            }}>"{item.notes}"</p>
          )}

          <div style={{ marginTop: 16 }}>
            <VUMeter pct={prog.pct} color={accent} segments={24} label={prog.total > 0 ? `${prog.pct}%` : '—'} />
          </div>
        </div>
      </Plate>

      {open && (
        <div style={{
          marginTop: 10, marginLeft: 18,
          paddingLeft: 18, borderLeft: `1px solid ${accent}55`,
          boxShadow: `inset 4px 0 12px -8px ${accent}66`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {months.map((m: any) => (
            <MonthNode
              key={m.id} item={m} items={items} today={today}
              accent={accent}
              isOpen={isOpen} toggle={toggle}
              onSelect={onSelect} onToggle={onToggle}
              onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
              selectedId={selectedId} readonly={readonly}
            />
          ))}
          {!readonly && (
            <AddSubtle
              childScope="month"
              accent={accent}
              placeholder="A month-level milestone…"
              onSubmit={(title: string) => onAddItem({
                kind: 'goal', scope: 'month',
                parent_id: item.id,
                title, accent, source: item.source || 'bb',
                year: item.year,
                month: (new Date()).getMonth() + 1,
              })}
            />
          )}
        </div>
      )}
    </article>
  )
}

function MonthNode({ item, items, today, accent, isOpen, toggle, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, readonly }: any) {
  const { drag, beginDrag } = useTasksDrag()
  const prog = getProgress(item, items)
  const weeks = getChildren(item, items).filter((c: any) => c.scope === 'week')
  const open = isOpen(item.id)
  const ml = monthLabel(item.month)
  const isHovered = drag?.hoverId === item.id
  const isValid = drag && isValidDrop(drag.item, item, items)
  const isBeingDragged = drag?.item?.id === item.id

  return (
    <div style={{ opacity: isBeingDragged ? 0.35 : 1 }}>
      <header
        data-drop-id={item.id}
        onClick={() => toggle(item.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 12px',
          background: open ? `${accent}14` : (isHovered ? `${accent}33` : 'transparent'),
          cursor: 'pointer',
          outline: isHovered ? `1.5px solid ${accent}` : isValid ? `1px dashed ${accent}55` : 'none',
          outlineOffset: -1,
          boxShadow: isHovered ? `0 0 18px ${accent}66` : 'none',
          transition: 'background 0.12s, outline 0.12s, box-shadow 0.12s',
        }}
      >
        <Caret open={open} color={accent} />
        <span style={{
          fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: accent,
          textShadow: halate(accent, 'low'),
          border: `1px solid ${accent}55`,
          padding: '3px 9px',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.18)',
        }}>{ml}</span>
        <h3 style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontWeight: 500, fontSize: 19,
          margin: 0, color: 'var(--color-ink)', lineHeight: 1.25, letterSpacing: '-0.015em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.title}</h3>
        <span style={{
          fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', flexShrink: 0,
        }}>{prog.total > 0 ? `${prog.done}/${prog.total}` : `${weeks.length}w`}</span>
        <DragHandle onMouseDown={(e: React.MouseEvent) => beginDrag(e, item)} />
      </header>

      {open && (
        <div style={{
          marginLeft: 22, paddingLeft: 16, marginTop: 6,
          borderLeft: `1px solid ${accent}33`,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {weeks.map((w: any) => (
            <WeekNode
              key={w.id} item={w} items={items} today={today}
              accent={accent}
              isOpen={isOpen} toggle={toggle}
              onSelect={onSelect} onToggle={onToggle}
              onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
              selectedId={selectedId} readonly={readonly}
            />
          ))}
          {!readonly && (
            <AddSubtle
              childScope="week"
              accent={accent}
              placeholder="A theme for one week…"
              onSubmit={(title: string) => onAddItem({
                kind: 'goal', scope: 'week',
                parent_id: item.id,
                title, accent, source: item.source || 'bb',
                week_start: weekStart(today),
              })}
            />
          )}
        </div>
      )}
    </div>
  )
}

function WeekNode({ item, items, today, accent, isOpen, toggle, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, readonly }: any) {
  const { drag, beginDrag } = useTasksDrag()
  const tasks = getChildren(item, items).filter((c: any) => c.kind === 'task')
  const open = isOpen(item.id)
  const done = tasks.filter((t: any) => t.completed).length
  const isHovered = drag?.hoverId === item.id
  const isValid = drag && isValidDrop(drag.item, item, items)
  const isBeingDragged = drag?.item?.id === item.id

  return (
    <div style={{ opacity: isBeingDragged ? 0.35 : 1 }}>
      <header
        data-drop-id={item.id}
        onClick={() => toggle(item.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px',
          cursor: 'pointer',
          background: isHovered ? `${accent}33` : 'transparent',
          outline: isHovered ? `1.5px solid ${accent}` : isValid ? `1px dashed ${accent}55` : 'none',
          outlineOffset: -1,
          boxShadow: isHovered ? `0 0 14px ${accent}55` : 'none',
          transition: 'background 0.12s, outline 0.12s, box-shadow 0.12s',
        }}
      >
        <Caret open={open} color={accent} small />
        <span style={{
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-faint)',
          flexShrink: 0,
        }}>week of</span>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 15,
          color: 'var(--color-ink)', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.title}</span>
        {tasks.length > 0 && (
          <span style={{
            fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)', flexShrink: 0,
          }}>{done}/{tasks.length}</span>
        )}
        <DragHandle onMouseDown={(e: React.MouseEvent) => beginDrag(e, item)} small />
      </header>

      {open && (
        <ul style={{
          listStyle: 'none', padding: 0, margin: '4px 0 8px',
          marginLeft: 18, paddingLeft: 16,
          borderLeft: `1px solid ${accent}26`,
        }}>
          {tasks.map((t: any) => (
            <TaskRow
              key={t.id} item={t} items={items} depth={0}
              onSelect={onSelect} onToggle={onToggle}
              onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
              selectedId={selectedId} accent={accent} readonly={readonly}
            />
          ))}
          {!readonly && (
            <li>
              <AddTaskInline
                accent={accent}
                onSubmit={(title: string) => onAddItem({
                  kind: 'task', scope: 'day',
                  parent_id: item.id,
                  title, accent, source: item.source || 'bb',
                  due_date: today,
                })}
              />
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function TaskRow({ item, items, depth, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, accent: parentAccent, readonly }: any) {
  const { drag, beginDrag } = useTasksDrag()
  const accent = getAccent(item, items) || parentAccent || 'var(--color-accent)'
  const subs = getChildren(item, items)
  const [expanded, setExpanded] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)
  const [showColors, setShowColors] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isSel = selectedId === item.id
  const isHovered = drag?.hoverId === item.id
  const isValid = drag && isValidDrop(drag.item, item, items)
  const isBeingDragged = drag?.item?.id === item.id

  const handleAdd = () => {
    if (!draft.trim()) { setAdding(false); return }
    onAddItem({
      kind: 'task', scope: 'subtask',
      parent_id: item.id, due_date: item.due_date,
      title: draft.trim(), source: item.source || 'bb',
      accent,
    })
    setDraft('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const commitTitle = () => {
    const t = titleDraft.trim()
    if (t && t !== item.title) onUpdateItem?.(item.id, { title: t })
    else setTitleDraft(item.title)
    setEditingTitle(false)
  }

  return (
    <li style={{ opacity: isBeingDragged ? 0.35 : 1 }}>
      <div
        data-drop-id={depth === 0 ? item.id : undefined}
        className="task-row"
        onClick={() => !editingTitle && onSelect(item)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: depth === 0 ? '8px 4px' : '5px 4px',
          borderBottom: `1px solid 'var(--color-line-strong)'`,
          cursor: editingTitle ? 'default' : 'pointer',
          background: isHovered ? `${accent}33` : (isSel ? 'var(--color-accent-soft)' : 'transparent'),
          outline: isHovered ? `1.5px solid ${accent}` : isValid && depth === 0 ? `1px dashed ${accent}55` : 'none',
          outlineOffset: -1,
          boxShadow: isHovered ? `0 0 12px ${accent}66` : 'none',
          transition: 'background 0.12s, outline 0.12s, box-shadow 0.12s',
          '--hover-bg': 'var(--color-paper-2)',
        } as any}
      >
        <button
          onClick={e => { e.stopPropagation(); if (subs.length) setExpanded(v => !v) }}
          style={{
            background: 'none', border: 'none',
            color: subs.length ? 'var(--color-muted)' : 'transparent',
            fontSize: 8, cursor: subs.length ? 'pointer' : 'default',
            padding: 0, lineHeight: 1, flexShrink: 0, width: 12,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >▶</button>

        <Checkbox id={item.id} completed={item.completed} onToggle={onToggle} size={depth === 0 ? 13 : 11} color={accent} />

        {depth === 0 && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); setShowColors(v => !v) }}
              title="Set color"
              style={{
                width: 10, height: 10,
                background: item.accent || 'var(--color-line-strong)',
                border: item.accent ? 'none' : `1px solid 'var(--color-line)'`,
                borderRadius: 0,
                cursor: 'pointer', padding: 0, flexShrink: 0,
                boxShadow: item.accent ? `0 0 6px ${item.accent}88` : 'none',
              }}
            />
            {showColors && (
              <div style={{ position: 'absolute', left: 0, top: 16, zIndex: 200 }}>
                <ColorPicker
                  current={item.accent}
                  onChange={(hex: string) => onUpdateItem?.(item.id, { accent: hex })}
                  onClose={() => setShowColors(false)}
                />
              </div>
            )}
          </div>
        )}

        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') { setTitleDraft(item.title); setEditingTitle(false) }
            }}
            onBlur={commitTitle}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0,
              background: 'transparent', border: 'none',
              borderBottom: `1px solid 'var(--color-line)'`,
              fontFamily: FONT_BODY, fontSize: depth === 0 ? 14 : 12.5,
              color: 'var(--color-ink)', outline: 'none', padding: '1px 0',
            }}
          />
        ) : (
          <span
            onDoubleClick={e => { e.stopPropagation(); setTitleDraft(item.title); setEditingTitle(true) }}
            title="Double-click to edit"
            style={{
              flex: 1, minWidth: 0,
              fontFamily: FONT_BODY,
              fontSize: depth === 0 ? 14 : 12.5,
              color: item.completed ? 'var(--color-muted)' : 'var(--color-ink)',
              textDecoration: item.completed ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{item.title}</span>
        )}

        {item.due_date && depth === 0 && (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 10, color: 'var(--color-muted)',
            letterSpacing: '0.08em', flexShrink: 0,
          }}>
            {fmtWeekday(item.due_date)} {localDate(item.due_date).getDate()}
          </span>
        )}

        {item.scheduled_time && (
          <span style={{
            fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 11.5,
            color: accent, flexShrink: 0,
            textShadow: halate(accent, 'low'),
          }}>{fmtTime(item.scheduled_time)}</span>
        )}

        {subs.length > 0 && (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 10, color: 'var(--color-muted)', flexShrink: 0,
          }}>{subs.filter((s: any) => s.completed).length}/{subs.length}</span>
        )}

        {!readonly && (
          <button
            onClick={e => { e.stopPropagation(); setAdding(true); setExpanded(true) }}
            title="Add a smaller step"
            style={{
              background: 'none', border: 'none', color: 'var(--color-faint)',
              fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: '0 3px', flexShrink: 0,
            }}
          >+</button>
        )}
        {!readonly && (
          <button
            onClick={e => { e.stopPropagation(); onDelete?.(item.id) }}
            style={{
              background: 'none', border: 'none', color: 'var(--color-faint)',
              fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0,
              opacity: 0.6,
            }}
          >✕</button>
        )}
        <DragHandle onMouseDown={(e: React.MouseEvent) => beginDrag(e, item)} small />
      </div>

      {expanded && (subs.length > 0 || adding) && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginLeft: 16, paddingLeft: 10, borderLeft: `1px solid 'var(--color-line-strong)'` }}>
          {subs.map((s: any) => (
            <TaskRow
              key={s.id} item={s} items={items} depth={depth + 1}
              onSelect={onSelect} onToggle={onToggle}
              onAddItem={onAddItem} onDelete={onDelete} onUpdateItem={onUpdateItem}
              selectedId={selectedId} accent={accent} readonly={readonly}
            />
          ))}
          {adding && (
            <li style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '5px 4px',
              borderBottom: `1px solid 'var(--color-line-strong)'`,
            }} onClick={e => e.stopPropagation()}>
              <span style={{ width: 12 }} />
              <span style={{ width: 11, height: 11, border: `1px solid 'var(--color-line)'`, flexShrink: 0 }} />
              <input
                ref={inputRef} autoFocus value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd()
                  if (e.key === 'Escape') { setAdding(false); setDraft('') }
                }}
                onBlur={() => { if (!draft.trim()) setAdding(false) }}
                placeholder="A smaller step…"
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  borderBottom: `1px solid 'var(--color-line)'`,
                  fontFamily: FONT_BODY, fontSize: 12.5,
                  color: 'var(--color-ink)', outline: 'none', padding: '2px 0',
                }}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function DragHandle({ onMouseDown, small }: any) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      title="Drag to reparent"
      style={{
        flexShrink: 0,
        cursor: 'grab',
        padding: '0 4px',
        color: 'var(--color-faint)', fontSize: small ? 10 : 12,
        letterSpacing: '-0.1em', lineHeight: 1,
        userSelect: 'none',
        opacity: 0.55,
        transition: 'opacity 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = 'var(--color-muted)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.55'; (e.currentTarget as HTMLElement).style.color = 'var(--color-faint)' }}
    >⠿</span>
  )
}

function DragPill({ drag, items }: any) {
  const item = drag.item
  const accent = getAccent(item, items) || 'var(--color-accent)'
  const valid = drag.hoverId !== null

  const pill = (
    <div style={{
      position: 'fixed',
      left: drag.pos.x + 14,
      top:  drag.pos.y + 14,
      pointerEvents: 'none',
      zIndex: 99999,
      background: accent,
      color: 'rgba(255,255,255,0.96)',
      fontFamily: FONT_BODY, fontSize: 12, letterSpacing: '0.02em',
      padding: '7px 14px',
      maxWidth: 320,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      transform: `rotate(${valid ? -2 : -4}deg) scale(${valid ? 1.04 : 1})`,
      boxShadow: `
        0 0 24px ${accent}99,
        0 0 48px ${accent}55,
        0 12px 32px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.18),
        inset 0 -1px 0 rgba(0,0,0,0.18)
      `,
      transition: 'transform 0.12s',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{
        fontFamily: FONT_BODY, fontSize: 8, letterSpacing: '0.22em',
        textTransform: 'uppercase', opacity: 0.6,
        padding: '1px 5px', border: `1px solid rgba(255,255,255,0.25)`,
      }}>{item.scope}</span>
      <span>{item.title}</span>
      {valid && (
        <span style={{
          fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
          textTransform: 'uppercase', opacity: 0.7,
          paddingLeft: 8, marginLeft: 2, borderLeft: `1px solid rgba(255,255,255,0.25)`,
        }}>release →</span>
      )}
    </div>
  )

  return ReactDOM.createPortal(pill, document.body)
}

function ExpandToggle({ open, count, childLabel, accent, onClick }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        background: 'transparent', border: `1px solid ${open ? accent : 'var(--color-line)'}`,
        padding: '4px 10px', cursor: 'pointer',
        fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
        textTransform: 'uppercase', color: open ? accent : 'var(--color-muted)',
        flexShrink: 0,
        textShadow: open ? halate(accent, 'low') : 'none',
        boxShadow: open
          ? `inset 0 1px 0 rgba(0,0,0,0.3), 0 0 12px ${accent}33`
          : `inset 0 1px 0 rgba(255,255,255,0.04)`,
        transition: 'border-color 0.15s, color 0.15s, box-shadow 0.15s',
      }}
    >
      <Caret open={open} color={open ? accent : 'var(--color-muted)'} small />
      {count > 0 ? `${count} ${childLabel}${count === 1 ? '' : 's'}` : 'open'}
    </button>
  )
}

function Caret({ open, color, small }: any) {
  const sz = small ? 7 : 9
  return (
    <span style={{
      display: 'inline-block', fontSize: sz, lineHeight: 1,
      color, flexShrink: 0,
      transform: open ? 'rotate(90deg)' : 'none',
      transition: 'transform 0.15s',
      width: sz + 2,
    }}>▶</span>
  )
}

function AddPlate({ label, placeholder, onSubmit }: any) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const handle = () => {
    if (!draft.trim()) { setAdding(false); return }
    onSubmit(draft.trim())
    setDraft(''); setAdding(false)
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{
          background: 'transparent', border: `1px dashed 'var(--color-line)'`,
          padding: '16px 22px',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
          color: 'var(--color-muted)', cursor: 'pointer',
          width: '100%', textAlign: 'left',
        }}
      >{label}</button>
    )
  }

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'baseline',
      padding: '16px 22px',
      border: `1px solid 'var(--color-line)'`, background: 'var(--color-paper-2)',
    }}>
      <input
        autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handle()
          if (e.key === 'Escape') { setAdding(false); setDraft('') }
        }}
        placeholder={placeholder}
        style={{
          flex: 1, background: 'transparent', border: 'none',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 19,
          color: 'var(--color-ink)', outline: 'none',
        }}
      />
      <button onClick={handle} className="btn-action" style={{
        background: 'var(--color-accent)', color: 'var(--color-paper)', border: 'none',
        fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
        textTransform: 'uppercase', padding: '8px 16px', cursor: 'pointer',
        boxShadow: '0 0 16px var(--color-accent-glow)',
      }}>Stamp →</button>
    </div>
  )
}

function AddSubtle({ accent, placeholder, onSubmit, childScope }: any) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const handle = () => {
    if (!draft.trim()) { setAdding(false); return }
    onSubmit(draft.trim())
    setDraft(''); setAdding(false)
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{
          background: 'transparent', border: 'none',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12,
          color: 'var(--color-faint)', cursor: 'pointer',
          padding: '6px 12px', textAlign: 'left',
          textDecoration: 'underline', textDecorationStyle: 'dotted',
          textUnderlineOffset: 3, textDecorationColor: ((accent || 'var(--color-muted)') + '70') as any,
        }}
      >+ break down further</button>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px' }}>
      <span style={{
        fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
        textTransform: 'uppercase', color: accent,
        textShadow: halate(accent, 'low'),
        border: `1px solid ${accent}55`,
        padding: '2px 8px', flexShrink: 0,
      }}>{childScope}</span>
      <input
        autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handle()
          if (e.key === 'Escape') { setAdding(false); setDraft('') }
        }}
        onBlur={() => { if (!draft.trim()) setAdding(false) }}
        placeholder={placeholder}
        style={{
          flex: 1, background: 'transparent', border: 'none',
          borderBottom: `1px solid 'var(--color-line)'`,
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
          color: 'var(--color-ink)', outline: 'none', padding: '2px 0',
        }}
      />
    </div>
  )
}

function AddTaskInline({ accent, onSubmit }: any) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const handle = () => {
    if (!draft.trim()) { setAdding(false); return }
    onSubmit(draft.trim())
    setDraft('')
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none',
          padding: '8px 4px',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
          color: 'var(--color-faint)', cursor: 'pointer',
        }}
      >+ Add a concrete task</button>
    )
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '8px 4px',
      borderBottom: `1px solid 'var(--color-line-strong)'`,
    }}>
      <span style={{ width: 12 }} />
      <span style={{ width: 13, height: 13, border: `1px solid 'var(--color-line)'`, flexShrink: 0 }} />
      <input
        autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handle()
          if (e.key === 'Escape') { setAdding(false); setDraft('') }
        }}
        placeholder="A concrete task…"
        style={{
          flex: 1, background: 'transparent', border: 'none',
          borderBottom: `1px solid 'var(--color-line)'`,
          fontFamily: FONT_BODY, fontSize: 13.5,
          color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
        }}
      />
      <button onClick={handle} className="btn-action" style={{
        background: accent || 'var(--color-accent)', color: 'var(--color-paper)', border: 'none',
        fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.14em',
        textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer',
        boxShadow: halate(accent || 'var(--color-accent)', 'mid'),
      }}>Add</button>
    </div>
  )
}

function miniBtn(_?: any) {
  return {
    background: 'transparent', border: `1px solid 'var(--color-line)'`,
    fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.18em',
    textTransform: 'uppercase' as const, color: 'var(--color-muted)', cursor: 'pointer',
    padding: '5px 11px',
  }
}

function monthLabel(m: number) {
  if (!m) return ''
  return new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
}

import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, sourceOf } from '../../lib/theme'
import { getAncestors, getChildren, getAccent } from '../../lib/seed'
import { Eyebrow, SourceDot, Checkbox } from './MobileWidgets'

/**
 * Sheets — Detail + Add modal components that slide up from bottom
 */

export interface SheetProps {
  onClose: () => void
  children: React.ReactNode
  maxH?: string | number
}

export function Sheet({ onClose, children, maxH }: SheetProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(0,0,0,0.45)',
        animation: 'bb-fade 0.2s ease both',
      }}
    >
      <div
        className="bb-sheetin"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: maxH || '82%',
          overflowY: 'auto',
          background: 'var(--color-card)',
          borderTop: `1px solid ${'var(--color-line)'}`,
          borderTopLeftRadius: false ? 14 : 6,
          borderTopRightRadius: false ? 14 : 6,
          boxShadow: '0 -16px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <span style={{ width: 40, height: 4, borderRadius: 3, background: 'var(--color-line)' }} />
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * DetailSheet — shows a single item's details with editing capabilities
 */

export interface DetailSheetProps {
  item: any
  items: any[]
  onClose: () => void
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onUpdate: (id: number, patch: any) => void
  onCreate: (partial: any) => any
  onSelect: (item: any) => void
}

export function DetailSheet({
  item,
  items,
  onClose,
  onToggle,
  onDelete,
  onUpdate,
  onCreate,
  onSelect,
}: DetailSheetProps) {
  const isEvent = item.kind === 'event'
  const accent = isEvent
    ? item.accent || sourceOf(item.source).hex
    : getAccent(item, items) || 'var(--color-accent)'
  const ancestors = getAncestors(item, items).slice().reverse()
  const src = sourceOf(item.source)
  const subtasks = getChildren(item, items).filter((k: any) => k.kind === 'task')

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [moving, setMoving] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [subDraft, setSubDraft] = useState('')

  const commitTitle = () => {
    const t = title.trim()
    if (t && t !== item.title) onUpdate(item.id, { title: t })
    setEditing(false)
  }

  const addSub = () => {
    const t = subDraft.trim()
    if (t) {
      onCreate({ kind: 'task', title: t, parent_id: item.id })
      setSubDraft('')
    }
  }

  const targets = items.filter((g: any) => g.kind === 'goal' && g.id !== item.id)

  return (
    <Sheet onClose={onClose}>
      <div style={{ padding: '12px 22px 28px', position: 'relative' }}>
        {accent && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              background: accent,
              boxShadow: `0 0 8px ${accent}66`,
            }}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <SourceDot hex={accent} size={8} />
            <Eyebrow color={'var(--color-muted)'}>
              {isEvent ? src.label : item.kind === 'goal' ? 'Goal' : item.kind === 'milestone' ? 'Checkpoint' : 'Task'}
            </Eyebrow>
          </div>
          <button
            onClick={onClose}
            className="bb-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-faint)',
              fontSize: 18,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* title — tap to rename */}
        {editing && !isEvent ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setTitle(item.title)
                setEditing(false)
              }
            }}
            onBlur={commitTitle}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              borderBottom: `1px solid ${accent}`,
              fontFamily: FONT_HEAD,
              fontWeight: 500,
              fontSize: 26,
              color: 'var(--color-ink)',
              letterSpacing: '-0.02em',
              padding: '0 0 4px',
            }}
          />
        ) : (
          <h2
            onClick={() => !isEvent && setEditing(true)}
            style={{
              fontFamily: FONT_HEAD,
              fontWeight: 500,
              fontSize: 26,
              lineHeight: 1.15,
              margin: 0,
              color: 'var(--color-ink)',
              letterSpacing: '-0.02em',
              textDecoration: item.completed ? 'line-through' : 'none',
              cursor: isEvent ? 'default' : 'text',
            }}
          >
            {item.title}
          </h2>
        )}

        {ancestors.length > 0 && (
          <div style={{ marginTop: 10, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-muted)' }}>
            {ancestors.map((a: any) => a.title).join('  ›  ')}
          </div>
        )}

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {!isEvent && (
            <div>
              <button
                onClick={() => onDelete(item.id)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${'var(--color-accent)'}`,
                  color: 'var(--color-accent)',
                  textShadow: 'var(--accent-halo-text)',
                  cursor: 'pointer',
                  fontFamily: FONT_BODY,
                  fontSize: 12,
                  padding: '6px 12px',
                  borderRadius: 2,
                  width: '100%',
                  marginTop: 16,
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/**
 * AddSheet — form to create a new task
 */

export interface AddSheetProps {
  date: string
  today: string
  items: any[]
  onClose: () => void
  onAdd: (partial: any) => any
}

export function AddSheet({ date, today, items, onClose, onAdd }: AddSheetProps) {
  const [title, setTitle] = useState('')

  const handleAdd = () => {
    if (title.trim()) {
      onAdd({
        kind: 'task',
        title: title.trim(),
        due_date: date,
      })
      setTitle('')
      onClose()
    }
  }

  return (
    <Sheet onClose={onClose}>
      <div style={{ padding: '20px 22px 28px' }}>
        <h3
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 20,
            fontWeight: 500,
            margin: '0 0 16px',
            color: 'var(--color-ink)',
          }}
        >
          New Task
        </h3>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Task name…"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontFamily: FONT_BODY,
            fontSize: 14,
            border: `1px solid ${'var(--color-line)'}`,
            borderRadius: 4,
            background: 'var(--color-paper)',
            color: 'var(--color-ink)',
            marginBottom: 16,
            outline: 'none',
          }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px',
              background: 'transparent',
              border: `1px solid ${'var(--color-line)'}`,
              color: 'var(--color-ink)',
              cursor: 'pointer',
              fontFamily: FONT_BODY,
              borderRadius: 2,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            style={{
              flex: 1,
              padding: '10px',
              background: 'var(--color-accent)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: FONT_BODY,
              fontWeight: 600,
              borderRadius: 2,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </Sheet>
  )
}

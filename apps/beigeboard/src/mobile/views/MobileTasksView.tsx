import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM } from '../../lib/theme'
import { getChildren, getProgress } from '../../lib/seed'
import { Eyebrow } from '../components/MobileWidgets'

/**
 * Mobile Tasks View — goals as cassettes with VU progress meters
 */

export interface MobileTasksViewProps {
  items: any[]
  today: string
  onSelect: (item: any) => void
  onToggle: (id: number) => void
  onCreate: (partial: any) => any
  onUpdate: (id: number, patch: any) => void
}

export function MobileTasksView({
  items,
  today,
  onSelect,
  onToggle,
  onCreate,
  onUpdate,
}: MobileTasksViewProps) {
  const goals = items.filter((it: any) => it.kind === 'goal' && it.scope === 'year')
  const [open, setOpen] = useState(() => (goals[0] ? { [goals[0].id]: true } : {}))
  const [addingGoal, setAddingGoal] = useState(false)

  const total = items.filter((it: any) => it.kind === 'task')
  const doneCount = total.filter((t: any) => t.completed).length
  const overallPct = total.length ? Math.round((doneCount / total.length) * 100) : 0

  return (
    <div className="bb-scroll" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: '22px 18px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <Eyebrow>The workshop</Eyebrow>
            <h1
              style={{
                fontFamily: FONT_HEAD,
                fontWeight: 500,
                fontSize: 30,
                margin: '6px 0 0',
                letterSpacing: '-0.02em',
                color: 'var(--color-ink)',
              }}
            >
              Goals
            </h1>
          </div>
          <button
            onClick={() => setAddingGoal(true)}
            style={{
              background: 'transparent',
              border: `1px solid ${'var(--color-accent)'}`,
              color: 'var(--color-accent)',
              cursor: 'pointer',
              fontFamily: FONT_BODY,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '6px 10px',
              borderRadius: 2,
            }}
          >
            + Goal
          </button>
        </div>

        {/* overall shelf meter */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <Eyebrow>The year · all reels</Eyebrow>
            <Eyebrow color={'var(--color-muted)'}>
              {doneCount}/{total.length}
            </Eyebrow>
          </div>
          <VUMeter pct={overallPct} color={'var(--color-accent)'} label={`${overallPct}%`} />
        </div>

        {addingGoal && (
          <div style={{ marginBottom: 14 }}>
            <InlineAdd
              onAdd={(title) => {
                onCreate({ kind: 'goal', scope: 'year', title, accent: 'var(--color-accent)' })
                setAddingGoal(false)
              }}
              onClose={() => setAddingGoal(false)}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {goals.map((g: any) => (
            <Cassette
              key={g.id}
              goal={g}
              items={items}
              isOpen={!!open[g.id]}
              onToggleOpen={() => setOpen((o: any) => ({ ...o, [g.id]: !o[g.id] }))}
              onSelect={onSelect}
              onToggle={onToggle}
              onCreate={onCreate}
              onUpdate={onUpdate}
            />
          ))}
        </div>
        <div style={{ height: 16 }} />
      </div>
    </div>
  )
}

function Cassette({ goal, items, isOpen, onToggleOpen, onSelect, onToggle, onCreate, onUpdate }: any) {
  const accent = goal.accent || 'var(--color-accent)'
  const prog = getProgress(goal, items)
  const kids = getChildren(goal, items)
  const projects = kids.filter((k: any) => k.kind === 'goal')
  const looseTasks = kids.filter((k: any) => k.kind === 'task')
  const active = prog.pct > 0 && prog.pct < 100
  const [addingList, setAddingList] = useState(false)

  return (
    <div
      style={{
        border: `1px solid ${accent}`,
        borderRadius: 4,
        background: 'rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
    >
      {/* cassette face */}
      <div onClick={onToggleOpen} style={{ padding: '16px 16px 15px 20px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <h2
              style={{
                fontFamily: FONT_HEAD,
                fontWeight: 500,
                fontSize: 18,
                margin: 0,
                color: 'var(--color-ink)',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {goal.title}
            </h2>
          </div>
          <span
            style={{
              fontFamily: FONT_NUM,
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--color-faint)',
              flexShrink: 0,
              transform: isOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          >
            ›
          </span>
        </div>

        <VUMeter pct={prog.pct} color={accent} label={`${prog.pct}%`} />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9 }}>
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 9,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--color-faint)',
            }}
          >
            {prog.done} of {prog.total} tracks
          </span>
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 9,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: active ? accent : 'var(--color-faint)',
            }}
          >
            {prog.pct === 100 && prog.total ? 'Side complete' : active ? 'Playing' : 'Cued'}
          </span>
        </div>
      </div>

      {/* expanded body */}
      {isOpen && (
        <div
          className="bb-itemin"
          style={{
            borderTop: `1px solid ${'var(--color-line-strong)'}`,
            background: 'rgba(0,0,0,0.2)',
            padding: '4px 14px 12px',
          }}
        >
          {looseTasks.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {looseTasks.map((t: any) => (
                  <div
                    key={t.id}
                    onClick={() => onSelect(t)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      cursor: 'pointer',
                      fontSize: 13,
                      borderRadius: 2,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={t.completed}
                      onChange={() => onToggle(t.id)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ flex: 1, color: t.completed ? 'var(--color-muted)' : 'var(--color-ink)' }}>
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {projects.length > 0 && (
            <div>
              {projects.map((p: any) => (
                <ProjectRow key={p.id} project={p} items={items} onSelect={onSelect} />
              ))}
            </div>
          )}

          {addingList ? (
            <InlineAdd
              onAdd={(title) => {
                onCreate({ kind: 'goal', scope: 'project', title, parent_id: goal.id })
                setAddingList(false)
              }}
              onClose={() => setAddingList(false)}
            />
          ) : (
            <button
              onClick={() => setAddingList(true)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: `1px dashed ${'var(--color-line)'}`,
                color: 'var(--color-faint)',
                cursor: 'pointer',
                padding: '8px 8px',
                fontFamily: FONT_BODY,
                fontSize: 12,
                borderRadius: 2,
                marginTop: looseTasks.length > 0 ? 8 : 0,
              }}
            >
              + Add list
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ProjectRow({ project, items, onSelect }: any) {
  const prog = getProgress(project, items)
  return (
    <div onClick={() => onSelect(project)} style={{ marginBottom: 8, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontFamily: FONT_HEAD, fontSize: 13, color: 'var(--color-ink)', fontWeight: 500 }}>
          {project.title}
        </span>
        <span style={{ fontFamily: FONT_NUM, fontSize: 11, color: 'var(--color-faint)' }}>{prog.pct}%</span>
      </div>
      <VUMeter pct={prog.pct} color={'var(--color-accent)'} />
    </div>
  )
}

function VUMeter({ pct = 0, color, label }: any) {
  const accent = color || 'var(--color-accent)'
  const lit = Math.round((pct / 100) * 20)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          gap: 2,
          padding: 3,
          background: 'rgba(0,0,0,0.4)',
          border: `1px solid ${'var(--color-line)'}`,
          boxShadow: `inset 0 2px 4px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.06)`,
        }}
      >
        {Array.from({ length: 20 }, (_, i) => {
          const isLit = i < lit
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: 6,
                background: isLit ? accent : 'rgba(0,0,0,0.5)',
                opacity: isLit ? 1 : 0.45,
                transition: 'background 0.2s',
              }}
            />
          )
        })}
      </div>
      {label && (
        <span
          style={{
            fontFamily: FONT_NUM,
            fontStyle: 'italic',
            fontSize: 12,
            color: pct >= 80 ? 'var(--color-accent)' : accent,
            minWidth: 32,
            textAlign: 'right',
            textShadow: `0 0 8px ${pct >= 80 ? 'var(--color-accent)' : accent}66`,
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

function InlineAdd({ onAdd, onClose }: any) {
  const [title, setTitle] = React.useState('')

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onAdd(title)
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Name…"
        style={{
          flex: 1,
          padding: '6px 8px',
          fontFamily: FONT_BODY,
          fontSize: 12,
          border: `1px solid ${'var(--color-line)'}`,
          borderRadius: 2,
          background: 'var(--color-paper)',
          color: 'var(--color-ink)',
          outline: 'none',
        }}
      />
      <button
        onClick={() => onAdd(title)}
        style={{
          padding: '6px 12px',
          background: 'var(--color-accent)',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontFamily: FONT_BODY,
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 2,
        }}
      >
        Add
      </button>
    </div>
  )
}

import React from 'react'
import { FONT_HEAD, FONT_BODY, weekStart } from '../../lib/theme'
import { getChildren, getAccent, getAncestors } from '../../lib/seed'
import {
  stepsOf, actionsOf, currentStep, nodeProgress, nodeCleared, paceOf, fmtTarget,
} from '../../lib/plan'
import { Eyebrow, Checkbox } from '../../components/SharedComponents'
import { Press, Lab, Pill, Sheet } from '@jkos/ui'
import { StateGlyph, AddInline, DoneMeans, CommitControl, tinyLink } from './bits'

/*
 * A drilled-in node — a goal or a checkpoint at any depth. Header chrome, then the
 * two ladders that hang off it: StepList (checkpoint children, position-ordered,
 * the current one emphasised) and ActionList (task children, each commit-able to
 * the week or a day). Only the current path is broken down; everything else waits.
 */
export function NodePage({ node, items, today, weekIso, drill, onSelect, onToggle, onAddItem, onDelete, onUpdateItem, selectedId, readonly }: any) {
  const accent = getAccent(node, items) || node.accent || 'var(--color-accent)'
  const steps  = stepsOf(node, items)
  const actions = actionsOf(node, items)
  const cur    = currentStep(node, items)
  const isGoal = node.kind === 'goal'

  const trail = [
    { id: null as number | null, label: 'Workshop' },
    ...getAncestors(node, items).slice().reverse().map((a: any) => ({ id: a.id, label: a.title })),
  ]

  const moveStep = (m: any, dir: -1 | 1) => {
    const idx = steps.findIndex(s => s.id === m.id)
    const j = idx + dir
    if (j < 0 || j >= steps.length) return
    onUpdateItem(m.id, { position: j })
    onUpdateItem(steps[j].id, { position: idx })
  }

  const nextPos = (steps[steps.length - 1]?.position ?? steps.length - 1) + 1

  return (
    <div>
      {/* Breadcrumb — the zoom level */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {trail.map((c, i) => (
          <React.Fragment key={`${c.id}-${i}`}>
            {i > 0 && <span style={{ color: 'var(--color-faint)', fontSize: 12 }}>›</span>}
            <button
              onClick={() => drill(c.id)}
              style={{
                ...tinyLink(), textDecoration: 'none', maxWidth: 220,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >{c.label}</button>
          </React.Fragment>
        ))}
        <span style={{ color: 'var(--color-faint)', fontSize: 12 }}>›</span>
        <span style={{
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)',
          maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{node.title}</span>
      </nav>

      <NodeHeader node={node} items={items} accent={accent} today={today} isGoal={isGoal}
                  onSelect={onSelect} onUpdateItem={onUpdateItem} onToggle={onToggle} readonly={readonly} />

      {/* The checkpoint ladder */}
      <section style={{ marginTop: 22 }}>
        <Eyebrow color={accent}>{isGoal ? 'The ladder' : 'Sub-checkpoints'}</Eyebrow>
        {steps.length === 0 ? (
          <LadderPrompt node={node} accent={accent} onAddItem={onAddItem} readonly={readonly} />
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column' }}>
            {steps.map((m: any, i: number) => (
              <StepRow
                key={m.id} m={m} index={i + 1} items={items} accent={accent}
                isCurrent={cur?.id === m.id} drill={drill}
                canUp={i > 0} canDown={i < steps.length - 1} moveStep={moveStep}
                onSelect={onSelect} onDelete={onDelete} readonly={readonly}
              />
            ))}
          </ol>
        )}
        {steps.length > 0 && !readonly && (
          <AddInline
            label="+ step"
            placeholder="A checkpoint you could prove you passed…"
            onSubmit={(title: string) => onAddItem({
              kind: 'milestone', parent_id: node.id, title, source: 'bb', position: nextPos,
            })}
          />
        )}
      </section>

      {/* The next actions parented directly here */}
      {(actions.length > 0 || !readonly) && (
        <section style={{ marginTop: 24 }}>
          <Eyebrow color={accent}>Next actions</Eyebrow>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {actions.map((t: any) => (
              <TaskRow
                key={t.id} item={t} items={items} today={today} weekIso={weekIso} accent={accent} depth={0}
                onSelect={onSelect} onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem}
                onAddItem={onAddItem} selectedId={selectedId} readonly={readonly}
              />
            ))}
          </ul>
          {!readonly && (
            <AddInline
              label="+ next action" weekChip dayChips today={today}
              placeholder="Small enough to finish in one sitting…"
              onSubmit={(title: string, commit: any) => onAddItem({
                kind: 'task', scope: 'day', parent_id: node.id, title, source: 'bb',
                due_date:   commit.due || null,
                week_start: commit.bench ? weekIso : (commit.due ? weekStart(commit.due) : null),
              })}
            />
          )}
        </section>
      )}
    </div>
  )
}

/* ── Header: definition, progress, and the clear/done moment ───────────── */
function NodeHeader({ node, items, accent, today, isGoal, onSelect, onUpdateItem, onToggle, readonly }: any) {
  const prog    = nodeProgress(node, items)
  const cleared = nodeCleared(node, items)
  const pace    = isGoal ? paceOf(node, items, today) : null

  return (
    <header>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <Lab size="sm" as="span" className="jk-glow-text jk-glow-low" style={{ color: accent, '--jk-glow-color': accent } as React.CSSProperties}>
          {isGoal ? 'Goal' : 'Checkpoint'}
        </Lab>
        {isGoal && node.target_date && <Lab size="sm" as="span">by {fmtTarget(node.target_date)}</Lab>}
        {pace && (pace === 'behind'
          ? <span style={{
              fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--hub-radius-lg)',
              padding: '2px 7px', textShadow: 'var(--accent-halo-text)',
            }}>{pace}</span>
          : <Pill><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-ok)', flexShrink: 0 }} />{pace}</Pill>
        )}
      </div>

      <h1
        onClick={() => onSelect(node)}
        title="Open details"
        style={{
          fontFamily: FONT_HEAD, fontWeight: 600, fontSize: isGoal ? 32 : 26, cursor: 'pointer',
          margin: 0, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--color-ink)',
          fontStyle: isGoal ? 'normal' : 'italic',
        }}
      >
        {node.title}
        <Press large as="span" className="jk-glow-text jk-glow-hi" style={{ color: accent, '--jk-glow-color': accent } as React.CSSProperties}>.</Press>
      </h1>

      <DoneMeans node={node} onUpdateItem={onUpdateItem} readonly={readonly} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
        <div className="bb-prog-track">
          <div className="progress-fill" style={{ width: `${prog.pct}%`, height: '100%', background: accent, boxShadow: `0 0 8px ${accent}66` }} />
        </div>
        <Lab size="sm" as="span">{prog.total > 0 ? `${prog.done}/${prog.total} ${prog.unit}` : '—'}</Lab>
      </div>

      {cleared && !readonly && (
        <div style={{
          marginTop: 14, padding: '13px 16px',
          border: `1px solid ${accent}55`, background: `${accent}12`,
          borderRadius: 'var(--hub-radius-lg)',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14.5, color: 'var(--color-ink)', flex: 1 }}>
            {isGoal ? 'Every checkpoint passed. Call it done?' : 'Every action here is done.'}
          </span>
          <button
            onClick={() => isGoal ? onUpdateItem(node.id, { status: 'done' }) : onToggle(node.id, node.completed)}
            className="btn-action jk-glow jk-glow-mid"
            style={{
              background: accent, color: 'var(--color-paper)', border: 'none',
              borderRadius: 'var(--hub-radius-button)',
              fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.16em',
              textTransform: 'uppercase', padding: '8px 15px', cursor: 'pointer',
              '--jk-glow-color': accent,
            } as React.CSSProperties}
          >{isGoal ? 'Mark the goal done →' : 'Checkpoint passed →'}</button>
        </div>
      )}
    </header>
  )
}

/* ── One rung — a checkpoint child, drill-in to break it down further ──── */
function StepRow({ m, index, items, accent, isCurrent, drill, canUp, canDown, moveStep, onSelect, onDelete, readonly }: any) {
  const kids  = getChildren(m, items)
  const prog  = nodeProgress(m, items)
  const empty = kids.length === 0
  const state: 'done' | 'current' | 'later' = m.completed ? 'done' : isCurrent ? 'current' : 'later'

  const inner = (
    <div
      onClick={() => drill(m.id)}
      title="Open this checkpoint"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: isCurrent ? '2px 2px' : '9px 10px', cursor: 'pointer',
        opacity: state === 'later' ? 0.62 : 1,
      }}
    >
      <Lab size="sm" as="span" className={isCurrent ? 'jk-glow-text jk-glow-low' : undefined} style={{
        color: state === 'done' ? 'var(--color-faint)' : accent,
        width: 22, flexShrink: 0, textAlign: 'right', '--jk-glow-color': accent,
      } as React.CSSProperties}>{String(index).padStart(2, '0')}</Lab>

      <StateGlyph state={state} accent={accent} />

      <span
        onClick={e => { e.stopPropagation(); onSelect(m) }}
        title="Open details"
        style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontWeight: 500,
          fontSize: isCurrent ? 17 : 15.5,
          color: state === 'done' ? 'var(--color-muted)' : 'var(--color-ink)',
          textDecoration: state === 'done' ? 'line-through' : 'none',
          lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{m.title}</span>

      {isCurrent && (
        <span className="jk-glow-text jk-glow-low" style={{
          fontFamily: 'var(--hub-font-mono)', fontSize: 8.5, letterSpacing: '0.18em',
          textTransform: 'uppercase', fontWeight: 600, color: accent,
          background: `color-mix(in srgb, ${accent} 16%, var(--color-card))`,
          padding: '3px 9px', flexShrink: 0, '--jk-glow-color': accent,
        } as React.CSSProperties}>current</span>
      )}
      {prog.total > 0 && <Lab size="sm" as="span" style={{ flexShrink: 0 }}>{prog.done}/{prog.total}</Lab>}

      {!readonly && (
        <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
          <button onClick={() => moveStep(m, -1)} disabled={!canUp}   title="Move up"   style={reorderBtn(canUp)}>↑</button>
          <button onClick={() => moveStep(m, 1)}  disabled={!canDown} title="Move down" style={reorderBtn(canDown)}>↓</button>
        </span>
      )}
      {!readonly && empty && !m.completed && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(m.id) }}
          title="Remove checkpoint"
          style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: 0.6 }}
        >✕</button>
      )}
      <span aria-hidden style={{ color: 'var(--color-faint)', fontSize: 13, flexShrink: 0 }}>→</span>
    </div>
  )

  if (isCurrent) {
    return <li style={{ margin: '8px 0' }}><Sheet style={{ padding: '10px 12px' }}>{inner}</Sheet></li>
  }
  return <li style={{ borderBottom: '1px solid var(--color-line-strong)' }}>{inner}</li>
}

function reorderBtn(enabled: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none', color: enabled ? 'var(--color-muted)' : 'var(--color-faint)',
    fontSize: 11, cursor: enabled ? 'pointer' : 'default', lineHeight: 1, padding: '0 1px', opacity: enabled ? 0.8 : 0.3,
  }
}

/* ── A next action, with one-tap commit (week/day) ─────────────────────── */
function TaskRow({ item, items, today, weekIso, accent, depth, onSelect, onToggle, onDelete, onUpdateItem, onAddItem, selectedId, readonly }: any) {
  const subs = getChildren(item, items)
  const a = getAccent(item, items) || accent
  const grew = subs.length > 0   // a task that sprouted its own steps is checkpoint-sized

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
          <CommitControl item={item} today={today} weekIso={weekIso} accent={a} onUpdateItem={onUpdateItem} readonly={readonly} />
        )}

        {grew && !readonly && (
          <button
            onClick={e => { e.stopPropagation(); onUpdateItem(item.id, { kind: 'milestone' }) }}
            title="Make it a checkpoint (it grew its own steps)"
            style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 12, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: 0.7 }}
          >⇗</button>
        )}
        {!readonly && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(item.id) }}
            style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: 0.6 }}
          >✕</button>
        )}
      </div>

      {subs.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginLeft: 16, paddingLeft: 10, borderLeft: '1px solid var(--color-line-strong)' }}>
          {subs.map((s: any) => (
            <TaskRow
              key={s.id} item={s} items={items} today={today} weekIso={weekIso} accent={a} depth={depth + 1}
              onSelect={onSelect} onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem}
              onAddItem={onAddItem} selectedId={selectedId} readonly={readonly}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/* ── Prompt to ladder a node that has no checkpoints yet ───────────────── */
function LadderPrompt({ node, accent, onAddItem, readonly }: any) {
  const isGoal = node.kind === 'goal'
  if (readonly) {
    return (
      <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', margin: '10px 0 0' }}>
        Not laddered down yet.
      </p>
    )
  }
  return (
    <div style={{ marginTop: 10, border: '1px dashed var(--color-line)', borderRadius: 'var(--hub-radius-lg)', padding: '14px 18px', background: 'var(--color-paper-2)' }}>
      <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-ink)', margin: '0 0 6px', lineHeight: 1.4 }}>
        {isGoal
          ? 'Ladder it down — name the checkpoints you’d pass on the way.'
          : 'Too big to do in one sitting? Break it into smaller checkpoints — or just add the next actions below.'}
      </p>
      <AddInline
        label="+ first checkpoint"
        placeholder="A checkpoint you could prove you passed…"
        onSubmit={(title: string) => onAddItem({ kind: 'milestone', parent_id: node.id, title, source: 'bb', position: 0 })}
      />
    </div>
  )
}

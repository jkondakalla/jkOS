/**
 * WorkshopView — the goal forge (Full Press rebuild).
 *
 * Two panes, straight from the prototype: a goals RAIL on the left (a card per
 * goal — dot · serif title · .seg % · bar · leaf count; the selected card is a
 * jk-well) and THE FORGE on the right (the selected goal's header — jk-press-lg
 * title, jk-bubble-secondary category, big .seg % — a jk-rule, then an
 * expand/collapse tree of milestone branches → task leaves). Leaves roll up to
 * the goal.
 *
 * This retires the unlimited-depth drill-down + weekly-bench sidebar (ShopFloor /
 * NodePage / Bench / bits / GoalForge, PLANNING_METHOD.md). The item model maps
 * goal (kind:'goal') → milestone (kind:'milestone') → task (kind:'task'); rollup
 * = descendant leaves done/total. New creation caps at three levels; any deeper
 * existing node surfaces as a (clickable) leaf.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { FONT_HEAD, TASK_COLORS, localDate } from '../../lib/theme'
import { getChildren, getAncestors, getProgress } from '../../lib/seed'
import { Press, Well, Bubble, Chip, Check, TButton, Rule, Bar } from '@jkos/ui'
import { stagger } from '@jkos/design'

const MONO = 'var(--hub-font-mono)'

export function WorkshopView({
  items, today, onSelect, onToggle, onAddItem, onUpdateItem,
  focusedNodeId, setFocusedNodeId, readonly,
}: any) {
  const goals = useMemo(
    () => items.filter((it: any) => it.kind === 'goal').sort((a: any, b: any) => (a.id - b.id)),
    [items],
  )
  const active = goals.filter((g: any) => (g.status || 'active') === 'active')

  const [selId, setSelId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  // Deep-link from a DetailPanel ("Open in workshop →"): select the node's goal
  // and open the branch it sits under.
  useEffect(() => {
    if (focusedNodeId == null) return
    const node = items.find((i: any) => i.id === focusedNodeId)
    if (node) {
      const chain = [node, ...getAncestors(node, items)]
      const goal = chain.find((n: any) => n.kind === 'goal')
      const branch = chain.find((n: any) => n.kind === 'milestone')
      if (goal) setSelId(goal.id)
      if (branch) setExpanded((e) => ({ ...e, [branch.id]: true }))
    }
    setFocusedNodeId?.(null)
  }, [focusedNodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a valid selection: fall to the first active goal (then any goal).
  const selGoal = useMemo(() => {
    if (selId != null) {
      const g = goals.find((x: any) => x.id === selId)
      if (g) return g
    }
    return active[0] || goals[0] || null
  }, [selId, goals, active])

  const toggleExpand = (id: number) => setExpanded((e) => ({ ...e, [id]: e[id] === false }))

  const addGoal = async () => {
    if (readonly) return
    const accent = TASK_COLORS[goals.length % TASK_COLORS.length].hex
    const g = await onAddItem?.({
      kind: 'goal', scope: 'year', status: 'active', source: 'bb',
      title: 'New goal', accent, year: localDate(today).getFullYear(),
    })
    if (g?.id) setSelId(g.id)
  }

  const addBranch = async () => {
    if (readonly || !selGoal) return
    const pos = getChildren(selGoal, items).filter((c: any) => c.kind === 'milestone').length
    const m = await onAddItem?.({ kind: 'milestone', parent_id: selGoal.id, title: 'New milestone', source: 'bb', position: pos })
    if (m?.id) {
      await onAddItem?.({ kind: 'task', scope: 'day', parent_id: m.id, title: 'First step', source: 'bb' })
      setExpanded((e) => ({ ...e, [m.id]: true }))
    }
  }

  const addLeaf = async (branchId: number) => {
    if (readonly) return
    await onAddItem?.({ kind: 'task', scope: 'day', parent_id: branchId, title: 'New task', source: 'bb' })
    setExpanded((e) => ({ ...e, [branchId]: true }))
  }

  return (
    // Column around the rail + forge row. It carried a pinned foot until the
    // page footer was cut suite-wide; kept as the seam for anything that spans
    // both panes, and because the rail/forge row wants an explicit `flex: 1`
    // parent rather than being the height-100% child itself.
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* ── Goals rail ── */}
        <div style={{ width: 'var(--jk-rail)', flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--hub-line)', minHeight: 0 }}>
          <div className="mo-item" style={{ flex: 'none', display: 'flex', alignItems: 'baseline', gap: 10, padding: '16px 20px 12px' }}>
            <span className="label-tape">GOALS</span>
            <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>{String(active.length).padStart(2, '0')} ACTIVE</span>
          </div>
          <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            {goals.map((g: any, i: number) => (
              <GoalCard
                key={g.id}
                goal={g}
                items={items}
                selected={selGoal?.id === g.id}
                delay={stagger(i, 60, 70)}
                onClick={() => setSelId(g.id)}
              />
            ))}
            {!readonly && (
              <TButton quiet onClick={addGoal} style={{ padding: 11, borderStyle: 'dashed', cursor: 'pointer' }}>
                + New goal
              </TButton>
            )}
          </div>
        </div>

        {/* ── The forge ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {selGoal ? (
            <Forge
              goal={selGoal}
              items={items}
              expanded={expanded}
              readonly={readonly}
              onSelect={onSelect}
              onToggle={onToggle}
              onUpdateItem={onUpdateItem}
              onToggleExpand={toggleExpand}
              onAddLeaf={addLeaf}
              onAddBranch={addBranch}
            />
          ) : (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 40 }}>
              <div style={{ textAlign: 'center', maxWidth: 320 }}>
                <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE FORGE</span>
                <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 18, color: 'var(--color-muted)', margin: '12px 0 0', lineHeight: 1.4 }}>
                  No goals yet. Forge one on the rail, then break it down into milestones and leaves.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── A goal card on the rail ────────────────────────────────────────────── */

function GoalCard({ goal, items, selected, delay, onClick }: any) {
  const tint = goal.accent || 'var(--color-accent)'
  const prog = getProgress(goal, items)
  const meta = [goal.target_date ? `DUE ${fmtTarget(goal.target_date)}` : 'ONGOING', goal.category].filter(Boolean).join(' · ').toUpperCase()
  const As: any = selected ? Well : 'div'

  return (
    <As
      className="jk-hit mo-item"
      onClick={onClick}
      style={{
        border: '1px solid var(--hub-line)', borderRadius: 'var(--hub-radius)', padding: '13px 15px',
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
        animationDelay: delay, ['--jk-tint' as string]: tint,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: tint, flex: 'none', alignSelf: 'center' }} />
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, letterSpacing: '-0.015em' }}>{goal.title}</span>
        <span className="seg" style={{ marginLeft: 'auto', fontSize: 16 }}>{prog.pct}%</span>
      </div>
      <Bar value={prog.pct / 100} tint={tint} height={5} radius={3} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono-eyebrow">{meta || 'GOAL'}</span>
        <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>{prog.done}/{prog.total} LEAVES</span>
      </div>
    </As>
  )
}

/* ── The forge pane for the selected goal ───────────────────────────────── */

function Forge({ goal, items, expanded, readonly, onSelect, onToggle, onUpdateItem, onToggleExpand, onAddLeaf, onAddBranch }: any) {
  const tint = goal.accent || 'var(--color-accent)'
  const prog = getProgress(goal, items)
  const children = getChildren(goal, items)
  const branches = children.filter((c: any) => c.kind === 'milestone').sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
  const looseLeaves = children.filter((c: any) => c.kind === 'task')

  let idx = 0
  const delay = () => stagger(idx++, 120, 40)

  return (
    <>
      <div className="mo-item" style={{ flex: 'none', padding: '16px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE FORGE</span>
          <span className="mono-eyebrow">BREAK IT DOWN — LEAVES ROLL UP TO THE GOAL</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 12 }}>
          <Press
            large
            onClick={() => onSelect?.(goal)}
            style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '1.85rem', lineHeight: 1, letterSpacing: '-0.02em', cursor: 'pointer' }}
          >
            {goal.title}
          </Press>
          {goal.category && <Bubble tone="secondary" style={{ marginBottom: 4 }}>{goal.category}</Bubble>}
          <span className="mono-eyebrow" style={{ marginBottom: 5 }}>
            {goal.target_date ? `DUE ${fmtTarget(goal.target_date)}` : 'ONGOING'} · {prog.done}/{prog.total} LEAVES DONE
          </span>
          <span className="seg" style={{ marginLeft: 'auto', fontSize: 30 }}>{prog.pct}%</span>
        </div>
        <Bar value={prog.pct / 100} tint={tint} height={7} radius={4} style={{ marginTop: 8 }} />
      </div>
      <Rule style={{ margin: '4px 28px 0' }} />
      <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '14px 28px 20px', display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
        {looseLeaves.map((leaf: any) => (
          <Leaf key={leaf.id} node={leaf} tint={tint} delay={delay()} readonly={readonly} onSelect={onSelect} onToggle={onToggle} items={items} />
        ))}
        {branches.map((b: any) => {
          const open = expanded[b.id] !== false
          const br = getProgress(b, items)
          return (
            <React.Fragment key={b.id}>
              <div className="mo-item" style={{ display: 'flex', alignItems: 'center', animationDelay: delay() }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderRadius: 'var(--hub-radius-sm)', border: '1px solid var(--hub-line)', background: 'var(--hub-bg-3)' }}>
                  <span
                    className="jk-hit"
                    onClick={() => onToggleExpand(b.id)}
                    style={{ fontFamily: MONO, fontSize: 11, width: 14, textAlign: 'center', color: 'var(--color-muted)', cursor: 'pointer', borderRadius: 3 }}
                  >
                    {open ? '▾' : '▸'}
                  </span>
                  <span
                    onClick={() => onSelect?.(b)}
                    style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', cursor: 'pointer' }}
                  >
                    {b.title}
                  </span>
                  <Bubble tone="secondary" style={{ fontSize: 8, padding: '2px 8px' }}>{br.done}/{br.total}</Bubble>
                  <Bar value={br.pct / 100} tint={tint} height={6} radius={3} style={{ marginLeft: 'auto', width: 130, flex: 'none' }} />
                  <span className="seg" style={{ fontSize: 15, minWidth: 46, textAlign: 'right' }}>{br.pct}%</span>
                  {!readonly && (
                    <TButton quiet onClick={() => onAddLeaf(b.id)} style={{ flex: 'none', cursor: 'pointer' }}>+ task</TButton>
                  )}
                </div>
              </div>
              {open && getChildren(b, items).map((leaf: any) => (
                <div key={leaf.id} className="mo-item" style={{ display: 'flex', alignItems: 'center', paddingLeft: 30, animationDelay: delay() }}>
                  <Leaf node={leaf} tint={tint} readonly={readonly} onSelect={onSelect} onToggle={onToggle} items={items} nested />
                </div>
              ))}
            </React.Fragment>
          )
        })}
        {!readonly && (
          <TButton quiet onClick={onAddBranch} style={{ padding: 10, borderStyle: 'dashed', alignSelf: 'flex-start', marginTop: 4, cursor: 'pointer' }}>
            + Break into a new milestone
          </TButton>
        )}
      </div>
    </>
  )
}

/* A leaf row — a task (checkable) or a deeper node (surfaced as a clickable
   leaf with its own rollup instead of a check). */
function Leaf({ node, tint, delay, readonly, onSelect, onToggle, items, nested }: any) {
  const isTask = node.kind === 'task'
  const prog = isTask ? null : getProgress(node, items)
  const wrapStyle: React.CSSProperties = nested
    ? { flex: 1 }
    : {}
  const chip = (
    <Chip
      solid={false}
      done={isTask && node.completed}
      tint={tint}
      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px', ...wrapStyle }}
    >
      <span style={{ fontFamily: MONO, color: 'var(--color-faint)', fontSize: 13 }}>└</span>
      {isTask ? (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
          <Check
            checked={!!node.completed}
            onChange={readonly ? undefined : () => onToggle?.(node.id, !node.completed)}
            tint={tint}
            style={{ fontSize: 11 }}
          />
        </span>
      ) : (
        <span className="seg" style={{ fontSize: 12, color: 'var(--color-accent)' }}>{prog!.pct}%</span>
      )}
      <Press
        variant="ink"
        onClick={() => onSelect?.(node)}
        style={{ fontSize: 14, cursor: 'pointer', color: isTask && node.completed ? 'var(--color-faint)' : 'var(--color-ink)', textDecoration: isTask && node.completed ? 'line-through' : 'none' }}
      >
        {node.title}
      </Press>
    </Chip>
  )
  if (nested) return chip
  return (
    <div className="mo-item" style={{ display: 'flex', alignItems: 'center', animationDelay: delay }}>
      {chip}
    </div>
  )
}

function fmtTarget(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  } catch {
    return iso
  }
}

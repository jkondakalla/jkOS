/**
 * WorkshopView — the planning tab. ONE BENCH.
 *
 * The two shapes planning comes in are GOALS (a finite tree with a finish line,
 * broken down until every leaf is a task you can put on a day) and ROUTINES —
 * standing orders: commitments with no finish line, planned by frequency instead
 * of by breakdown. They stay two shapes because they disagree about what progress
 * IS. A goal's progress is leaves done over leaves total and it ends at 100%; a
 * routine's is this week's count against this week's target, and next week it
 * starts again. Putting a routine in the goal tree would make every rollup lie — a
 * "meditate daily" node can never complete, so any goal above it would sit short of
 * 100% forever. One item table underneath, two shapes, no rollup between them.
 *
 * THEY USED TO BE TWO BOARDS BEHIND BADGES, plus a third for the library. That is
 * gone. The badges made the workshop modal — three screens you switched between,
 * each with its own head, its own scroll and its own idea of what was selected —
 * and the thing you actually do here crosses all three: you break a goal down,
 * notice the part you will be doing every week, and file a standing order under it.
 * Every one of those steps was a badge click and a lost selection.
 *
 * So: ONE RAIL, one forge. The rail carries goals over standing orders in a single
 * scroll with a sticky head each; the forge shows whichever one you picked. There
 * is no mode — the selection IS the mode, and it is visible the whole time.
 *
 *   a goal picked     → <Forge> below: the header, the standing orders filed under
 *                       it, then the expand/collapse tree of milestone branches →
 *                       task leaves. Leaves roll up to the goal.
 *   a routine picked  → <RoutineForge>: the cadence band (./cadence — the seven
 *                       days, the target, the streak) over the document (steps,
 *                       progression, phases).
 *
 * THE LIBRARY IS AN OVERLAY, not the third badge. It is the vocabulary the two
 * forges are written out of — a shelf you reach INTO while writing something else —
 * and a shelf that replaces the thing you were writing is a shelf you have to
 * remember your way back from. It opens over the forge from either side, and the
 * step-picker inside RoutineForge opens the same one with an onPick attached, so
 * there is one library surface and not two that can drift.
 *
 * WHY AN ABSOLUTE OVERLAY IS SAFE HERE, given .jk-panel has cost this app two
 * silent "clicking does nothing" bugs: both of those were CSS GRID — grid places
 * definite items first, so an explicitly-placed overlay pushed its sibling into an
 * implicit row and collapsed the content row to 0px. The forge pane is a FLEX
 * column with one positioned ancestor and an inset:0 child; flex has no such
 * placement pass, and the overlay is a sibling of nothing it can displace.
 *
 * ── The item model ──
 * goal (kind:'goal') → milestone (kind:'milestone') → task (kind:'task'); rollup =
 * descendant leaves done/total. New creation caps at three levels; any deeper
 * existing node surfaces as a (clickable) leaf. A routine (kind:'routine') may hang
 * UNDER a goal via parent_id — "read 20 pages a day" belongs to "finish six books"
 * — and is listed on that goal without joining its rollup.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { FONT_HEAD, TASK_COLORS, localDate } from '../../lib/theme'
import { getChildren, getAncestors, getProgress } from '../../lib/seed'
import { Press, Well, Bubble, Chip, Check, TButton, Rule, Bar, Sheet, Scrim } from '@jkos/ui'
import { stagger } from '@jkos/design'
import { LibraryBrowser } from './LibraryBrowser'
import { RoutineImport } from './RoutineImport'
import { RoutineForge } from './RoutineForge'
import { RoutineCard, WeekStrip } from './cadence'
import { getRoutines, cadenceDays, weeklyTarget, weekCells, weekStart, streakOf } from '../../lib/routines'
import { normalizeSpec, summarize } from '../../lib/routine-spec'

const MONO = 'var(--hub-font-mono)'

/** What the rail has selected. `kind` is carried alongside the id rather than
 *  derived from it because the two shapes live in ONE table — a bare id would have
 *  to be looked up before the forge could know which pane to render, and during the
 *  frame after a delete that lookup returns nothing and the pane would flicker to
 *  the empty state instead of moving on. */
type Sel = { kind: 'goal' | 'routine'; id: number }

export function WorkshopView(props: any) {
  const {
    items, today, readonly, api, onReload,
    onSelect, onToggle, onAddItem, onUpdateItem, onDelete,
    focusedNodeId, setFocusedNodeId,
  } = props

  const goals = useMemo(
    () => items.filter((it: any) => it.kind === 'goal').sort((a: any, b: any) => (a.id - b.id)),
    [items],
  )
  const activeGoals = useMemo(() => goals.filter((g: any) => (g.status || 'active') === 'active'), [goals])
  const routines = useMemo(() => getRoutines(items), [items])
  const activeRoutines = useMemo(() => routines.filter((r: any) => (r.status || 'active') === 'active'), [routines])

  const [sel, setSel] = useState<Sel | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  /* The shelf. `onPick` is what tells the overlay which of its two jobs it is doing:
     absent, it is the browsable shelf you curate; present, RoutineForge is waiting
     for one entry to turn into a step. One state, so the two can never be open at
     once over each other. */
  const [shelf, setShelf] = useState<{ onPick?: (entry: any) => void } | null>(null)
  /* The paste pane rides inside the shelf, because a bundle carries routines AND
     library entries — it is a write to the shelf as much as to the rail. */
  const [pasting, setPasting] = useState(false)
  const [libCount, setLibCount] = useState<number | null>(null)

  /* One count, fetched once, purely so the shelf button can state the size of the
     shelf. The browser fetches the entries themselves when it opens — a count is not
     worth holding a copy of the library in a parent for. */
  useEffect(() => {
    let live = true
    api?.get('/api/library').then((r: any) => { if (live) setLibCount(r?.count ?? r?.entries?.length ?? 0) })
      .catch(() => { if (live) setLibCount(0) })
    return () => { live = false }
  }, [api])

  /* Deep-link from a DetailPanel ("Open in workshop →"). It can now land on either
     shape, which is the whole point of one rail: a routine used to be unreachable
     from this link because the effect that consumed it lived inside the goals board
     and the routines board it lived on was a different component. */
  useEffect(() => {
    if (focusedNodeId == null) return
    const node = items.find((i: any) => i.id === focusedNodeId)
    if (node) {
      if (node.kind === 'routine') {
        setSel({ kind: 'routine', id: node.id })
      } else {
        const chain = [node, ...getAncestors(node, items)]
        const goal = chain.find((n: any) => n.kind === 'goal')
        const branch = chain.find((n: any) => n.kind === 'milestone')
        if (goal) setSel({ kind: 'goal', id: goal.id })
        if (branch) setExpanded((e) => ({ ...e, [branch.id]: true }))
      }
    }
    setFocusedNodeId?.(null)
  }, [focusedNodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Keep a valid selection. A goal falls to the first ACTIVE goal (then any goal)
     so an empty rail is the only way to see the empty state; a routine that has been
     deleted falls back to the goal side rather than to the first routine, because
     "the thing I was looking at is gone" should not silently open a different
     routine's document under a Save button. */
  const selected = useMemo(() => {
    if (sel) {
      const hit = (sel.kind === 'goal' ? goals : routines).find((x: any) => x.id === sel.id)
      if (hit) return { kind: sel.kind, node: hit }
    }
    const g = activeGoals[0] || goals[0]
    return g ? { kind: 'goal' as const, node: g } : null
  }, [sel, goals, routines, activeGoals])

  const toggleExpand = (id: number) => setExpanded((e) => ({ ...e, [id]: e[id] === false }))

  const addGoal = async () => {
    if (readonly) return
    const accent = TASK_COLORS[goals.length % TASK_COLORS.length].hex
    const g = await onAddItem?.({
      kind: 'goal', scope: 'year', status: 'active', source: 'bb',
      title: 'New goal', accent, year: localDate(today).getFullYear(),
    })
    if (g?.id) setSel({ kind: 'goal', id: g.id })
  }

  /* `parent` is how "+ routine" inside a goal's forge differs from "+ New routine"
     on the rail: the same write, filed under the goal you were looking at. */
  const addRoutine = async (parentId?: number) => {
    if (readonly) return
    const accent = TASK_COLORS[(goals.length + routines.length) % TASK_COLORS.length].hex
    const r = await onAddItem?.({
      kind: 'routine', scope: 'week', status: 'active', source: 'bb',
      title: 'New routine', cadence_days: '', accent,
      position: routines.length, ...(parentId ? { parent_id: parentId } : {}),
    })
    if (r?.id) setSel({ kind: 'routine', id: r.id })
  }

  const addBranch = async () => {
    if (readonly || selected?.kind !== 'goal') return
    const goal = selected.node
    const pos = getChildren(goal, items).filter((c: any) => c.kind === 'milestone').length
    const m = await onAddItem?.({ kind: 'milestone', parent_id: goal.id, title: 'New milestone', source: 'bb', position: pos })
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

  /* Both exits re-read the count, because the browser is a full editor — entries may
     have been added, renamed or given a ladder while it was open. */
  const closeShelf = () => {
    setShelf(null)
    setPasting(false)
    api?.get('/api/library').then((r: any) => setLibCount(r?.count ?? r?.entries?.length ?? 0)).catch(() => { /* keep what we had */ })
  }

  return (
    <div style={{ height: '100%', display: 'flex', minHeight: 0 }}>
      {/* ══ THE RAIL — goals over standing orders, one scroll ══════════════ */}
      <div style={{
        width: 'var(--jk-rail)', flex: 'none', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--hub-line)', minHeight: 0,
      }}>
        <div className="jk-scroll" style={{ flex: 1, minHeight: 0, padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {/* The section heads are STICKY and opaque. A single scroll carrying two
              lists needs to say which one you are in once you are past its head, and
              they need a ground of their own or the cards run under the text. */}
          <RailHead label="Goals" meta={`${String(activeGoals.length).padStart(2, '0')} ACTIVE`} />
          {goals.map((g: any, i: number) => (
            <GoalCard
              key={g.id}
              goal={g}
              items={items}
              selected={selected?.kind === 'goal' && selected.node.id === g.id}
              delay={stagger(i, 60, 70)}
              onClick={() => setSel({ kind: 'goal', id: g.id })}
            />
          ))}
          {!readonly && (
            <TButton quiet onClick={addGoal} style={{ padding: 11, borderStyle: 'dashed', cursor: 'pointer' }}>
              + New goal
            </TButton>
          )}

          <RailHead
            label="Standing orders"
            meta={`${String(activeRoutines.length).padStart(2, '0')} RUNNING`}
            style={{ paddingTop: 18 }}
          />
          {routines.map((r: any, i: number) => (
            <RoutineCard
              key={r.id}
              routine={r}
              items={items}
              goals={goals}
              today={today}
              selected={selected?.kind === 'routine' && selected.node.id === r.id}
              delay={stagger(i, 340, 60)}
              onClick={() => setSel({ kind: 'routine', id: r.id })}
            />
          ))}
          {!readonly && (
            <TButton quiet onClick={() => addRoutine()} style={{ padding: 11, borderStyle: 'dashed', cursor: 'pointer' }}>
              + New routine
            </TButton>
          )}
        </div>
      </div>

      {/* ══ THE FORGE ═════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
        {selected?.kind === 'routine' ? (
          <RoutineForge
            key={selected.node.id}
            routine={selected.node}
            items={items}
            goals={goals}
            today={today}
            api={api}
            readonly={readonly}
            onToggle={onToggle}
            onUpdateItem={onUpdateItem}
            onDelete={onDelete}
            onOpenShelf={(onPick?: (entry: any) => void) => setShelf({ onPick })}
            shelfCount={libCount}
          />
        ) : selected?.kind === 'goal' ? (
          <Forge
            goal={selected.node}
            items={items}
            expanded={expanded}
            readonly={readonly}
            today={today}
            shelfCount={libCount}
            onSelect={onSelect}
            onToggle={onToggle}
            onToggleExpand={toggleExpand}
            onAddLeaf={addLeaf}
            onAddBranch={addBranch}
            onAddRoutine={() => addRoutine(selected.node.id)}
            onOpenRoutine={(id: number) => setSel({ kind: 'routine', id })}
            onOpenShelf={() => setShelf({})}
          />
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 40 }}>
            <div style={{ textAlign: 'center', maxWidth: 340 }}>
              <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE FORGE</span>
              <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 18, color: 'var(--color-muted)', margin: '12px 0 0', lineHeight: 1.4 }}>
                Nothing on the bench. Forge a goal on the rail and break it down — or
                start a standing order, the part you don't re-decide each week.
              </p>
            </div>
          </div>
        )}

        {/* ══ THE SHELF — the library, over the forge ══════════════════════ */}
        {shelf && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 18, display: 'flex', flexDirection: 'column' }}>
            <Scrim onClick={closeShelf} style={{ position: 'absolute', inset: 0 }} />
            <Sheet
              className="modal-in"
              style={{
                position: 'relative', margin: 16, flex: 1, minHeight: 0,
                borderRadius: 'var(--hub-radius-lg)', display: 'flex', flexDirection: 'column',
                boxShadow: 'var(--hub-shadow-card)', overflow: 'hidden',
              }}
            >
              {pasting ? (
                <RoutineImport
                  api={api}
                  readonly={readonly}
                  onClose={() => setPasting(false)}
                  /* Straight onto the first routine imported. An import that lands you
                     back on the shelf leaves you hunting the row you just made, and the
                     forge is where you would go next anyway — the ladder is the thing you
                     check after a document you did not type yourself. The reload is
                     awaited so the row exists by the time the rail looks for it. */
                  onImported={async (res: any) => {
                    await onReload?.()
                    const first = res?.routines?.[0]?.id
                    closeShelf()
                    if (first) setSel({ kind: 'routine', id: first })
                  }}
                />
              ) : (
                <LibraryBrowser
                  api={api}
                  items={items}
                  readonly={readonly}
                  onPick={shelf.onPick ? (entry: any) => { shelf.onPick!(entry); closeShelf() } : undefined}
                  onPaste={() => setPasting(true)}
                  onClose={closeShelf}
                />
              )}
            </Sheet>
          </div>
        )}
      </div>
    </div>
  )
}

/* A rail section head. Serif and sticky: the print voice names CONTENT (the
   .label-tape it replaces is machine chrome, and two lists of user things are not
   that), and it needs an opaque ground of its own or the cards scroll under it. */
function RailHead({ label, meta, style }: { label: string; meta: string; style?: React.CSSProperties }) {
  return (
    <div className="mo-item" style={{
      flex: 'none', display: 'flex', alignItems: 'baseline', gap: 10,
      padding: '16px 2px 4px', position: 'sticky', top: 0, zIndex: 4,
      background: 'var(--color-paper)', ...style,
    }}>
      <Press style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '1.06rem', letterSpacing: '-0.015em' }}>
        {label}
      </Press>
      <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>{meta}</span>
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

function Forge({
  goal, items, today, expanded, readonly, shelfCount,
  onSelect, onToggle, onToggleExpand, onAddLeaf, onAddBranch, onAddRoutine, onOpenRoutine, onOpenShelf,
}: any) {
  const tint = goal.accent || 'var(--color-accent)'
  const prog = getProgress(goal, items)
  const children = getChildren(goal, items)
  const branches = children.filter((c: any) => c.kind === 'milestone').sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
  const looseLeaves = children.filter((c: any) => c.kind === 'task')
  // Routines filed under this goal. Listed but NOT part of the tree or the rollup
  // (see isUnderRoutine in lib/seed) — without this line a routine attached to a
  // goal would simply disappear from the goals board, since it is neither a
  // milestone branch nor a task leaf.
  const routines = children.filter((c: any) => c.kind === 'routine')

  let idx = 0
  const delay = () => stagger(idx++, 120, 40)

  return (
    <>
      <div className="mo-item" style={{ flex: 'none', padding: '16px 28px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>THE FORGE</span>
          <span className="mono-eyebrow">BREAK IT DOWN — LEAVES ROLL UP TO THE GOAL</span>
          <TButton quiet onClick={onOpenShelf} style={{ marginLeft: 'auto', cursor: 'pointer' }}>
            ◧ Library{shelfCount == null ? '' : ` · ${shelfCount}`}
          </TButton>
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

      {/* ── The standing orders filed under this goal ──────────────────────
          They are listed but NOT part of the tree or the rollup (see
          isUnderRoutine in lib/seed) — a routine can never complete, so counting
          one would hold the goal short of 100% forever. Given a band of their own
          above the rule rather than a strip of chips inside the header, because
          "what am I doing every week toward this" is a peer of the breakdown and
          not an annotation on the title. */}
      {!readonly || routines.length > 0 ? (
        <div className="mo-item" style={{ flex: 'none', padding: '2px 28px 14px', animationDelay: '80ms' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
            <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-secondary)' }}>STANDING ORDERS</span>
            <span className="mono-eyebrow">RUN ON THEIR OWN CLOCK — TRACKED APART FROM THE %</span>
            {!readonly && (
              <TButton quiet onClick={onAddRoutine} style={{ marginLeft: 'auto', cursor: 'pointer' }}>+ routine</TButton>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {routines.map((r: any) => (
              <StandingOrder key={r.id} routine={r} items={items} today={today} onClick={() => onOpenRoutine?.(r.id)} />
            ))}
            {routines.length === 0 && (
              <div style={{ border: '1px dashed var(--hub-line)', borderRadius: 'var(--hub-radius-sm)', padding: '11px 14px', gridColumn: '1 / -1' }}>
                <span className="jk-async-note" style={{ fontSize: 14, color: 'var(--color-muted)' }}>
                  Nothing recurring under this goal yet — a standing order is the part you don't re-decide each week.
                </span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Rule style={{ margin: '0 28px' }} />
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

/* A standing order, as seen from the goal it hangs under. The rail's card without
   the chrome you already have on the rail: the name, the rhythm, and the week —
   enough to know whether it is being kept, and a click to go edit it. */
function StandingOrder({ routine, items, today, onClick }: any) {
  const tint = routine.accent || 'var(--color-accent)'
  const wk = useMemo(() => weekStart(today), [today])
  const cells = useMemo(() => weekCells(routine, items, wk, today), [routine, items, wk, today])
  const streak = useMemo(() => streakOf(routine, items, today), [routine, items, today])
  const spec = useMemo(() => normalizeSpec(routine.spec), [routine.spec])
  return (
    <div
      className="jk-hit"
      onClick={onClick}
      role="button"
      style={{
        border: '1px solid var(--hub-line)', borderRadius: 'var(--hub-radius-sm)',
        background: 'var(--hub-bg-3)', padding: '11px 14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12, ['--jk-tint' as string]: tint,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 2, background: tint, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{
          fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {routine.title}
        </span>
        <span className="mono-eyebrow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cadenceDays(routine).length ? `${weeklyTarget(routine)}×/WK` : 'NO CADENCE'} · {(summarize(spec) || 'NO STEPS').toUpperCase()}
        </span>
      </div>
      <WeekStrip cells={cells} tint={tint} height={7} style={{ marginLeft: 'auto', width: 74, flex: 'none' }} />
      <span className="seg" style={{ fontSize: 15, minWidth: 34, textAlign: 'right', flex: 'none' }}>{streak}</span>
    </div>
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

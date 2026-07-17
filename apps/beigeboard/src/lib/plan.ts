// Breakdown Method helpers (Documentation/PLANNING_METHOD.md).
// goal → ordered milestones AT ANY DEPTH (the current path) → tasks (next actions)
// → a weekly bench (week_start) → calendar days (due_date).
//
// The tree walkers these build on (getChildren/getDescendants/getProgress) are already
// depth-N and cycle-guarded (src/lib/seed.ts), so every helper here works at any level:
// a goal, a checkpoint, or a checkpoint-under-a-checkpoint are the same `node`.

import { isoDate, localDate, weekStart } from './theme'
import { getChildren, getDescendants, getProgress } from './seed'

export const topGoals = (items: any[]) =>
  items.filter(it => it.kind === 'goal' && !it.parent_id)

export const activeGoals = (items: any[]) =>
  topGoals(items).filter(g => (g.status || 'active') === 'active')

/* ── The ladder, at any depth ─────────────────────────────────────────────── */

/** A node's checkpoint children, in position order. Works for a goal or a milestone. */
export const stepsOf = (node: any, items: any[]) =>
  getChildren(node, items)
    .filter(it => it.kind === 'milestone')
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.id - b.id)

/** A node's next-action (task) children, undated first then by day. */
export const actionsOf = (node: any, items: any[]) =>
  getChildren(node, items)
    .filter(it => it.kind === 'task')
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id)

/** The first un-cleared checkpoint under a node — the only one worth breaking down now. */
export const currentStep = (node: any, items: any[]) =>
  stepsOf(node, items).find(s => !s.completed) || null

/** Follow currentStep down to the deepest active node — the tip of the current path. */
export function currentLeaf(node: any, items: any[]) {
  let cur = node
  for (let guard = 0; guard < 64; guard++) {   // guard: a malformed cycle mustn't loop forever
    const next = currentStep(cur, items)
    if (!next) break
    cur = next
  }
  return cur
}

/**
 * Progress at a node: checkpoints passed when it has a ladder, else leaf-task
 * completion. (Task-leaf counting overstates a young ladder — later checkpoints have
 * no tasks yet, by design — so a checkpoint ladder is preferred when one exists.)
 */
export function nodeProgress(node: any, items: any[]) {
  const steps = stepsOf(node, items)
  if (steps.length > 0) {
    const done = steps.filter(s => s.completed).length
    return { done, total: steps.length, pct: Math.round((done / steps.length) * 100), unit: 'checkpoints' }
  }
  return { ...getProgress(node, items), unit: 'tasks' }
}

/** True once every task under the node is done (and there was at least one). */
export function nodeCleared(node: any, items: any[]) {
  if (node.completed) return false
  const ts = getDescendants(node, items).filter(d => d.kind === 'task')
  return ts.length > 0 && ts.every(t => t.completed)
}

/* ── Reach: what's within grasp for a goal ────────────────────────────────── */

/** Incomplete next actions anywhere under the node. */
export const openTasksUnder = (node: any, items: any[]) =>
  getDescendants(node, items).filter(d => d.kind === 'task' && !d.completed)

/**
 * First truly-unscheduled open task (no day, no bench) along the current path,
 * falling back to anywhere under the goal — the one to bench or commit to a day.
 */
export function nextUnscheduled(goal: any, items: any[]) {
  const leaf = currentLeaf(goal, items)
  const here = actionsOf(leaf, items).find(x => !x.completed && !x.due_date && !x.week_start)
  if (here) return here
  return openTasksUnder(goal, items).find(t => !t.due_date && !t.week_start) || null
}

/* ── The weekly bench (week_start, ISO-Monday) ────────────────────────────── */

/** Tasks parked on week W's bench — committed to the week, not yet a day. */
export const benchedTasks = (items: any[], weekIso: string) =>
  items.filter(it => it.kind === 'task' && it.week_start === weekIso && !it.due_date)

/** A goal's open contribution to week W: benched to W, or scheduled to a day within W. */
export const thisWeekOf = (goal: any, items: any[], weekIso: string) =>
  openTasksUnder(goal, items).filter(t =>
    (t.week_start === weekIso && !t.due_date) ||
    (t.due_date && weekStart(t.due_date) === weekIso))

/** Open, undated tasks benched to a PAST week — leftovers to consciously resolve. */
export const carriedBench = (items: any[], weekIso: string) =>
  items.filter(it =>
    it.kind === 'task' && !it.completed && !it.due_date &&
    it.week_start && it.week_start < weekIso)

/**
 * The invariant: an active goal must have a next action within reach — either on a
 * day (any open due-dated task) or on THIS week's bench. Neither → adrift.
 */
export function isAdrift(goal: any, items: any[], weekIso: string = weekStart(isoDate(new Date()))) {
  if ((goal.status || 'active') !== 'active') return false
  const open = openTasksUnder(goal, items)
  const hasDay   = open.some(t => t.due_date)
  const hasBench = open.some(t => !t.due_date && t.week_start === weekIso)
  return !hasDay && !hasBench
}

/* ── Pace + formatting ────────────────────────────────────────────────────── */

/**
 * Simple pace signal: completed fraction vs. elapsed fraction of the horizon.
 * Generous by a 10-point margin; silent when too early or undated.
 */
export function paceOf(goal: any, items: any[], today: string): 'on pace' | 'behind' | null {
  if (!goal.target_date || (goal.status || 'active') !== 'active') return null
  const start = (goal.created_at || today).slice(0, 10)
  const span = localDate(goal.target_date).getTime() - localDate(start).getTime()
  if (span <= 0) return null
  const elapsed = Math.min(1, Math.max(0, (localDate(today).getTime() - localDate(start).getTime()) / span))
  if (elapsed < 0.08) return 'on pace'
  return nodeProgress(goal, items).pct / 100 + 0.1 >= elapsed ? 'on pace' : 'behind'
}

export const fmtTarget = (iso: string) =>
  localDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

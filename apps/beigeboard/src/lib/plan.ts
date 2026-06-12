// Breakdown Method helpers (Documentation/PLANNING_METHOD.md).
// goal → ordered milestones (flat) → tasks (next actions) → calendar days.

import { localDate } from './theme'
import { getChildren, getDescendants, getProgress } from './seed'

export const topGoals = (items: any[]) =>
  items.filter(it => it.kind === 'goal' && !it.parent_id)

export const activeGoals = (items: any[]) =>
  topGoals(items).filter(g => (g.status || 'active') === 'active')

export const milestonesOf = (goal: any, items: any[]) =>
  items
    .filter(it => it.kind === 'milestone' && it.parent_id === goal.id)
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.id - b.id)

export const tasksOf = (node: any, items: any[]) =>
  getChildren(node, items)
    .filter(it => it.kind === 'task')
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id)

/** The first un-passed checkpoint — the only one worth breaking down right now. */
export const currentMilestone = (goal: any, items: any[]) =>
  milestonesOf(goal, items).find(m => !m.completed) || null

/**
 * Goal progress = checkpoints passed when a ladder exists. Task-leaf counting
 * overstates early on (later milestones have no tasks yet, by design).
 */
export function goalProgress(goal: any, items: any[]) {
  const ms = milestonesOf(goal, items)
  if (ms.length > 0) {
    const done = ms.filter(m => m.completed).length
    return { done, total: ms.length, pct: Math.round((done / ms.length) * 100), unit: 'checkpoints' }
  }
  return { ...getProgress(goal, items), unit: 'tasks' }
}

/** Incomplete next actions anywhere under the goal. */
export const openTasksUnder = (goal: any, items: any[]) =>
  getDescendants(goal, items).filter(d => d.kind === 'task' && !d.completed)

/** The invariant: an active goal must have a next action on the calendar. */
export const isAdrift = (goal: any, items: any[]) =>
  (goal.status || 'active') === 'active' &&
  !openTasksUnder(goal, items).some(t => t.due_date)

/** First unscheduled open task (under the current milestone first) — the one to commit to a day. */
export function nextUnscheduled(goal: any, items: any[]) {
  const cur = currentMilestone(goal, items)
  if (cur) {
    const t = tasksOf(cur, items).find(x => !x.completed && !x.due_date)
    if (t) return t
  }
  return openTasksUnder(goal, items).find(t => !t.due_date) || null
}

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
  return goalProgress(goal, items).pct / 100 + 0.1 >= elapsed ? 'on pace' : 'behind'
}

/** True once every task under the milestone is done (and there was at least one). */
export function milestoneCleared(m: any, items: any[]) {
  if (m.completed) return false
  const ts = getDescendants(m, items).filter(d => d.kind === 'task')
  return ts.length > 0 && ts.every(t => t.completed)
}

export const fmtTarget = (iso: string) =>
  localDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

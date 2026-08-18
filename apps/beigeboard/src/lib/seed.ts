import { isoDate, tagTintOf } from './theme'

export const TODAY_ISO = isoDate(new Date())

export const INITIAL_ACCOUNTS = [
  { id: 'google',   connected: false, email: '',                    visible: true, kind: 'google'  },
  { id: 'outlook',  connected: false, email: '',                    visible: true, kind: 'outlook' },
  { id: 'icloud',   connected: false, email: '',                    visible: true, kind: 'icloud'  },
  { id: 'bb',       connected: true,  email: 'tasks · this device', visible: true, kind: 'tasks'   },
]

export function getChildren(item: any, items: any[]) {
  return items.filter(it => it.parent_id === item.id)
}

export function getDescendants(item: any, items: any[]) {
  const out: any[] = []
  const seen = new Set([item.id])   // cycle guard: a parent cycle must not loop forever
  const stack = [item]
  while (stack.length) {
    const cur = stack.pop()
    for (const kid of getChildren(cur, items)) {
      if (seen.has(kid.id)) continue
      seen.add(kid.id)
      out.push(kid)
      stack.push(kid)
    }
  }
  return out
}

export function getAncestors(item: any, items: any[]) {
  const out: any[] = []
  const seen = new Set([item.id])   // cycle guard (see getDescendants)
  let cur = item
  while (cur && cur.parent_id && !seen.has(cur.parent_id)) {
    seen.add(cur.parent_id)
    cur = items.find(i => i.id === cur.parent_id)
    if (cur) out.push(cur); else break
  }
  return out
}

/**
 * An item's tint, resolved ORIGIN → PARENT → THEME.
 *
 * Origin first: an explicit accent the user set, else the tint its tag implies
 * (what kind of work it is). Only then does it inherit the goal it hangs under,
 * and only if nothing at all applies does the caller fall back to the theme
 * accent. Tint should say something about the item, never just repeat the
 * user's current accent choice back at them.
 */
export function getAccent(item: any, items: any[]): string | null {
  if (item.accent) return item.accent
  const own = tagTintOf(item.tag ?? item.category)
  if (own) return own
  for (const a of getAncestors(item, items)) {
    if (a.accent) return a.accent
    const inherited = tagTintOf(a.tag ?? a.category)
    if (inherited) return inherited
  }
  return null
}

/**
 * The LOOSE LEAVES — tasks that hang under no goal.
 *
 * The Breakdown Method files work under goals, and every view is built around
 * that: the Workshop lists goals and drills into them, Today's rail rolls up
 * "goals in press", and the bench holds this week's committed work. A task that
 * was never filed under a goal therefore had exactly one way to be seen — being
 * scheduled on a day — and one with no date and no week_start appeared NOWHERE in
 * the app. It was in the database, it was in `items`, and there was no screen that
 * would show it to you.
 *
 * "Not part of a goal" means no GOAL anywhere up the parent chain, not merely
 * `!parent_id`: a task hung under another loose task is still loose, and reading
 * only the immediate parent would have quietly hidden that whole shape. Milestones
 * don't count as filing either — a milestone under a goal puts its children under
 * that goal, and a milestone under nothing is itself loose.
 *
 * Ordering is the section's argument: open before done, then most-committed first
 * (dated → benched → undated), then oldest date first. So the row at the top is
 * always the one with a real claim on today, and the drift sits at the bottom
 * where it can be filed or dropped.
 */
export function getLooseTasks(items: any[]) {
  return items
    .filter((it: any) => {
      if (it.kind !== 'task') return false
      // A routine's occurrence is never adrift: it is filed under a routine, which
      // IS its home, and the routine's cadence band is where it is accounted for. Without
      // this the rail would fill with two weeks of "gym" rows every time someone
      // adds a routine that isn't under a goal.
      if (isUnderRoutine(it, items)) return false
      return !getAncestors(it, items).some((a: any) => a.kind === 'goal')
    })
    .sort((a: any, b: any) => {
      if (!!a.completed !== !!b.completed) return Number(a.completed) - Number(b.completed)
      const rank = (t: any) => (t.due_date ? 0 : t.week_start ? 1 : 2)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return String(a.due_date || a.week_start || '').localeCompare(String(b.due_date || b.week_start || ''))
    })
}

/**
 * Under a ROUTINE, and therefore not the goal tree's work.
 *
 * A routine may hang under a goal ("read 20 pages a day" under "finish six
 * books"), and its occurrences are real kind:'task' rows filed beneath it — which
 * is exactly what makes them work everywhere else in the app for free. It also
 * means that without this guard they are indistinguishable from the goal's own
 * leaves, and every rollup that counts leaves would count them.
 *
 * That would not be a rounding error, it would make the number a lie: a routine
 * mints two weeks of occurrences at a time, forever, so a goal with one routine
 * under it would have a denominator that grows every week and a percentage that
 * can never reach 100 no matter how much of the actual GOAL is finished.
 * Breakdown progress and cadence attainment are different measurements; the
 * routine's cadence band (views/workshop/cadence.tsx) owns the second one.
 */
export function isUnderRoutine(item: any, items: any[]) {
  return item.kind === 'routine' || getAncestors(item, items).some((a: any) => a.kind === 'routine')
}

export function getProgress(item: any, items: any[]) {
  const desc = getDescendants(item, items)
  const leaves = desc.filter(d => (
    d.kind === 'task' && !getChildren(d, items).length && !isUnderRoutine(d, items)
  ))
  if (leaves.length === 0) return { done: 0, total: 0, pct: 0 }
  const done = leaves.filter((l: any) => l.completed).length
  return { done, total: leaves.length, pct: Math.round((done / leaves.length) * 100) }
}

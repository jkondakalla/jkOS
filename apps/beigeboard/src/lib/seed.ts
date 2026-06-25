import { isoDate } from './theme'

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

export function getAccent(item: any, items: any[]): string | null {
  if (item.accent) return item.accent
  for (const a of getAncestors(item, items)) if (a.accent) return a.accent
  return null
}

export function getProgress(item: any, items: any[]) {
  const desc = getDescendants(item, items)
  const leaves = desc.filter(d => d.kind === 'task' && (!getChildren(d, items).length))
  if (leaves.length === 0) return { done: 0, total: 0, pct: 0 }
  const done = leaves.filter((l: any) => l.completed).length
  return { done, total: leaves.length, pct: Math.round((done / leaves.length) * 100) }
}

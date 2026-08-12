/**
 * routines.ts — reading the cadence, on the client.
 *
 * A routine (kind:'routine') holds a weekly PATTERN; its occurrences are ordinary
 * kind:'task' rows minted under it by the backend engine (backend/src/routines.js,
 * which is where the mint rules and their reasoning live). Nothing here mints,
 * withdraws or writes: this module only READS the pattern and the rows it produced,
 * so the board can draw them and the row-level meters can be computed.
 *
 * The one piece of shared vocabulary is the cadence encoding — `cadence_days` is a
 * CSV of DAY OFFSETS FROM MONDAY ("0,2,4"), because every consumer computes the
 * actual date as addDays(weekStart, n). `toggleDay` below is the only writer of
 * that string in the frontend, so the encoding has exactly one producer here and
 * one parser (`cadenceDays`).
 *
 * Kept free of React and of the DOM so it can be unit-tested directly
 * (test/cards-logic.mjs transpiles it and calls these functions for real).
 */
import { addDays, isoDate, localDate, weekStart } from '@jkos/cards'

export const ROUTINE_KIND = 'routine'

/** Every routine the user owns, stable-ordered (position, then creation). */
export function getRoutines(items: any[]): any[] {
  return items
    .filter((it) => it.kind === ROUTINE_KIND)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
}

/** The committed day offsets, 0=Mon … 6=Sun, sorted and de-duped. Tolerant of a
 *  malformed string for the same reason the backend's reader is: this drives a
 *  render, and a stray value must not place a cell in column 9. */
export function cadenceDays(routine: any): number[] {
  const raw = String(routine?.cadence_days || '').trim()
  if (!raw) return []
  const seen = new Set<number>()
  for (const part of raw.split(',')) {
    const n = parseInt(part, 10)
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/** The weekly target: an explicit count, else the number of committed days. */
export function weeklyTarget(routine: any): number {
  const days = cadenceDays(routine).length
  const n = routine?.cadence_count
  if (n == null || !Number.isFinite(Number(n))) return days
  return Math.max(0, Math.trunc(Number(n)))
}

/** Occurrences the target asks for beyond the committed days — the FLOAT, which
 *  the engine mints onto the week bench for the user to place. */
export function floatCount(routine: any): number {
  return Math.max(0, weeklyTarget(routine) - cadenceDays(routine).length)
}

export const hasDay = (routine: any, offset: number): boolean =>
  cadenceDays(routine).includes(offset)

/** The cadence string with `offset` flipped — the ONE place the frontend writes
 *  this encoding. Returns the new value for a PATCH; does not mutate. */
export function toggleDay(routine: any, offset: number): string {
  const days = cadenceDays(routine)
  const next = days.includes(offset) ? days.filter((d) => d !== offset) : [...days, offset]
  return next.sort((a, b) => a - b).join(',')
}

/* ── The occurrences ──────────────────────────────────────────────────────── */

/** Rows the engine minted under this routine. Identified by parent_id AND the
 *  `routine:` ext_ref, so a task a user files under a routine by hand is not
 *  mistaken for an occurrence and counted in a streak. */
export function occurrencesOf(routine: any, items: any[]): any[] {
  return items.filter(
    (it) => it.parent_id === routine.id && String(it.ext_ref || '').startsWith('routine:'),
  )
}

/** This week's unplaced float occurrences — no date, benched on `wkStart`. */
export function floatsOf(routine: any, items: any[], wkStart: string): any[] {
  return occurrencesOf(routine, items).filter((o) => !o.due_date && o.week_start === wkStart)
}

/** What a single board cell shows.
 *   off      nothing committed and nothing minted — an empty slot
 *   idle     the pattern commits this weekday, but no occurrence exists on this
 *            date (the week predates the routine, or it was withdrawn)
 *   planned  an occurrence in the future
 *   open     today's occurrence, not yet ticked — the day is still running
 *   missed   a past occurrence that was never ticked
 *   done     completed */
export type CellState = 'off' | 'idle' | 'planned' | 'open' | 'missed' | 'done'

export interface Cell {
  iso: string
  offset: number
  committed: boolean
  isToday: boolean
  isPast: boolean
  occurrence: any | null
  state: CellState
}

/** The seven cells of one routine's row, for the week starting `wkStart`. */
export function weekCells(routine: any, items: any[], wkStart: string, today: string): Cell[] {
  const committed = new Set(cadenceDays(routine))
  const byDate = new Map<string, any>()
  for (const o of occurrencesOf(routine, items)) if (o.due_date) byDate.set(o.due_date, o)

  return Array.from({ length: 7 }, (_, offset) => {
    const iso = addDays(wkStart, offset)
    const occurrence = byDate.get(iso) || null
    const isToday = iso === today
    const isPast = iso < today
    let state: CellState = 'off'
    if (occurrence) {
      if (occurrence.completed) state = 'done'
      else if (isPast) state = 'missed'
      else if (isToday) state = 'open'
      else state = 'planned'
    } else if (committed.has(offset)) {
      state = 'idle'
    }
    return { iso, offset, committed: committed.has(offset), isToday, isPast, occurrence, state }
  })
}

/* ── The meters ───────────────────────────────────────────────────────────── */

/** How the week is going: ticked occurrences over the weekly target. Counts
 *  floats too — a float you placed and did is the routine being kept, and the
 *  target counts it, so the meter must as well. */
export function attainment(routine: any, items: any[], wkStart: string) {
  const end = addDays(wkStart, 6)
  const inWeek = occurrencesOf(routine, items).filter((o) => (
    o.due_date ? o.due_date >= wkStart && o.due_date <= end : o.week_start === wkStart
  ))
  const done = inWeek.filter((o) => o.completed).length
  const target = weeklyTarget(routine)
  return { done, target, pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0 }
}

/**
 * The streak — consecutive kept occurrences, counting back from the most recent.
 *
 * TODAY IS NOT A BREAK. An unticked occurrence today is a day still in progress,
 * not a day missed; treating it as a break would show every streak collapsing to
 * zero each morning and rebuilding each evening, which is exactly the reading that
 * makes a streak meter useless. So today is skipped when it is open, and counted
 * when it is done.
 *
 * Only DATED occurrences count: a float that was never placed has no day to be
 * consecutive with.
 */
export function streakOf(routine: any, items: any[], today: string): number {
  const past = occurrencesOf(routine, items)
    .filter((o) => o.due_date && o.due_date <= today)
    .sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)))

  let n = 0
  for (const o of past) {
    if (o.completed) { n++; continue }
    if (o.due_date === today) continue   // still running — neither breaks nor counts
    break
  }
  return n
}

/* ── Small formatting shared by the board ─────────────────────────────────── */

/** "Mon 11" for a column head. */
export function cellLabel(iso: string): string {
  return String(localDate(iso).getDate())
}

/** The Monday of the week containing `iso` — re-exported so callers need one
 *  import for the whole cadence vocabulary. */
export { weekStart, addDays, isoDate }

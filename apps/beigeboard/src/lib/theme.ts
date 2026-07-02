// Fonts flow from the @jkos/design token system (set per-app via the factory in
// App.tsx: serif → Fraunces, sans/mono → IBM Plex). Referencing the tokens here
// means every view that uses these constants adopts the brief typography at once.
export const FONT_HEAD = 'var(--hub-font-serif)'   // Fraunces (serif headers)
export const FONT_BODY = 'var(--hub-font-sans)'    // IBM Plex Sans
export const FONT_NUM  = 'var(--hub-font-serif)'   // Fraunces (serif figures)

// Date/time + grid math is single-sourced in @jkos/cards (the calendar card kit);
// re-exported here so existing BeigeBoard imports keep working without a second,
// drifting copy. BeigeBoard-only formatters that build on these stay below.
export {
  isoDate, localDate, addDays, weekStart,
  fmtTime, timeToFrac, fmtHourLabel, fmtWeekday, fmtFull,
} from '@jkos/cards'
import { localDate } from '@jkos/cards'

export const TASK_COLORS = [
  { id: 'rust',  label: 'Rust',  hex: '#B05040' },
  { id: 'amber', label: 'Amber', hex: '#A07828' },
  { id: 'sage',  label: 'Sage',  hex: '#4E7250' },
  { id: 'slate', label: 'Slate', hex: '#3A5C78' },
  { id: 'umber', label: 'Umber', hex: '#7A6050' },
  { id: 'teal',  label: 'Teal',  hex: '#307068' },
  { id: 'mauve', label: 'Mauve', hex: '#7A5070' },
]

export const SOURCES: Record<string, { label: string; hex: string }> = {
  work:     { label: 'Work',             hex: '#3A5C78' },
  personal: { label: 'Personal',         hex: '#4E7250' },
  outlook:  { label: 'Outlook',          hex: '#7A5070' },
  google:   { label: 'Google Calendar',  hex: '#3A7BD5' },
  icloud:   { label: 'iCloud Calendar',  hex: '#5C8FA8' },
  bb:       { label: 'BeigeBoard',       hex: '#B05040' },
}

export const sourceOf = (id: string) => SOURCES[id] || { label: 'Source', hex: '#7A6050' }

// BeigeBoard-only formatters layered on the shared localDate.
export const fmtMonthDay = (iso: string) => localDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function getGreeting() {
  const h = new Date().getHours()
  if (h <  5) return 'Late night.'
  if (h < 12) return 'Morning.'
  if (h < 17) return 'Afternoon.'
  if (h < 21) return 'Evening.'
  return 'Night.'
}

// The per-colour emissive glow that used to live here (halate) now belongs to the
// @jkos/design factory as the .jk-glow / .jk-glow-text utility classes: add the
// class + an intensity rung (.jk-glow-low/-mid/-hi) and set the colour inline via
// --jk-glow-color. Mode-gating (none on paper, glow in CRT) is handled in CSS, so
// there is no JS helper to call. Primary-accent glows use --accent-halo(-text).

export const FONT_HEAD = "'Newsreader', 'EB Garamond', Georgia, serif"
export const FONT_BODY = "'Inter Tight', system-ui, sans-serif"
export const FONT_NUM  = "'Newsreader', Georgia, serif"

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

export function isoDate(d: Date): string {
  const z = new Date(d)
  const y = z.getFullYear()
  const m = String(z.getMonth() + 1).padStart(2, '0')
  const day = String(z.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const localDate     = (iso: string) => new Date(iso + 'T00:00:00')
export const fmtWeekday    = (iso: string) => localDate(iso).toLocaleDateString('en-US', { weekday: 'short' })
export const fmtWeekdayLong= (iso: string) => localDate(iso).toLocaleDateString('en-US', { weekday: 'long' })
export const fmtFull       = (iso: string) => localDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
export const fmtMonthDay   = (iso: string) => localDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export const fmtTime = (t: string) => {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

export const timeToFrac = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export const fmtHourLabel = (h: number) =>
  h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`

export const addDays = (iso: string, n: number) => {
  const d = localDate(iso)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

export const weekStart = (iso: string) => {
  const d = localDate(iso)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return isoDate(d)
}

export function getGreeting() {
  const h = new Date().getHours()
  if (h <  5) return 'Late night.'
  if (h < 12) return 'Morning.'
  if (h < 17) return 'Afternoon.'
  if (h < 21) return 'Evening.'
  return 'Night.'
}

export function halate(hex: string | null | undefined, level = 'mid') {
  if (!hex || hex.startsWith('var(')) return 'none'
  const c = hex.replace('#', '')
  const alpha = ({ hi: '88', mid: '55', low: '33', soft: '1f' } as any)[level] || '55'
  const radius = ({ hi: 28, mid: 16, low: 10, soft: 5 } as any)[level] || 16
  return `0 0 ${radius}px #${c}${alpha}`
}

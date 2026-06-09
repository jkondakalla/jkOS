import React from 'react'
import { useTheme } from '../lib/theme'

/* — helpers ——————————————————————————————————————————————————————————————— */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const UNIT_VARS = [
  'var(--color-u1)', 'var(--color-u2)', 'var(--color-u3)', 'var(--color-u4)',
  'var(--color-u5)', 'var(--color-u6)', 'var(--color-u7)', 'var(--color-u8)',
]
export function unitColor(i: number): string {
  return UNIT_VARS[((i % UNIT_VARS.length) + UNIT_VARS.length) % UNIT_VARS.length]
}

/* — icons (inline, currentColor) ———————————————————————————————————————————— */

type IconName =
  | 'chevron' | 'check' | 'flame' | 'book' | 'upload' | 'settings' | 'sun' | 'moon'
  | 'play' | 'pause' | 'arrow-right' | 'arrow-left' | 'x' | 'sparkles' | 'layers'
  | 'clock' | 'trash' | 'target' | 'logout' | 'plus' | 'cap' | 'dot' | 'lightning'
  | 'search' | 'film' | 'image'

const PATHS: Record<IconName, React.ReactNode> = {
  chevron: <path d="M9 6l6 6-6 6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  flame: <path d="M12 3c1 3-1 4-1 6a4 4 0 108 0c0-1.5-.5-2.5-1-3 .2 1.2-.6 2-1.2 2C16 5 14 4 12 3z M12 21a5 5 0 01-5-5c0-2 1-3 1.5-4 .3 1 1.2 1.6 1.9 1.6" />,
  book: <><path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" /><path d="M4 20.5A2.5 2.5 0 016.5 18H20" /><path d="M9 7.5h7" /></>,
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  moon: <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />,
  play: <path d="M7 4.5v15l13-7.5z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  'arrow-left': <><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  sparkles: <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7l1 13h10l1-13" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  logout: <><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 12H21M18 9l3 3-3 3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  cap: <><path d="M3 9l9-4 9 4-9 4z" /><path d="M7 11v4c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4" /></>,
  dot: <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />,
  lightning: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
}

export function Icon({ name, size = 18, className, strokeWidth = 1.75 }: {
  name: IconName; size?: number; className?: string; strokeWidth?: number
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

/* — Button ———————————————————————————————————————————————————————————————— */

type Variant = 'primary' | 'soft' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-strong shadow-card',
  soft: 'bg-accent-soft text-accent-ink hover:brightness-[0.97] dark:hover:brightness-110',
  outline: 'border border-line-strong text-ink hover:bg-paper-2 hover:border-faint',
  ghost: 'text-muted hover:text-ink hover:bg-paper-2',
  danger: 'bg-danger-soft text-danger hover:brightness-[0.97] dark:hover:brightness-110',
}
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-[15px] rounded-xl gap-2',
}

export const Button = React.forwardRef<HTMLButtonElement, {
  variant?: Variant; size?: Size; icon?: React.ReactNode; full?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>>(function Button(
  { variant = 'primary', size = 'md', icon, full, className, children, ...rest }, ref) {
  return (
    <button ref={ref} {...rest}
      className={cx(
        'inline-flex items-center justify-center font-semibold tracking-[-0.01em]',
        'transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
        VARIANT[variant], SIZE[size], full && 'w-full', className,
      )}>
      {icon}{children}
    </button>
  )
})

/* — Card ————————————————————————————————————————————————————————————————— */

export function Card({ className, hover, glow, children, style, ...rest }: {
  hover?: boolean; glow?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} style={style}
      className={cx(
        'relative bg-card border border-line rounded-card shadow-card overflow-hidden',
        hover && 'transition hover:shadow-lift hover:-translate-y-0.5',
        className,
      )}>
      {glow && (
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full opacity-60"
          style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)` }} />
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

/* — Progress —————————————————————————————————————————————————————————————— */

export function Bar({ value, color = 'var(--color-accent)', height = 6, className }: {
  value: number; color?: string; height?: number; className?: string
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={cx('w-full rounded-full bg-line overflow-hidden', className)} style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export function Ring({ value, size = 80, stroke = 7, color = 'var(--color-accent)', track = 'var(--color-line)', children }: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

/* — Badge ————————————————————————————————————————————————————————————————— */

export function Badge({ children, color, className }: {
  children: React.ReactNode; color?: string; className?: string
}) {
  const style = color
    ? { color, background: `color-mix(in oklab, ${color} 14%, transparent)`, borderColor: `color-mix(in oklab, ${color} 32%, transparent)` }
    : undefined
  return (
    <span style={style}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide',
        !color && 'bg-accent-soft text-accent-ink border-transparent', className,
      )}>
      {children}
    </span>
  )
}

/* — Segmented control ——————————————————————————————————————————————————————— */

export function Segmented<T extends string>({ options, value, onChange, full }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; full?: boolean
}) {
  return (
    <div className={cx('inline-flex gap-1 rounded-xl border border-line bg-paper-2 p-1', full && 'w-full')}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition',
              active ? 'bg-card text-ink shadow-card' : 'text-muted hover:text-ink',
            )}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* — Form ————————————————————————————————————————————————————————————————— */

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] text-faint">{hint}</span>}
    </label>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={cx(
        'w-full rounded-xl border border-line bg-paper-2 px-3.5 py-2.5 text-sm text-ink',
        'placeholder:text-faint outline-none transition',
        'focus:border-accent focus:bg-card focus:ring-2 focus:ring-accent/25',
        props.className,
      )} />
  )
}

/* — Theme toggle ————————————————————————————————————————————————————————— */

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button onClick={toggle} title={dark ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle theme"
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted',
        'transition hover:text-ink hover:border-faint hover:bg-paper-2 active:scale-95',
        className,
      )}>
      <Icon name={dark ? 'sun' : 'moon'} size={17} />
    </button>
  )
}

/* — Misc ————————————————————————————————————————————————————————————————— */

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span className="inline-block animate-spin rounded-full border-2 border-line border-t-accent"
      style={{ width: size, height: size }} />
  )
}

export function EmptyState({ icon, title, body, action }: {
  icon: IconName; title: string; body?: string; action?: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-md py-20 text-center animate-fade-up">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
        <Icon name={icon} size={28} />
      </div>
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      {body && <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}

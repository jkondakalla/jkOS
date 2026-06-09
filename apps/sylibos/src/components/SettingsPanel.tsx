import { useRef, useState, useEffect } from 'react'
import type { JkOSTheme, JkosUser, EffectsPreferences, LazurPreferences } from '../api/auth'
import { AUTH_URL, logout } from '../api/auth'

const PRESETS = [
  { label: 'Amber · Cyan',    primary: '#ffb000', secondary: '#4ecdc4' },
  { label: 'Green · Violet',  primary: '#5cd66a', secondary: '#c08aff' },
  { label: 'Ice · Coral',     primary: '#a8d8ff', secondary: '#ff6b5a' },
  { label: 'Gold · Mint',     primary: '#ffd000', secondary: '#5affc1' },
  { label: 'Rose · Amber',    primary: '#ff7a9a', secondary: '#ffb000' },
  { label: 'Electric · Lime', primary: '#2eb3ff', secondary: '#aeff1e' },
]

interface Props {
  open:         boolean
  onClose:      () => void
  user:         JkosUser | null
  theme:        JkOSTheme
  effects:      EffectsPreferences
  lazuros:      LazurPreferences
  saving:       boolean
  patchTheme:   (p: Partial<JkOSTheme>) => void
  patchEffects: (p: Partial<EffectsPreferences>) => void
  patchLazuros: (p: Partial<LazurPreferences>) => void
}

const glass: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0,
  height: '100dvh', width: 360,
  background: 'rgba(10, 9, 7, 0.96)',
  backdropFilter: 'blur(32px) saturate(160%)',
  borderLeft: '1px solid rgba(255,255,255,0.07)',
  boxShadow: '-24px 0 64px rgba(0,0,0,0.75)',
  zIndex: 400,
  display: 'flex', flexDirection: 'column',
  overflowY: 'auto', overflowX: 'hidden',
  transition: 'transform 0.28s cubic-bezier(0.4, 0.2, 0.2, 1)',
}

const sect: React.CSSProperties = {
  padding: '18px 20px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', flexShrink: 0 }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
    </div>
  )
}

export function SettingsPanel({
  open, onClose, user, theme, effects, lazuros, saving,
  patchTheme, patchEffects, patchLazuros,
}: Props) {
  const src = (user?.name || user?.email || '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: open ? 'rgba(0,0,0,0.35)' : 'transparent',
          backdropFilter: open ? 'blur(1px)' : 'none',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s, backdrop-filter 0.25s', zIndex: 399,
        }}
      />

      <aside style={{ ...glass, transform: open ? 'translateX(0)' : 'translateX(105%)' }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
            jkOS Suite{saving && <span style={{ color: 'var(--color-accent)', marginLeft: 10 }}>· Saving</span>}
          </span>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1, outline: 'none', transition: 'color 0.12s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
          >×</button>
        </div>

        {/* Profile */}
        <section style={{ ...sect, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, var(--color-accent-deep, #084), var(--color-accent))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff',
            boxShadow: '0 0 12px var(--color-accent-glow)',
          }}>{inits}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name || 'User'}
              {user?.role === 'guest' && <span style={{ marginLeft: 8, fontSize: 8, letterSpacing: '0.1em', color: 'var(--color-accent)' }}>GUEST</span>}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.email}
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section style={sect}>
          <SectionLabel>Appearance</SectionLabel>
          <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
            {(['system', 'light', 'dark'] as JkOSTheme['mode'][]).map(m => (
              <button type="button" key={m} onClick={() => patchTheme({ mode: m })} style={{
                flex: 1, padding: '7px 0',
                background: theme.mode === m ? 'var(--color-accent)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${theme.mode === m ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)'}`,
                color: theme.mode === m ? '#fff' : 'rgba(255,255,255,0.4)',
                fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
                cursor: 'pointer', transition: 'all 0.14s', outline: 'none',
              }}>
                {m === 'system' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.2)', marginBottom: 8, textTransform: 'uppercase' }}>Presets</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {PRESETS.map(p => {
              const active = theme.primary === p.primary && theme.secondary === p.secondary
              return (
                <button type="button" key={p.label}
                  onClick={() => patchTheme({ primary: p.primary, secondary: p.secondary })}
                  title={p.label}
                  style={{
                    width: 48, height: 28,
                    background: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    transition: 'all 0.12s', outline: 'none',
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.primary, boxShadow: `0 0 4px ${p.primary}88`, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.secondary, boxShadow: `0 0 4px ${p.secondary}88`, display: 'inline-block', flexShrink: 0 }} />
                </button>
              )
            })}
          </div>

          <ColorRow label="Primary"   color={theme.primary}   onChange={c => patchTheme({ primary: c })} />
          <ColorRow label="Secondary" color={theme.secondary} onChange={c => patchTheme({ secondary: c })} />
        </section>

        {/* Effects */}
        <section style={sect}>
          <SectionLabel>Effects</SectionLabel>
          <EffectRow label="Film grain"  value={effects.grain}     onToggle={v => patchEffects({ grain: v })}>
            {effects.grain && <SliderInput value={effects.grainStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ grainStrength: v })} />}
          </EffectRow>
          <EffectRow label="Halation"    value={effects.halation}  onToggle={v => patchEffects({ halation: v })} />
          <EffectRow label="Scan lines"  value={effects.scanLines} onToggle={v => patchEffects({ scanLines: v })}>
            {effects.scanLines && <SliderInput value={effects.scanStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ scanStrength: v })} />}
          </EffectRow>
          <EffectRow label="Artifacts"   value={effects.artifacts} onToggle={v => patchEffects({ artifacts: v })} />
        </section>

        {/* AI */}
        <section style={sect}>
          <SectionLabel>AI · LazurOS</SectionLabel>
          <LazurRow label="URL"   value={lazuros.url}   onCommit={v => patchLazuros({ url: v })}   placeholder="http://host:8080" />
          <LazurRow label="Model" value={lazuros.model} onCommit={v => patchLazuros({ model: v })} placeholder="llama3.2" />
        </section>

        {/* Account */}
        <section style={{ ...sect, borderBottom: 'none' }}>
          <SectionLabel>Account</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={`${AUTH_URL}/auth/dashboard`} target="_blank" rel="noopener noreferrer"
              style={{
                flex: 1, padding: '8px 12px', textAlign: 'center', textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,255,255,0.5)', fontSize: 10, letterSpacing: '0.1em', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
            >Manage ↗</a>
            <button type="button" onClick={logout}
              style={{
                flex: 1, padding: '8px 12px',
                border: '1px solid rgba(255,80,50,0.25)', background: 'transparent',
                color: 'rgba(255,100,70,0.65)', fontSize: 10, letterSpacing: '0.1em',
                cursor: 'pointer', outline: 'none', transition: 'all 0.12s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,80,50,0.6)'
                ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,100,70,0.9)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,80,50,0.25)'
                ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,100,70,0.65)'
              }}
            >Sign out</button>
          </div>
        </section>
      </aside>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ColorRow({ label, color, onChange }: { label: string; color: string; onChange: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(color)
  useEffect(() => setDraft(color), [color])

  const handleText = (val: string) => {
    setDraft(val)
    if (/^#[0-9a-fA-F]{6}$/.test(val)) onChange(val)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 62, flexShrink: 0, letterSpacing: '0.06em' }}>{label}</span>
      <button type="button" onClick={() => ref.current?.click()} style={{ width: 30, height: 30, flexShrink: 0, background: color, border: '2px solid rgba(255,255,255,0.15)', cursor: 'pointer', boxShadow: `0 0 10px ${color}55`, outline: 'none', transition: 'box-shadow 0.15s' }} />
      <input ref={ref} type="color" value={color} onChange={e => onChange(e.target.value)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
      <input type="text" value={draft} onChange={e => handleText(e.target.value)} onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(draft)) setDraft(color) }} maxLength={7} spellCheck={false}
        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: /^#[0-9a-fA-F]{6}$/.test(draft) ? 'rgba(255,255,255,0.75)' : 'rgba(255,120,80,0.8)', padding: '5px 10px', fontSize: 11, letterSpacing: '0.08em', outline: 'none' }} />
    </div>
  )
}

function EffectRow({ label, value, onToggle, children }: { label: string; value: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: children ? 7 : 0 }}>
        <span style={{ fontSize: 11, color: value ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.32)', letterSpacing: '0.04em' }}>{label}</span>
        <Toggle value={value} onChange={onToggle} />
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} aria-pressed={value}
      style={{ width: 36, height: 20, position: 'relative', cursor: 'pointer', flexShrink: 0, background: value ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)', border: `1px solid ${value ? 'var(--color-accent)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 10, padding: 0, transition: 'all 0.18s', outline: 'none' }}>
      <span style={{ position: 'absolute', top: 2, left: value ? 16 : 2, width: 14, height: 14, background: value ? '#fff' : 'rgba(255,255,255,0.45)', borderRadius: '50%', transition: 'left 0.18s cubic-bezier(0.4, 0.2, 0.2, 1)' }} />
    </button>
  )
}

function SliderInput({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 10, marginTop: 2 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 30, textAlign: 'right', flexShrink: 0 }}>{Math.round(value * 100)}%</span>
    </div>
  )
}

function LazurRow({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 44, flexShrink: 0, letterSpacing: '0.06em' }}>{label}</span>
      <input type="text" value={draft} placeholder={placeholder} spellCheck={false}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onCommit(draft.trim())}
        onKeyDown={e => { if (e.key === 'Enter') { onCommit(draft.trim()); (e.target as HTMLInputElement).blur() } }}
        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', padding: '5px 10px', fontSize: 10, letterSpacing: '0.04em', outline: 'none' }} />
    </div>
  )
}

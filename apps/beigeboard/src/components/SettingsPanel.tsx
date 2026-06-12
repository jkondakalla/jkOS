import React, { useRef } from 'react'
import type { JkOSTheme, EffectsPreferences, LazurPreferences, JkosUser } from '../lib/jkauth'
import { AUTH_URL } from '../lib/jkauth'
import { FONT_BODY } from '../lib/theme'

const PRESETS = [
  { label: 'AMBER · CYAN',    primary: '#ffb000', secondary: '#4ecdc4' },
  { label: 'GREEN · VIOLET',  primary: '#5cd66a', secondary: '#c08aff' },
  { label: 'ICE · CORAL',     primary: '#a8d8ff', secondary: '#ff6b5a' },
  { label: 'GOLD · MINT',     primary: '#ffd000', secondary: '#5affc1' },
  { label: 'ROSE · AMBER',    primary: '#ff7a9a', secondary: '#ffb000' },
  { label: 'ELECTRIC · LIME', primary: '#2eb3ff', secondary: '#aeff1e' },
]

interface Props {
  open:         boolean
  onClose:      () => void
  user:         JkosUser | null
  onLogout?:    () => void
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
  background: 'rgba(10, 9, 7, 0.94)',
  backdropFilter: 'blur(28px) saturate(150%)',
  borderLeft: '1px solid rgba(255,255,255,0.07)',
  boxShadow: '-20px 0 60px rgba(0,0,0,0.7)',
  zIndex: 400,
  display: 'flex', flexDirection: 'column',
  overflowY: 'auto',
  transition: 'transform 0.28s cubic-bezier(0.4, 0.2, 0.2, 1)',
  fontFamily: FONT_BODY,
}

const sect: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
}

const label: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.15em',
  color: 'rgba(255,255,255,0.3)',
  textTransform: 'uppercase', marginBottom: 10,
}

export function SettingsPanel({
  open, onClose, user, onLogout, theme, effects, lazuros, saving,
  patchTheme, patchEffects, patchLazuros,
}: Props) {
  const inits = (() => {
    const src = (user?.name || user?.email || '?').trim()
    const parts = src.split(/[\s@.]+/).filter(Boolean)
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()
  })()

  const handleLogout = () => {
    onLogout?.()
    fetch(`${AUTH_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
      .finally(() => { window.location.href = `${AUTH_URL}/auth/login` })
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: open ? 'rgba(0,0,0,0.35)' : 'transparent',
        opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.25s', zIndex: 399,
      }} />

      <aside style={{ ...glass, transform: open ? 'translateX(0)' : 'translateX(105%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
            jkOS SUITE{saving && <span style={{ color: 'var(--color-accent)', marginLeft: 8 }}>· SAVING</span>}
          </span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {/* Profile */}
        <section style={{ ...sect, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#000' }}>{inits}</div>
          <div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{user?.name || 'User'}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{user?.email}</div>
          </div>
        </section>

        {/* Appearance */}
        <section style={sect}>
          <div style={label}>Appearance</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {(['system', 'light', 'dark'] as JkOSTheme['mode'][]).map(m => (
              <button key={m} onClick={() => patchTheme({ mode: m })} style={{
                flex: 1, padding: '6px 0',
                background: theme.mode === m ? 'var(--color-accent)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${theme.mode === m ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)'}`,
                color: theme.mode === m ? '#000' : 'rgba(255,255,255,0.45)',
                fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              }}>{m === 'system' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => patchTheme({ primary: p.primary, secondary: p.secondary })} title={p.label}
                style={{ width: 44, height: 26, padding: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.primary, display: 'inline-block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.secondary, display: 'inline-block' }} />
              </button>
            ))}
          </div>
          <ColorRow label="Primary"   color={theme.primary}   onChange={c => patchTheme({ primary: c })} />
          <ColorRow label="Secondary" color={theme.secondary} onChange={c => patchTheme({ secondary: c })} />
        </section>

        {/* Effects */}
        <section style={sect}>
          <div style={label}>Effects</div>
          <EffectRow label="Film grain"  value={effects.grain}     onToggle={v => patchEffects({ grain: v })}>
            {effects.grain && <SliderRow value={effects.grainStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ grainStrength: v })} />}
          </EffectRow>
          <EffectRow label="Halation"    value={effects.halation}  onToggle={v => patchEffects({ halation: v })} />
          <EffectRow label="Scan lines"  value={effects.scanLines} onToggle={v => patchEffects({ scanLines: v })}>
            {effects.scanLines && <SliderRow value={effects.scanStrength} min={0} max={1} step={0.05} onChange={v => patchEffects({ scanStrength: v })} />}
          </EffectRow>
          <EffectRow label="Artifacts"   value={effects.artifacts} onToggle={v => patchEffects({ artifacts: v })} />
        </section>

        {/* AI — hidden when suite kill switch is off */}
        {lazuros.enabled !== false && (
          <section style={sect}>
            <div style={label}>AI · LazurOS</div>
            <LazurRow label="URL"   value={lazuros.url}   onChange={v => patchLazuros({ url: v })}   placeholder="http://host:8080" />
            <LazurRow label="Model" value={lazuros.model} onChange={v => patchLazuros({ model: v })} placeholder="llama3.2" />
          </section>
        )}

        {/* Account */}
        <section style={{ ...sect, borderBottom: 'none' }}>
          <div style={label}>Account</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={`${AUTH_URL}/auth/dashboard`} target="_blank" rel="noopener"
              style={{ flex: 1, padding: '8px 12px', textAlign: 'center', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', fontSize: 10, display: 'block' }}>
              Manage ↗
            </a>
            <button onClick={handleLogout}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid rgba(255,80,50,0.3)', background: 'transparent', color: 'rgba(255,80,50,0.7)', fontSize: 10, cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        </section>
      </aside>
    </>
  )
}

function ColorRow({ label: lbl, color, onChange }: { label: string; color: string; onChange: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 60, flexShrink: 0 }}>{lbl}</span>
      <button onClick={() => ref.current?.click()} style={{ width: 28, height: 28, flexShrink: 0, background: color, border: '2px solid rgba(255,255,255,0.15)', cursor: 'pointer' }} />
      <input ref={ref} type="color" value={color} onChange={e => onChange(e.target.value)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
      <input type="text" value={color} onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value) }} maxLength={7}
        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', padding: '4px 8px', fontSize: 11 }} />
    </div>
  )
}

function EffectRow({ label: lbl, value, onToggle, children }: { label: string; value: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: children ? 6 : 0 }}>
        <span style={{ fontSize: 11, color: value ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)' }}>{lbl}</span>
        <button onClick={() => onToggle(!value)} style={{
          width: 38, height: 20, position: 'relative', cursor: 'pointer',
          background: value ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 0,
        }}>
          <span style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 14, height: 14, background: value ? '#000' : 'rgba(255,255,255,0.4)', borderRadius: '50%', transition: 'left 0.18s' }} />
        </button>
      </div>
      {children}
    </div>
  )
}

function SliderRow({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--color-accent)' }} />
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 30, textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    </div>
  )
}

function LazurRow({ label: lbl, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 44, flexShrink: 0 }}>{lbl}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', padding: '5px 8px', fontSize: 10 }} />
    </div>
  )
}

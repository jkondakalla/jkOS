import React, { useState, useEffect, useRef } from 'react'
import { VU } from '@jkos/ui'
import { FONT_HEAD, FONT_BODY, FONT_NUM, TASK_COLORS } from '../lib/theme'

export function Checkbox({ id, completed, onToggle, color, size = 15 }: any) {
  const [pop, setPop] = useState(false)
  const handle = (e: any) => {
    e?.stopPropagation()
    if (!completed) { setPop(true); setTimeout(() => setPop(false), 260) }
    onToggle?.(id, completed)
  }
  const accent = color || 'var(--color-accent)'
  return (
    <button
      onClick={handle}
      className={pop ? 'check-pop' : ''}
      style={{
        width: size, height: size,
        border: `1px solid ${completed ? accent : 'var(--color-line)'}`,
        borderRadius: 'var(--hub-radius-xs)',
        background: completed ? accent : 'transparent',
        cursor: 'pointer', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-paper)', fontSize: Math.round(size * 0.6), lineHeight: 1,
        transition: 'background 0.15s, border-color 0.15s',
        padding: 0,
        boxShadow: completed ? `0 0 8px ${accent}66` : 'none',
      }}
    >{completed ? '✓' : ''}</button>
  )
}

export function Eyebrow({ children, color, style }: any) {
  return (
    <div style={{
      fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.22em',
      textTransform: 'uppercase', color: color || 'var(--color-muted)',
      ...style,
    }}>{children}</div>
  )
}

export function VUMeter({ pct = 0, color, segments = 20, height = 8, label }: any) {
  const accent = color || 'var(--color-accent)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <VU
        value={pct / 100}
        segments={segments}
        tint={accent}
        style={{
          flex: 1, height: height + 6,
          padding: 3,
          background: 'rgba(0,0,0,0.4)',
          border: `1px solid var(--color-line)`,
          boxShadow: `inset 0 2px 4px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.06)`,
        }}
      />
      {label && (
        <span style={{
          fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12,
          color: pct >= 80 ? 'var(--color-accent)' : accent,
          minWidth: 38, textAlign: 'right',
          textShadow: `0 0 8px ${pct >= 80 ? 'var(--color-accent)' : accent}66`,
        }}>{label}</span>
      )}
    </div>
  )
}

export function TapeReel({ size = 36, color, spinning = false, style }: any) {
  const c = color || 'var(--color-muted)'
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{
      display: 'inline-block',
      width: size, height: size,
      flexShrink: 0,
      overflow: 'visible',
      animation: spinning ? 'spin 2.4s linear infinite' : 'none',
      ...style,
    }}>
      <circle cx="20" cy="20" r="18" fill="none" stroke={c} strokeWidth="1.2" opacity="0.85" />
      <circle cx="20" cy="20" r="11" fill="none" stroke={c} strokeWidth="0.8" opacity="0.6" />
      <circle cx="20" cy="20" r="3.5" fill={c} opacity="0.9" />
      {[0, 60, 120, 180, 240, 300].map(deg => (
        <line key={deg}
          x1="20" y1="20"
          x2={20 + Math.cos(deg * Math.PI / 180) * 11}
          y2={20 + Math.sin(deg * Math.PI / 180) * 11}
          stroke={c} strokeWidth="1" opacity="0.5"
        />
      ))}
    </svg>
  )
}

export function Plate({ children, style, accent, recessed, dataDropId, ...rest }: any) {
  return (
    <div
      data-drop-id={dataDropId}
      {...rest}
      style={{
        position: 'relative',
        background: recessed ? 'rgba(0,0,0,0.25)' : 'var(--color-paper-2)',
        border: `1px solid var(--color-line)`,
        borderRadius: 'var(--hub-radius-lg)',
        boxShadow: recessed
          ? `inset 0 2px 6px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.04)`
          : `inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.18), 0 1px 0 rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.18)`,
        ...style,
      }}>
      {accent && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 5,
          background: accent,
          borderTopLeftRadius: 'var(--hub-radius-lg)',
          borderBottomLeftRadius: 'var(--hub-radius-lg)',
          boxShadow: `0 0 14px ${accent}66`,
        }} />
      )}
      {children}
    </div>
  )
}

export function RecLamp({ size = 8, label }: any) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="now-dot" style={{
        width: size, height: size, borderRadius: '50%',
        background: 'var(--color-accent)',
        boxShadow: `0 0 8px var(--color-accent-glow), 0 0 14px var(--color-accent-glow), inset 0 -1px 0 rgba(255,255,255,0.18)`,
      }} />
      {label && (
        <span style={{
          fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: 'var(--color-accent)',
          textShadow: 'var(--accent-halo-text)',
        }}>{label}</span>
      )}
    </div>
  )
}

export function TimeReadout({ style }: any) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i) }, [])
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return (
    <span style={{
      fontFamily: FONT_NUM, fontStyle: 'italic',
      fontSize: 13, color: 'var(--color-accent)', letterSpacing: '0.08em',
      textShadow: 'var(--accent-halo-text)',
      ...style,
    }}>
      {hh}<span style={{ opacity: 0.4 }}>:</span>{mm}<span style={{ opacity: 0.6, fontSize: 10 }}>:{ss}</span>
    </span>
  )
}

export function ColorPicker({ current, onChange, onClose }: any) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', zIndex: 300,
      background: 'var(--color-paper-2)',
      border: `1px solid var(--color-line)`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.45)`,
      padding: '8px 10px',
      display: 'flex', gap: 5, alignItems: 'center',
    }}>
      <button
        onClick={() => { onChange(null); onClose() }}
        title="No color"
        style={{
          width: 18, height: 18, border: `1px solid var(--color-line)`,
          background: 'transparent', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-faint)', fontSize: 10, lineHeight: 1,
          outline: !current ? `2px solid var(--color-ink)` : 'none',
          outlineOffset: 1,
        }}
      >✕</button>
      {TASK_COLORS.map(c => (
        <button
          key={c.id}
          onClick={() => { onChange(c.hex); onClose() }}
          title={c.label}
          style={{
            width: 18, height: 18,
            background: c.hex,
            border: 'none', cursor: 'pointer', padding: 0,
            outline: current === c.hex ? `2px solid var(--color-ink)` : 'none',
            outlineOffset: 1,
            boxShadow: current === c.hex ? `0 0 8px ${c.hex}99` : 'none',
          }}
        />
      ))}
    </div>
  )
}

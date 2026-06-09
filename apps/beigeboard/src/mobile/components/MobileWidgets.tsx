import React, { useState, useEffect, useRef } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM } from '../../lib/theme'

/**
 * Mobile-optimized widget library for compact phone interface
 */

export function Eyebrow({ children, color, style }: any) {
  return (
    <div style={{
      fontFamily: FONT_BODY,
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: '0.24em',
      textTransform: 'uppercase',
      color: color || 'var(--color-muted)',
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </div>
  )
}

export function TapeReel({ size = 28, color, spinning = false, style }: any) {
  const c = color || 'var(--color-muted)'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{
        display: 'inline-block',
        flexShrink: 0,
        overflow: 'visible',
        animation: spinning ? 'bb-spin 2.6s linear infinite' : 'none',
        ...style,
      }}
    >
      <circle cx="20" cy="20" r="18" fill="none" stroke={c} strokeWidth="1.2" opacity="0.85" />
      <circle cx="20" cy="20" r="11" fill="none" stroke={c} strokeWidth="0.8" opacity="0.55" />
      <circle cx="20" cy="20" r="3.4" fill={c} opacity="0.9" />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <line
          key={deg}
          x1="20"
          y1="20"
          x2={20 + Math.cos((deg * Math.PI) / 180) * 11}
          y2={20 + Math.sin((deg * Math.PI) / 180) * 11}
          stroke={c}
          strokeWidth="1"
          opacity="0.5"
        />
      ))}
    </svg>
  )
}

export function RecLamp({ size = 7, label, color }: any) {
  const c = color || 'var(--color-accent)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className="bb-pulse"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: c,
          boxShadow: `0 0 8px ${c}cc, 0 0 14px ${c}55, inset 0 -1px 0 rgba(255,255,255,0.2)`,
        }}
      />
      {label && (
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: c,
          }}
        >
          {label}
        </span>
      )}
    </span>
  )
}

export function SourceDot({ hex, size = 8 }: any) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: hex,
        boxShadow: `0 0 6px ${hex}88`,
      }}
    />
  )
}

export function Checkbox({ id, completed, onToggle, color, size = 14 }: any) {
  const [pop, setPop] = useState(false)

  const handle = (e: any) => {
    e?.stopPropagation()
    if (!completed) {
      setPop(true)
      setTimeout(() => setPop(false), 260)
    }
    onToggle?.(id)
  }

  const accent = color || 'var(--color-accent)'

  return (
    <button
      onClick={handle}
      className={pop ? 'check-pop' : ''}
      style={{
        width: size,
        height: size,
        border: `1px solid ${completed ? accent : 'var(--color-line)'}`,
        background: completed ? accent : 'transparent',
        cursor: 'pointer',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-paper)',
        fontSize: Math.round(size * 0.6),
        lineHeight: 1,
        transition: 'background 0.15s, border-color 0.15s',
        padding: 0,
        boxShadow: completed ? `0 0 8px ${accent}66` : 'none',
      }}
    >
      {completed ? '✓' : ''}
    </button>
  )
}

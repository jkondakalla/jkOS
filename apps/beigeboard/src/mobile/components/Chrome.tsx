import React, { useState, useEffect, useRef } from 'react'

/**
 * Chrome — mode-aware atmosphere with film grain, scanlines, halation vignette
 * intensity: 'off' | 'subtle' | 'full'
 */

interface Artifact {
  id: number
  x: number
  y: number
  h: number
  op: number
  dur: number
  bright: boolean
}

function FilmGrain({ opacity, blend }: any) {
  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 60,
        opacity,
        mixBlendMode: blend,
      }}
    >
      <filter id="bb-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch">
          <animate
            attributeName="seed"
            values="0;7;14"
            calcMode="discrete"
            dur="20s"
            repeatCount="indefinite"
          />
        </feTurbulence>
        <feColorMatrix
          type="matrix"
          values="2.2 0 0 0 -0.65  2.2 0 0 0 -0.65  2.2 0 0 0 -0.65  0 0 0 1 0"
        />
      </filter>
      <rect width="100%" height="100%" filter="url(#bb-grain)" />
    </svg>
  )
}

function ScanLines() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 61,
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0px, transparent 2.5px, rgba(0,0,0,0.05) 2.5px, rgba(0,0,0,0.05) 3.5px)',
        animation: 'bb-scanroll 10s linear infinite, bb-scanpulse 16s ease-in-out infinite',
      }}
    />
  )
}

function HalationVignette() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 59,
        background:
          'radial-gradient(120% 80% at 50% 28%, rgba(224,160,32,0.05) 0%, transparent 45%), radial-gradient(140% 120% at 50% 50%, transparent 58%, rgba(0,0,0,0.55) 100%)',
      }}
    />
  )
}

function Artifacts() {
  const [items, setItems] = useState<Artifact[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true

    const make = () => {
      const id = Math.random()
      const left = Math.random() < 0.5
      const a: Artifact = {
        id,
        x: left ? 2 + Math.random() * 8 : 90 + Math.random() * 7,
        y: 6 + Math.random() * 50,
        h: 8 + Math.random() * 26,
        op: 0.22 + Math.random() * 0.32,
        dur: 90 + Math.floor(Math.random() * 220),
        bright: Math.random() < 0.6,
      }
      setItems((p) => [...p, a])
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), a.dur + 80)
    }

    const loop = () => {
      timerRef.current = setTimeout(() => {
        if (!alive) return
        make()
        loop()
      }, 7000 + Math.random() * 12000)
    }

    loop()

    return () => {
      alive = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 62 }}>
      {items.map((a) => (
        <div
          key={a.id}
          style={{
            position: 'absolute',
            left: `${a.x}%`,
            top: `${a.y}%`,
            width: 1,
            height: `${a.h}%`,
            opacity: a.op,
            background: a.bright ? '#FFF5E0' : '#1A0F06',
            animation: `bb-flash ${a.dur}ms ease-in-out forwards`,
          }}
        />
      ))}
    </div>
  )
}

export interface ChromeProps {
  intensity: 'off' | 'subtle' | 'full'
}

export function Chrome({ intensity }: ChromeProps) {

  if (intensity === 'off') return null

  const full = intensity === 'full'

  return (
    <>
      <HalationVignette />
      <FilmGrain opacity={full ? 0.07 : (0.07 * 0.5)} blend="screen" />
      {full && <ScanLines />}
      {full && <Artifacts />}
    </>
  )
}

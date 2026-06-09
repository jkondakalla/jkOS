import { useState, useEffect, useRef } from 'react'

/* Props-driven CRT overlay effects — no theme context dependency.
   Defaults are intentionally conservative (design principle: effects are
   seasoning, not the meal). Apply at most grain + halation by default. */

/* ── Film Grain ─────────────────────────────────────────────────────────── */

interface FilmGrainProps {
  strength?: number   // 0–1, defaults to --grain-opacity CSS var or 0.05
}

export function FilmGrain({ strength }: FilmGrainProps) {
  const isDark = document.documentElement.getAttribute('data-mode') === 'dark'
  const fallback = isDark ? 0.06 : 0.03
  const opacity = (strength ?? fallback) * (isDark ? 1 : 0.5)
  const blendMode = isDark ? 'screen' : 'multiply'

  return (
    <svg
      style={{
        position: 'fixed', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 9995,
        opacity,
        mixBlendMode: blendMode as any,
      }}
      aria-hidden="true"
    >
      <filter id="sylib-fg">
        <feTurbulence type="fractalNoise" baseFrequency="0.76" numOctaves={4} stitchTiles="stitch">
          <animate attributeName="seed" values="0;5;11" calcMode="discrete" dur="22s" repeatCount="indefinite" />
        </feTurbulence>
        <feColorMatrix type="matrix" values="2.2 0 0 0 -0.65  2.2 0 0 0 -0.65  2.2 0 0 0 -0.65  0 0 0 1 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#sylib-fg)" />
    </svg>
  )
}

/* ── Halation (lens bloom — only meaningful in dark mode) ───────────────── */

export function Halation() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <defs>
        <filter id="sylib-halation" x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="1 0 0 0  0
                    0 0 0 0  0
                    0 0 0 0  0
                    2 -1 -1 0 -0.5"
            result="warmOnly" />
          <feGaussianBlur in="warmOnly" stdDeviation={4} result="bloom" />
          <feBlend in="SourceGraphic" in2="bloom" mode="screen" />
        </filter>
      </defs>
    </svg>
  )
}

/* ── Scan Lines ─────────────────────────────────────────────────────────── */

interface ScanLinesProps {
  strength?: number   // 0–1 multiplier on line opacity
}

export function ScanLines({ strength = 1 }: ScanLinesProps) {
  const isDark = document.documentElement.getAttribute('data-mode') === 'dark'
  const lineColor = isDark
    ? `rgba(255,255,255,${0.016 * strength})`
    : `rgba(0,0,0,${0.018 * strength})`
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0,
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, ${lineColor} 3px, ${lineColor} 4px)`,
        animation: 'scanRoll 12s linear infinite, scanPulse 17s ease-in-out infinite',
        pointerEvents: 'none',
        zIndex: 9993,
      }}
    />
  )
}

/* ── Artifacts (CRT corner glitches) ────────────────────────────────────── */

let _aid = 0
function makeArtifact() {
  const id = ++_aid
  const isScratch = Math.random() < 0.55
  const bright = Math.random() < 0.65
  if (isScratch) {
    const left = Math.random() < 0.5
    return {
      id, type: 'scratch',
      x:      left ? 1 + Math.random() * 11 : 88 + Math.random() * 10,
      y:      3 + Math.random() * 40,
      height: 10 + Math.random() * 32,
      tilt:   (Math.random() - 0.5) * 3.5,
      peakOp: 0.28 + Math.random() * 0.42,
      dur:    90 + Math.floor(Math.random() * 240),
      bright,
    }
  }
  const lx = Math.random() < 0.5, ty = Math.random() < 0.5
  return {
    id, type: 'blip',
    x:      lx ? 1 + Math.random() * 12 : 87 + Math.random() * 12,
    y:      ty ? 1 + Math.random() * 12 : 87 + Math.random() * 12,
    w:      2 + Math.floor(Math.random() * 5),
    h:      2 + Math.floor(Math.random() * 5),
    peakOp: 0.45 + Math.random() * 0.45,
    dur:    55 + Math.floor(Math.random() * 160),
    bright,
  }
}

export function Artifacts() {
  const [items, setItems] = useState<any[]>([])
  const timer = useRef<any>(null)

  useEffect(() => {
    const schedule = () => {
      timer.current = setTimeout(() => {
        const a = makeArtifact()
        setItems(p => [...p, a])
        setTimeout(() => setItems(p => p.filter(x => x.id !== a.id)), a.dur + 60)
        schedule()
      }, 9000 + Math.random() * 18000)
    }
    schedule()
    return () => clearTimeout(timer.current)
  }, [])

  if (!items.length) return null
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9997 }}>
      {items.map(a => {
        const color = a.bright ? 'var(--color-ink)' : 'var(--color-paper-2)'
        const shared = { position: 'absolute' as const, opacity: a.peakOp }
        const inner = { width: '100%', height: '100%', background: color, animation: `artifactFlash ${a.dur}ms ease-in-out forwards` }
        const outer: any = a.type === 'scratch'
          ? { ...shared, left: `${a.x}%`, top: `${a.y}%`, width: 1, height: `${a.height}%`, transform: `rotate(${a.tilt}deg)`, transformOrigin: 'top center' }
          : { ...shared, left: `${a.x}%`, top: `${a.y}%`, width: a.w, height: a.h }
        return <div key={a.id} style={outer}><div style={inner} /></div>
      })}
    </div>
  )
}

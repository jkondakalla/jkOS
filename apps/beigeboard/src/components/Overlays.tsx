import React, { useState, useEffect, useRef, useMemo } from 'react'
import { FONT_HEAD, FONT_BODY, isoDate, localDate } from '../lib/theme'

function getIntroIsDark(): boolean {
  // Stay in lock-step with the app shell: App.tsx sets <html data-mode> before
  // React hydrates, from the user's saved mode (localStorage 'jkos-mode'). Reading
  // that resolved attribute here guarantees the opening scroll matches whatever
  // mode the user is actually in. localStorage / prefers-color-scheme are only
  // belt-and-suspenders fallbacks for the (shouldn't-happen) missing-attr case.
  const m = document.documentElement.getAttribute('data-mode')
  if (m) return m === 'dark'
  try {
    const s = localStorage.getItem('jkos-mode')
    if (s) return s === 'dark'
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/* Film grain is now a suite-wide background default from the @jkos/design
   factory (buildJkOSTheme → `<scope> body` background-blend); the old on-top
   FilmGrain overlay was removed. */

/* ── Halation (lens bloom SVG filter) ───────────────────────────────────── */

export function Halation() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <defs>
        {/* Lens bloom. The alpha row gates the bloom to genuinely BRIGHT warm
            pixels (alpha = 1.8R − 0.9G − 0.9B − 0.62) so dim accent-tinted card
            surfaces no longer bloom — they were washing the whole dark UI red.
            The red channel is also dimmed to 0.55 and the blur tightened, so
            what survives is a soft halo on bright accent type, not a flood. The
            deliberate per-accent glow now comes from --accent-halo (@jkos/design). */}
        <filter id="halation" x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0.55 0    0    0  0
                    0    0    0    0  0
                    0    0    0    0  0
                    1.8 -0.9 -0.9  0 -0.62"
            result="warmOnly" />
          <feGaussianBlur in="warmOnly" stdDeviation={3.2} result="bloom" />
          <feBlend in="SourceGraphic" in2="bloom" mode="screen" />
        </filter>
      </defs>
    </svg>
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
        // Use CSS vars so artifacts adapt to light/dark theme
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

/* ── Scan Lines ─────────────────────────────────────────────────────────── */

interface ScanLinesProps {
  strength?: number   // 0–1 scale on opacity, defaults to 1
}

export function ScanLines({ strength = 1 }: ScanLinesProps) {
  const isDark = document.documentElement.getAttribute('data-mode') === 'dark'
  const lineColor = isDark
    ? `rgba(255,255,255,${0.018 * strength})`
    : `rgba(0,0,0,${0.022 * strength})`
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

/* ── Cinematic Intro (BeigeBoard-specific) ──────────────────────────────── */

function playStartupAudio() {
  let ctx: AudioContext
  try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)() }
  catch { return () => {} }
  const t = ctx.currentTime

  const thumpOsc = ctx.createOscillator()
  const thumpGain = ctx.createGain()
  thumpOsc.type = 'sine'
  thumpOsc.frequency.setValueAtTime(55, t)
  thumpOsc.frequency.exponentialRampToValueAtTime(18, t + 0.18)
  thumpGain.gain.setValueAtTime(0, t)
  thumpGain.gain.linearRampToValueAtTime(0.40, t + 0.018)
  thumpGain.gain.linearRampToValueAtTime(0, t + 0.22)
  thumpOsc.connect(thumpGain); thumpGain.connect(ctx.destination)
  thumpOsc.start(t); thumpOsc.stop(t + 0.25)

  const fanBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate)
  const fd = fanBuf.getChannelData(0)
  for (let i = 0; i < fd.length; i++) fd[i] = Math.random() * 2 - 1
  const fan = ctx.createBufferSource()
  fan.buffer = fanBuf; fan.loop = true
  const fanLp = ctx.createBiquadFilter()
  fanLp.type = 'lowpass'
  fanLp.frequency.setValueAtTime(60, t)
  fanLp.frequency.linearRampToValueAtTime(210, t + 2)
  const fanGain = ctx.createGain()
  fanGain.gain.setValueAtTime(0, t + 0.05)
  fanGain.gain.linearRampToValueAtTime(0.06, t + 1.5)
  fanGain.gain.linearRampToValueAtTime(0.02, t + 2.6)
  fan.connect(fanLp); fanLp.connect(fanGain); fanGain.connect(ctx.destination)
  fan.start(t)

  ;[0.28, 0.52, 0.78].forEach((dt, i) => {
    const ct = t + dt
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.055), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let j = 0; j < d.length; j++)
      d[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.012))
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 900 + i * 180; bp.Q.value = 0.6
    const g = ctx.createGain(); g.gain.value = 0.22 - i * 0.04
    src.connect(bp); bp.connect(g); g.connect(ctx.destination)
    src.start(ct)
  })

  return () => { try { ctx.close() } catch { /* ignore */ } }
}

export function CinematicIntro({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0)
  const audioCleanup = useRef<any>(null)
  const today = isoDate(new Date())
  const d = localDate(today)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const isDark = useMemo(() => getIntroIsDark(), [])

  useEffect(() => {
    audioCleanup.current = playStartupAudio()
    const t1 = setTimeout(() => setPhase(1), 120)
    const t2 = setTimeout(() => setPhase(2), 700)
    const t3 = setTimeout(() => setPhase(3), 2000)
    const t4 = setTimeout(onDone, 2500)
    return () => {
      [t1, t2, t3, t4].forEach(clearTimeout)
      audioCleanup.current?.()
    }
  }, [onDone])

  return (
    <div
      className={phase === 3 ? 'intro-out' : ''}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: isDark ? '#0A0703' : '#ede2c8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        pointerEvents: phase === 3 ? 'none' : 'all',
      }}
    >
      <div
        className={phase >= 1 ? (isDark ? 'crt-expand' : 'paper-expand') : ''}
        style={{
          position: 'absolute', inset: 0,
          background: isDark ? '#0D0B07' : '#f5ead4',
          clipPath: phase === 0 ? 'inset(50% 0 50% 0)' : undefined,
        }}
      />
      {phase >= 1 && isDark && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
        }} />
      )}
      {phase >= 1 && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
          background: isDark
            ? 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(190,130,20,0.07) 0%, transparent 70%)'
            : 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(165,115,35,0.04) 0%, transparent 70%)',
        }} />
      )}
      {phase >= 2 && (
        <div className="intro-title" style={{ position: 'relative', zIndex: 2, textAlign: 'center' }}>
          <div style={{
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontWeight: 600,
            fontSize: 60, color: 'var(--color-accent)',
            letterSpacing: '-0.02em', lineHeight: 1,
            textShadow: isDark
              ? '0 0 35px var(--color-accent-glow), 0 0 70px var(--color-secondary-glow)'
              : '0 1px 8px var(--color-accent-glow), 0 0 24px var(--color-accent-glow)',
          }}>
            BeigeBoard
          </div>
          <div style={{
            fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.30em',
            textTransform: 'uppercase', color: 'var(--color-muted)',
            marginTop: 13,
          }}>
            Calendar · {dateStr}
          </div>
        </div>
      )}
    </div>
  )
}

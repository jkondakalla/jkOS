/**
 * ProgressChart — PRESCRIBED vs PERFORMED for one step, over time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY TWO LINES AND NOT TWO COLOURS
 *
 * The two series are not two entities. They are the PLAN and the ACTUAL of the
 * same thing, so encoding them as two categorical hues would be a category error —
 * it would say "these are different subjects" when the entire point is that they
 * are the same subject measured twice.
 *
 * So the encoding is reference-vs-actual, not A-vs-B:
 *   · PRESCRIBED — a hairline dashed reference in muted ink. Recessive: it is the
 *     backdrop the real line is read against. (Dashing is legitimate here and
 *     nowhere else in this chart — it means "planned", which is exactly what a
 *     dash conventionally means. The grid and axis are solid hairlines.)
 *   · PERFORMED — 2px, in the routine's own accent, with markers. The subject.
 *
 * Consequences worth stating, because they are the reason this needed no palette
 * validation: only ONE hue is present, so there is no adjacent-pair separation to
 * check under colour-vision deficiency. The two marks are told apart by WEIGHT,
 * DASH and DIRECT LABEL — never by hue alone — which is the accessibility floor
 * that a two-hue version would have had to earn with a validator.
 *
 * ONE AXIS, ALWAYS. Both series are the same measure in the same unit; that is
 * what makes the comparison meaningful and a second y-scale impossible.
 *
 * WHAT THE GAP MEANS. When the lines separate, the programme is asking for
 * something you are not doing. That divergence is the single most useful signal a
 * training log carries and it is invisible in either line on its own — which is
 * the whole argument for drawing this at all rather than printing a number.
 *
 * Marks follow the house data rules: thin strokes, a hairline recessive baseline,
 * markers only where they SAY something (the endpoint, and any session logged
 * short), never a number on every point, and text in ink tokens rather than in the
 * series colour. Colours come from hub.css tokens, so paper and CRT are each drawn
 * deliberately rather than one being an automatic inversion of the other.
 */
import React, { useMemo, useRef, useState } from 'react'
import { FONT_HEAD, localDate } from '../lib/theme'
import type { SeriesPoint } from '../lib/routine-spec'

const MONO = 'var(--hub-font-mono)'

interface Props {
  points: SeriesPoint[]
  title: string
  unit?: string | null
  tint?: string
  height?: number
}

export function ProgressChart({ points, title, unit, tint = 'var(--color-accent)', height = 92 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const model = useMemo(() => {
    const pts = (points || []).filter((p) => p.prescribed !== null || p.performed !== null)
    if (pts.length < 2) return null
    const vals: number[] = []
    for (const p of pts) {
      if (p.prescribed !== null) vals.push(p.prescribed)
      if (p.performed !== null) vals.push(p.performed)
    }
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    // A flat series would collapse to a zero-height plot; give it a band so the
    // line sits in the middle rather than on the floor.
    if (hi === lo) { hi = lo + 1; lo = Math.max(0, lo - 1) }
    const pad = (hi - lo) * 0.12
    return { pts, lo: lo - pad, hi: hi + pad }
  }, [points])

  if (!model) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div className="mono-eyebrow">{title.toUpperCase()}</div>
        <div className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
          NOT ENOUGH SESSIONS YET
        </div>
      </div>
    )
  }

  const { pts, lo, hi } = model
  const W = 100, H = 100                      // viewBox units; the SVG scales to its box
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W)
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H

  const path = (get: (p: SeriesPoint) => number | null) => {
    let d = ''
    let open = false
    pts.forEach((p, i) => {
      const v = get(p)
      if (v === null) { open = false; return }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `
      open = true
    })
    return d.trim()
  }

  const lastPerformed = [...pts].reverse().find((p) => p.performed !== null)
  const lastPerformedIdx = lastPerformed ? pts.lastIndexOf(lastPerformed) : -1
  const lastPrescribed = [...pts].reverse().find((p) => p.prescribed !== null)
  const lastPrescribedIdx = lastPrescribed ? pts.lastIndexOf(lastPrescribed) : -1

  /* Markers only where they SAY something: where the line ends, and where a session
     was logged short. A dot on every point is noise — the line already carries the
     shape, and the tooltip carries the numbers. */
  const marked = pts
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i === lastPerformedIdx || (p.performed !== null && p.met === false))

  const fmt = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`)
  const dayOf = (iso: string | null) => (iso ? localDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

  const onMove = (e: React.PointerEvent) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    setHover(Math.round(frac * (pts.length - 1)))
  }

  const hovered = hover !== null ? pts[hover] : null

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Title + the legend. Present because there are two marks, so identity is
          never carried by appearance alone — and the swatches are the marks
          themselves (a dash and a rule) rather than two squares, so the legend
          teaches the encoding instead of just naming it. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 12 }}>{title}</span>
        <span className="mono-eyebrow" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 9, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="14" height="4" aria-hidden><line x1="0" y1="2" x2="14" y2="2" stroke="var(--color-faint)" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
            PLAN
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="14" height="4" aria-hidden><line x1="0" y1="2" x2="14" y2="2" stroke={tint} strokeWidth="2" /></svg>
            DONE
          </span>
          <button
            onClick={() => setTable((t) => !t)}
            className="jk-hit"
            title="Show the numbers"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--color-muted)' }}
          >
            {table ? '× TABLE' : 'TABLE'}
          </button>
        </span>
      </div>

      <div
        ref={wrapRef}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ position: 'relative', height, touchAction: 'pan-y' }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          width="100%" height="100%"
          style={{ display: 'block', overflow: 'visible' }}
          role="img"
          aria-label={`${title}: prescribed versus performed over ${pts.length} sessions`}
        >
          {/* A deload is a session the programme made lighter on purpose. Marked as
              a faint band so a dip in the line reads as planned rather than as a
              failure — without it the chart libels every deload week. */}
          {pts.map((p, i) => (p.deload ? (
            <rect
              key={`d${i}`}
              x={x(i) - (W / Math.max(1, pts.length - 1)) / 2} y={0}
              width={W / Math.max(1, pts.length - 1)} height={H}
              fill="var(--hub-bg-4)" opacity={0.5}
            />
          ) : null))}

          {/* One solid hairline baseline. No grid — at this size a grid is noise,
              and the axis labels below carry the scale. */}
          <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* PLAN — recessive reference. */}
          <path
            d={path((p) => p.prescribed)}
            fill="none" stroke="var(--color-faint)" strokeWidth="1.5"
            strokeDasharray="3 2" vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round"
          />
          {/* DONE — the subject. */}
          <path
            d={path((p) => p.performed)}
            fill="none" stroke={tint} strokeWidth="2"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
          />

          {/* Selective markers, each with a 2px surface ring so it stays legible
              where it overlaps the plan line. */}
          {marked.map(({ p, i }) => (
            <circle
              key={`m${i}`}
              cx={x(i)} cy={y(p.performed as number)} r="4"
              fill={p.met === false ? 'var(--hub-bg-2)' : tint}
              stroke={p.met === false ? tint : 'var(--hub-bg-2)'}
              strokeWidth="2" vectorEffect="non-scaling-stroke"
            />
          ))}

          {hovered && (
            <line
              x1={x(hover as number)} y1={0} x2={x(hover as number)} y2={H}
              stroke="var(--color-muted)" strokeWidth="1" opacity={0.5} vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Direct labels at the line ends — identity without a colour lookup, and
            the two numbers a reader actually wants. Text in INK tokens; the marks
            beside them carry the colour. */}
        {lastPerformedIdx >= 0 && (
          <span style={{
            position: 'absolute', right: 0, top: `${(y(lastPerformed!.performed as number) / H) * 100}%`,
            transform: 'translate(100%, -50%)', paddingLeft: 5,
            fontFamily: MONO, fontSize: 9.5, color: 'var(--color-ink)', whiteSpace: 'nowrap',
          }}>{fmt(lastPerformed!.performed)}</span>
        )}
        {lastPrescribedIdx >= 0 && lastPrescribed!.prescribed !== lastPerformed?.performed && (
          <span style={{
            position: 'absolute', right: 0, top: `${(y(lastPrescribed!.prescribed as number) / H) * 100}%`,
            transform: 'translate(100%, -50%)', paddingLeft: 5,
            fontFamily: MONO, fontSize: 9.5, color: 'var(--color-faint)', whiteSpace: 'nowrap',
          }}>{fmt(lastPrescribed!.prescribed)}</span>
        )}

        {hovered && (
          <div style={{
            position: 'absolute', left: `${(x(hover as number) / W) * 100}%`, top: -4,
            transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 2,
            background: 'var(--hub-bg-2)', border: '1px solid var(--color-line)',
            borderRadius: 'var(--hub-radius-xs)', padding: '4px 7px', whiteSpace: 'nowrap',
            fontFamily: MONO, fontSize: 10, color: 'var(--color-ink)',
            boxShadow: '0 2px 8px rgb(0 0 0 / 0.18)',
          }}>
            <div style={{ color: 'var(--color-muted)' }}>
              {dayOf(hovered.date)} · session {hovered.cycle + 1}{hovered.deload ? ' · deload' : ''}
            </div>
            <div>plan {fmt(hovered.prescribed)}</div>
            <div>done {hovered.performed === null ? (hovered.completed ? '—' : 'not yet') : fmt(hovered.performed)}</div>
          </div>
        )}
      </div>

      {/* The x band lives INSIDE the component's own flow, so the container always
          has room for it rather than clipping it into a nested scrollbar. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span className="mono-eyebrow">{dayOf(pts[0].date)}</span>
        <span className="mono-eyebrow" style={{ color: 'var(--color-faint)' }}>
          {Math.round(lo)}–{Math.round(hi)}{unit ? ` ${unit}` : ''}
        </span>
        <span className="mono-eyebrow">{dayOf(pts[pts.length - 1].date)}</span>
      </div>

      {/* The table view. Present because a chart is not the only way anyone should
          be able to get at these numbers — a screen reader, a print, or a person
          who just wants the figures. */}
      {table && (
        <div className="jk-scroll" style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 10 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-muted)' }}>
                <th style={{ fontWeight: 400, padding: '2px 4px' }}>date</th>
                <th style={{ fontWeight: 400, padding: '2px 4px' }}>plan</th>
                <th style={{ fontWeight: 400, padding: '2px 4px' }}>done</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--color-line)' }}>
                  <td style={{ padding: '2px 4px', color: 'var(--color-muted)' }}>{dayOf(p.date)}{p.deload ? ' ·d' : ''}</td>
                  <td style={{ padding: '2px 4px' }}>{fmt(p.prescribed)}</td>
                  <td style={{ padding: '2px 4px', color: p.met === false ? 'var(--color-muted)' : 'var(--color-ink)' }}>
                    {p.performed === null ? (p.completed ? '—' : '·') : fmt(p.performed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

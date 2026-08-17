/**
 * parts.tsx — the field chrome and the one control the workshop's three document
 * surfaces share.
 *
 * The forge (a routine's document), the library (the vocabulary its steps are built
 * from) and the paste pane (a whole bundle at once) are all dense editors over the
 * same spec, and all three needed the same two things: inputs that agree on their
 * height, and a progression rule editor.
 *
 * They live here rather than in the forge because the forge is not the owner of
 * either — it was just the first to need them. Importing them out of RoutineForge
 * would also have made the library browser and the forge import each other, since
 * the forge opens the browser.
 *
 * A form whose inputs drift in height is the fastest way to make a dense editor
 * unreadable, so the chrome is declared once and spent everywhere.
 */
import React from 'react'
import { TButton } from '@jkos/ui'
import { FONT_HEAD } from '../../lib/theme'
import { PROGRESSIONS, DRIVES, PROGRESSION_LABEL } from '../../lib/routine-spec'

export const MONO = 'var(--hub-font-mono)'

export const field: React.CSSProperties = {
  fontFamily: MONO, fontSize: 11, color: 'var(--color-ink)',
  background: 'transparent', border: '1px solid var(--color-line)',
  borderRadius: 3, padding: '3px 5px', outline: 'none', minWidth: 0,
}
export const numField: React.CSSProperties = { ...field, width: 58, textAlign: 'right' }
export const textField: React.CSSProperties = {
  ...field, fontFamily: FONT_HEAD, fontSize: 13, fontWeight: 600,
}

/** One progression rule. Only the fields THIS type needs are drawn — a form that
 *  shows every field of every progression at once is the form nobody fills in
 *  correctly. */
export function RuleRow({ rule: p, variants = [], vars = [], readonly, onSet, onRemove }: any) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
      <span className="mono-eyebrow">HARDER BY</span>
      <select value={p.type} disabled={readonly} onChange={(e) => onSet('type', e.target.value)} style={field}>
        {PROGRESSIONS.filter((t) => t !== 'fixed').map((t) => (
          <option key={t} value={t}>{t} — {PROGRESSION_LABEL[t]}</option>
        ))}
      </select>

      {(p.type === 'linear' || p.type === 'ladder') && (
        <>
          <span className="mono-eyebrow">MOVING</span>
          <select value={p.drives} disabled={readonly} onChange={(e) => onSet('drives', e.target.value)} style={field}>
            {DRIVES.map((d) => (
              <option key={d} value={d} disabled={d === 'variant' && variants.length < 2}>{d}</option>
            ))}
          </select>
        </>
      )}

      {p.type === 'linear' && (
        <>
          <span className="mono-eyebrow">BY</span>
          <input type="number" step={0.5} value={p.increment ?? 0} disabled={readonly}
            onChange={(e) => onSet('increment', Number(e.target.value) || 0)} style={numField} />
          <span className="mono-eyebrow">EVERY</span>
          <input type="number" min={1} value={p.every ?? 1} disabled={readonly}
            onChange={(e) => onSet('every', Math.max(1, Number(e.target.value) || 1))} style={numField} />
          <span className="mono-eyebrow">SESSIONS</span>
        </>
      )}

      {(p.type === 'double' || p.type === 'autoregulated') && (
        <>
          <span className="mono-eyebrow">REPS</span>
          <input type="number" value={p.range?.[0] ?? 5} disabled={readonly}
            onChange={(e) => onSet('range', [Number(e.target.value) || 0, p.range?.[1] ?? 8])} style={numField} />
          <span className="mono-eyebrow">→</span>
          <input type="number" value={p.range?.[1] ?? 8} disabled={readonly}
            onChange={(e) => onSet('range', [p.range?.[0] ?? 5, Number(e.target.value) || 0])} style={numField} />
          <span className="mono-eyebrow">THEN +</span>
          <input type="number" step={0.5} value={p.increment ?? 5} disabled={readonly}
            onChange={(e) => onSet('increment', Number(e.target.value) || 0)} style={numField} />
          <span className="mono-eyebrow">LOAD</span>
        </>
      )}

      {p.type === 'ladder' && (
        <>
          <span className="mono-eyebrow">TABLE</span>
          <input
            value={(p.values || []).join(', ')} disabled={readonly} placeholder="3, 5, 8, 13"
            onChange={(e) => onSet('values', e.target.value.split(',').map((v: string) => Number(v.trim())).filter((n: number) => Number.isFinite(n)))}
            style={{ ...field, width: 140 }}
          />
        </>
      )}

      {p.type === 'percent' && (
        <>
          <span className="mono-eyebrow">OF</span>
          {/* A library entry has no `vars` of its own — a percent default only means
              something once a routine supplies the named number, so the field is a
              free text key there and a picker inside the forge. */}
          {vars.length > 0 ? (
            <select value={p.of ?? ''} disabled={readonly} onChange={(e) => onSet('of', e.target.value)} style={field}>
              <option value="">—</option>
              {vars.map((v: string) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : (
            <input value={p.of ?? ''} disabled={readonly} placeholder="squat_max"
              onChange={(e) => onSet('of', e.target.value)} style={{ ...field, width: 100 }} />
          )}
          <span className="mono-eyebrow">FROM</span>
          <input type="number" step={0.05} value={p.start ?? 0.6} disabled={readonly}
            onChange={(e) => onSet('start', Number(e.target.value) || 0)} style={numField} />
          <span className="mono-eyebrow">+</span>
          <input type="number" step={0.005} value={p.increment ?? 0.025} disabled={readonly}
            onChange={(e) => onSet('increment', Number(e.target.value) || 0)} style={numField} />
        </>
      )}

      <span className="mono-eyebrow">CAP</span>
      <input type="number" value={p.cap ?? ''} disabled={readonly} placeholder="none"
        onChange={(e) => onSet('cap', e.target.value === '' ? null : Number(e.target.value))} style={numField}
        title="An uncapped count climbs forever — +5s a session is a five-minute plank by next spring" />

      {!readonly && onRemove && (
        <TButton quiet onClick={onRemove} style={{ padding: '1px 6px', cursor: 'pointer' }}>×</TButton>
      )}
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { FONT_HEAD, FONT_BODY, addDays, fmtWeekday, localDate, weekStart } from '../../lib/theme'
import { TButton } from '@jkos/ui'

/*
 * Shared workshop primitives (Documentation/PLANNING_METHOD.md). The bits every
 * screen of the drill-down reuses: the checkpoint state glyph, the inline adders,
 * the editable "done means", and the CommitControl — the one control that moves a
 * task between unscheduled → this week's bench → a day.
 */

export function tinyLink(): React.CSSProperties {
  return {
    background: 'transparent', border: 'none',
    fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12,
    color: 'var(--color-faint)', cursor: 'pointer', padding: 0,
    textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3,
  }
}

/* ── The checkpoint's state, at a glance ───────────────────────────────── */
export function StateGlyph({ state, accent }: { state: 'done' | 'current' | 'later'; accent: string }) {
  if (state === 'done') {
    return (
      <span style={{
        width: 14, height: 14, flexShrink: 0, background: accent,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-paper)', fontSize: 9, lineHeight: 1,
        boxShadow: `0 0 8px ${accent}66`,
      }}>✓</span>
    )
  }
  if (state === 'current') {
    return (
      <span className="now-dot" style={{
        width: 9, height: 9, margin: '0 2.5px', borderRadius: '50%', flexShrink: 0,
        background: accent, boxShadow: `0 0 8px ${accent}aa, 0 0 14px ${accent}55`,
      }} />
    )
  }
  return <span style={{ width: 14, height: 14, flexShrink: 0, border: '1px solid var(--color-line)', opacity: 0.8 }} />
}

export function DayChip({ label, onClick }: any) {
  return (
    <TButton onClick={onClick} style={{ fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 7px' }}>
      {label}
    </TButton>
  )
}

const dateInput: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--color-line)',
  fontFamily: FONT_BODY, fontSize: 10, color: 'var(--color-ink)',
  padding: '2px 4px', outline: 'none',
}

/** A raw date input that yields the picked ISO day to `onPick` (caller normalises). */
export function DatePick({ item, onPick, onClose }: any) {
  return (
    <input
      type="date" autoFocus defaultValue={item.due_date || ''}
      onClick={e => e.stopPropagation()}
      onChange={e => { if (e.target.value) { onPick(e.target.value); onClose() } }}
      onBlur={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      style={dateInput}
    />
  )
}

const rowSty: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }
const xBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-faint)',
  fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0,
}
const benchPill: React.CSSProperties = {
  fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--color-muted)', border: '1px dashed var(--color-line)', borderRadius: 'var(--hub-radius-lg)',
  padding: '2px 8px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
}

/**
 * The Commit step, as one control across all three states of a task:
 *   unscheduled → chips  wk · today · tmrw · pick
 *   benched     → "this week" pill → expand to promote (→day) or unbench
 *   day-set     → date chip → repick, or "← week" to demote back to the bench
 * Promotion normalises week_start to the day's Monday; demotion clears the time.
 */
export function CommitControl({ item, today, weekIso, accent, onUpdateItem, readonly }: any) {
  const [open, setOpen]       = useState(false)
  const [picking, setPicking] = useState(false)
  const reset = () => { setOpen(false); setPicking(false) }

  const toDay   = (d: string) => { onUpdateItem(item.id, { due_date: d, week_start: weekStart(d) }); reset() }
  const toWeek  = () => { onUpdateItem(item.id, { week_start: weekIso, due_date: null, scheduled_time: null, scheduled_end: null }); reset() }
  const unbench = () => { onUpdateItem(item.id, { week_start: null }); reset() }

  // Day-scheduled
  if (item.due_date) {
    const overdue = item.due_date < today
    if (picking && !readonly) {
      return (
        <span onClick={e => e.stopPropagation()} style={rowSty}>
          <DatePick item={item} onPick={toDay} onClose={reset} />
          <DayChip label="← week" onClick={toWeek} />
        </span>
      )
    }
    return (
      <span
        onClick={e => { if (!readonly) { e.stopPropagation(); setPicking(true) } }}
        title={readonly ? undefined : 'Reschedule'}
        className={overdue ? 'jk-glow-text jk-glow-low' : undefined}
        style={{
          fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.08em', flexShrink: 0,
          whiteSpace: 'nowrap', cursor: readonly ? 'default' : 'pointer',
          color: overdue ? accent : 'var(--color-muted)', '--jk-glow-color': accent,
        } as React.CSSProperties}
      >
        {item.due_date === today ? 'today' : `${fmtWeekday(item.due_date)} ${localDate(item.due_date).getDate()}`}
      </span>
    )
  }

  // Benched to a week, no day yet
  if (item.week_start) {
    if (readonly) return <span style={{ ...benchPill, cursor: 'default' }}>this week</span>
    if (open) {
      if (picking) {
        return <span onClick={e => e.stopPropagation()} style={rowSty}><DatePick item={item} onPick={toDay} onClose={reset} /></span>
      }
      return (
        <span onClick={e => e.stopPropagation()} style={rowSty}>
          <DayChip label="→ today" onClick={() => toDay(today)} />
          <DayChip label="→ tmrw"  onClick={() => toDay(addDays(today, 1))} />
          <DayChip label="pick"    onClick={() => setPicking(true)} />
          <button onClick={unbench} title="Off the bench" style={xBtn}>✕</button>
        </span>
      )
    }
    return (
      <span onClick={e => { e.stopPropagation(); setOpen(true) }} title="On the bench — commit to a day" style={benchPill}>
        this week
      </span>
    )
  }

  // Unscheduled — invite a commit outright
  if (readonly) return null
  if (picking) {
    return <span onClick={e => e.stopPropagation()} style={rowSty}><DatePick item={item} onPick={toDay} onClose={reset} /></span>
  }
  return (
    <span onClick={e => e.stopPropagation()} style={rowSty}>
      <DayChip label="wk"    onClick={toWeek} />
      <DayChip label="today" onClick={() => toDay(today)} />
      <DayChip label="tmrw"  onClick={() => toDay(addDays(today, 1))} />
      <DayChip label="pick"  onClick={() => setPicking(true)} />
    </span>
  )
}

/* ── Inline adder — checkpoints (no chips) or actions (day/week chips) ──── */
export type CommitHint = { due?: string | null; bench?: boolean }

export function AddInline({ label, placeholder, onSubmit, dayChips, weekChip, today }: any) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (commit?: CommitHint) => {
    if (!draft.trim()) { setAdding(false); return }
    onSubmit(draft.trim(), commit || {})
    setDraft('')
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} style={{ ...tinyLink(), padding: '8px 4px', display: 'block' }}>
        {label}
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', flexWrap: 'wrap' }}>
      <input
        ref={inputRef} autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setAdding(false); setDraft('') }
        }}
        onBlur={() => { if (!draft.trim()) setAdding(false) }}
        placeholder={placeholder}
        style={{
          flex: '1 1 200px', background: 'transparent', border: 'none',
          borderBottom: '1px solid var(--color-line)',
          fontFamily: FONT_BODY, fontSize: 13,
          color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
        }}
      />
      {draft.trim() && weekChip && <DayChip label="→ this wk" onClick={() => submit({ bench: true })} />}
      {draft.trim() && dayChips && (
        <>
          <DayChip label="→ today" onClick={() => submit({ due: today })} />
          <DayChip label="→ tmrw"  onClick={() => submit({ due: addDays(today, 1) })} />
        </>
      )}
    </div>
  )
}

/* ── "Done means …" — the finish line, editable in place on any node ───── */
export function DoneMeans({ node, onUpdateItem, readonly, placeholder }: any) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(node.done_means || '')
  useEffect(() => { setDraft(node.done_means || ''); setEditing(false) }, [node.id, node.done_means])

  const commit = () => {
    const v = draft.trim()
    if (v !== (node.done_means || '')) onUpdateItem(node.id, { done_means: v || null })
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(node.done_means || ''); setEditing(false) }
        }}
        placeholder={placeholder || "A verifiable outcome — how will you know it's done?"}
        style={{
          display: 'block', width: '100%', marginTop: 8,
          background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
          color: 'var(--color-ink)', outline: 'none', padding: '2px 0',
        }}
      />
    )
  }

  if (node.done_means) {
    return (
      <p
        onClick={() => !readonly && setEditing(true)}
        title={readonly ? undefined : 'Click to edit'}
        style={{
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13,
          color: 'var(--color-muted)', margin: '8px 0 0', lineHeight: 1.45, maxWidth: 600,
          cursor: readonly ? 'default' : 'text',
        }}
      >
        Done means: “{node.done_means}”
      </p>
    )
  }

  if (readonly) return null
  return (
    <button onClick={() => setEditing(true)} style={{ ...tinyLink(), marginTop: 8, display: 'block' }}>
      + define what done means
    </button>
  )
}

import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, TASK_COLORS, localDate, weekStart } from '../../lib/theme'
import { Eyebrow, Plate } from '../../components/SharedComponents'
import { DayChip } from './bits'

/*
 * Forge a new goal — Define → Ladder → Commit, in one card. The planning is manual
 * by design (Documentation/PLANNING_METHOD.md → the mission): no "draft it" seam here.
 * The first step can land on a specific day OR go straight to this week's bench.
 */
export function GoalForge({ startOpen, today, goalCount, onAddItem }: any) {
  const [open, setOpen]       = useState(!!startOpen)
  const [title, setTitle]     = useState('')
  const [done, setDone]       = useState('')
  const [target, setTarget]   = useState('')
  const [ladder, setLadder]   = useState<string[]>([])
  const [msDraft, setMsDraft] = useState('')
  const [firstAction, setFirstAction] = useState('')
  const [firstWhen, setFirstWhen]     = useState<'day' | 'week'>('day')
  const [firstDay, setFirstDay]       = useState(today)
  const [saving, setSaving]   = useState(false)

  const accent = TASK_COLORS[goalCount % TASK_COLORS.length].hex
  const weekIso = weekStart(today)
  const canStamp = title.trim().length > 0

  const addMs = () => {
    const v = msDraft.trim()
    if (!v) return
    setLadder(l => [...l, v])
    setMsDraft('')
  }

  const stamp = async () => {
    if (!canStamp || saving) return
    setSaving(true)
    try {
      const goal = await onAddItem({
        kind: 'goal', scope: 'year', status: 'active', source: 'bb',
        title: title.trim(), accent,
        done_means: done.trim() || null,
        target_date: target || null,
        year: localDate(today).getFullYear(),
      })
      if (!goal?.id) return   // create failed — keep the form so the user can retry
      let firstMs: any = null
      for (let i = 0; i < ladder.length; i++) {
        const m = await onAddItem({ kind: 'milestone', parent_id: goal.id, title: ladder[i], position: i, source: 'bb' })
        if (i === 0) firstMs = m
      }
      if (firstAction.trim()) {
        const onWeek = firstWhen === 'week'
        await onAddItem({
          kind: 'task', scope: 'day', parent_id: (firstMs || goal).id,
          title: firstAction.trim(), source: 'bb',
          due_date:   onWeek ? null : (firstDay || today),
          week_start: onWeek ? weekIso : weekStart(firstDay || today),
        })
      }
      setTitle(''); setDone(''); setTarget(''); setLadder([]); setMsDraft('')
      setFirstAction(''); setFirstWhen('day'); setFirstDay(today); setOpen(false)
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: '1px dashed var(--color-line)',
          borderRadius: 'var(--hub-radius-lg)', padding: '16px 22px',
          fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
          color: 'var(--color-muted)', cursor: 'pointer', width: '100%', textAlign: 'left',
        }}
      >+ Forge a new goal</button>
    )
  }

  return (
    <Plate accent={accent} style={{ padding: '22px 26px 22px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Eyebrow color={accent}>01 · Define the destination</Eyebrow>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 }}
        >✕</button>
      </div>
      <input
        autoFocus value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What are you reaching for?"
        style={{
          display: 'block', width: '100%', marginTop: 10,
          background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)',
          fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 24, letterSpacing: '-0.02em',
          color: 'var(--color-ink)', outline: 'none', padding: '2px 0 8px',
        }}
      />
      <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <input
          value={done}
          onChange={e => setDone(e.target.value)}
          placeholder="Done means… (a verifiable outcome, not an activity)"
          style={{
            flex: '1 1 320px', background: 'transparent', border: 'none',
            borderBottom: '1px solid var(--color-line)',
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13.5,
            color: 'var(--color-ink)', outline: 'none', padding: '2px 0 5px',
          }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>by</span>
          <input
            type="date" value={target}
            onChange={e => setTarget(e.target.value)}
            style={{
              background: 'transparent', border: '1px solid var(--color-line)',
              fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-ink)',
              padding: '3px 6px', outline: 'none',
            }}
          />
        </label>
      </div>

      {title.trim() && (
        <div style={{ marginTop: 22 }}>
          <Eyebrow color={accent}>02 · Ladder it down</Eyebrow>
          {ladder.length > 0 && (
            <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ladder.map((p, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: accent, width: 20, textAlign: 'right' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ flex: 1, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-ink)' }}>{p}</span>
                  <button
                    onClick={() => setLadder(ps => ps.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 11, cursor: 'pointer', padding: '0 2px' }}
                  >✕</button>
                </li>
              ))}
            </ol>
          )}
          <input
            value={msDraft}
            onChange={e => setMsDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMs() }}
            placeholder={ladder.length ? 'Another checkpoint… (Enter to add)' : 'The first checkpoint you’d pass… (Enter to add)'}
            style={{
              display: 'block', width: '100%', marginTop: 8,
              background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)',
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14,
              color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
            }}
          />
        </div>
      )}

      {ladder.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <Eyebrow color={accent}>03 · Commit the first step</Eyebrow>
          <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={firstAction}
              onChange={e => setFirstAction(e.target.value)}
              placeholder="The very first concrete action…"
              style={{
                flex: '1 1 260px', background: 'transparent', border: 'none',
                borderBottom: '1px solid var(--color-line)',
                fontFamily: FONT_BODY, fontSize: 13.5,
                color: 'var(--color-ink)', outline: 'none', padding: '3px 0',
              }}
            />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <DayChip label={firstWhen === 'week' ? '● this week' : 'this week'} onClick={() => setFirstWhen('week')} />
              <DayChip label={firstWhen === 'day' ? '● on a day' : 'on a day'} onClick={() => setFirstWhen('day')} />
              {firstWhen === 'day' && (
                <input
                  type="date" value={firstDay}
                  onChange={e => setFirstDay(e.target.value)}
                  style={{
                    background: 'transparent', border: '1px solid var(--color-line)',
                    fontFamily: FONT_BODY, fontSize: 11, color: 'var(--color-ink)',
                    padding: '3px 6px', outline: 'none',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={stamp} disabled={!canStamp || saving}
          className={canStamp ? 'btn-action jk-glow jk-glow-mid' : 'btn-action'}
          style={{
            background: canStamp ? accent : 'var(--color-paper-2)',
            color: canStamp ? 'var(--color-paper)' : 'var(--color-faint)',
            border: canStamp ? 'none' : '1px solid var(--color-line)',
            borderRadius: 'var(--hub-radius-button)',
            fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase',
            padding: '10px 20px', cursor: canStamp ? 'pointer' : 'default',
            '--jk-glow-color': accent, opacity: saving ? 0.6 : 1,
          } as React.CSSProperties}
        >{saving ? 'Stamping…' : 'Stamp the goal →'}</button>
      </div>
    </Plate>
  )
}

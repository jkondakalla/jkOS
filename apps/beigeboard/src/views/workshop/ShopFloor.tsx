import React from 'react'
import { FONT_HEAD, localDate } from '../../lib/theme'
import { topGoals, nodeProgress, currentStep, paceOf, isAdrift, thisWeekOf, fmtTarget } from '../../lib/plan'
import { Eyebrow } from '../../components/SharedComponents'
import { Press, Lab, Pill } from '@jkos/ui'
import { GoalForge } from './GoalForge'

/*
 * The shop floor — the root of the drill-down. Every active goal is a compact card
 * you click to zoom in; parked/done goals rest on the shelf; a fresh goal is forged
 * at the bottom. The weekly bench rides alongside (rendered by the container).
 */
export function ShopFloor({ items, today, weekIso, drill, onSelect, onAddItem, onUpdateItem, readonly }: any) {
  const goals   = topGoals(items)
  const active  = goals.filter((g: any) => (g.status || 'active') === 'active')
  const shelved = goals.filter((g: any) => (g.status || 'active') !== 'active')
  const year    = localDate(today).getFullYear()

  return (
    <div>
      {/* Chapter head: printed eyebrow + a machine annotation on the right, the
          title, then the ink rule from the rules ladder closes the head. */}
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Eyebrow>The workshop · {year}</Eyebrow>
          <span className="mono-eyebrow" style={{ marginLeft: 'auto' }}>
            {active.length} on the floor{shelved.length > 0 ? ` · ${shelved.length} shelved` : ''}
          </span>
        </div>
        <h1 style={{
          fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 40,
          margin: '8px 0 8px', letterSpacing: '-0.025em', lineHeight: 1.04, color: 'var(--color-ink)',
        }}>
          Break it <Press large as="em" style={{ fontStyle: 'italic' }}>down</Press>.
        </h1>
        <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-muted)', margin: 0, lineHeight: 1.4 }}>
          Name the destination · ladder it to checkpoints · put the next step on the week, then a day.
        </p>
        <hr className="jk-rule-strong" style={{ margin: '16px 0 0' }} />
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {active.map((g: any, i: number) => (
          <GoalCard key={g.id} goal={g} items={items} index={i + 1} today={today} weekIso={weekIso}
                    drill={drill} onSelect={onSelect} />
        ))}

        {!readonly && (
          <GoalForge startOpen={active.length === 0} today={today} goalCount={goals.length} onAddItem={onAddItem} />
        )}

        {shelved.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{
              fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 10.5, letterSpacing: '0.18em',
              textTransform: 'uppercase', color: 'var(--color-muted)', cursor: 'pointer', padding: '4px 0',
            }}>
              {shelved.length} on the shelf
            </summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shelved.map((g: any) => (
                <div key={g.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', border: '1px solid var(--color-line)',
                  borderRadius: 'var(--hub-radius-lg)', background: 'var(--color-paper-2)', opacity: 0.75,
                }}>
                  <span style={{
                    fontFamily: 'var(--hub-font-mono)', fontSize: 8.5, letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: 'var(--color-muted)', border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-sm)', padding: '2px 7px', flexShrink: 0,
                  }}>{g.status === 'done' ? 'Done' : 'Parked'}</span>
                  <span
                    onClick={() => onSelect(g)}
                    style={{
                      flex: 1, minWidth: 0, fontFamily: FONT_HEAD, fontSize: 16, color: 'var(--color-ink)',
                      textDecoration: g.status === 'done' ? 'line-through' : 'none', cursor: 'pointer',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >{g.title}</span>
                  {!readonly && (
                    <button onClick={() => onUpdateItem(g.id, { status: 'active' })} style={{
                      background: 'transparent', border: 'none', fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12,
                      color: 'var(--color-faint)', cursor: 'pointer', padding: 0,
                      textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3,
                    }}>bring it back →</button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

/* A compact goal card — the whole card drills in; the title opens details. */
function GoalCard({ goal, items, index, today, weekIso, drill, onSelect }: any) {
  const accent = goal.accent || 'var(--color-accent)'
  const prog   = nodeProgress(goal, items)
  const pace   = paceOf(goal, items, today)
  const adrift = isAdrift(goal, items, weekIso)
  const cur    = currentStep(goal, items)
  const quiet  = !adrift && thisWeekOf(goal, items, weekIso).length === 0

  return (
    <article
      className="bb-goal-well"
      onClick={() => drill(goal.id)}
      title="Open in the workshop"
      style={{ padding: '20px 24px', cursor: 'pointer', '--goal-accent': accent } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <Lab size="sm" as="span" className="jk-glow-text jk-glow-low" style={{ color: accent, '--jk-glow-color': accent } as React.CSSProperties}>
          {`Goal ${String(index).padStart(2, '0')}`}
        </Lab>
        {goal.target_date && <Lab size="sm" as="span">by {fmtTarget(goal.target_date)}</Lab>}
        {pace && (pace === 'behind'
          ? <span style={{
              fontFamily: 'var(--hub-font-mono)', fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--hub-radius-lg)',
              padding: '2px 7px', textShadow: 'var(--accent-halo-text)',
            }}>{pace}</span>
          : <Pill><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-ok)', flexShrink: 0 }} />{pace}</Pill>
        )}
        {adrift && (
          <span className="jk-glow jk-glow-low" style={{
            fontFamily: 'var(--hub-font-mono)', fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--color-paper)', background: accent, padding: '3px 8px', '--jk-glow-color': accent,
          } as React.CSSProperties}>nothing in reach</span>
        )}
        {quiet && (
          <span style={{
            fontFamily: 'var(--hub-font-mono)', fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--color-muted)', border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-lg)', padding: '2px 8px',
          }}>quiet this week</span>
        )}
      </div>

      <h2
        onClick={e => { e.stopPropagation(); onSelect(goal) }}
        title="Open details"
        style={{
          fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 24, cursor: 'pointer',
          margin: 0, letterSpacing: '-0.02em', lineHeight: 1.12, color: 'var(--color-ink)',
        }}
      >
        {goal.title}
        <span className="jk-glow-text jk-glow-hi" style={{ color: accent, '--jk-glow-color': accent } as React.CSSProperties}>.</span>
      </h2>

      {goal.done_means && (
        <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12.5, color: 'var(--color-muted)', margin: '6px 0 0', lineHeight: 1.4, maxWidth: 560 }}>
          Done means: “{goal.done_means}”
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
        <div className="bb-prog-track">
          <div className="progress-fill" style={{ width: `${prog.pct}%`, height: '100%', background: accent, boxShadow: `0 0 8px ${accent}66` }} />
        </div>
        <Lab size="sm" as="span">{prog.total > 0 ? `${prog.done}/${prog.total}` : '—'}</Lab>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
        <span style={{
          flex: 1, minWidth: 0, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {cur ? <>up next · {cur.title}</> : prog.total > 0 ? 'all checkpoints cleared' : 'not laddered down yet'}
        </span>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent, flexShrink: 0 }}>
          open →
        </span>
      </div>
    </article>
  )
}

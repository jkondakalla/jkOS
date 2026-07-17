import React, { useState } from 'react'
import { FONT_HEAD, FONT_BODY, localDate } from '../../lib/theme'
import { getAncestors } from '../../lib/seed'
import { activeGoals, thisWeekOf, nextUnscheduled, currentLeaf, carriedBench } from '../../lib/plan'
import { Checkbox, Eyebrow } from '../../components/SharedComponents'
import { CommitControl, DatePick, DayChip, tinyLink } from './bits'

/*
 * This week's bench — the ritual that ties the breakdown to real time. Every active
 * goal contributes 1–3 next actions to the week, or is consciously parked. Benched =
 * a task with week_start set to this Monday and no day yet. (PLANNING_METHOD.md → bench.)
 */
export function Bench({ items, today, weekIso, drill, setView, onToggle, onUpdateItem, onDelete, onSelect, readonly }: any) {
  const goals   = activeGoals(items)
  const carried = carriedBench(items, weekIso)
  const weekLabel = localDate(weekIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <aside style={{
      border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-lg)',
      background: 'var(--color-paper-2)', padding: '16px 16px 18px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Eyebrow>The bench</Eyebrow>
          <button onClick={() => setView?.('week')} style={{ ...tinyLink(), fontSize: 11 }}>open the week →</button>
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
          week of {weekLabel}
        </div>
      </div>

      {goals.length === 0 && (
        <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.4 }}>
          No active goals yet. Forge one, then bench its first step here.
        </p>
      )}

      {goals.map((g: any) => (
        <GoalBenchBlock
          key={g.id} goal={g} items={items} today={today} weekIso={weekIso}
          drill={drill} onToggle={onToggle} onUpdateItem={onUpdateItem} onSelect={onSelect} readonly={readonly}
        />
      ))}

      {carried.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-line-strong)', paddingTop: 12 }}>
          <Eyebrow>Carried over · {carried.length}</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {carried.map((t: any) => (
              <CarriedRow key={t.id} item={t} items={items} today={today} weekIso={weekIso}
                          onUpdateItem={onUpdateItem} onDelete={onDelete} readonly={readonly} />
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

function GoalBenchBlock({ goal, items, today, weekIso, drill, onToggle, onUpdateItem, onSelect, readonly }: any) {
  const accent  = goal.accent || 'var(--color-accent)'
  const contrib = thisWeekOf(goal, items, weekIso)

  const benchNext = () => {
    const nxt = nextUnscheduled(goal, items)
    if (nxt) onUpdateItem(nxt.id, { week_start: weekIso })
    else drill(currentLeaf(goal, items).id)   // nothing to bench — go break it down
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 4, height: 14, background: accent, flexShrink: 0, boxShadow: `0 0 8px ${accent}55` }} />
        <button
          onClick={() => drill(goal.id)}
          title="Open in the workshop"
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0,
          }}
        >{goal.title}</button>
      </div>

      {contrib.length > 0 ? (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
            {contrib.map((t: any) => (
              <li key={t.id} className="task-row" onClick={() => onSelect(t)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', cursor: 'pointer',
                '--hover-bg': 'var(--color-paper)',
              } as any}>
                <Checkbox id={t.id} completed={t.completed} onToggle={onToggle} size={12} color={accent} />
                <span style={{
                  flex: 1, minWidth: 0, fontFamily: FONT_BODY, fontSize: 12.5,
                  color: t.completed ? 'var(--color-muted)' : 'var(--color-ink)',
                  textDecoration: t.completed ? 'line-through' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.title}</span>
                {!t.completed && (
                  <CommitControl item={t} today={today} weekIso={weekIso} accent={accent} onUpdateItem={onUpdateItem} readonly={readonly} />
                )}
              </li>
            ))}
          </ul>
          {contrib.length > 3 && (
            <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11, color: 'var(--color-faint)', paddingLeft: 12 }}>
              more than a handful — worth focusing?
            </span>
          )}
        </>
      ) : !readonly ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-faint)' }}>quiet this week</span>
          <DayChip label="bench next step" onClick={benchNext} />
          <DayChip label="park" onClick={() => onUpdateItem(goal.id, { status: 'parked' })} />
        </div>
      ) : (
        <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-faint)', paddingLeft: 12 }}>quiet this week</span>
      )}
    </div>
  )
}

function CarriedRow({ item, items, today, weekIso, onUpdateItem, onDelete, readonly }: any) {
  const [picking, setPicking] = useState(false)
  const owningGoal = getAncestors(item, items).find((a: any) => a.kind === 'goal')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{
        flex: '1 1 120px', minWidth: 0, fontFamily: FONT_BODY, fontSize: 12, color: 'var(--color-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{item.title}</span>
      {!readonly && (picking ? (
        <DatePick
          item={item}
          onPick={(d: string) => onUpdateItem(item.id, { due_date: d, week_start: weekIso })}
          onClose={() => setPicking(false)}
        />
      ) : (
        <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
          <DayChip label="this wk" onClick={() => onUpdateItem(item.id, { week_start: weekIso })} />
          <DayChip label="pick" onClick={() => setPicking(true)} />
          <DayChip label="let go" onClick={() => onDelete(item.id)} />
          {owningGoal && <DayChip label="park" onClick={() => onUpdateItem(owningGoal.id, { status: 'parked' })} />}
        </span>
      ))}
    </div>
  )
}

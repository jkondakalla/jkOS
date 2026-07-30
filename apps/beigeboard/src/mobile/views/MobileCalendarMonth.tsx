/**
 * MobileCalendarMonth — BeigeBoard's phone calendar: month grid + day agenda.
 *
 * Moved out of @jkos/cards' CalendarView for the same reason as
 * [MobileWeekAgenda]: it is on v0 styles (hardcoded rgba fills, a colour bar
 * down each row's left edge), and behind a `useBreakpoint()` branch inside a
 * kit component it leaked into every narrow-window mount — ORDECK widgets and
 * the design-system previews included. @jkos/cards' CalendarView is now the
 * desktop grid at every width; this body belongs to the mobile app.
 *
 * Restyling this to the Full Press language is still owed; until then nothing
 * outside apps/beigeboard/src/mobile/ may render it.
 */
import React, { useEffect, useRef, useState } from 'react'
import { usePointerDrag, DRAG_THRESHOLD_PX, HOLD_MS } from '@jkos/ui'
import { withAlpha } from '@jkos/design'
import {
  mergeResolvers, localDate, isoDate, fmtFull, fmtTime,
  Eyebrow, RecLamp, Checkbox, FONT_HEAD, FONT_BODY, FONT_NUM,
  type CalendarItem, type CalendarViewProps,
} from '@jkos/cards'

/** The ISO day under a screen point, via the same data-drop-day contract the
 *  desktop grid uses — so the mobile month grid shares one hit-test approach. */
function dayUnderPoint(x: number, y: number): string | null {
  try {
    for (const el of document.elementsFromPoint(x, y)) {
      const day = (el as HTMLElement).getAttribute?.('data-drop-day')
      if (day) return day
    }
  } catch { /* detached node */ }
  return null
}

export function MobileCalendarMonth({ items, today, resolvers, onSelect, onToggle, onAddItem, onUpdateItem, onAddOnDate }: CalendarViewProps) {
  const { accentOf, sourceColorOf } = mergeResolvers(resolvers);
  const [sel, setSel] = useState(today);
  const base = localDate(today);
  const [ym, setYm] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const { begin } = usePointerDrag();
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding && addRef.current) addRef.current.focus();
  }, [adding]);

  const reschedule = (id: number, iso: string) => {
    const it = items.find((x) => x.id === id);
    if (it && it.due_date !== iso) onUpdateItem?.(id, { due_date: iso });
    setSel(iso);
    setDragId(null);
    setDragOver(null);
  };

  // Pointer-drag a task row onto a day cell to reschedule. Touch must HOLD so the
  // agenda list still scrolls; mouse/pen drags on the 4px nudge. Replaces the old
  // HTML5 draggable path (flaky on phones) with the suite's one gesture engine.
  const beginRowDrag = (e: React.PointerEvent, it: CalendarItem) => {
    const activation = e.pointerType === 'touch'
      ? { kind: 'hold' as const, delay: HOLD_MS, cancelDistance: 8 }
      : { kind: 'distance' as const, threshold: DRAG_THRESHOLD_PX };
    let overIso: string | null = null;
    begin(e, {
      activation,
      onActivate: () => setDragId(it.id),
      onMove: (c) => {
        overIso = dayUnderPoint(c.x, c.y);
        setDragOver(overIso);
      },
      onEnd: (_c, activated) => {
        if (activated && overIso) reschedule(it.id, overIso);
        else { setDragId(null); setDragOver(null); }
      },
      onCancel: () => { setDragId(null); setDragOver(null); },
    });
  };

  const first = new Date(ym.y, ym.m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(isoDate(new Date(ym.y, ym.m, day)));
  while (cells.length % 7 !== 0) cells.push(null);

  const itemsByDay = (iso: string) => items.filter((it) => it.due_date === iso);
  const selItems = itemsByDay(sel).sort((a, b) => (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz'));

  const shift = (n: number) => {
    let m = ym.m + n;
    let y = ym.y;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    setYm({ y, m });
  };

  const monthName = new Date(ym.y, ym.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const accentFor = (it: CalendarItem) => (it.kind === 'event' ? it.accent || sourceColorOf(it.source) : accentOf(it)) || 'var(--color-muted)';

  const submitAdd = (v: string) => {
    if (v.trim()) onAddItem?.({ kind: 'task', scope: 'day', due_date: sel, title: v.trim() });
    setAdding(false);
  };

  // Prefer a host "add on date" flow (mobile shell's AddSheet); else inline add.
  const triggerAdd = () => (onAddOnDate ? onAddOnDate(sel) : setAdding(true));

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: '22px 18px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <button onClick={() => shift(-1)} className="jk-cards-btn" style={{ background: 'transparent', border: 'none', color: 'var(--color-ink)', cursor: 'pointer', fontSize: 20, padding: 4 }}>
            ‹
          </button>
          <div style={{ textAlign: 'center' }}>
            <Eyebrow style={{ marginBottom: 3 }}>Calendar</Eyebrow>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontStyle: 'italic', fontSize: 22, color: 'var(--color-ink)', letterSpacing: '-0.01em' }}>{monthName}</div>
          </div>
          <button onClick={() => shift(1)} className="jk-cards-btn" style={{ background: 'transparent', border: 'none', color: 'var(--color-ink)', cursor: 'pointer', fontSize: 20, padding: 4 }}>
            ›
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
            <div key={i} style={{ textAlign: 'center', fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.12em', color: 'var(--color-faint)', fontWeight: 500 }}>
              {w}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, padding: 6, background: 'rgba(0,0,0,0.22)', border: '1px solid var(--color-line)', borderRadius: 4 }}>
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} style={{ aspectRatio: '1 / 1.05' }} />;
            const dayItems = itemsByDay(iso);
            const isToday = iso === today;
            const isSel = iso === sel;
            const dots = dayItems.slice(0, 4).map((it) => accentFor(it));
            const isDropTarget = dragId != null && dragOver === iso;
            const draggedItem = dragId != null ? items.find((x) => x.id === dragId) : null;
            const isDragSource = draggedItem && draggedItem.due_date === iso;

            return (
              <button
                key={i}
                onClick={() => setSel(iso)}
                className="jk-cards-btn"
                data-drop-zone="cell"
                data-drop-day={iso}
                style={{
                  aspectRatio: '1 / 1.05',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 3,
                  padding: '5px 0 0',
                  cursor: 'pointer',
                  position: 'relative',
                  background: isDropTarget ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)' : isSel ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
                  border: isDropTarget ? '1px dashed var(--color-accent)' : isSel ? '1px solid var(--color-accent)' : '1px solid transparent',
                  borderRadius: 2,
                  boxShadow: isDropTarget ? '0 0 8px var(--color-accent-glow)' : 'none',
                  opacity: dragId != null && !isDropTarget && isDragSource ? 0.55 : 1,
                  transition: 'background 0.12s, border-color 0.12s',
                }}
              >
                <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 14, color: isToday ? 'var(--color-accent)' : 'var(--color-ink)', fontWeight: isToday ? 600 : 400, textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                  {localDate(iso).getDate()}
                </span>
                <span style={{ display: 'flex', gap: 2, height: 5, alignItems: 'center' }}>
                  {dots.map((c, j) => (
                    <span key={j} style={{ width: 4, height: 4, borderRadius: '50%', background: c, boxShadow: `0 0 4px ${withAlpha(c, 0.4)}` }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <Eyebrow color={sel === today ? 'var(--color-accent)' : 'var(--color-muted)'}>{fmtFull(sel)}</Eyebrow>
            {sel === today && <RecLamp size={6} />}
            <span style={{ flex: 1 }} />
            <button onClick={triggerAdd} className="jk-cards-btn" style={{ background: 'transparent', border: 'none', color: 'var(--color-accent)', textShadow: 'var(--accent-halo-text)', cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 0' }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add
            </button>
          </div>

          {adding && (
            <input
              ref={addRef}
              placeholder="New task…"
              onBlur={(e) => submitAdd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setAdding(false);
              }}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10, background: 'transparent', border: '1px solid var(--color-accent)', borderRadius: 3, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 15, color: 'var(--color-ink)', outline: 'none', padding: '8px 10px' }}
            />
          )}

          {selItems.length === 0 && !adding ? (
            <button onClick={triggerAdd} className="jk-cards-btn" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', borderRadius: 2, border: '1px dashed var(--color-line)', background: 'transparent', color: 'var(--color-faint)', fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 15, padding: '14px 14px' }}>
              Nothing scheduled — tap to lay down a task…
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--color-line-strong)', paddingTop: 10 }}>
              {selItems.map((it) => {
                const isEvent = it.kind === 'event';
                const accent = accentFor(it);
                const beingDragged = dragId === it.id;
                return (
                  <div
                    key={it.id}
                    className="jk-cards-row"
                    onClick={() => onSelect?.(it)}
                    onPointerDown={!isEvent ? (e) => beginRowDrag(e, it) : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 6px', cursor: isEvent ? 'pointer' : 'grab', borderLeft: `2px solid ${accent}`, paddingLeft: 8, opacity: beingDragged ? 0.4 : 1, background: beingDragged ? 'rgba(255,240,200,0.04)' : 'transparent', touchAction: beingDragged ? 'none' : undefined }}
                  >
                    {!isEvent && (
                      <span aria-hidden="true" style={{ color: 'var(--color-faint)', fontSize: 11, lineHeight: 1, letterSpacing: '-1px', cursor: 'grab', flexShrink: 0, userSelect: 'none' }}>
                        ⠿
                      </span>
                    )}
                    {!isEvent ? (
                      <Checkbox id={it.id} completed={it.completed} onToggle={onToggle} color={accent} size={14} />
                    ) : (
                      <span style={{ width: 14, textAlign: 'center', fontSize: 9, color: accent }}>◇</span>
                    )}
                    <span style={{ flex: 1, fontFamily: FONT_HEAD, fontSize: 15, color: it.completed ? 'var(--color-muted)' : 'var(--color-ink)', textDecoration: it.completed ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: isEvent ? 'italic' : 'normal' }}>
                      {it.title}
                    </span>
                    {it.scheduled_time && <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 11.5, color: accent, whiteSpace: 'nowrap' }}>{fmtTime(it.scheduled_time)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

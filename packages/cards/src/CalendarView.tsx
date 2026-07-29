/**
 * CalendarView — responsive calendar tab.
 *   • desktop/tablet → unscheduled sidebar + interactive month grid (drag chips
 *     and all-day bars to reschedule, click-to-quick-add, date → week jump) when
 *     a DragAdapter is given; read+light otherwise.
 *   • mobile → month grid with a selected-day agenda (native drag reschedule,
 *     inline add).
 *
 * Ported from BeigeBoard's CalendarView + MobileCalendarView.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBreakpoint, usePointerDrag, DRAG_THRESHOLD_PX, HOLD_MS } from '@jkos/ui';
import type { CalendarItem, DragAdapter, CalendarViewProps } from './types';
import { withAlpha } from '@jkos/design';
import { mergeResolvers, FONT_HEAD, FONT_BODY, FONT_NUM } from './theme';
import {
  addDays,
  addMonths,
  buildMonthGrid,
  fmtFull,
  fmtTime,
  isoDate,
  localDate,
  monthStart,
  chipState,
  chipStateClass,
} from './datetime';
import { DOW } from './constants';
import { TaskChip } from './TaskChip';
import { Checkbox, Eyebrow, RecLamp, ChromeBar } from './primitives';
import { TButton, EmptyState } from '@jkos/ui';
import { MO_DELAYS } from '@jkos/design';

export function CalendarView(props: CalendarViewProps) {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <CalendarMonth {...props} />;
  return <CalendarGrid {...props} />;
}

function shortMonth(iso: string) {
  return localDate(iso).toLocaleDateString('en-US', { month: 'short' });
}

/** The ISO day under a screen point, via the same data-drop-day contract the
 *  desktop grid uses — so the mobile month grid shares one hit-test approach. */
function dayUnderPoint(x: number, y: number): string | null {
  try {
    for (const el of document.elementsFromPoint(x, y)) {
      const day = (el as HTMLElement).getAttribute?.('data-drop-day');
      if (day) return day;
    }
  } catch { /* detached node */ }
  return null;
}

/* ── Desktop / tablet grid ─────────────────────────────────────────────── */

function CalendarGrid({
  items,
  today,
  selectedId,
  resolvers,
  drag: adapter,
  onSelect,
  onToggle,
  onAddItem,
  onUpdateItem,
  onWeekJump,
  foot,
  sidebar = false,
}: CalendarViewProps) {
  const { accentOf, sourceColorOf } = mergeResolvers(resolvers);
  const drag = adapter?.drag ?? null;
  const beginDrag: DragAdapter['beginDrag'] = adapter?.beginDrag ?? (() => {});
  const hasDnd = !!adapter;

  const [cursor, setCursor] = useState(() => monthStart(today));
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (quickAdd && quickRef.current) quickRef.current.focus();
  }, [quickAdd]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  // Per-day buckets. Like the Week lanes, the month is now GAPPED cells — and a
  // continuous spanning bar needs continuous columns, so a multi-day event
  // surfaces as a chip in EACH day it covers instead of one bar across the row.
  // (The spanning AllDayBar lives on in DayView's all-day lane.)
  const byDay = useMemo(() => {
    const out: Record<string, CalendarItem[]> = {};
    items.forEach((it) => {
      if (it.kind !== 'task' && it.kind !== 'event') return;
      if (it.kind === 'event' && !it.scheduled_time) {
        const start = it.due_date;
        if (!start) return;
        const end = it.end_date || start;
        for (let d = start; d <= end; d = addDays(d, 1)) {
          if (!out[d]) out[d] = [];
          out[d].push(it);
        }
        return;
      }
      const key = it.due_date || '__none__';
      if (!out[key]) out[key] = [];
      out[key].push(it);
    });
    return out;
  }, [items]);

  const unscheduled = byDay['__none__'] || [];

  // How many week rows this month actually needs. The prototype hardcodes 5,
  // which is only right for the month it was drawn in — a month starting late
  // in the week spills into a 6th. Trim trailing all-out-of-month weeks instead,
  // so `1fr` rows always divide the pane evenly and no month clips.
  const weekRows = useMemo(() => {
    for (let w = 6; w > 4; w--) {
      if (grid.slice((w - 1) * 7, w * 7).some((c) => c.inMonth)) return w;
    }
    return 5;
  }, [grid]);

  const monthName = useMemo(() => localDate(cursor).toLocaleDateString('en-US', { month: 'long' }), [cursor]);
  const monthYear = useMemo(() => String(localDate(cursor).getFullYear()), [cursor]);
  const daysInMonth = useMemo(() => {
    const d = localDate(cursor);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }, [cursor]);
  const monthItemCount = useMemo(
    () => grid.reduce((n, c) => n + (c.inMonth ? (byDay[c.iso]?.length ?? 0) : 0), 0),
    [grid, byDay],
  );

  const beginDragChip = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    if (drag) return;
    beginDrag(e, item, 'cell', ({ overDay, overZone }) => {
      if (overZone === 'cell' && overDay && overDay !== item.due_date) {
        onUpdateItem?.(item.id, { due_date: overDay });
      }
    });
  };

  const anyDrag = !!drag;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', background: 'transparent' }}>
      {/* The unscheduled sidebar is OFF by default: it is not in the prototype's
          month, and it was the reason Calendar read as a different app from the
          other three tabs. Unplaced work belongs on the Week bench strip. Kept
          behind a prop for any consumer that still wants the rail. */}
      {sidebar && (
        <aside className="jk-scroll" style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--hub-line)', background: 'var(--color-paper-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--hub-line)' }}>
            <Eyebrow>Unscheduled · {unscheduled.length}</Eyebrow>
            <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 12, color: 'var(--color-muted)', margin: '4px 0 0', lineHeight: 1.35 }}>Drag onto a date to schedule</p>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
            {unscheduled.length === 0 ? (
              <EmptyState line="Nothing left to place." />
            ) : (
              unscheduled.map((it) => (
                <TaskChip
                  key={it.id}
                  item={it}
                  accent={accentOf(it) || 'var(--color-muted)'}
                  size="md"
                  showTime
                  isDragging={drag?.item?.id === it.id}
                  isSelected={selectedId === it.id}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onPointerDown={hasDnd ? (e) => beginDragChip(e, it) : undefined}
                />
              ))
            )}
          </div>
        </aside>
      )}

      {/* Fills its container — the page's .jk-canvas owns the measure. Month
          cells were 350px wide on a 2560 monitor before the canvas capped it. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 28px 18px' }}>
        <ChromeBar
          className="mo-item"
          style={{ height: 'auto', padding: 0, border: 'none', marginBottom: 14, animationDelay: `${MO_DELAYS.header}ms` }}
          title={
            <span style={{ fontSize: '1.9rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
              {monthName} <span style={{ fontStyle: 'italic' }}>{monthYear}</span>
            </span>
          }
          stats={`${String(daysInMonth).padStart(2, '0')} DAYS · ${String(monthItemCount).padStart(2, '0')} ITEMS · CLICK A DAY TO OPEN IT`}
          nav={
            <>
              <TButton quiet onClick={() => setCursor((c) => addMonths(c, -1))}>← {shortMonth(addMonths(cursor, -1))}</TButton>
              <TButton onClick={() => setCursor(monthStart(today))}>Today</TButton>
              <TButton quiet onClick={() => setCursor((c) => addMonths(c, 1))}>{shortMonth(addMonths(cursor, 1))} →</TButton>
            </>
          }
        />

        {/* Day-of-week row — no borders, no background: the cells carry the frame. */}
        <div className="mo-item" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6, flexShrink: 0, animationDelay: `${MO_DELAYS.calendarDow}ms` }}>
          {DOW.map((d) => (
            <div key={d} className="jk-lab jk-lab-xs" style={{ color: 'var(--color-muted)', textAlign: 'center' }}>
              {d}
            </div>
          ))}
        </div>

        {/* The cell grid — gapped, individually bordered cells: Week's lane idea
            at month scale. Rows are 1fr so the grid fills the pane instead of
            scrolling a fixed 90px-per-row table. */}
        <div
          className="mo-item"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: `repeat(${weekRows}, 1fr)`,
            gap: 6,
            position: 'relative',
            animationDelay: `${MO_DELAYS.calendarGrid}ms`,
          }}
        >
          {monthItemCount === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 4 }}>
              <EmptyState line="No impressions this month." sub="CLICK A DAY TO OPEN IT" />
            </div>
          )}
          {grid.slice(0, weekRows * 7).map((cell) => {
            const cellItems = byDay[cell.iso] || [];
            const isToday = cell.iso === today;
            const isOver = drag?.overZone === 'cell' && drag?.overDay === cell.iso;
            const isTarget = anyDrag && cell.inMonth;

            return (
              <div
                key={cell.iso}
                data-drop-zone="cell"
                data-drop-day={cell.iso}
                className={cell.inMonth ? 'jk-hit' : undefined}
                onClick={(e) => {
                  if (e.target !== e.currentTarget || !cell.inMonth || anyDrag) return;
                  // Clicking the cell opens that day; the quick-add lives on the
                  // day number, so a cell is one gesture with one meaning.
                  onWeekJump?.(cell.iso);
                }}
                style={{
                  border: '1px solid var(--hub-line)',
                  borderRadius: 'var(--hub-radius-xs)',
                  padding: '7px 9px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  overflow: 'hidden',
                  minWidth: 0,
                  opacity: cell.inMonth ? 1 : 0.36,
                  background: isOver
                    ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                    : isToday
                      ? 'color-mix(in srgb, var(--jk-tint, var(--accent)) 14%, var(--hub-bg-2))'
                      : 'var(--color-paper)',
                  boxShadow: isToday ? 'var(--hub-accent-press)' : 'none',
                  outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                  outlineOffset: -1,
                  cursor: anyDrag ? (cell.inMonth ? 'copy' : 'default') : cell.inMonth ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                <div
                  className={isToday ? 'jk-press' : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (cell.inMonth) setQuickAdd(cell.iso);
                  }}
                  style={{
                    fontFamily: FONT_HEAD,
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1,
                    flex: 'none',
                    alignSelf: 'flex-start',
                    cursor: cell.inMonth ? 'text' : 'default',
                  }}
                  title="Add on this day"
                >
                  {localDate(cell.iso).getDate()}
                </div>

                {cell.inMonth && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 0, overflow: 'hidden' }}>
                    {cellItems.slice(0, 4).map((it) => {
                      const tint = accentOf(it) || sourceColorOf(it.source);
                      return (
                        <span
                          key={it.id}
                          className={`jk-chip jk-chip-solid jk-chip-sm ${chipStateClass(chipState(it))}`}
                          onPointerDown={hasDnd ? (e) => beginDragChip(e, it) : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!drag) onSelect?.(it);
                          }}
                          style={{
                            ['--jk-tint' as string]: tint,
                            padding: '3px 7px',
                            cursor: 'pointer',
                            outline: selectedId === it.id ? '1.5px solid var(--color-accent)' : undefined,
                            outlineOffset: -2,
                            opacity: drag?.item?.id === it.id ? 0.4 : undefined,
                          }}
                        >
                          <span
                            className="jk-press-rev"
                            style={{
                              fontFamily: FONT_HEAD,
                              fontWeight: 600,
                              fontSize: 10,
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.title}
                          </span>
                        </span>
                      );
                    })}
                    {cellItems.length > 4 && (
                      <span className="mono-eyebrow" style={{ fontSize: 8 }}>+{cellItems.length - 4} MORE</span>
                    )}
                    {quickAdd === cell.iso && (
                      <input
                        ref={quickRef}
                        placeholder="New task…"
                        onBlur={() => setQuickAdd(null)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (e.key === 'Enter' && v) {
                            onAddItem?.({ kind: 'task', scope: 'day', due_date: cell.iso, title: v });
                            setQuickAdd(null);
                          }
                          if (e.key === 'Escape') setQuickAdd(null);
                        }}
                        style={{ background: 'transparent', border: '1px solid var(--color-accent)', borderRadius: 'var(--hub-radius-sm)', fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11, color: 'var(--color-ink)', outline: 'none', padding: '2px 5px', width: '100%', boxSizing: 'border-box' }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* The page's foot — the bottom anchor of the canvas (hub.css). */}
        {foot && <div className="jk-canvas-foot">{foot}</div>}
      </div>
    </div>
  );
}

/* ── Mobile month grid + day agenda ────────────────────────────────────── */

function CalendarMonth({ items, today, resolvers, onSelect, onToggle, onAddItem, onUpdateItem, onAddOnDate }: CalendarViewProps) {
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

/**
 * CalendarView — the calendar tab: an unscheduled sidebar beside an interactive
 * month grid (drag chips and all-day bars to reschedule, click-to-quick-add,
 * date → week jump) when a DragAdapter is given; read+light otherwise.
 *
 * ONE BODY AT EVERY WIDTH — see the note on WeekView. The phone month+agenda
 * body this used to swap in below 768px is on v0 styles, so it moved to the app
 * that wants it (apps/beigeboard/src/mobile/views/MobileCalendarMonth.tsx)
 * rather than lying in wait inside a kit component.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarItem, DragAdapter, CalendarViewProps } from './types';
import { mergeResolvers, FONT_HEAD } from './theme';
import {
  addDays,
  addMonths,
  buildMonthGrid,
  localDate,
  monthStart,
  chipState,
  chipStateClass,
} from './datetime';
import { DOW } from './constants';
import { TaskChip } from './TaskChip';
import { Eyebrow, ChromeBar } from './primitives';
import { TButton } from '@jkos/ui';
import { MO_DELAYS, MO_RING_STEP, ringOrder } from '@jkos/design';

function shortMonth(iso: string) {
  return localDate(iso).toLocaleDateString('en-US', { month: 'short' });
}

export function CalendarView({
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

  // ── The entrance ring ──────────────────────────────────────────────────
  // The month is the one grid with a "you are here", so its cells do not enter
  // in reading order: the cascade STARTS ON TODAY, runs to the end of the month,
  // wraps to the 1st and closes on the day before. The eye goes to where motion
  // begins, so the current date is named by choreography — before the tint, the
  // press and the type have to carry it alone. (ringOrder + MO_RING_STEP live in
  // @jkos/design: the order is choreography, and choreography is shared data.)
  //
  // Anchor is today only when the cursor is on today's month; a month you paged
  // to has no "now", so it opens from the 1st and simply reads left-to-right.
  // Out-of-month gutter cells are not days and take no place in the ring — they
  // fill in together on the beat after it closes.
  const cellDelay = useMemo(() => {
    const t = localDate(today);
    const c = localDate(cursor);
    const anchor = t.getFullYear() === c.getFullYear() && t.getMonth() === c.getMonth()
      ? t.getDate()
      : 1;
    return (cell: { iso: string; inMonth: boolean }) => {
      const rank = cell.inMonth
        ? ringOrder(localDate(cell.iso).getDate(), anchor, daysInMonth)
        : daysInMonth;
      return MO_DELAYS.calendarGrid + rank * MO_RING_STEP;
    };
  }, [today, cursor, daysInMonth]);

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
            {/* Empty rail = empty rail; the count in the header above already
                says "0", so a placard here is a second voice saying it. */}
            {unscheduled.map((it) => (
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
            ))}
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
            scrolling a fixed 90px-per-row table.
            The container itself does NOT animate: the entrance belongs to the
            cells (see cellDelay), and a .mo-item wrapper around .mo-item children
            fades the whole pane in while each child is still holding its
            pre-delay frame — one entrance per surface. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: `repeat(${weekRows}, 1fr)`,
            gap: 6,
            position: 'relative',
          }}
        >
          {/* An empty month says so by being empty — the cell grid is the
              message, and the count already rides in the ChromeBar stats. */}
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
                className={cell.inMonth ? 'mo-item jk-hit' : 'mo-item'}
                onClick={(e) => {
                  if (e.target !== e.currentTarget || !cell.inMonth || anyDrag) return;
                  // Clicking the cell opens that day; the quick-add lives on the
                  // day number, so a cell is one gesture with one meaning.
                  onWeekJump?.(cell.iso);
                }}
                style={{
                  animationDelay: `${cellDelay(cell)}ms`,
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

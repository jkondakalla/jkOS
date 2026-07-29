/**
 * WeekView — responsive week tab.
 *   • desktop/tablet → interactive time grid (drag to schedule/move/resize,
 *     all-day lane, untimed lane, click-to-create) when a DragAdapter is given;
 *     read+light (select/toggle) when not.
 *   • mobile → a vertical 7-day agenda (no drag).
 *
 * Ported from BeigeBoard's WeekView + MobileWeekView; drag and accent/source
 * colour are injected so the same component serves BeigeBoard and ORDECK.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBreakpoint } from '@jkos/ui';
import type { CalendarItem, DragAdapter, WeekViewProps } from './types';
import { mergeResolvers, FONT_HEAD, FONT_BODY, FONT_NUM } from './theme';
import {
  addDays,
  fmtHourLabel,
  fmtTime,
  fracToTime,
  layoutTimedEvents,
  localDate,
  snapFrac,
  timeToFrac,
  weekStart,
} from './datetime';
import { WV_FIRST_H, WV_LAST_H, WV_ROW_H, WV_LABEL_W } from './constants';
import { TaskChip } from './TaskChip';
import { TimeBlock } from './TimeBlock';
import { TimelinePreview } from './TimelinePreview';
import { CreateDialog } from './CreateDialog';
import { Checkbox, Eyebrow, RecLamp } from './primitives';
import { Press, TButton } from '@jkos/ui';

export function WeekView(props: WeekViewProps) {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <WeekAgenda {...props} />;
  return <WeekGrid {...props} />;
}

/* ── Desktop / tablet interactive grid ─────────────────────────────────── */

function WeekGrid({
  items,
  today,
  selectedId,
  readonly,
  resolvers,
  drag: adapter,
  onSelect,
  onToggle,
  onAddItem,
  onUpdateItem,
  weekJumpDate,
  benchLane,
  createSource,
  density = 'comfortable',
}: WeekViewProps) {
  const compact = density === 'compact';
  // Framing metrics — the lane framing is preserved at both densities; only the
  // air (inter-lane gap + padding) shrinks so the day-separation survives in the
  // small ORDECK widget without forking the layout.
  const GAP = compact ? 5 : 11;
  const PAD_X = compact ? 12 : 28;
  const { accentOf, sourceColorOf } = mergeResolvers(resolvers);
  const drag = adapter?.drag ?? null;
  const beginDrag: DragAdapter['beginDrag'] = adapter?.beginDrag ?? (() => {});
  const hasDnd = !!adapter;

  const [cursor, setCursor] = useState(() => weekStart(today));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(cursor, i)), [cursor]);

  useEffect(() => {
    if (weekJumpDate) setCursor(weekJumpDate);
  }, [weekJumpDate]);

  const weekRange = useMemo(() => {
    const a = localDate(days[0]);
    const b = localDate(days[6]);
    return a.getMonth() === b.getMonth()
      ? `${a.toLocaleDateString('en-US', { month: 'long' })} ${a.getDate()} – ${b.getDate()}`
      : `${a.toLocaleDateString('en-US', { month: 'short' })} ${a.getDate()} – ${b.toLocaleDateString('en-US', { month: 'short' })} ${b.getDate()}`;
  }, [days]);

  // Per-day buckets. Under Full Press the week reads as seven framed, gapped day
  // lanes, so a spanning all-day bar (which needs continuous columns) can't cross
  // the gaps — all-day events surface as a chip in EACH day they cover instead,
  // held in the day's top band beside its untimed tasks. (The continuous
  // AllDayBar lives on in CalendarView's month rows, which are not gapped.)
  const byDay = useMemo(() => {
    const out: Record<string, { allday: CalendarItem[]; untimed: CalendarItem[]; timed: CalendarItem[] }> = {};
    days.forEach((d) => (out[d] = { allday: [], untimed: [], timed: [] }));
    items.forEach((it) => {
      if (it.kind !== 'task' && it.kind !== 'event') return;
      if (it.kind === 'event' && !it.scheduled_time) {
        // Multi-day span → drop a chip in every covered day within the week.
        const start = it.due_date;
        if (!start) return;
        const end = it.end_date || start;
        days.forEach((d) => {
          if (d >= start && d <= end) out[d].allday.push(it);
        });
        return;
      }
      if (!it.due_date || !out[it.due_date]) return;
      if (it.scheduled_time) out[it.due_date].timed.push(it);
      else out[it.due_date].untimed.push(it);
    });
    return out;
  }, [items, days]);

  const anyAllday = useMemo(() => days.some((d) => byDay[d]?.allday.length > 0), [days, byDay]);

  // The bench lane's contents: open tasks committed to the visible week (week_start
  // = this Monday) with no day yet. Empty unless benchLane is on.
  const benched = useMemo(
    () => (benchLane
      ? items.filter((it) => it.kind === 'task' && it.week_start === cursor && !it.due_date && !it.completed)
      : []),
    [items, cursor, benchLane],
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(i);
  }, []);
  const nowFrac = now.getHours() + now.getMinutes() / 60;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      const target = days.includes(today) ? Math.max(WV_FIRST_H, nowFrac - 1) : 8;
      scrollRef.current.scrollTop = (target - WV_FIRST_H) * WV_ROW_H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const [createPending, setCreatePending] = useState<any>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);

  const beginDragUntimed = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    beginDrag(e, item, 'untimed', ({ overDay, overFrac, overZone }) => {
      if (overZone === 'timed' && overFrac != null) {
        onUpdateItem?.(item.id, {
          due_date: overDay ?? undefined,
          scheduled_time: fracToTime(overFrac),
          scheduled_end: fracToTime(overFrac + 1),
        });
      } else if (overZone === 'bench') {
        // Demote to this week's bench (zone only exists when benchLane is on).
        onUpdateItem?.(item.id, { due_date: null, week_start: cursor, scheduled_time: null, scheduled_end: null });
      } else if (overZone === 'untimed' && overDay && overDay !== item.due_date) {
        onUpdateItem?.(item.id, { due_date: overDay });
      }
    });
  };

  const beginDragTimed = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    e.stopPropagation();
    const baseStart = timeToFrac(item.scheduled_time as string);
    const baseEnd = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1;
    const dur = baseEnd - baseStart;
    beginDrag(
      e,
      item,
      'timed',
      ({ overDay, overFrac, overZone }) => {
        if (overZone === 'timed' && overFrac != null) {
          onUpdateItem?.(item.id, {
            due_date: overDay ?? undefined,
            scheduled_time: fracToTime(overFrac),
            scheduled_end: fracToTime(overFrac + dur),
          });
        } else if (overZone === 'bench') {
          // Demote to this week's bench (zone only exists when benchLane is on).
          onUpdateItem?.(item.id, { due_date: null, week_start: cursor, scheduled_time: null, scheduled_end: null });
        } else if (overZone === 'untimed' && overDay) {
          onUpdateItem?.(item.id, { due_date: overDay, scheduled_time: null, scheduled_end: null });
        }
      },
      { startFrac: baseStart },
    );
  };

  const beginResize = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    e.stopPropagation();
    const startFrac = timeToFrac(item.scheduled_time as string);
    beginDrag(
      e,
      item,
      'resize',
      ({ overFrac }) => {
        if (overFrac != null && overFrac > startFrac + 0.1) {
          onUpdateItem?.(item.id, { scheduled_end: fracToTime(overFrac) });
        }
      },
      { startFrac },
    );
  };

  const beginDragAllday = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    e.stopPropagation();
    beginDrag(e, item, 'allday', ({ overDay }) => {
      if (overDay && overDay !== item.due_date) {
        const delta = Math.round((new Date(overDay).getTime() - new Date(item.due_date as string).getTime()) / 86400000);
        const updates: Partial<CalendarItem> = { due_date: addDays(item.due_date as string, delta) };
        if (item.end_date) updates.end_date = addDays(item.end_date, delta);
        onUpdateItem?.(item.id, updates);
      }
    });
  };

  // A benched task (this week, no day) dragged onto a day commits it — normalising
  // week_start to that day's Monday. Uses mode 'untimed' so the day zones highlight
  // as targets. The reverse (day → bench) rides beginDragUntimed/Timed's bench branch.
  const beginDragBench = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    beginDrag(e, item, 'untimed', ({ overDay, overFrac, overZone }) => {
      if (overZone === 'timed' && overFrac != null && overDay) {
        onUpdateItem?.(item.id, {
          due_date: overDay, week_start: weekStart(overDay),
          scheduled_time: fracToTime(overFrac), scheduled_end: fracToTime(overFrac + 1),
        });
      } else if (overZone === 'untimed' && overDay) {
        onUpdateItem?.(item.id, { due_date: overDay, week_start: weekStart(overDay) });
      }
      // dropped back on the bench (or nowhere): it's already benched here — no-op.
    });
  };

  const beginCreate = (e: React.PointerEvent, dayKey: string, hourFrac: number) => {
    if (readonly) return;
    e.preventDefault();
    beginDrag(
      e,
      null,
      'create',
      ({ overFrac, overDay }) => {
        const a = hourFrac;
        const b = overFrac ?? hourFrac;
        const start = Math.min(a, b);
        const end = Math.max(a + 0.5, b);
        setCreatePending({
          startDay: overDay || dayKey,
          scheduled_time: fracToTime(start),
          scheduled_end: fracToTime(end),
        });
      },
      { startFrac: hourFrac, startDay: dayKey },
    );
  };

  const anyDrag = !!drag;
  const HOURS = Array.from({ length: WV_LAST_H - WV_FIRST_H + 1 }, (_, i) => i + WV_FIRST_H);
  const totalH = HOURS.length * WV_ROW_H;

  // The seven day lanes are framed, gapped columns; the header rounds its top,
  // the timed body rounds its bottom, and the (optional) all-day + untimed bands
  // between them carry only side borders — so a column's bands stack flush into
  // ONE bordered unit with real air between neighbours (the day-separation that
  // replaces the old monolithic hairline grid). Today's whole lane is a tinted
  // well. `pos` places a band in the column stack.
  const cols = `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`;
  const rad = 'var(--hub-radius-sm)';
  const laneFrame = (pos: 'head' | 'mid' | 'foot', isToday: boolean): React.CSSProperties => ({
    border: '1px solid var(--color-line)',
    borderTop: pos === 'head' ? undefined : 'none',
    borderTopLeftRadius: pos === 'head' ? rad : 0,
    borderTopRightRadius: pos === 'head' ? rad : 0,
    borderBottomLeftRadius: pos === 'foot' ? rad : 0,
    borderBottomRightRadius: pos === 'foot' ? rad : 0,
    background: isToday
      ? 'color-mix(in srgb, var(--jk-tint, var(--accent)) 14%, var(--hub-bg-2))'
      : 'var(--color-paper)',
    minWidth: 0,
  });

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', background: 'transparent', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, padding: compact ? `10px ${PAD_X}px 0` : `24px ${PAD_X}px 0`, display: 'flex', flexDirection: 'column', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--color-line)' }}>
            <div>
              <Eyebrow style={{ marginBottom: 4 }}>The week</Eyebrow>
              <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 30, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.04, whiteSpace: 'nowrap' }}>
                <Press large as="em" style={{ fontStyle: 'italic' }}>
                  {weekRange}
                </Press>
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TButton onClick={() => setCursor(addDays(cursor, -7))} style={{ fontSize: 13, padding: '6px 11px' }}>
                ‹
              </TButton>
              <TButton onClick={() => setCursor(weekStart(today))} style={{ letterSpacing: '0.14em', padding: '6px 14px' }}>
                THIS WEEK
              </TButton>
              <TButton onClick={() => setCursor(addDays(cursor, 7))} style={{ fontSize: 13, padding: '6px 11px' }}>
                ›
              </TButton>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* This week's bench — a full-width strip ABOVE the framed lanes (opt-in) */}
            {benchLane && (() => {
              const isOver = drag?.overZone === 'bench';
              const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed');
              return (
                <div
                  data-drop-zone="bench"
                  style={{
                    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: `${compact ? 6 : 9}px ${compact ? 6 : 4}px`, marginBottom: 4,
                    background: isOver ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
                    outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                    outlineOffset: -2, transition: 'background 0.08s',
                  }}
                >
                  <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>The bench</span>
                  {benched.length === 0 ? (
                    <span className="mono-eyebrow">{isTarget ? 'DROP TO HOLD FOR THE WEEK' : 'NOTHING BENCHED THIS WEEK'}</span>
                  ) : (
                    <span className="mono-eyebrow">UNSCHEDULED — DROP ONTO A DAY</span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {benched.map((it) => (
                      <div key={it.id} style={{ flex: '0 1 auto', minWidth: 110, maxWidth: 220 }}>
                        <TaskChip
                          item={it}
                          accent={accentOf(it) || 'var(--color-muted)'}
                          size="sm"
                          isSelected={selectedId === it.id}
                          isDragging={drag?.item?.id === it.id}
                          onSelect={onSelect}
                          onToggle={onToggle}
                          onPointerDown={hasDnd ? (e) => beginDragBench(e, it) : undefined}
                        />
                      </div>
                    ))}
                  </span>
                </div>
              );
            })()}

            {/* ── Day-header band — framed column tops (rounded on top) ── */}
            <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: GAP, flexShrink: 0 }}>
              <div />
              {days.map((d) => {
                const dd = localDate(d);
                const isToday = d === today;
                return (
                  <div key={d} style={{ ...laneFrame('head', isToday), display: 'flex', alignItems: 'baseline', gap: 6, padding: compact ? '5px 7px 4px' : '9px 11px 7px' }}>
                    <span className="jk-lab jk-lab-xs" style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-muted)' }}>
                      {dd.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span
                      className={isToday ? 'jk-press' : undefined}
                      style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: compact ? 15 : 20, marginLeft: 'auto', letterSpacing: '-0.02em', fontStyle: isToday ? 'italic' : 'normal', color: isToday ? 'var(--color-accent)' : 'var(--color-ink)' }}
                    >
                      {dd.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* ── All-day band — one chip per covered day (framed sides) ── */}
            {(anyAllday || (anyDrag && drag?.mode === 'allday')) && (
              <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: GAP, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', padding: '4px 6px 0 0' }}>
                  <span className="mono-eyebrow" style={{ fontSize: 7 }}>ALL-DAY</span>
                </div>
                {days.map((d) => {
                  const isToday = d === today;
                  const isOver = drag?.overZone === 'allday' && drag?.overDay === d;
                  const isTarget = anyDrag && drag?.mode === 'allday';
                  return (
                    <div
                      key={d}
                      data-drop-zone="allday"
                      data-drop-day={d}
                      onClick={!anyDrag && !readonly ? () => setCreatePending({ startDay: d, allDay: true, scheduled_time: null, scheduled_end: null }) : undefined}
                      style={{
                        ...laneFrame('mid', isToday),
                        ...(isOver ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : null),
                        outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                        outlineOffset: -2,
                        minHeight: 24, padding: 4, display: 'flex', flexDirection: 'column', gap: 3,
                        cursor: anyDrag ? 'copy' : readonly ? 'default' : 'pointer', transition: 'background 0.08s',
                      }}
                    >
                      {(byDay[d]?.allday || []).map((ev) => (
                        <TaskChip
                          key={ev.id}
                          item={ev}
                          accent={accentOf(ev) || sourceColorOf(ev.source) || 'var(--color-muted)'}
                          size="xs"
                          variant="solid"
                          isSelected={selectedId === ev.id}
                          isDragging={drag?.item?.id === ev.id}
                          onSelect={onSelect}
                          onPointerDown={hasDnd ? (e) => beginDragAllday(e, ev) : undefined}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Untimed band — framed sides ── */}
            <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: GAP, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', padding: '5px 6px 0 0' }}>
                <span className="mono-eyebrow" style={{ fontSize: 7 }}>UNTIMED</span>
              </div>
              {days.map((d) => {
                const dayItems = byDay[d]?.untimed || [];
                const isToday = d === today;
                const isOver = drag?.overZone === 'untimed' && drag?.overDay === d;
                const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed');
                return (
                  <div
                    key={d}
                    data-drop-zone="untimed"
                    data-drop-day={d}
                    style={{
                      ...laneFrame('mid', isToday),
                      ...(isOver ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : null),
                      outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                      outlineOffset: -2,
                      minHeight: compact ? 30 : 44, padding: 4, display: 'flex', flexDirection: 'column', gap: 3,
                      transition: 'background 0.08s',
                    }}
                  >
                    {dayItems.map((it) => (
                      <TaskChip
                        key={it.id}
                        item={it}
                        accent={accentOf(it) || 'var(--color-muted)'}
                        size="sm"
                        isSelected={selectedId === it.id}
                        isDragging={drag?.item?.id === it.id}
                        onSelect={onSelect}
                        onToggle={onToggle}
                        onPointerDown={hasDnd ? (e) => beginDragUntimed(e, it) : undefined}
                      />
                    ))}
                  </div>
                );
              })}
            </div>

            {/* ── Timed hour grid — framed column bottoms (rounded on bottom) ── */}
            <div ref={scrollRef} data-hour-scroll style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: GAP, height: totalH, position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  {HOURS.map((h, i) => (
                    <div key={h} style={{ position: 'absolute', top: i * WV_ROW_H, left: 0, right: 0, height: WV_ROW_H, textAlign: 'right', padding: '2px 8px 0 0' }}>
                      <span className="seg" style={{ fontSize: 9, color: 'var(--color-faint)', letterSpacing: '0.04em' }}>{i === 0 ? '' : fmtHourLabel(h)}</span>
                    </div>
                  ))}
                  {days.includes(today) && nowFrac >= WV_FIRST_H && nowFrac <= WV_LAST_H + 1 && (
                    <div style={{ position: 'absolute', top: (nowFrac - WV_FIRST_H) * WV_ROW_H, right: 6, transform: 'translateY(-50%)' }}>
                      <span className="seg" style={{ fontSize: 10, color: 'var(--color-accent)' }}>
                        {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>

                {days.map((d) => {
                  const timedLayout = layoutTimedEvents(byDay[d]?.timed || []);
                  const isToday = d === today;
                  const isOver = drag?.overZone === 'timed' && drag?.overDay === d;
                  const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed' || drag?.mode === 'create');
                  const isHover = hoverCol === d && !anyDrag && !readonly;
                  const showPreview = isOver && drag?.overFrac != null && (drag?.mode === 'create' || drag?.mode === 'untimed' || drag?.mode === 'timed');

                  return (
                    <div
                      key={d}
                      data-drop-zone="timed"
                      data-drop-day={d}
                      data-frac-base={WV_FIRST_H}
                      data-frac-scale={WV_ROW_H}
                      onMouseEnter={() => setHoverCol(d)}
                      onMouseLeave={() => setHoverCol((c) => (c === d ? null : c))}
                      onPointerDown={
                        hasDnd
                          ? (e) => {
                              if (e.target !== e.currentTarget) return;
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const frac = snapFrac(WV_FIRST_H + (e.clientY - r.top) / WV_ROW_H);
                              beginCreate(e, d, frac);
                            }
                          : undefined
                      }
                      style={{
                        ...laneFrame('foot', isToday),
                        ...(isOver
                          ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }
                          : isHover
                            ? { background: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-paper))' }
                            : null),
                        // per-lane hour gridlines (applied AFTER the frame's background)
                        backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line-strong) 0 1px, transparent 1px ${WV_ROW_H}px)`,
                        position: 'relative',
                        outline: isTarget && !isToday ? '1px solid var(--color-accent-glow)' : 'none',
                        outlineOffset: -1,
                        cursor: anyDrag ? 'copy' : readonly || !hasDnd ? 'default' : 'crosshair',
                        transition: 'background 0.12s',
                      }}
                    >
                      {timedLayout.map(({ ev: item, slot, totalCols }) => {
                        const isMine = drag?.item?.id === item.id;
                        const isRsz = isMine && drag?.mode === 'resize';
                        const isEvent = item.kind === 'event';
                        const blockAccent = accentOf(item) || (isEvent ? sourceColorOf(item.source) : '') || 'var(--color-accent)';
                        return (
                          <TimeBlock
                            key={item.id}
                            item={item}
                            accent={blockAccent}
                            slot={slot}
                            totalCols={totalCols}
                            isSelected={selectedId === item.id}
                            isDragging={isMine}
                            isResizing={isRsz}
                            liveOverride={
                              isMine && drag?.mode === 'timed' && drag?.overFrac != null
                                ? { start: drag.overFrac }
                                : isMine && isRsz && drag?.overFrac != null
                                  ? { end: drag.overFrac }
                                  : null
                            }
                            onSelect={onSelect}
                            onToggle={onToggle}
                            onBeginDrag={hasDnd ? (e) => beginDragTimed(e, item) : undefined}
                            onBeginResize={hasDnd ? (e) => beginResize(e, item) : undefined}
                          />
                        );
                      })}

                      {showPreview && drag && <TimelinePreview drag={drag} sourceColorOf={sourceColorOf} />}

                      {isToday && nowFrac >= WV_FIRST_H && nowFrac <= WV_LAST_H + 1 && (
                        <div style={{ position: 'absolute', top: (nowFrac - WV_FIRST_H) * WV_ROW_H, left: 0, right: 0, height: 0, zIndex: 12, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
                          <span className="now-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: 'var(--accent-halo)', marginLeft: -4 }} />
                          <span style={{ flex: 1, height: 2, background: 'var(--color-accent)', opacity: 0.75 }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {createPending && (
        <CreateDialog
          pending={createPending}
          onSubmit={(title: string) => {
            if (createPending.allDay) {
              onAddItem?.({ kind: 'event', scope: 'day', ...(createSource ? { source: createSource } : {}), due_date: createPending.startDay, title });
            } else {
              onAddItem?.({
                kind: 'task',
                scope: 'day',
                due_date: createPending.startDay,
                scheduled_time: createPending.scheduled_time,
                scheduled_end: createPending.scheduled_end,
                title,
              });
            }
            setCreatePending(null);
          }}
          onCancel={() => setCreatePending(null)}
        />
      )}
    </>
  );
}

/* ── Mobile vertical agenda ────────────────────────────────────────────── */

function WeekAgenda({ items, today, resolvers, onSelect, onToggle }: WeekViewProps) {
  const { accentOf, sourceColorOf } = mergeResolvers(resolvers);
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: '22px 18px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20, gap: 12 }}>
          <div style={{ flexShrink: 0 }}>
            <Eyebrow>This week</Eyebrow>
            <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 30, margin: '6px 0 0', letterSpacing: '-0.02em', color: 'var(--color-ink)', whiteSpace: 'nowrap' }}>7 days</h1>
          </div>
          <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 13, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
            {localDate(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {localDate(addDays(start, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {days.map((iso) => {
            const isToday = iso === today;
            const dayItems = items
              .filter((it) => it.due_date === iso)
              .sort((a, b) => (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz'));
            const d = localDate(iso);

            return (
              <div key={iso}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                  <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 17, color: isToday ? 'var(--color-accent)' : 'var(--color-ink)', minWidth: 26, textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>{d.getDate()}</span>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: isToday ? 'var(--color-accent)' : 'var(--color-muted)', textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                    {d.toLocaleDateString('en-US', { weekday: 'long' })}
                  </span>
                  {isToday && <RecLamp size={6} label="Today" />}
                  <span style={{ flex: 1, height: 1, background: 'var(--color-line-strong)' }} />
                  {dayItems.length > 0 && <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: 'var(--color-faint)' }}>{dayItems.length}</span>}
                </div>

                {dayItems.length === 0 ? (
                  <div style={{ paddingLeft: 35, fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 13, color: 'var(--color-faint)', opacity: 0.7, paddingBottom: 4 }}>open</div>
                ) : (
                  <div style={{ paddingLeft: 35, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {dayItems.map((it) => {
                      const isEvent = it.kind === 'event';
                      const accent = (isEvent ? it.accent || sourceColorOf(it.source) : accentOf(it)) || 'var(--color-muted)';
                      return (
                        <div
                          key={it.id}
                          className="jk-cards-row"
                          onClick={() => onSelect?.(it)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', cursor: 'pointer', borderRadius: 3, background: isEvent ? 'rgba(0,0,0,0.22)' : 'transparent', borderLeft: `2px solid ${accent}` }}
                        >
                          {!isEvent && <Checkbox id={it.id} completed={it.completed} onToggle={onToggle} color={accent} size={14} />}
                          {isEvent && <span style={{ width: 14, textAlign: 'center', fontSize: 9, color: accent }}>◇</span>}
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
            );
          })}
        </div>
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

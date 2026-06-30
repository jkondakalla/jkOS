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
  layoutBars,
  layoutTimedEvents,
  localDate,
  snapFrac,
  timeToFrac,
  weekStart,
} from './datetime';
import { WV_FIRST_H, WV_LAST_H, WV_ROW_H, WV_LABEL_W } from './constants';
import { TaskChip } from './TaskChip';
import { TimeBlock } from './TimeBlock';
import { AllDayBar } from './AllDayBar';
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
}: WeekViewProps) {
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

  const byDay = useMemo(() => {
    const out: Record<string, { untimed: CalendarItem[]; timed: CalendarItem[] }> = {};
    days.forEach((d) => (out[d] = { untimed: [], timed: [] }));
    items.forEach((it) => {
      if (it.kind !== 'task' && it.kind !== 'event') return;
      if (it.kind === 'event' && !it.scheduled_time) return;
      if (!it.due_date || !out[it.due_date]) return;
      if (it.scheduled_time) out[it.due_date].timed.push(it);
      else out[it.due_date].untimed.push(it);
    });
    return out;
  }, [items, days]);

  const alldayBars = useMemo(
    () => layoutBars(items.filter((it) => it.kind === 'event' && !it.scheduled_time), days),
    [items, days],
  );
  const alldayLanes = alldayBars.length > 0 ? Math.max(...alldayBars.map((b) => b.lane)) + 1 : 0;

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

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', background: 'transparent', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, padding: '24px 32px 0', display: 'flex', flexDirection: 'column', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
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

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--color-paper-2)',
              border: '1px solid var(--color-line)',
              boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.06), inset 0 -1px 0 rgba(255,255,255,0.18)',
              overflow: 'hidden',
            }}
          >
            {/* Day header */}
            <div style={{ display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`, borderBottom: '1px solid var(--color-line)', background: 'var(--color-paper)' }}>
              <div style={{ borderRight: '1px solid var(--color-line)' }} />
              {days.map((d, i) => {
                const dd = localDate(d);
                const isToday = d === today;
                return (
                  <div key={d} style={{ background: isToday ? 'var(--color-accent-soft)' : 'transparent', borderRight: i < 6 ? '1px solid var(--color-line)' : 'none', padding: '8px 12px 10px' }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: isToday ? 'var(--color-accent)' : 'var(--color-muted)', textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                      {dd.toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div style={{ fontFamily: FONT_NUM, fontSize: 22, marginTop: 2, color: isToday ? 'var(--color-accent)' : 'var(--color-ink)', fontStyle: isToday ? 'italic' : 'normal', fontWeight: isToday ? 500 : 400, letterSpacing: '-0.02em', textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                      {dd.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* All-day lane */}
            {(alldayLanes > 0 || (anyDrag && drag?.mode === 'allday')) && (
              <div style={{ display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px 1fr`, borderBottom: '1px solid var(--color-line)', background: 'var(--color-paper)', flexShrink: 0 }}>
                <div style={{ borderRight: '1px solid var(--color-line)', fontFamily: FONT_BODY, fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-faint)', padding: '5px 5px 0 0', textAlign: 'right' }}>
                  all‑day
                </div>
                <div style={{ position: 'relative', height: Math.max(alldayLanes, 1) * 22 + 8, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                    {days.map((d, i) => {
                      const isOver = drag?.overZone === 'allday' && drag?.overDay === d;
                      const isTarget = anyDrag && drag?.mode === 'allday';
                      return (
                        <div
                          key={d}
                          data-drop-zone="allday"
                          data-drop-day={d}
                          onClick={!anyDrag && !readonly ? () => setCreatePending({ startDay: d, allDay: true, scheduled_time: null, scheduled_end: null }) : undefined}
                          style={{
                            borderRight: i < 6 ? '1px solid var(--color-line)' : 'none',
                            background: isOver ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : d === today ? 'var(--color-accent-soft)' : 'transparent',
                            outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                            outlineOffset: -2,
                            cursor: anyDrag ? 'copy' : 'pointer',
                            transition: 'background 0.08s',
                          }}
                        />
                      );
                    })}
                  </div>
                  {alldayBars.map((bar) => (
                    <AllDayBar
                      key={bar.ev.id}
                      bar={bar}
                      color={sourceColorOf(bar.ev.source)}
                      top={bar.lane * 22 + 4}
                      height={18}
                      isSelected={selectedId === bar.ev.id}
                      isDragging={drag?.item?.id === bar.ev.id}
                      onPointerDown={hasDnd ? (e) => beginDragAllday(e, bar.ev) : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!drag) onSelect?.(bar.ev);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Untimed lane */}
            <div style={{ display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`, borderBottom: '1px solid var(--color-line)', background: 'var(--color-paper)', minHeight: 56 }}>
              <div style={{ borderRight: '1px solid var(--color-line)', fontFamily: FONT_BODY, fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-faint)', padding: '6px 6px 0 0', textAlign: 'right' }}>
                untimed
              </div>
              {days.map((d, i) => {
                const dayItems = byDay[d]?.untimed || [];
                const isOver = drag?.overZone === 'untimed' && drag?.overDay === d;
                const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed');
                return (
                  <div
                    key={d}
                    data-drop-zone="untimed"
                    data-drop-day={d}
                    style={{
                      borderRight: i < 6 ? '1px solid var(--color-line)' : 'none',
                      background: isOver ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : d === today ? 'var(--color-accent-soft)' : 'transparent',
                      outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                      outlineOffset: -2,
                      padding: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
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

            {/* Hour grid */}
            <div ref={scrollRef} data-hour-scroll style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `${WV_LABEL_W}px repeat(7, minmax(0, 1fr))`, height: totalH, position: 'relative' }}>
                <div style={{ position: 'relative', borderRight: '1px solid var(--color-line)', background: 'var(--color-paper)' }}>
                  {HOURS.map((h, i) => (
                    <div key={h} style={{ position: 'absolute', top: i * WV_ROW_H, left: 0, right: 0, height: WV_ROW_H, fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 10.5, color: 'var(--color-muted)', textAlign: 'right', padding: '3px 6px 0 0' }}>
                      {i === 0 ? '' : fmtHourLabel(h)}
                    </div>
                  ))}
                </div>

                {days.map((d, i) => {
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
                              if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset?.gridBg) return;
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const frac = snapFrac(WV_FIRST_H + (e.clientY - r.top) / WV_ROW_H);
                              beginCreate(e, d, frac);
                            }
                          : undefined
                      }
                      style={{
                        position: 'relative',
                        borderRight: i < 6 ? '1px solid var(--color-line)' : 'none',
                        background: isOver ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : isToday ? 'var(--color-accent-soft)' : isHover ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'var(--color-paper)',
                        outline: isTarget && !isToday ? '1px solid var(--color-accent-glow)' : 'none',
                        outlineOffset: -1,
                        cursor: anyDrag ? 'copy' : readonly || !hasDnd ? 'default' : 'crosshair',
                        transition: 'background 0.12s',
                      }}
                    >
                      {HOURS.map((h, idx) => (
                        <div key={h} data-grid-bg style={{ position: 'absolute', left: 0, right: 0, top: idx * WV_ROW_H, height: WV_ROW_H, borderBottom: idx < HOURS.length - 1 ? '1px solid var(--color-line-strong)' : 'none', pointerEvents: 'none' }}>
                          <div data-grid-bg style={{ position: 'absolute', left: 0, right: 0, top: WV_ROW_H / 2, borderTop: '1px dotted var(--color-line-strong)', opacity: 0.4 }} />
                        </div>
                      ))}

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
                        <div style={{ position: 'absolute', top: (nowFrac - WV_FIRST_H) * WV_ROW_H, left: 0, right: 0, height: 1, background: 'var(--color-accent)', zIndex: 12, pointerEvents: 'none', boxShadow: 'var(--accent-halo)' }}>
                          <span className="now-dot" style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: 'var(--accent-halo)' }} />
                          <span style={{ position: 'absolute', right: 6, top: -8, fontFamily: FONT_BODY, fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--color-accent)', background: 'var(--color-paper)', padding: '1px 5px', textShadow: 'var(--accent-halo-text)', border: '1px solid var(--color-accent)' }}>
                            ● rec
                          </span>
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
              onAddItem?.({ kind: 'event', scope: 'day', source: 'bb', due_date: createPending.startDay, title });
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
    <div className="bb-scroll" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
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
                          className="bb-row"
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

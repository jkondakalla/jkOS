/**
 * WeekView — the week tab: an interactive time grid (drag to schedule/move/
 * resize, all-day lane, untimed lane, click-to-create) when a DragAdapter is
 * given; read+light (select/toggle) when not. `density="compact"` is the small
 * mount (ORDECK's bb-week widget); the framing survives, only the air shrinks.
 *
 * ONE BODY AT EVERY WIDTH. This used to branch on `useBreakpoint()` and render
 * a separate phone agenda, which meant a narrow WINDOW silently swapped in
 * un-migrated v0 chrome — in ORDECK's widget and in the design system's own
 * previews as much as on a phone. That body now lives with the app that wants
 * it (apps/beigeboard/src/mobile/views/MobileWeekAgenda.tsx), and picking it is
 * the app's call, not this component's.
 *
 * Drag and accent/source colour are injected so the same component serves
 * BeigeBoard and ORDECK.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarItem, DragAdapter, WeekViewProps } from './types';
import { mergeResolvers, FONT_HEAD } from './theme';
import {
  addDays,
  fmtHourLabel,
  fracToTime,
  layoutTimedEvents,
  localDate,
  snapFrac,
  timeToFrac,
  weekStart,
  isoWeekNo,
} from './datetime';
import { WV_FIRST_H, WV_LAST_H, rowHeight, labelW, gridRules, gridHeight } from './constants';
import { TaskChip } from './TaskChip';
import { TimeBlock } from './TimeBlock';
import { TimelinePreview } from './TimelinePreview';
import { CreateDialog } from './CreateDialog';
import { ChromeBar, HourLabel, NowLine } from './primitives';
import { useScrollGutter } from './useScrollGutter';
import { TButton, EmptyState } from '@jkos/ui';
import { MO_DELAYS } from '@jkos/design';

export function WeekView({
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
  foot,
  density = 'comfortable',
}: WeekViewProps) {
  const compact = density === 'compact';
  // Framing metrics — the lane framing is preserved at both densities; only the
  // air (inter-lane gap + padding) shrinks so the day-separation survives in the
  // small ORDECK widget without forking the layout.
  const GAP = compact ? 5 : 11;
  const PAD_X = compact ? 12 : 28;
  // Geometry rides the density axis — see constants.ts. Never a bare constant:
  // a 60px row in ORDECK's compact HUD would grow every widget by 20%.
  const ROW_H = rowHeight(density);
  const LABEL_W = labelW(density);
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

  /** Everything actually placed on a day this week — the chrome bar's stat. */
  const scheduledCount = useMemo(
    () => days.reduce((n, d) => {
      const b = byDay[d];
      return n + (b ? b.timed.length + b.untimed.length + b.allday.length : 0);
    }, 0),
    [days, byDay],
  );

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
      scrollRef.current.scrollTop = (target - WV_FIRST_H) * ROW_H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  // The hour grid scrolls, the three header bands above it don't — but all four
  // are grids on ONE column template, so the scrollbar's width has to come out
  // of the headers too or the columns drift apart (see useScrollGutter).
  const gutter = useScrollGutter(scrollRef);

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
  const totalH = gridHeight(density);

  // The seven day lanes are framed, gapped columns; the header rounds its top,
  // the timed body rounds its bottom, and the (optional) all-day + untimed bands
  // between them carry only side borders — so a column's bands stack flush into
  // ONE bordered unit with real air between neighbours (the day-separation that
  // replaces the old monolithic hairline grid). Today's whole lane is a tinted
  // well. `pos` places a band in the column stack.
  const cols = `${LABEL_W}px repeat(7, minmax(0, 1fr))`;
  // Every non-scrolling band shares this: the same column template as the hour
  // grid, minus the scrollbar gutter the grid loses, so the eight columns land
  // in exactly the same places top to bottom.
  const headBand: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: cols, columnGap: GAP,
    flexShrink: 0, paddingRight: gutter,
  };
  const rad = 'var(--hub-radius-sm)';
  // NEVER the `background` shorthand here. The timed lane paints its hour rules
  // with `backgroundImage`, and the shorthand resets background-image to none —
  // React's style diff only re-writes the keys that CHANGED, so a hover that
  // flips `background` wipes the gridlines and never puts them back. Every lane
  // state below sets backgroundCOLOR so the two layers stay independent.
  // TODAY'S LANE IS LIT, NOT WASHED.
  //
  // It used to be the faint-CHIP recipe — 14% tint over --hub-bg-2 — which is a
  // mid-tone, and that failed twice over. Against its neighbours (--color-paper)
  // it was a barely-there shift in hue at nearly equal lightness, so the lane
  // didn't read as marked; and against --hub-line it was nearly equal lightness
  // too, so the hour rules inside it disappeared. A wash that is too weak to see
  // and strong enough to erase the ledger is the worst of both.
  //
  // The fix is to mark today by LIGHT rather than by pigment: a 5% tint over
  // --hub-bg-4, the brightest stock in the palette, so today's lane is a visibly
  // cleaner sheet than the six around it while carrying only a trace of accent
  // warmth. The tint is kept deliberately thin — every extra percent pulls the
  // lane back toward its neighbours' value and spends the contrast this is for,
  // and today's accent IDENTITY is already carried three other ways (the pressed
  // day number, the accent weekday eyebrow, the now-line). The lane's only job is
  // to be the lit column. Lightness now differs (the thing the eye actually
  // finds), and because
  // the lane got LIGHTER the rules gain contrast instead of losing it — they then
  // step up a weight anyway (tone: 'strong', below) so the marked lane is the
  // best-ruled one, not the worst. The frame follows in --color-line-strong: a
  // second, structural cue that survives at any tint and in either face.
  //
  // Mode-correct by token, not by branch: in dark, --hub-bg-4 (#38321f) is
  // likewise the brightest stock and --hub-line-strong the heavier rule, so "lit"
  // and "better-ruled" mean the same thing on the tube as on paper.
  const laneFrame = (pos: 'head' | 'mid' | 'foot', isToday: boolean): React.CSSProperties => ({
    border: `1px solid ${isToday ? 'var(--color-line-strong)' : 'var(--color-line)'}`,
    borderTop: pos === 'head' ? undefined : 'none',
    borderTopLeftRadius: pos === 'head' ? rad : 0,
    borderTopRightRadius: pos === 'head' ? rad : 0,
    borderBottomLeftRadius: pos === 'foot' ? rad : 0,
    borderBottomRightRadius: pos === 'foot' ? rad : 0,
    backgroundColor: isToday
      ? 'color-mix(in srgb, var(--jk-tint, var(--accent)) 5%, var(--hub-bg-4))'
      : 'var(--color-paper)',
    minWidth: 0,
  });

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', background: 'transparent', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Fills its container — the page's .jk-canvas owns the measure. (Was a
            self-imposed maxWidth: 1280; see the note in DayView.) */}
        <div style={{ flex: 1, minHeight: 0, padding: compact ? `10px ${PAD_X}px 0` : `14px ${PAD_X}px 0`, display: 'flex', flexDirection: 'column', width: '100%' }}>
          {/* The chrome bar. The old 30px serif <h1> cost ~40px of timeline for
              no information the stat line doesn't carry better. */}
          {!compact && (
            <ChromeBar
              className="mo-item"
              style={{ margin: `0 -${PAD_X}px`, animationDelay: `${MO_DELAYS.header}ms` }}
              title={weekRange}
              stats={`7 DAYS · ${String(scheduledCount).padStart(2, '0')} SCHEDULED · ${String(benched.length).padStart(2, '0')} ON THE BENCH`}
              nav={
                <>
                  <TButton quiet onClick={() => setCursor(addDays(cursor, -7))}>← W{isoWeekNo(addDays(cursor, -7))}</TButton>
                  <TButton onClick={() => setCursor(weekStart(today))}>This week</TButton>
                  <TButton quiet onClick={() => setCursor(addDays(cursor, 7))}>W{isoWeekNo(addDays(cursor, 7))} →</TButton>
                </>
              }
            />
          )}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* This week's bench — a full-width strip ABOVE the framed lanes (opt-in) */}
            {benchLane && (() => {
              const isOver = drag?.overZone === 'bench';
              const isTarget = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed');
              return (
                <div
                  data-drop-zone="bench"
                  className={compact ? undefined : 'mo-item'}
                  style={{
                    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: compact ? '6px 6px' : '10px 28px',
                    margin: compact ? '0 0 4px' : `0 -${PAD_X}px 4px`,
                    borderBottom: compact ? undefined : '1px solid var(--hub-line)',
                    animationDelay: `${MO_DELAYS.weekBench}ms`,
                    background: isOver
                      ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                      : compact ? 'transparent' : 'color-mix(in srgb, var(--hub-bg-1) 30%, transparent)',
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
            <div className={compact ? undefined : 'mo-item'} style={{ ...headBand, animationDelay: `${MO_DELAYS.weekDayHeads}ms` }}>
              <div />
              {days.map((d) => {
                const dd = localDate(d);
                const isToday = d === today;
                return (
                  <div key={d} style={{ ...laneFrame('head', isToday), display: 'flex', alignItems: 'baseline', gap: 6, padding: compact ? '5px 7px 4px' : '9px 11px 7px' }}>
                    {/* The weekday is machine annotation (mono); the date is
                        content (print). Today's number stays in INK — the tinted
                        lane well plus the press carry the state, so the number
                        doesn't have to shout it a third time. */}
                    <span className="mono-eyebrow" style={{ fontSize: 8, color: isToday ? 'var(--color-accent)' : undefined }}>
                      {dd.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span
                      className={isToday ? 'jk-press' : undefined}
                      style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: compact ? 15 : 20, marginLeft: 'auto', letterSpacing: '-0.02em' }}
                    >
                      {dd.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* ── All-day band — one chip per covered day (framed sides) ── */}
            {(anyAllday || (anyDrag && drag?.mode === 'allday')) && (
              <div style={headBand}>
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
                        ...(isOver ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : null),
                        outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                        outlineOffset: -2,
                        minHeight: 24, padding: 4, display: 'flex', flexDirection: 'column', gap: 3,
                        cursor: anyDrag ? 'copy' : readonly ? 'default' : 'pointer', transition: 'background-color 0.08s',
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
            <div style={headBand}>
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
                      ...(isOver ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : null),
                      outline: isOver ? '1px dashed var(--color-accent)' : isTarget ? '1px dashed var(--color-accent-glow)' : 'none',
                      outlineOffset: -2,
                      minHeight: compact ? 30 : 44, padding: 4, display: 'flex', flexDirection: 'column', gap: 3,
                      transition: 'background-color 0.08s',
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
            <div
              ref={scrollRef}
              data-hour-scroll
              className={compact ? undefined : 'mo-item'}
              style={{
                flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative',
                // Reserve the gutter even when the grid happens to fit, so the
                // measured header padding above can't blink on and off.
                scrollbarGutter: 'stable',
                animationDelay: `${MO_DELAYS.weekGrid}ms`,
              }}
            >
              {/* A clean week still draws its grid — the empty state floats over
                  it rather than replacing it, so drag-to-create keeps working. */}
              {!compact && scheduledCount === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 3 }}>
                  <EmptyState line="A clean week. Nothing set in type yet." sub="DROP FROM THE BENCH TO SCHEDULE" />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: GAP, height: totalH, position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  {HOURS.map((h, i) => (
                    <div key={h} style={{ position: 'absolute', top: i * ROW_H, left: 0, right: 0, height: ROW_H, textAlign: 'right', padding: '2px 8px 0 0' }}>
                      <HourLabel>{i === 0 ? '' : fmtHourLabel(h)}</HourLabel>
                    </div>
                  ))}
                  {days.includes(today) && nowFrac >= WV_FIRST_H && nowFrac <= WV_LAST_H + 1 && (
                    <div style={{ position: 'absolute', top: (nowFrac - WV_FIRST_H) * ROW_H, right: 6, transform: 'translateY(-50%)' }}>
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
                      data-frac-scale={ROW_H}
                      onMouseEnter={() => setHoverCol(d)}
                      onMouseLeave={() => setHoverCol((c) => (c === d ? null : c))}
                      onPointerDown={
                        hasDnd
                          ? (e) => {
                              if (e.target !== e.currentTarget) return;
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const frac = snapFrac(WV_FIRST_H + (e.clientY - r.top) / ROW_H);
                              beginCreate(e, d, frac);
                            }
                          : undefined
                      }
                      style={{
                        ...laneFrame('foot', isToday),
                        ...(isOver
                          ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }
                          : isHover
                            // Hover mixes into the lane's OWN stock, so hovering
                            // today doesn't knock it back down to paper and undo
                            // the lit state that marks it.
                            ? { backgroundColor: `color-mix(in srgb, var(--color-accent) 6%, ${isToday ? 'var(--hub-bg-4)' : 'var(--color-paper)'})` }
                            : null),
                        // per-lane hour gridlines — a SEPARATE layer from the lane
                        // colour above (see laneFrame: no `background` shorthand).
                        // Today's lane takes the heavier rule: it is the lane that
                        // gets read, and its lighter fill has the headroom for it
                        // (see the laneFrame note on marking today by light).
                        backgroundImage: gridRules(density, { tone: isToday ? 'strong' : 'default' }),
                        position: 'relative',
                        outline: isTarget && !isToday ? '1px solid var(--color-accent-glow)' : 'none',
                        outlineOffset: -1,
                        cursor: anyDrag ? 'copy' : readonly || !hasDnd ? 'default' : 'crosshair',
                        transition: 'background-color 0.12s',
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
                            density={density}
                            surface="week"
                            now={now}
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

                      {showPreview && drag && <TimelinePreview drag={drag} sourceColorOf={sourceColorOf} density={density} />}

                      {isToday && nowFrac >= WV_FIRST_H && nowFrac <= WV_LAST_H + 1 && (
                        <div style={{ position: 'absolute', top: (nowFrac - WV_FIRST_H) * ROW_H, left: 0, right: 0, height: 0, zIndex: 12, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
                          {/* No label in Week — naming the live event is a Today
                              affordance; seven lanes have no room for it. */}
                          <NowLine dot={8} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* The page's foot — the bottom anchor of the canvas (hub.css).
                Never in a HUD widget: `compact` has no room to spend on it. */}
            {!compact && foot && <div className="jk-canvas-foot">{foot}</div>}
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

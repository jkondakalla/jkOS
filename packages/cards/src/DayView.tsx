/**
 * DayView — the single-day calendar body, in two modes.
 *
 *   • grid   → the Week time grid reduced to ONE column: all-day lane, untimed
 *              lane, and the hour grid, with the same data-drop-zone / data-frac-*
 *              drag contract and WV_* geometry. Drag arms from the originating
 *              pointer event (new contract) so touch hold-to-drag works for free
 *              via CalendarDragProvider — usable on mobile, not just an agenda.
 *   • agenda → the briefing layout (Next hero / Carried / Adrift / After that /
 *              Done), rendered from the section model (deriveDaySections) + injected
 *              PlanResolvers. This is the factory recreation of BeigeBoard's Today.
 *
 * Headless: like the other views it owns an internal date cursor + a light nav row;
 * it adds no app chrome and pulls no app imports (resolvers are injected).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarItem, DragAdapter, DayViewProps } from './types';
import { withAlpha } from '@jkos/design';
import { mergeResolvers, mergePlanResolvers, FONT_HEAD, FONT_BODY, FONT_NUM } from './theme';
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
  chipState,
  dayOfYear,
} from './datetime';
import { WV_FIRST_H, WV_LAST_H, rowHeight, labelW, gridRules, gridHeight } from './constants';
import { TaskChip } from './TaskChip';
import { TimeBlock } from './TimeBlock';
import { AllDayBar } from './AllDayBar';
import { TimelinePreview } from './TimelinePreview';
import { CreateDialog, type CreatePending } from './CreateDialog';
import { Checkbox, Eyebrow, RecLamp, HourLabel, NowLine } from './primitives';
import { useScrollGutter } from './useScrollGutter';
import { Press, TButton, Well } from '@jkos/ui';
import { MO_DELAYS } from '@jkos/design';
import { deriveDaySections } from './sections';

export function DayView(props: DayViewProps) {
  if (props.mode === 'agenda') return <DayAgenda {...props} />;
  return <DayGrid {...props} />;
}

function dayLabel(iso: string) {
  return localDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ── Single-day interactive time grid ──────────────────────────────────── */

function DayGrid({
  items,
  today,
  date,
  selectedId,
  readonly,
  resolvers,
  drag: adapter,
  onSelect,
  onToggle,
  onAddItem,
  onUpdateItem,
  createSource,
  foot,
  density = 'comfortable',
}: DayViewProps) {
  const { accentOf, sourceColorOf } = mergeResolvers(resolvers);
  // Geometry rides the density axis — see constants.ts.
  const ROW_H = rowHeight(density);
  const LABEL_W = labelW(density);
  const drag = adapter?.drag ?? null;
  const beginDrag: DragAdapter['beginDrag'] = adapter?.beginDrag ?? (() => {});
  const hasDnd = !!adapter;

  const [cursor, setCursor] = useState(() => date || today);
  useEffect(() => {
    if (date) setCursor(date);
  }, [date]);

  const day = cursor;

  const { untimed, timed } = useMemo(() => {
    const out = { untimed: [] as CalendarItem[], timed: [] as CalendarItem[] };
    items.forEach((it) => {
      if (it.kind !== 'task' && it.kind !== 'event') return;
      if (it.kind === 'event' && !it.scheduled_time) return;
      if (it.due_date !== day) return;
      if (it.scheduled_time) out.timed.push(it);
      else out.untimed.push(it);
    });
    return out;
  }, [items, day]);

  const alldayBars = useMemo(
    () => layoutBars(items.filter((it) => it.kind === 'event' && !it.scheduled_time), [day]),
    [items, day],
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
    if (!scrollRef.current) return;
    // Open the timeline where the day IS. Landing on 06:00 every morning is the
    // most-noticed daily papercut: on today, show the hour before now; on any
    // other day, show the half-hour before its first event (and fall back to 08:00
    // for an empty day, which is the old behaviour and still the right one).
    const firstEvent = timed.reduce<number | null>((min, it) => {
      const f = timeToFrac(it.scheduled_time as string);
      return min == null || f < min ? f : min;
    }, null);
    // Note: NOT max(now-60, firstEvent-30) across both terms — on today with a
    // 20:00 first event that would scroll to the evening and hide the current
    // hour. The first-event anchor is for days that have no "now".
    const target = day === today
      ? nowFrac - 1
      : firstEvent != null ? firstEvent - 0.5 : 8;
    scrollRef.current.scrollTop = Math.max(0, (target - WV_FIRST_H) * ROW_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  // The all-day/untimed lanes don't scroll; the hour grid does. Same column
  // template, so the scrollbar's width has to come out of the lanes above too or
  // the label rule sits 8px off the grid's (see useScrollGutter).
  const gutter = useScrollGutter(scrollRef);
  const laneBand: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: `${LABEL_W}px 1fr`,
    borderBottom: '1px solid var(--color-line)',
    background: 'var(--color-paper)', paddingRight: gutter,
  };

  const [createPending, setCreatePending] = useState<CreatePending | null>(null);

  const beginDragUntimed = (e: React.PointerEvent, item: CalendarItem) => {
    e.preventDefault();
    beginDrag(e, item, 'untimed', ({ overFrac, overZone }) => {
      if (overZone === 'timed' && overFrac != null) {
        onUpdateItem?.(item.id, {
          scheduled_time: fracToTime(overFrac),
          scheduled_end: fracToTime(overFrac + 1),
        });
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
      ({ overFrac, overZone }) => {
        if (overZone === 'timed' && overFrac != null) {
          onUpdateItem?.(item.id, {
            scheduled_time: fracToTime(overFrac),
            scheduled_end: fracToTime(overFrac + dur),
          });
        } else if (overZone === 'untimed') {
          onUpdateItem?.(item.id, { scheduled_time: null, scheduled_end: null });
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

  const beginCreate = (e: React.PointerEvent, hourFrac: number) => {
    if (readonly) return;
    e.preventDefault();
    beginDrag(
      e,
      null,
      'create',
      ({ overFrac }) => {
        const a = hourFrac;
        const b = overFrac ?? hourFrac;
        const start = Math.min(a, b);
        const end = Math.max(a + 0.5, b);
        setCreatePending({ startDay: day, scheduled_time: fracToTime(start), scheduled_end: fracToTime(end) });
      },
      { startFrac: hourFrac, startDay: day },
    );
  };

  const anyDrag = !!drag;
  const isToday = day === today;

  // The now-line label names the LIVE event and counts down. A static "NOW" is
  // worse than none — it takes the same space and says nothing the dot doesn't —
  // so with nothing running the label is omitted rather than faked.
  const nowLabel = useMemo(() => {
    if (!isToday) return undefined;
    const live = timed.find((it) => chipState(it, now) === 'live');
    if (!live) return undefined;
    const endFrac = live.scheduled_end
      ? timeToFrac(live.scheduled_end)
      : timeToFrac(live.scheduled_time as string) + 1;
    const mins = Math.max(0, Math.round((endFrac - nowFrac) * 60));
    return `NOW · ${live.title.toUpperCase()} · ${mins} MIN LEFT`;
  }, [isToday, timed, now, nowFrac]);
  const HOURS = Array.from({ length: WV_LAST_H - WV_FIRST_H + 1 }, (_, i) => i + WV_FIRST_H);
  const totalH = gridHeight(density);
  const isOverTimed = drag?.overZone === 'timed';
  const isTargetTimed = anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed' || drag?.mode === 'create');
  const showPreview = isOverTimed && drag?.overFrac != null;
  const timedLayout = layoutTimedEvents(timed);

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', background: 'transparent', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* No maxWidth here. The kit view FILLS what it is handed — the page's
            .jk-canvas owns the measure (hub.css --jk-canvas). This used to cap
            itself at 760 and centre, which meant that inside BeigeBoard's Today
            it centred within its own pane while the rail beside it stayed pinned
            to the window edge: two independent centrings, ~700px of dead paper
            between them. Same reason the widget case works — dropped into an
            ORDECK card it fills the card. */}
        <div style={{ flex: 1, minHeight: 0, padding: '14px 28px 12px', display: 'flex', flexDirection: 'column', width: '100%' }}>
          {/* The masthead. The full stop is deliberate — it is the prototype's
              voice: a day is a statement, not a heading. */}
          <div className="mo-item" style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10, animationDelay: `${MO_DELAYS.header}ms` }}>
            <Press large style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: '2rem', lineHeight: 1, letterSpacing: '-0.025em', whiteSpace: 'nowrap' }}>
              {dayLabel(day)}.
            </Press>
            <span className="mono-eyebrow">
              {`DAY ${String(dayOfYear(day)).padStart(2, '0')} · ${String(timed.length + untimed.length).padStart(2, '0')} EVENTS · ${String(untimed.length).padStart(2, '0')} UNTIMED`}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
              <TButton quiet onClick={() => setCursor((c) => addDays(c, -1))}>← Prev</TButton>
              <TButton onClick={() => setCursor(today)}>Today</TButton>
              <TButton quiet onClick={() => setCursor((c) => addDays(c, 1))}>Next →</TButton>
            </span>
          </div>
          <hr className="jk-rule-strong mo-item" style={{ margin: '0 0 12px', animationDelay: `${MO_DELAYS.todayRule}ms` }} />

          {/* NO frame. Today runs masthead → rule → bare sheet: the timeline is
              drawn ON the page, not inside a panel. The framed paper-2 box this
              used to be came straight from Week, where an edge is what makes seven
              lanes read as seven OF something — one column has nothing to be one
              of, so the frame only boxed the day in and broke the run of the page
              (this is the "stylistically different" tell vs the reference Today). */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* All-day lane */}
            {(alldayLanes > 0 || (anyDrag && drag?.mode === 'allday')) && (
              <div style={{ ...laneBand, flexShrink: 0 }}>
                <div className="mono-eyebrow" style={{ borderRight: '1px solid var(--color-line)', fontSize: 7, padding: '5px 5px 0 0', textAlign: 'right' }}>
                  ALL-DAY
                </div>
                {/* No isToday wash here either — one always-today column. */}
                <div data-drop-zone="allday" data-drop-day={day} style={{ position: 'relative', height: Math.max(alldayLanes, 1) * 22 + 8, overflow: 'hidden', background: 'transparent' }}>
                  {alldayBars.map((bar) => (
                    <AllDayBar
                      key={bar.ev.id}
                      bar={bar}
                      color={sourceColorOf(bar.ev.source)}
                      top={bar.lane * 22 + 4}
                      height={18}
                      isSelected={selectedId === bar.ev.id}
                      isDragging={drag?.item?.id === bar.ev.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!drag) onSelect?.(bar.ev);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Untimed lane — CONDITIONAL, like the all-day lane above it. It used
                to render unconditionally at minHeight 44, so an empty day always
                wore an "UNTIMED" band that the reference Today has nowhere (the
                bench in the right rail is where unscheduled work lives). It still
                appears the moment it has contents OR a drag could land in it, so
                dragging a timed block out to unschedule it keeps a target. */}
            {(untimed.length > 0 || (anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed'))) && (
            <div style={{ ...laneBand, minHeight: 44 }}>
              <div className="mono-eyebrow" style={{ borderRight: '1px solid var(--color-line)', fontSize: 7, padding: '6px 6px 0 0', textAlign: 'right' }}>
                UNTIMED
              </div>
              <div
                data-drop-zone="untimed"
                data-drop-day={day}
                style={{
                  // No isToday wash: same reason as the hour grid below — the one
                  // column is always today, so tinting it distinguishes nothing.
                  background: drag?.overZone === 'untimed' ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
                  outline: drag?.overZone === 'untimed' ? '1px dashed var(--color-accent)' : anyDrag && (drag?.mode === 'untimed' || drag?.mode === 'timed') ? '1px dashed var(--color-accent-glow)' : 'none',
                  outlineOffset: -2,
                  padding: 6,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  transition: 'background 0.08s',
                }}
              >
                {untimed.map((it) => (
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
            </div>
            )}

            {/* Hour grid */}
            <div
              ref={scrollRef}
              data-hour-scroll
              className="mo-item"
              style={{
                flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative',
                // Always reserve the gutter, so the measured lane padding above
                // can't blink on and off as the grid crosses the overflow line.
                scrollbarGutter: 'stable',
                animationDelay: `${MO_DELAYS.todayGrid}ms`,
              }}
            >
              {/* An empty day says so by being empty — see WeekView. No placard. */}
              <div style={{ display: 'grid', gridTemplateColumns: `${LABEL_W}px 1fr`, height: totalH, position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  {HOURS.map((h, i) => (
                    <div key={h} style={{ position: 'absolute', top: i * ROW_H, left: 0, right: 0, height: ROW_H, textAlign: 'right', padding: '2px 8px 0 0' }}>
                      <HourLabel>{i === 0 ? '' : fmtHourLabel(h)}</HourLabel>
                    </div>
                  ))}
                  {isToday && nowFrac >= WV_FIRST_H && nowFrac <= WV_LAST_H + 1 && (
                    <div style={{ position: 'absolute', top: (nowFrac - WV_FIRST_H) * ROW_H, right: 6, transform: 'translateY(-50%)' }}>
                      <span className="seg" style={{ fontSize: 10, color: 'var(--color-accent)' }}>
                        {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>

                <div
                  data-drop-zone="timed"
                  data-drop-day={day}
                  data-frac-base={WV_FIRST_H}
                  data-frac-scale={ROW_H}
                  onPointerDown={
                    hasDnd
                      ? (e) => {
                          if (e.target !== e.currentTarget) return;
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const frac = snapFrac(WV_FIRST_H + (e.clientY - r.top) / ROW_H);
                          beginCreate(e, frac);
                        }
                      : undefined
                  }
                  style={{
                    position: 'relative',
                    // Bare paper + hour rules, no border and no tint — see the note
                    // on the frame above. The `isToday` wash that used to live here
                    // was WeekView's laneFrame() recipe, which is itself the FAINT
                    // CHIP background (14% tint over --hub-bg-2). In Week that says
                    // which of seven lanes is today; here the single column is
                    // always today, so it painted the entire timeline as one giant
                    // chip — and every solid chip then sat on a chip-coloured
                    // field, which is why the day read as flat olive boxes.
                    // backgroundCOLOR, never the shorthand: the hour rules below
                    // are a separate background-image layer, and the shorthand
                    // resets it to none — which React's key-wise style diff would
                    // then never repaint. (Same trap fixed in WeekView's lanes.)
                    backgroundColor: isOverTimed
                      ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                      : 'transparent',
                    // tone 'strong' — the Day timeline is drawn directly on the
                    // grained ground with no lane fill under it, and --hub-line
                    // over grain is the faintest pairing in the app: the hour
                    // ledger was legible in theory and invisible in practice. This
                    // is also the ONE timeline on screen, a close-read surface that
                    // earns the heavier rule where seven competing lanes would not.
                    backgroundImage: gridRules(density, { halfHour: true, tone: 'strong' }),
                    // No `&& !isToday` guard any more: that existed because the
                    // today wash already marked the column. With no wash, the drag
                    // target has to be able to show itself on today too.
                    outline: isTargetTimed ? '1px solid var(--color-accent-glow)' : 'none',
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
                        surface="day"
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
                      <NowLine dot={10} label={nowLabel} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* The page's foot — the bottom anchor of the canvas (hub.css).
              Outside the timeline's frame: it ends the SHEET, not the grid. */}
          {density !== 'compact' && foot && <div className="jk-canvas-foot">{foot}</div>}
        </div>
      </div>

      {createPending && (
        <CreateDialog
          pending={createPending}
          onSubmit={(title: string) => {
            onAddItem?.({
              kind: 'task',
              scope: 'day',
              // `createSource` was declared on the props (types.ts) and passed by
              // every host, but this view silently dropped it — so an item drawn
              // on the day grid came back with no source while the SAME gesture
              // in Week stamped one (WeekView honours it). Untracked source then
              // fell through the tint chain to a neutral.
              ...(createSource ? { source: createSource } : {}),
              due_date: createPending.startDay,
              scheduled_time: createPending.scheduled_time,
              scheduled_end: createPending.scheduled_end,
              title,
            });
            setCreatePending(null);
          }}
          onCancel={() => setCreatePending(null)}
        />
      )}
    </>
  );
}

/* ── Agenda / briefing (the factory recreation of Today) ───────────────── */

function DayAgenda({
  items,
  today,
  date,
  resolvers,
  plan,
  greeting,
  readonly,
  onSelect,
  onToggle,
  onAddItem,
  onUpdateItem,
  onOpenWeek,
  onOpenWorkshop,
  onFocusGoal,
}: DayViewProps) {
  const day = date || today;
  const { accentOf } = mergeResolvers(resolvers);
  const { ancestorsOf, nextUnscheduled } = mergePlanResolvers(plan);
  const sections = useMemo(() => deriveDaySections(items, day, plan), [items, day, plan]);
  const { next, rest, carried, adrift, done, isEmpty } = sections;

  const dateStr = localDate(day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const accentFor = (it: CalendarItem) => accentOf(it) || 'var(--color-muted)';

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'transparent' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 36px 80px' }}>
        <div style={{ marginBottom: 36 }}>
          <Eyebrow style={{ marginBottom: 6 }}>{dateStr}</Eyebrow>
          {greeting && (
            <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 32, lineHeight: 1, margin: 0, letterSpacing: '-0.025em', color: 'var(--color-ink)', textShadow: 'var(--accent-halo-text)' }}>
              {greeting}
            </h1>
          )}
        </div>

        {next ? (
          <NextCard item={next} items={items} accentOf={accentOf} ancestorsOf={ancestorsOf} onSelect={onSelect} onToggle={onToggle} />
        ) : isEmpty ? (
          <EmptyDay onAdd={readonly ? undefined : onAddItem} today={day} />
        ) : (
          <ClearedDay onOpenWeek={onOpenWeek} />
        )}

        {carried.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <Eyebrow color="var(--color-accent)" style={{ textShadow: 'var(--accent-halo-text)' }}>
                Carried · {carried.length}
              </Eyebrow>
              <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-faint)' }}>
                slipped past their day — decide, don't drift
              </span>
            </div>
            <CarriedStrip tasks={carried} items={items} today={today} accentOf={accentOf} ancestorsOf={ancestorsOf} onSelect={onSelect} onToggle={onToggle} onUpdateItem={onUpdateItem} readonly={readonly} />
          </section>
        )}

        {adrift.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <Eyebrow>Adrift · {adrift.length}</Eyebrow>
              <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-faint)' }}>
                goals with nothing on the calendar
              </span>
            </div>
            <AdriftStrip goals={adrift} items={items} today={today} nextUnscheduled={nextUnscheduled} onUpdateItem={onUpdateItem} onFocusGoal={onFocusGoal} readonly={readonly} />
          </section>
        )}

        {rest.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <Eyebrow>After that · {rest.length} more</Eyebrow>
              {onOpenWeek && <button onClick={onOpenWeek} style={tinyLink}>the week →</button>}
            </div>
            <Strip tasks={rest} items={items} accentOf={accentFor} ancestorsOf={ancestorsOf} onSelect={onSelect} onToggle={onToggle} />
          </section>
        )}

        {done.length > 0 && (
          <details style={{ marginTop: 36, opacity: 0.7 }}>
            <summary style={{ fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--color-muted)', cursor: 'pointer', padding: '4px 0' }}>
              {done.length} done today
            </summary>
            <div style={{ marginTop: 10 }}>
              <Strip tasks={done} items={items} accentOf={accentFor} ancestorsOf={ancestorsOf} onSelect={onSelect} onToggle={onToggle} muted />
            </div>
          </details>
        )}

        {(onOpenWeek || onOpenWorkshop) && (
          <footer style={{ marginTop: 56, paddingTop: 18, borderTop: '1px solid var(--color-line-strong)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            {onOpenWeek && <button onClick={onOpenWeek} style={tinyLink}>open the week →</button>}
            {onOpenWorkshop && <button onClick={onOpenWorkshop} style={tinyLink}>open the workshop →</button>}
          </footer>
        )}
      </div>
    </div>
  );
}

type AccentOf = (item: CalendarItem) => string | null;
type AncestorsOf = (item: CalendarItem, items: CalendarItem[]) => CalendarItem[];

function NextCard({
  item,
  items,
  accentOf,
  ancestorsOf,
  onSelect,
  onToggle,
}: {
  item: CalendarItem;
  items: CalendarItem[];
  accentOf: AccentOf;
  ancestorsOf: AncestorsOf;
  onSelect?: (item: CalendarItem) => void;
  onToggle?: (id: number, completed: boolean) => void;
}) {
  const accent = accentOf(item) || 'var(--color-accent)';
  const ancestors = ancestorsOf(item, items);

  return (
    <div style={{ position: 'relative', background: 'var(--color-paper-2)', border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-lg)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.18)', padding: '28px 32px 30px 44px', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: accent, borderTopLeftRadius: 'var(--hub-radius-lg)', borderBottomLeftRadius: 'var(--hub-radius-lg)', boxShadow: `0 0 14px ${withAlpha(accent, 0.4)}` }} />
      <article onClick={() => onSelect?.(item)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 14 }}>
          <RecLamp size={7} label="Next" />
          {item.scheduled_time && (
            <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 14, color: accent, textShadow: `0 0 10px ${withAlpha(accent, 0.6)}`, letterSpacing: '0.04em' }}>
              {fmtTime(item.scheduled_time)}
              {item.scheduled_end ? ` – ${fmtTime(item.scheduled_end)}` : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
          <Checkbox id={item.id} completed={item.completed} onToggle={onToggle} color={accent} size={20} />
          <h2 style={{ flex: 1, fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 36, margin: 0, lineHeight: 1.1, letterSpacing: '-0.025em', color: 'var(--color-ink)', textDecoration: item.completed ? 'line-through' : 'none', textShadow: `0 0 24px ${withAlpha(accent, 0.133)}` }}>
            {item.title}
          </h2>
        </div>

        {ancestors.length > 0 && (
          <div style={{ marginTop: 18, paddingLeft: 38, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 5, height: 5, background: accent, boxShadow: `0 0 6px ${withAlpha(accent, 0.8)}` }} />
            <span style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 14, color: 'var(--color-muted)', lineHeight: 1.3 }}>
              {ancestors.slice().reverse().map((a) => a.title).join('  ›  ')}
            </span>
          </div>
        )}
      </article>
    </div>
  );
}

function EmptyDay({ onAdd, today }: { onAdd?: (partial: Partial<CalendarItem>) => void; today: string }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const handle = () => {
    if (!draft.trim()) { setAdding(false); return; }
    onAdd?.({ kind: 'task', scope: 'day', title: draft.trim(), due_date: today });
    setDraft('');
    setAdding(false);
  };

  return (
    <article style={{ padding: '40px 36px', border: '1px dashed var(--color-line)', borderRadius: 'var(--hub-radius-lg)', background: 'var(--color-paper-2)' }}>
      <Eyebrow style={{ marginBottom: 6 }}>The day is open.</Eyebrow>
      <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 20, color: 'var(--color-ink)', margin: '0 0 20px', lineHeight: 1.3 }}>
        Nothing has been written down yet.
      </p>

      {onAdd && (adding ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handle();
              if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
            placeholder="Describe a task…"
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-line)', fontFamily: FONT_HEAD, fontSize: 22, color: 'var(--color-ink)', outline: 'none', padding: '6px 2px' }}
          />
          <button onClick={handle} className="jk-cards-btn" style={{ background: 'var(--color-accent)', color: 'var(--color-paper)', border: 'none', fontFamily: FONT_BODY, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '10px 18px', cursor: 'pointer' }}>
            Add →
          </button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="jk-cards-btn" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', border: 'none', fontFamily: FONT_BODY, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '12px 22px', cursor: 'pointer' }}>
          + Write something down
        </button>
      ))}
    </article>
  );
}

function ClearedDay({ onOpenWeek }: { onOpenWeek?: () => void }) {
  return (
    <Well as="article" style={{ padding: '40px 36px' }}>
      <Eyebrow style={{ marginBottom: 6, color: 'var(--color-accent)', textShadow: 'var(--accent-halo-text)' }}>Today is clear.</Eyebrow>
      <p style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 22, color: 'var(--color-ink)', margin: '0 0 16px', lineHeight: 1.3 }}>
        Every task on today's list is done.
      </p>
      {onOpenWeek && (
        <TButton onClick={onOpenWeek} style={{ fontSize: 10, letterSpacing: '0.14em', padding: '10px 16px' }}>
          Plan something for tomorrow →
        </TButton>
      )}
    </Well>
  );
}

function Strip({
  tasks,
  items,
  accentOf,
  ancestorsOf,
  onSelect,
  onToggle,
  muted,
}: {
  tasks: CalendarItem[];
  items: CalendarItem[];
  accentOf: AccentOf;
  ancestorsOf: AncestorsOf;
  onSelect?: (item: CalendarItem) => void;
  onToggle?: (id: number, completed: boolean) => void;
  muted?: boolean;
}) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderTop: '1px solid var(--color-line-strong)', opacity: muted ? 0.55 : 1 }}>
      {tasks.map((task) => {
        const accent = accentOf(task) || 'var(--color-muted)';
        const ancestors = ancestorsOf(task, items);
        const yearGoal = ancestors[ancestors.length - 1];

        return (
          <li
            key={task.id}
            className="jk-cards-row"
            onClick={() => onSelect?.(task)}
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', padding: '11px 6px', borderBottom: '1px solid var(--color-line-strong)', cursor: 'pointer', ['--hover-bg' as any]: 'var(--color-paper-2)' }}
          >
            <Checkbox id={task.id} completed={task.completed} onToggle={onToggle} color={accent} size={14} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT_HEAD, fontSize: 15.5, color: task.completed ? 'var(--color-muted)' : 'var(--color-ink)', textDecoration: task.completed ? 'line-through' : 'none', lineHeight: 1.25 }}>
                {task.title}
              </div>
              {yearGoal && (
                <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-muted)', marginTop: 2, lineHeight: 1.2 }}>
                  {yearGoal.title}
                </div>
              )}
            </div>
            {task.scheduled_time && (
              <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 12, color: accent, whiteSpace: 'nowrap' }}>{fmtTime(task.scheduled_time)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* Carried tasks: rescheduling is a decision, not a default. */
function CarriedStrip({
  tasks,
  items,
  today,
  accentOf,
  ancestorsOf,
  onSelect,
  onToggle,
  onUpdateItem,
  readonly,
}: {
  tasks: CalendarItem[];
  items: CalendarItem[];
  today: string;
  accentOf: AccentOf;
  ancestorsOf: AncestorsOf;
  onSelect?: (item: CalendarItem) => void;
  onToggle?: (id: number, completed: boolean) => void;
  onUpdateItem?: (id: number, patch: Partial<CalendarItem>) => void;
  readonly?: boolean;
}) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderTop: '1px solid var(--color-line-strong)' }}>
      {tasks.map((task) => {
        const accent = accentOf(task) || 'var(--color-muted)';
        const ancestors = ancestorsOf(task, items);
        const goal = ancestors[ancestors.length - 1];
        return (
          <li
            key={task.id}
            className="jk-cards-row"
            onClick={() => onSelect?.(task)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: '1px solid var(--color-line-strong)', cursor: 'pointer', ['--hover-bg' as any]: 'var(--color-paper-2)' }}
          >
            <Checkbox id={task.id} completed={task.completed} onToggle={onToggle} color={accent} size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_HEAD, fontSize: 15.5, color: 'var(--color-ink)', lineHeight: 1.25 }}>{task.title}</div>
              <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-muted)', marginTop: 2 }}>
                was {task.due_date ? localDate(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                {goal ? ` · ${goal.title}` : ''}
              </div>
            </div>
            {!readonly && (
              <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                <CarryChip label="today" onClick={() => onUpdateItem?.(task.id, { due_date: today })} />
                <CarryChip label="tmrw" onClick={() => onUpdateItem?.(task.id, { due_date: addDays(today, 1) })} />
                <CarryChip label="let go" muted onClick={() => onUpdateItem?.(task.id, { due_date: null, scheduled_time: null, scheduled_end: null })} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CarryChip({ label, onClick, muted }: { label: string; onClick: () => void; muted?: boolean }) {
  return (
    <TButton onClick={onClick} quiet={muted} style={{ fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 8px' }}>
      {label}
    </TButton>
  );
}

/* Goals that have drifted off the calendar — schedule the next step in one tap. */
function AdriftStrip({
  goals,
  items,
  today,
  nextUnscheduled,
  onUpdateItem,
  onFocusGoal,
  readonly,
}: {
  goals: CalendarItem[];
  items: CalendarItem[];
  today: string;
  nextUnscheduled: (goal: CalendarItem, items: CalendarItem[]) => CalendarItem | null;
  onUpdateItem?: (id: number, patch: Partial<CalendarItem>) => void;
  onFocusGoal?: (goal: CalendarItem) => void;
  readonly?: boolean;
}) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderTop: '1px solid var(--color-line-strong)' }}>
      {goals.map((g) => {
        const accent = g.accent || 'var(--color-accent)';
        const candidate = nextUnscheduled(g, items);
        return (
          <li key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: '1px solid var(--color-line-strong)' }}>
            <span style={{ width: 5, height: 30, background: accent, boxShadow: `0 0 10px ${withAlpha(accent, 0.333)}`, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_HEAD, fontSize: 15.5, color: 'var(--color-ink)', lineHeight: 1.25 }}>{g.title}</div>
              {candidate && (
                <div style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11.5, color: 'var(--color-muted)', marginTop: 2 }}>
                  next up: {candidate.title}
                </div>
              )}
            </div>
            {!readonly && candidate ? (
              <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                <CarryChip label="→ today" onClick={() => onUpdateItem?.(candidate.id, { due_date: today })} />
                <CarryChip label="→ tmrw" onClick={() => onUpdateItem?.(candidate.id, { due_date: addDays(today, 1) })} />
              </span>
            ) : (
              onFocusGoal && <button onClick={() => onFocusGoal(g)} style={tinyLink}>break it down →</button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* Navigational links ride the SECONDARY accent — the flat companion to the
   pressed primary used for headings/wordmark (the two-accent system). */
const tinyLink: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontFamily: FONT_HEAD,
  fontStyle: 'italic',
  fontSize: 12,
  color: 'var(--color-secondary)',
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textUnderlineOffset: 3,
};

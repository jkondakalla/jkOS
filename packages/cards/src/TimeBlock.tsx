/**
 * TimeBlock — a timed event/task block in the Week time grid, with an optional
 * bottom resize handle and a selected ring. Ported from BeigeBoard's TimeBlock,
 * surfaced through cardSurface().
 */

import React from 'react';
import type { CalendarItem } from './types';
import { cardSurface, chipCheck } from './surface';
import { FONT_HEAD } from './theme';
import { fmtTime, timeToFrac, chipState } from './datetime';
import { WV_FIRST_H, WV_LAST_H, rowHeight, minBlockH, chipInset, gridHeight } from './constants';
import type { CardDensity } from './types';

export interface TimeBlockProps {
  item: CalendarItem;
  accent: string;
  slot?: number;
  totalCols?: number;
  isSelected?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
  /** Live geometry while dragging/resizing (start or end fraction override). */
  liveOverride?: { start?: number; end?: number } | null;
  /** Picks the row height, block floor and lane inset — see constants.ts. */
  density?: CardDensity;
  /** Which timeline this block sits in. Today's single column can afford more
   *  air (and a bigger title) than Week's seven lanes. */
  surface?: 'week' | 'day';
  /** Clock for chip state; pass a frozen Date in tests. */
  now?: Date;
  onSelect?: (item: CalendarItem) => void;
  onToggle?: (id: number, completed: boolean) => void;
  /** Arm a move / resize drag from the originating pointer event (usePointerDrag). */
  onBeginDrag?: (e: React.PointerEvent) => void;
  onBeginResize?: (e: React.PointerEvent) => void;
}

export function TimeBlock({
  item,
  accent,
  slot = 0,
  totalCols = 1,
  isSelected = false,
  isDragging = false,
  isResizing = false,
  liveOverride = null,
  density = 'comfortable',
  surface: timeline = 'week',
  now,
  onSelect,
  onToggle,
  onBeginDrag,
  onBeginResize,
}: TimeBlockProps) {
  const isEvent = item.kind === 'event';
  const ROW_H = rowHeight(density);
  const MIN_H = minBlockH(density);
  const [insetL, insetW] = chipInset(density, timeline);
  const isDay = timeline === 'day';

  const baseStart = timeToFrac(item.scheduled_time as string);
  const baseEnd = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1;
  const start = liveOverride?.start ?? baseStart;
  const end =
    liveOverride?.end ?? (liveOverride?.start != null ? liveOverride.start + (baseEnd - baseStart) : baseEnd);
  // The grid only draws WV_FIRST_H..WV_LAST_H (06:00–22:00). An item scheduled
  // outside that window would land at a negative `top` or past the last row and
  // silently vanish. Clamp it to the nearest edge as a MIN_H sliver and flag the
  // direction, so it stays visible AND clickable (a tap still selects/reschedules).
  const GRID_H = gridHeight(density);
  const rawTop = (start - WV_FIRST_H) * ROW_H;
  const rawHeight = Math.max(MIN_H, (end - start) * ROW_H);
  const outBefore = start < WV_FIRST_H;
  const outAfter = rawTop >= GRID_H;
  let top = rawTop;
  let height = rawHeight;
  if (outBefore) {
    const endPx = (end - WV_FIRST_H) * ROW_H; // where the block would end
    top = 0;
    height = endPx > 0 ? Math.max(MIN_H, Math.min(endPx, GRID_H)) : MIN_H;
  } else if (outAfter) {
    top = GRID_H - MIN_H;
    height = MIN_H;
  }
  const outWindow = outBefore || outAfter;
  const showTime = height >= 32;
  // Equal-width lanes, never shingled: a lane is exactly 100/totalCols wide and
  // the chip insets INSIDE it, so two concurrent events read as two columns
  // rather than as one stack of overlapping cards.
  const leftPct = (slot / totalCols) * 100;
  const rightPct = ((totalCols - slot - 1) / totalCols) * 100;
  const state = chipState(item, now);

  if (isDragging && !isResizing) {
    return (
      <div
        style={{
          position: 'absolute',
          left: `calc(${leftPct}% + ${insetL}px)`,
          right: `calc(${rightPct}% + ${insetW - insetL}px)`,
          top,
          height: Math.min(height, 22),
          background: accent,
          borderRadius: 'var(--hub-radius-soft)',
          opacity: 0.28,
          zIndex: 8,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    );
  }

  const surface = cardSurface({
    accent,
    variant: 'solid',
    state,
    selected: isSelected,
    radius: 'var(--hub-radius-soft)',
  });

  return (
    <div
      onPointerDown={onBeginDrag}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging) onSelect?.(item);
      }}
      className={surface.className}
      style={{
        position: 'absolute',
        left: `calc(${leftPct}% + ${insetL}px)`,
        right: `calc(${rightPct}% + ${insetW - insetL}px)`,
        top,
        height,
        overflow: 'hidden',
        cursor: 'grab',
        zIndex: 4,
        userSelect: 'none',
        ...surface.style,
      }}
    >
      <div
        style={{
          padding: isDay ? '7px 11px' : density === 'compact' ? '3px 7px' : '5px 9px',
          height: '100%',
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: isDay ? 'baseline' : 'center', gap: isDay ? 9 : 5 }}>
          {outWindow && (
            <span
              className="mono-eyebrow"
              title={`${fmtTime(item.scheduled_time)} — outside the ${WV_FIRST_H}:00–${WV_LAST_H}:00 grid`}
              style={{ flexShrink: 0, fontSize: 8, lineHeight: 1 }}
            >
              {outBefore ? '▲' : '▼'}{fmtTime(item.scheduled_time)}
            </span>
          )}
          {!isEvent && (
            <span
              role="checkbox"
              aria-checked={!!item.completed}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggle?.(item.id, !!item.completed);
              }}
              className={chipCheck(12).className}
              style={chipCheck(12).style}
            >
              ✓
            </span>
          )}
          <span
            className={item.completed ? undefined : 'jk-press-rev'}
            style={{
              flex: isDay ? undefined : 1,
              minWidth: 0,
              fontFamily: FONT_HEAD,
              fontSize: isDay ? 15 : density === 'compact' ? 11 : 12,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: item.completed ? 'var(--color-faint)' : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textDecoration: item.completed ? 'line-through' : 'none',
            }}
          >
            {item.title}
          </span>
          {/* Today sets the meta on the title's baseline; Week stacks it below,
              where there is width but no height to spare. */}
          {isDay && showTime && (
            <span className="mono-eyebrow" style={{ marginLeft: 'auto', flex: 'none', fontSize: 8, opacity: 0.8 }}>
              {fmtTime(item.scheduled_time)}
              {item.scheduled_end ? ` – ${fmtTime(item.scheduled_end)}` : ''}
            </span>
          )}
        </div>
        {!isDay && showTime && (
          <div className="mono-eyebrow" style={{ fontSize: 8, marginTop: 3, opacity: 0.8 }}>
            {fmtTime(item.scheduled_time)}
            {item.scheduled_end ? ` – ${fmtTime(item.scheduled_end)}` : ''}
          </div>
        )}
      </div>
      <div
        onPointerDown={onBeginResize}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 8,
          cursor: 'ns-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ width: 20, height: 1.5, background: 'var(--color-on-accent-faint)', borderRadius: 1 }} />
          <div style={{ width: 20, height: 1.5, background: 'var(--color-on-accent-faint)', borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}

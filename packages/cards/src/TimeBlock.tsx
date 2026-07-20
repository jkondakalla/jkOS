/**
 * TimeBlock — a timed event/task block in the Week time grid, with an optional
 * bottom resize handle and a selected ring. Ported from BeigeBoard's TimeBlock,
 * surfaced through cardSurface().
 */

import React from 'react';
import type { CalendarItem } from './types';
import { cardSurface, chipCheck } from './surface';
import { FONT_BODY } from './theme';
import { fmtTime, timeToFrac } from './datetime';
import { WV_FIRST_H, WV_LAST_H, WV_ROW_H } from './constants';

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
  onSelect,
  onToggle,
  onBeginDrag,
  onBeginResize,
}: TimeBlockProps) {
  const isEvent = item.kind === 'event';

  const baseStart = timeToFrac(item.scheduled_time as string);
  const baseEnd = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1;
  const start = liveOverride?.start ?? baseStart;
  const end =
    liveOverride?.end ?? (liveOverride?.start != null ? liveOverride.start + (baseEnd - baseStart) : baseEnd);
  // The grid only draws WV_FIRST_H..WV_LAST_H (06:00–22:00). An item scheduled
  // outside that window would land at a negative `top` or past the last row and
  // silently vanish. Clamp it to the nearest edge as an 18px sliver and flag the
  // direction, so it stays visible AND clickable (a tap still selects/reschedules).
  const GRID_H = (WV_LAST_H + 1 - WV_FIRST_H) * WV_ROW_H;
  const rawTop = (start - WV_FIRST_H) * WV_ROW_H;
  const rawHeight = Math.max(18, (end - start) * WV_ROW_H);
  const outBefore = start < WV_FIRST_H;
  const outAfter = rawTop >= GRID_H;
  let top = rawTop;
  let height = rawHeight;
  if (outBefore) {
    const endPx = (end - WV_FIRST_H) * WV_ROW_H; // where the block would end
    top = 0;
    height = endPx > 0 ? Math.max(18, Math.min(endPx, GRID_H)) : 18;
  } else if (outAfter) {
    top = GRID_H - 18;
    height = 18;
  }
  const outWindow = outBefore || outAfter;
  const showTime = height >= 32;
  const leftPct = (slot / totalCols) * 100;
  const rightPct = ((totalCols - slot - 1) / totalCols) * 100;

  if (isDragging && !isResizing) {
    return (
      <div
        style={{
          position: 'absolute',
          left: `calc(${leftPct}% + 2px)`,
          right: `calc(${rightPct}% + 2px)`,
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
    completed: item.completed,
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
        left: `calc(${leftPct}% + 2px)`,
        right: `calc(${rightPct}% + 2px)`,
        top,
        height,
        overflow: 'hidden',
        cursor: 'grab',
        zIndex: 4,
        userSelect: 'none',
        ...surface.style,
      }}
    >
      <div style={{ padding: '3px 7px 8px', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
              flex: 1,
              minWidth: 0,
              fontFamily: FONT_BODY,
              fontSize: 11,
              fontWeight: 600,
              color: item.completed ? 'var(--color-faint)' : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textDecoration: item.completed ? 'line-through' : 'none',
            }}
          >
            {item.title}
          </span>
        </div>
        {showTime && (
          <div className="mono-eyebrow" style={{ fontSize: 8, marginTop: 3 }}>
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

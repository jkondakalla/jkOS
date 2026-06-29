/**
 * TimeBlock — a timed event/task block in the Week time grid, with an optional
 * bottom resize handle and a selected ring. Ported from BeigeBoard's TimeBlock,
 * surfaced through cardSurface().
 */

import React from 'react';
import type { CalendarItem } from './types';
import { cardSurface } from './surface';
import { FONT_BODY, FONT_NUM } from './theme';
import { fmtTime, timeToFrac } from './datetime';
import { WV_FIRST_H, WV_ROW_H } from './constants';

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
  onBeginDrag?: (e: React.MouseEvent) => void;
  onBeginResize?: (e: React.MouseEvent) => void;
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
  const top = (start - WV_FIRST_H) * WV_ROW_H;
  const height = Math.max(18, (end - start) * WV_ROW_H);
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

  const surface = cardSurface({ accent, selected: isSelected, elevation: 'block', radius: 'var(--hub-radius-soft)' });

  return (
    <div
      onMouseDown={onBeginDrag}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging) onSelect?.(item);
      }}
      style={{
        position: 'absolute',
        left: `calc(${leftPct}% + 2px)`,
        right: `calc(${rightPct}% + 2px)`,
        top,
        height,
        borderTop: '2px solid rgba(255,255,255,0.28)',
        overflow: 'hidden',
        cursor: 'grab',
        opacity: item.completed ? 0.55 : 1,
        zIndex: 4,
        userSelect: 'none',
        ...surface,
      }}
    >
      <div style={{ padding: '3px 7px 8px', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {!isEvent && (
            <span
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggle?.(item.id, !!item.completed);
              }}
              style={{
                width: 10,
                height: 10,
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.7)',
                background: item.completed ? 'rgba(255,255,255,0.85)' : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 7,
                color: accent,
                lineHeight: 1,
              }}
            >
              {item.completed ? '✓' : ''}
            </span>
          )}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: FONT_BODY,
              fontSize: 11,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.95)',
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
          <div style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 9.5, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
            {fmtTime(item.scheduled_time)}
            {item.scheduled_end ? ` – ${fmtTime(item.scheduled_end)}` : ''}
          </div>
        )}
      </div>
      <div
        onMouseDown={onBeginResize}
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
          <div style={{ width: 20, height: 1.5, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
          <div style={{ width: 20, height: 1.5, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}

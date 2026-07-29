/**
 * TaskChip — the filled task pill shared by the Week untimed lane and the
 * Calendar cells/sidebar. Unifies BeigeBoard's UntimedChip + CalTaskChip.
 */

import React from 'react';
import type { CalendarItem } from './types';
import { cardSurface, chipCheck, type CardVariant } from './surface';
import { FONT_BODY } from './theme';
import { fmtTime } from './datetime';

export type ChipSize = 'xs' | 'sm' | 'md';

const SIZE: Record<ChipSize, { fs: number; cb: number; pad: string; gap: number }> = {
  xs: { fs: 10, cb: 9, pad: '2px 5px 2px 4px', gap: 4 }, // calendar cell
  sm: { fs: 10.5, cb: 9, pad: '2px 6px 2px 5px', gap: 6 }, // week untimed lane
  md: { fs: 11.5, cb: 11, pad: '5px 8px 5px 6px', gap: 6 }, // calendar sidebar
};

export interface TaskChipProps {
  item: CalendarItem;
  accent: string;
  size?: ChipSize;
  /** Chip skin: `faint` (default) = raised faint-tint row with a neutral-ink
   *  pressed title; `solid` = saturated tab with a cream-knockout title. */
  variant?: CardVariant;
  showTime?: boolean;
  isSelected?: boolean;
  isDragging?: boolean;
  onSelect?: (item: CalendarItem) => void;
  onToggle?: (id: number, completed: boolean) => void;
  /** Arms a drag from the originating pointer event (see usePointerDrag). */
  onPointerDown?: (e: React.PointerEvent) => void;
}

export function TaskChip({
  item,
  accent,
  size = 'sm',
  variant = 'faint',
  showTime = false,
  isSelected = false,
  isDragging = false,
  onSelect,
  onToggle,
  onPointerDown,
}: TaskChipProps) {
  const s = SIZE[size];

  if (isDragging) {
    return (
      <div
        style={{
          height: size === 'md' ? 24 : 18,
          background: accent,
          borderRadius: 'var(--hub-radius-xs)',
          opacity: 0.28,
          flexShrink: 0,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    );
  }

  const completed = !!item.completed;
  const surface = cardSurface({ accent, variant, completed, selected: isSelected, sm: size === 'xs' || size === 'sm' });
  const check = chipCheck(s.cb);
  // The pressed title: cream knockout on a solid tab, neutral-ink on a faint chip.
  const titleClass = variant === 'solid' ? 'jk-press-rev' : 'jk-press-ink';

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(item);
      }}
      className={`jk-cards-chip ${surface.className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: s.gap,
        padding: s.pad,
        fontFamily: FONT_BODY,
        fontSize: s.fs,
        cursor: 'grab',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        userSelect: 'none',
        ...surface.style,
      }}
    >
      <span
        role="checkbox"
        aria-checked={completed}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.(item.id, completed);
        }}
        className={check.className}
        style={check.style}
      >
        ✓
      </span>
      <span
        className={completed ? undefined : titleClass}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textDecoration: completed ? 'line-through' : 'none',
          color: completed ? 'var(--color-faint)' : undefined,
        }}
      >
        {item.title}
      </span>
      {showTime && item.scheduled_time && (
        <span className="mono-eyebrow" style={{ fontSize: 8, flexShrink: 0, opacity: 0.85 }}>
          {fmtTime(item.scheduled_time)}
        </span>
      )}
    </div>
  );
}

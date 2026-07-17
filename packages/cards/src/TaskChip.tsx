/**
 * TaskChip — the filled task pill shared by the Week untimed lane and the
 * Calendar cells/sidebar. Unifies BeigeBoard's UntimedChip + CalTaskChip.
 */

import React from 'react';
import type { CalendarItem } from './types';
import { cardSurface, chipCheckStyle } from './surface';
import { FONT_BODY, FONT_NUM } from './theme';
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
  showTime?: boolean;
  /** Spent (completed) cards: outline border instead of flat paper fill. */
  spentBorder?: boolean;
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
  showTime = false,
  spentBorder = false,
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
          borderRadius: 'var(--hub-radius-sm)',
          opacity: 0.28,
          flexShrink: 0,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    );
  }

  const completed = !!item.completed;
  const surface = completed
    ? {
        background: spentBorder ? 'transparent' : 'var(--color-paper)',
        border: spentBorder ? '1px solid var(--color-line-strong)' : 'none',
        boxShadow: 'none',
        color: 'var(--color-muted)',
        borderRadius: 'var(--hub-radius-sm)',
        outline: isSelected ? '1.5px solid var(--color-accent)' : 'none',
        outlineOffset: -1,
      }
    : cardSurface({ accent, selected: isSelected, elevation: 'chip' });

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(item);
      }}
      className="jk-cards-chip"
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
        ...surface,
      }}
    >
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.(item.id, completed);
        }}
        style={chipCheckStyle(completed, s.cb, completed ? 'var(--color-muted)' : 'transparent')}
      >
        {completed ? '✓' : ''}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textDecoration: completed ? 'line-through' : 'none',
        }}
      >
        {item.title}
      </span>
      {showTime && item.scheduled_time && (
        <span style={{ fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 10, opacity: 0.75, flexShrink: 0 }}>
          {fmtTime(item.scheduled_time)}
        </span>
      )}
    </div>
  );
}

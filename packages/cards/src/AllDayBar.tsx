/**
 * AllDayBar — a multi-day event bar with continuation arrows, shared by the Week
 * all-day lane and the Calendar week rows. Geometry (top/height) is passed in so
 * each grid keeps its own lane math; left/width derive from the bar's columns.
 */

import React from 'react';
import type { AllDayBar as AllDayBarLayout } from './datetime';
import { ACCENT_GLAZE } from './surface';
import { FONT_BODY } from './theme';

export interface AllDayBarProps {
  bar: AllDayBarLayout;
  color: string;
  top: number;
  height: number;
  isSelected?: boolean;
  isDragging?: boolean;
  /** Arms a drag from the originating pointer event (see usePointerDrag). */
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}

export function AllDayBar({ bar, color, top, height, isSelected, isDragging, onPointerDown, onClick }: AllDayBarProps) {
  return (
    <div
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: `calc(${(bar.startCol / 7) * 100}% + ${bar.continuesLeft ? 0 : 2}px)`,
        width: `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - ${bar.continuesLeft ? 0 : 2}px - ${bar.continuesRight ? 0 : 2}px)`,
        top,
        height,
        background: `${ACCENT_GLAZE}, ${color}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 6px rgba(0,0,0,0.35)',
        borderTopLeftRadius: bar.continuesLeft ? 0 : 'var(--hub-radius-sm)',
        borderBottomLeftRadius: bar.continuesLeft ? 0 : 'var(--hub-radius-sm)',
        borderTopRightRadius: bar.continuesRight ? 0 : 'var(--hub-radius-sm)',
        borderBottomRightRadius: bar.continuesRight ? 0 : 'var(--hub-radius-sm)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: bar.continuesLeft ? 4 : 6,
        paddingRight: bar.continuesRight ? 0 : 6,
        cursor: 'grab',
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        outline: isSelected ? '2px solid var(--color-accent)' : 'none',
        outlineOffset: -2,
        userSelect: 'none',
        transition: 'opacity 0.1s',
      }}
    >
      <span
        style={{
          fontFamily: FONT_BODY,
          fontSize: 10,
          fontWeight: 500,
          color: 'var(--color-on-accent)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {!bar.continuesLeft && bar.ev.title}
      </span>
    </div>
  );
}

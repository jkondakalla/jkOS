/**
 * AllDayBar — a multi-day event bar with continuation arrows, shared by the Week
 * all-day lane and the Calendar week rows. Geometry (top/height) is passed in so
 * each grid keeps its own lane math; left/width derive from the bar's columns.
 */

import React from 'react';
import type { AllDayBar as AllDayBarLayout } from './datetime';
import { cardSurface } from './surface';

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
  const surface = cardSurface({ accent: color, variant: 'solid', sm: true, selected: isSelected });
  const rad = 'var(--hub-radius-xs)';
  return (
    <div
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={surface.className}
      style={{
        position: 'absolute',
        left: `calc(${(bar.startCol / 7) * 100}% + ${bar.continuesLeft ? 0 : 2}px)`,
        width: `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - ${bar.continuesLeft ? 0 : 2}px - ${bar.continuesRight ? 0 : 2}px)`,
        top,
        height,
        borderTopLeftRadius: bar.continuesLeft ? 0 : rad,
        borderBottomLeftRadius: bar.continuesLeft ? 0 : rad,
        borderTopRightRadius: bar.continuesRight ? 0 : rad,
        borderBottomRightRadius: bar.continuesRight ? 0 : rad,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: bar.continuesLeft ? 4 : 6,
        paddingRight: bar.continuesRight ? 0 : 6,
        cursor: 'grab',
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        userSelect: 'none',
        transition: 'opacity 0.1s',
        ...surface.style,
      }}
    >
      <span
        className="jk-press-rev"
        style={{
          fontFamily: 'var(--hub-font-serif)',
          fontSize: 10,
          fontWeight: 600,
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

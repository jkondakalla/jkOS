/**
 * TimelinePreview — the dashed ghost shown in the Week timed zone while creating,
 * moving, or rescheduling. Presentational: it reads the live drag state and an
 * injected sourceColorOf to colour a moving event.
 */

import type { DragState } from './types';
import { FONT_BODY, FONT_NUM } from './theme';
import { fmtTime, fracToTime, timeToFrac } from './datetime';
import { WV_FIRST_H, WV_ROW_H } from './constants';

export interface TimelinePreviewProps {
  drag: DragState;
  sourceColorOf: (source: string | undefined) => string;
}

export function TimelinePreview({ drag, sourceColorOf }: TimelinePreviewProps) {
  const { mode, startFrac, overFrac, item } = drag;
  if (overFrac == null) return null;

  let start: number;
  let end: number;
  let color: string;
  let label: string;

  if (mode === 'create') {
    start = Math.min(startFrac ?? overFrac, overFrac);
    end = Math.max((startFrac ?? overFrac) + 0.5, overFrac);
    color = 'var(--color-accent)';
    label = `${fmtTime(fracToTime(start))} – ${fmtTime(fracToTime(end))}`;
  } else if (mode === 'timed' && item) {
    const baseStart = timeToFrac(item.scheduled_time as string);
    const baseEnd = item.scheduled_end ? timeToFrac(item.scheduled_end) : baseStart + 1;
    const dur = baseEnd - baseStart;
    start = overFrac;
    end = overFrac + dur;
    color = item.accent || (item.source ? sourceColorOf(item.source) : '') || 'var(--color-accent)';
    label = item.title;
  } else {
    start = overFrac;
    end = overFrac + 1;
    color = 'var(--color-accent)';
    label = `${fmtTime(fracToTime(start))} – ${fmtTime(fracToTime(end))}`;
  }

  const top = (start - WV_FIRST_H) * WV_ROW_H;
  const height = Math.max(24, (end - start) * WV_ROW_H);

  return (
    <div
      style={{
        position: 'absolute',
        left: 4,
        right: 4,
        top,
        height,
        borderRadius: 'var(--hub-radius-soft)',
        background: mode === 'timed' ? `${color}CC` : `${color}55`,
        border: `1px dashed ${color}`,
        borderTop: mode === 'timed' ? '2px solid rgba(255,255,255,0.3)' : `1px dashed ${color}`,
        boxShadow: `0 0 12px ${color}44`,
        pointerEvents: 'none',
        zIndex: 6,
      }}
    >
      <div
        style={{
          padding: '3px 8px',
          fontFamily: mode === 'timed' ? FONT_BODY : FONT_NUM,
          fontStyle: mode === 'timed' ? 'normal' : 'italic',
          fontWeight: mode === 'timed' ? 500 : 400,
          fontSize: 11,
          color:
            mode === 'timed'
              ? 'rgba(255,255,255,0.9)'
              : mode === 'create'
                ? 'var(--color-paper)'
                : 'var(--color-ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      {mode === 'timed' && height >= 36 && (
        <div style={{ padding: '1px 8px', fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 9.5, color: 'rgba(255,255,255,0.65)' }}>
          {fmtTime(fracToTime(start))} – {fmtTime(fracToTime(end))}
        </div>
      )}
    </div>
  );
}

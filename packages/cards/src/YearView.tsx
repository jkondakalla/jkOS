/**
 * YearView — the 12-month overview: a grid of mini month grids (reusing
 * buildMonthGrid) with a per-day density dot, no drag. It's the "zoom out + quick
 * switch" body — clicking a day calls onMonthJump(iso) so a host can drop into the
 * simplified month/day from here.
 */

import { useMemo, useState } from 'react';
import type { CalendarItem, YearViewProps } from './types';
import { withAlpha } from '@jkos/design';
import { mergeResolvers, FONT_HEAD, FONT_BODY, FONT_NUM } from './theme';
import { buildMonthGrid, isoDate, localDate } from './datetime';
import { Eyebrow } from './primitives';
import { Press, TButton } from '@jkos/ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_MINI = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function YearView({ items, today, year, selectedId, resolvers, onSelect, onMonthJump }: YearViewProps) {
  const { accentOf, sourceColorOf } = mergeResolvers(resolvers);
  const [cursor, setCursor] = useState(() => year ?? localDate(today).getFullYear());

  // One pass over items → a per-ISO density bucket (count + accent for the dot).
  const byDay = useMemo(() => {
    const out: Record<string, { count: number; color: string; item: CalendarItem }> = {};
    items.forEach((it) => {
      if (it.kind !== 'task' && it.kind !== 'event') return;
      if (!it.due_date) return;
      const color = (it.kind === 'event' ? it.accent || sourceColorOf(it.source) : accentOf(it)) || 'var(--color-muted)';
      const cur = out[it.due_date];
      if (cur) cur.count += 1;
      else out[it.due_date] = { count: 1, color, item: it };
    });
    return out;
  }, [items, accentOf, sourceColorOf]);

  const thisYear = localDate(today).getFullYear();

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'transparent', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, padding: '24px 32px 40px', display: 'flex', flexDirection: 'column', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--color-line)' }}>
          <div>
            <Eyebrow style={{ marginBottom: 4 }}>The year</Eyebrow>
            <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 30, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.04 }}>
              <Press large as="em" style={{ fontStyle: 'italic', color: cursor === thisYear ? 'var(--color-accent)' : undefined }}>
                {cursor}
              </Press>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <TButton onClick={() => setCursor((c) => c - 1)} style={{ fontSize: 13, padding: '6px 11px' }}>‹</TButton>
            <TButton onClick={() => setCursor(thisYear)} style={{ letterSpacing: '0.14em', padding: '6px 14px' }}>THIS YEAR</TButton>
            <TButton onClick={() => setCursor((c) => c + 1)} style={{ fontSize: 13, padding: '6px 11px' }}>›</TButton>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
          {MONTHS.map((name, mi) => (
            <MiniMonth
              key={mi}
              name={name}
              year={cursor}
              month={mi}
              today={today}
              byDay={byDay}
              selectedId={selectedId}
              onSelect={onSelect}
              onMonthJump={onMonthJump}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniMonth({
  name,
  year,
  month,
  today,
  byDay,
  selectedId,
  onSelect,
  onMonthJump,
}: {
  name: string;
  year: number;
  month: number;
  today: string;
  byDay: Record<string, { count: number; color: string; item: CalendarItem }>;
  selectedId?: number | null;
  onSelect?: (item: CalendarItem) => void;
  onMonthJump?: (iso: string) => void;
}) {
  // buildMonthGrid keys off an ISO in the target month; the 1st is always present.
  const anchor = isoDate(new Date(year, month, 1));
  const grid = buildMonthGrid(anchor);

  return (
    <div style={{ background: 'var(--color-paper-2)', border: '1px solid var(--color-line)', borderRadius: 'var(--hub-radius-soft)', padding: '12px 12px 14px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}>
      <div
        onClick={() => onMonthJump?.(anchor)}
        style={{ fontFamily: FONT_HEAD, fontStyle: 'italic', fontWeight: 500, fontSize: 15, color: 'var(--color-ink)', marginBottom: 8, cursor: onMonthJump ? 'pointer' : 'default' }}
        title={onMonthJump ? 'Open this month' : undefined}
      >
        {name}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 3 }}>
        {DOW_MINI.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontFamily: FONT_BODY, fontSize: 7.5, letterSpacing: '0.08em', color: 'var(--color-faint)' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {grid.map((cell) => {
          const info = byDay[cell.iso];
          const isToday = cell.iso === today;
          const isSel = info && selectedId != null && info.item.id === selectedId;
          return (
            <button
              key={cell.iso}
              onClick={() => {
                if (info && onSelect) onSelect(info.item);
                else onMonthJump?.(cell.iso);
              }}
              title={info ? `${info.count} item${info.count > 1 ? 's' : ''}` : undefined}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                border: isSel ? '1px solid var(--color-accent)' : '1px solid transparent',
                borderRadius: 'var(--hub-radius-xs)',
                background: isToday ? 'var(--color-accent-soft)' : 'transparent',
                cursor: 'pointer',
                padding: 0,
                opacity: cell.inMonth ? 1 : 0.32,
              }}
            >
              <span style={{ fontFamily: FONT_NUM, fontSize: 9, lineHeight: 1, color: isToday ? 'var(--color-accent)' : 'var(--color-muted)', fontStyle: isToday ? 'italic' : 'normal', fontWeight: isToday ? 600 : 400, textShadow: isToday ? 'var(--accent-halo-text)' : 'none' }}>
                {localDate(cell.iso).getDate()}
              </span>
              {info && cell.inMonth && (
                <span style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: info.color, boxShadow: `0 0 3px ${withAlpha(info.color, 0.533)}` }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

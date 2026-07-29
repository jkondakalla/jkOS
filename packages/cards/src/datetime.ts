/**
 * datetime.ts — the pure date / time / grid math behind the calendar cards.
 *
 * Self-contained (no app deps) so the kit and any host can share ONE copy.
 * BeigeBoard's lib/theme re-exports these to avoid a second, drifting set.
 */

import type { CalendarItem, ChipState } from './types';

/* ── Time-of-day fractions ─────────────────────────────────────────────── */

/** "14:30" → 14.5 */
export const timeToFrac = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

/** 14.5 → "14:30" (clamped to a valid clock time). */
export const fracToTime = (frac: number): string => {
  const h = Math.max(0, Math.min(23, Math.floor(frac)));
  const m = Math.max(0, Math.min(59, Math.round((frac % 1) * 60)));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Snap a fraction to the nearest `step` (default 15 min). */
export const snapFrac = (frac: number, step = 0.25): number => Math.round(frac / step) * step;

/* ── Date helpers (local-timezone, ISO YYYY-MM-DD) ─────────────────────── */

export function isoDate(d: Date): string {
  const z = new Date(d);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, '0');
  const day = String(z.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const localDate = (iso: string): Date => new Date(iso + 'T00:00:00');

export const addDays = (iso: string, n: number): string => {
  const d = localDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

/** Monday-first week start. */
export const weekStart = (iso: string): string => {
  const d = localDate(iso);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return isoDate(d);
};

export const monthStart = (iso: string): string => {
  const d = localDate(iso);
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

export const monthEnd = (iso: string): string => {
  const d = localDate(iso);
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

export const addMonths = (iso: string, n: number): string => {
  const d = localDate(iso);
  return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1));
};

/* ── Display formatting ────────────────────────────────────────────────── */

/** Ordinal day of the year (1–366) for a YYYY-MM-DD. */
export function dayOfYear(iso: string): number {
  const d = localDate(iso);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return 1 + Math.round((d.getTime() - jan1.getTime()) / (24 * 3600 * 1000));
}

/** ISO-8601 week number (1–53) for a YYYY-MM-DD. Monday-first, and the week
 *  containing the year's first Thursday is week 1 — the same rule the rest of
 *  the kit's Monday-first date maths already follows. */
export function isoWeekNo(iso: string): number {
  const d = localDate(iso);
  // Shift to the Thursday of this week: the year that Thursday falls in owns it.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const firstThu = new Date(d.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() - ((firstThu.getDay() + 6) % 7) + 3);
  return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 24 * 3600 * 1000));
}

export const fmtTime = (t: string | null | undefined): string => {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`;
};

export const fmtHourLabel = (h: number): string =>
  h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;

export const fmtWeekday = (iso: string): string =>
  localDate(iso).toLocaleDateString('en-US', { weekday: 'short' });

export const fmtFull = (iso: string): string =>
  localDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/* ── Layout: all-day bars into non-overlapping lanes ───────────────────── */

export interface AllDayBar {
  ev: CalendarItem;
  startCol: number;
  endCol: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  lane: number;
}

/** Place multi-day events into lanes within one week row. Mirrors the original
 *  BeigeBoard layoutBars (shared by Week + Calendar). */
export function layoutBars(events: CalendarItem[], weekDays: string[]): AllDayBar[] {
  const wStart = weekDays[0];
  const wEnd = weekDays[weekDays.length - 1];
  const bars = events
    .filter((ev) => {
      const evEnd = ev.end_date || ev.due_date || '';
      return (ev.due_date || '') <= wEnd && evEnd >= wStart;
    })
    .map((ev) => {
      const evEnd = ev.end_date || ev.due_date || '';
      const due = ev.due_date || '';
      const sc = due < wStart ? 0 : Math.max(0, weekDays.indexOf(due));
      let ec = weekDays.length - 1;
      if (evEnd <= wEnd) {
        for (let i = weekDays.length - 1; i >= 0; i--) {
          if (weekDays[i] <= evEnd) {
            ec = i;
            break;
          }
        }
      }
      return {
        ev,
        startCol: sc,
        endCol: ec,
        continuesLeft: due < wStart,
        continuesRight: evEnd > wEnd,
        lane: 0,
      };
    })
    .sort((a, b) =>
      a.startCol !== b.startCol ? a.startCol - b.startCol : b.endCol - b.startCol - (a.endCol - a.startCol),
    );

  const laneEnds: number[] = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-Infinity);
    }
    laneEnds[lane] = bar.endCol;
    bar.lane = lane;
  }
  return bars;
}

/* ── Chip state — the clock decides, not the call site ─────────────────── */

/**
 * What weight an item's chip is wearing right now.
 *
 * Wave 0 shipped the four classes (.jk-chip-live / -spent / -done) but nothing
 * ever decided WHERE they get applied, so every block in the grid carried the
 * same weight and the now-line read as a line drawn across the day rather than a
 * position in it. This is that decision, made once:
 *
 *   done      struck off — the item's own `completed` flag wins over the clock
 *   live      started, not finished
 *   spent     ended, and nobody struck it off
 *   upcoming  everything else, including anything with no time at all
 *
 * `now` is a Date so a host can pass a frozen clock in tests. Items on a day
 * other than `now`'s are judged by date alone: a whole past day is spent, a
 * whole future day is upcoming.
 */
export function chipState(item: CalendarItem, now: Date = new Date()): ChipState {
  if (item.completed) return 'done';

  const day = item.due_date;
  if (!day) return 'upcoming';

  const todayIso = isoDate(now);
  if (day > todayIso) return 'upcoming';
  if (day < todayIso) return 'spent';

  // Same day: fall through to the clock. An untimed item on today has not ended.
  const start = item.scheduled_time;
  if (!start) return 'upcoming';

  const nowFrac = now.getHours() + now.getMinutes() / 60;
  const startFrac = timeToFrac(start);
  const endFrac = item.scheduled_end ? timeToFrac(item.scheduled_end) : startFrac + 1;

  if (nowFrac >= endFrac) return 'spent';
  if (nowFrac >= startFrac) return 'live';
  return 'upcoming';
}

/** The hub.css modifier for a chip state. `upcoming` is the base chip, so it
 *  contributes no class. */
export function chipStateClass(state: ChipState): string {
  switch (state) {
    case 'live': return 'jk-chip-live';
    case 'spent': return 'jk-chip-spent';
    case 'done': return 'jk-chip-done';
    default: return '';
  }
}

/* ── Layout: timed events into side-by-side slots ──────────────────────── */

export interface TimedLayout {
  ev: CalendarItem;
  slot: number;
  totalCols: number;
}

/** Assign concurrent timed events to up to 4 columns. Mirrors the original
 *  BeigeBoard layoutTimedEvents. */
export function layoutTimedEvents(events: CalendarItem[]): TimedLayout[] {
  if (!events.length) return [];
  const items = events
    .map((ev) => ({
      ev,
      start: timeToFrac(ev.scheduled_time as string),
      end: ev.scheduled_end ? timeToFrac(ev.scheduled_end) : timeToFrac(ev.scheduled_time as string) + 1,
      slot: 0,
    }))
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - a.end));

  const slotEnds: number[] = [];
  for (const it of items) {
    let s = slotEnds.findIndex((end) => end <= it.start);
    if (s === -1) s = slotEnds.length;
    slotEnds[s] = it.end;
    it.slot = Math.min(s, 3);
  }

  return items.map((it) => {
    const concurrent = items.filter((o) => o.start < it.end && o.end > it.start);
    const groupCols = Math.min(4, Math.max(...concurrent.map((o) => o.slot)) + 1);
    return { ev: it.ev, slot: it.slot, totalCols: groupCols };
  });
}

/* ── Layout: month grid (6×7 cells with in/out-of-month flag) ──────────── */

export interface MonthCell {
  iso: string;
  inMonth: boolean;
}

/** Build the 42-cell Monday-first month grid for the month containing `iso`. */
export function buildMonthGrid(iso: string): MonthCell[] {
  const ms = monthStart(iso);
  const startD = localDate(ms);
  const dow0 = (startD.getDay() + 6) % 7;
  const grid: MonthCell[] = [];
  const d = new Date(startD);
  d.setDate(d.getDate() - dow0);
  for (let i = 0; i < 42; i++) {
    grid.push({ iso: isoDate(d), inMonth: d.getMonth() === startD.getMonth() });
    d.setDate(d.getDate() + 1);
  }
  return grid;
}

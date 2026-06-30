/**
 * @jkos/cards — shared, app-agnostic calendar card kit.
 *
 * The Week/Calendar views that power BeigeBoard's tabs live here so the SAME
 * components can drop into ORDECK as widgets (via its `component` escape hatch).
 * Data is injected via props; cross-app domain logic (accent inheritance, source
 * colours) is injected through `CardResolvers` so the kit stays domain-free.
 */

import type React from 'react';

/** The normalized item shape both views render. A superset-tolerant `[k]: any`
 *  keeps callers from having to strip extra fields off their richer records. */
export interface CalendarItem {
  id: number;
  kind: string; // 'task' | 'event' | 'goal' | 'milestone'
  title: string;
  completed?: boolean;
  due_date?: string | null; // YYYY-MM-DD
  end_date?: string | null; // YYYY-MM-DD (multi-day events)
  scheduled_time?: string | null; // HH:MM
  scheduled_end?: string | null; // HH:MM
  source?: string;
  accent?: string;
  parent_id?: number;
  scope?: string;
  [k: string]: any;
}

/** Resolvers a host app injects so the kit can colour items without knowing the
 *  host's data model. `accentOf` walks the host's goal tree; `sourceColorOf` maps
 *  a calendar source id (google/outlook/…) to its hex. Both have safe defaults. */
export interface CardResolvers {
  accentOf: (item: CalendarItem) => string | null;
  sourceColorOf: (source: string | undefined) => string;
}

/** Domain resolvers the Day-agenda derivation needs to reproduce BeigeBoard's
 *  Today briefing without importing its goal-tree logic. All optional, defaulting
 *  to no-ops: an app with no goal tree gets next/rest/carried/done and an empty
 *  `adrift`. Lifted from BeigeBoard's lib/plan + lib/seed (getAncestors /
 *  activeGoals / isAdrift / nextUnscheduled). */
export interface PlanResolvers {
  /** Goal-tree ancestry of an item (nearest parent first), for breadcrumbs. */
  ancestorsOf: (item: CalendarItem, items: CalendarItem[]) => CalendarItem[];
  /** Top-level active goals — candidates for the Adrift section. */
  activeGoals: (items: CalendarItem[]) => CalendarItem[];
  /** True when an active goal has no next action on the calendar. */
  isAdrift: (goal: CalendarItem, items: CalendarItem[]) => boolean;
  /** The first unscheduled open task under a goal (the one to commit to a day). */
  nextUnscheduled: (goal: CalendarItem, items: CalendarItem[]) => CalendarItem | null;
}

/** Day-view layout: the timed grid, or the briefing/agenda (Today) layout. */
export type DayMode = 'grid' | 'agenda';

/** The four standardized calendar bodies the headless dispatcher renders. */
export type CalendarViewKind = 'day' | 'week' | 'month' | 'year';

/** The briefing model `deriveDaySections` produces — exactly the slices
 *  BeigeBoard's TodayView renders, derived once so any host can reproduce it. */
export interface DaySections {
  /** The hero "Next" item (first active item today), or null. */
  next: CalendarItem | null;
  /** The remaining active items today after `next`. */
  rest: CalendarItem[];
  /** Incomplete items whose day slipped past today. */
  carried: CalendarItem[];
  /** Active goals with nothing on the calendar (empty without PlanResolvers). */
  adrift: CalendarItem[];
  /** Items completed today. */
  done: CalendarItem[];
  /** True when nothing is on the day and nothing carried — the open-day state. */
  isEmpty: boolean;
}

/** Where a drop landed, reported back to the view's onDrop callback. */
export interface DropInfo {
  overDay?: string | null;
  overFrac?: number | null;
  overZone?: string | null;
}

/** The live drag state the desktop grid reads while a drag is in flight. Matches
 *  BeigeBoard's DragProvider `drag` object shape exactly. */
export interface DragState {
  item?: CalendarItem | null;
  mode?: string; // 'untimed' | 'timed' | 'resize' | 'allday' | 'create' | 'cell'
  x?: number;
  y?: number;
  overDay?: string | null;
  overFrac?: number | null;
  overZone?: string | null;
  startFrac?: number;
  startDay?: string;
  [k: string]: any;
}

/** The interaction seam. A host that wants full grid drag passes an adapter
 *  wrapping its drag engine (BeigeBoard → useCalendarDrag()); a host that wants
 *  the read+light experience (ORDECK) passes none, and the grid omits drag while
 *  keeping select/toggle/quick-add.
 *
 *  `beginDrag` takes the originating React pointer event: the underlying
 *  usePointerDrag gesture arms from it (capture + pointer-type-aware activation),
 *  which is what carries drag onto touch. */
export interface DragAdapter {
  drag: DragState | null;
  beginDrag: (
    e: React.PointerEvent,
    item: CalendarItem | null,
    mode: string,
    onDrop: (info: DropInfo) => void,
    opts?: { startFrac?: number; startDay?: string },
  ) => void;
}

/** Props common to both views. */
export interface CalendarViewProps {
  items: CalendarItem[];
  today: string; // YYYY-MM-DD
  selectedId?: number | null;
  readonly?: boolean;
  resolvers?: Partial<CardResolvers>;
  drag?: DragAdapter;
  onSelect?: (item: CalendarItem) => void;
  onToggle?: (id: number, completed: boolean) => void;
  onAddItem?: (partial: Partial<CalendarItem>) => void;
  onUpdateItem?: (id: number, patch: Partial<CalendarItem>) => void;
  onWeekJump?: (iso: string) => void;
  /** Optional host-driven "add on this date" affordance (e.g. the mobile shell's
   *  AddSheet). When omitted, the mobile calendar falls back to an inline add via
   *  onAddItem; the desktop grid always uses inline quick-add. */
  onAddOnDate?: (date: string) => void;
}

export interface WeekViewProps extends CalendarViewProps {
  /** A signal from a host (e.g. Calendar → Week jump) to recentre on this date. */
  weekJumpDate?: string | null;
}

export interface DayViewProps extends CalendarViewProps {
  /** Grid (the one-column time grid) or agenda (the Today briefing). Default grid. */
  mode?: DayMode;
  /** The day to open on; defaults to `today`. The view manages its own cursor. */
  date?: string;
  /** Domain resolvers for the agenda's Carried/Adrift derivation (optional). */
  plan?: Partial<PlanResolvers>;
  /** Optional hero line for the agenda (e.g. "Good evening"). */
  greeting?: string;
  /** Optional headless nav hooks for the agenda footer/section links. */
  onOpenWeek?: () => void;
  onOpenWorkshop?: () => void;
  onFocusGoal?: (goal: CalendarItem) => void;
}

export interface YearViewProps {
  items: CalendarItem[];
  today: string; // YYYY-MM-DD
  /** Year to render; defaults to the year of `today`. View owns its own cursor. */
  year?: number;
  selectedId?: number | null;
  resolvers?: Partial<CardResolvers>;
  onSelect?: (item: CalendarItem) => void;
  /** Jump into a simplified month/day view at this ISO date (the "quick switch"). */
  onMonthJump?: (iso: string) => void;
}

/** The headless dispatcher's props: pick a `view`, pass through whatever that
 *  body reads. Superset of every view's props so one call site drives all four. */
export interface CalendarProps extends WeekViewProps, Omit<DayViewProps, keyof CalendarViewProps> {
  view: CalendarViewKind;
  /** Day body layout when `view='day'`. */
  dayMode?: DayMode;
  /** Year to render when `view='year'`. */
  year?: number;
  onMonthJump?: (iso: string) => void;
}

/** The prop bundle `useCalendarSource` returns — snaps straight onto a view via
 *  `<Calendar {...src} />`. `drag` and `resolvers` stay separate props. */
export interface CalendarSource {
  items: CalendarItem[];
  onAddItem: (partial: Partial<CalendarItem>) => void;
  onUpdateItem: (id: number, patch: Partial<CalendarItem>) => void;
  onToggle: (id: number, completed: boolean) => void;
  onDelete: (id: number) => void;
  /** Force an immediate refetch (the invalidation bus already fires per write). */
  refresh: () => void;
}

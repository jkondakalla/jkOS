/**
 * @jkos/cards — shared, app-agnostic calendar card kit.
 *
 * The Week/Calendar views that power BeigeBoard's tabs live here so the SAME
 * components can drop into ORDECK as widgets (via its `component` escape hatch).
 * Data is injected via props; cross-app domain logic (accent inheritance, source
 * colours) is injected through `CardResolvers` so the kit stays domain-free.
 */

/** The normalized item shape both views render. A superset-tolerant `[k]: any`
 *  keeps callers from having to strip extra fields off their richer records. */
export interface CalendarItem {
  id: number;
  kind: string; // 'task' | 'event' | 'goal' | 'milestone'
  title: string;
  completed?: boolean;
  due_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD (multi-day events)
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
 *  wrapping its drag engine (BeigeBoard → useDrag()); a host that wants the
 *  read+light experience (ORDECK) passes none, and the grid omits drag while
 *  keeping select/toggle/quick-add. */
export interface DragAdapter {
  drag: DragState | null;
  beginDrag: (
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

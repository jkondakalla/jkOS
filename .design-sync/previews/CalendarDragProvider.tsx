import { CalendarDragProvider, WeekView, useCalendarDrag } from '@jkos/ui';
import { Faces } from './_faces';

/* The interaction seam. A host that wants full grid drag wraps its views in this
   provider and hands the adapter down; a host that wants read-and-light (ORDECK)
   passes no adapter at all, and the grid omits drag while keeping select, toggle
   and quick-add.
 *
 * Drag itself is a POINTER GESTURE — it cannot be captured statically, so these
 * cells show the wiring and the resting state, not a drag in flight. The ghost
 * that appears mid-drag is TimelinePreview, which has its own cells. */
const TODAY = '2026-07-30';

const AMBER = '#b8860b';
const TEAL = '#4ecdc4';
const GREEN = '#2a7040';

const items = [
  { id: 1, kind: 'event', title: 'Standup', due_date: '2026-07-27', scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 2, kind: 'event', title: 'Design sync', due_date: TODAY, scheduled_time: '13:00', scheduled_end: '14:00', accent: TEAL, source: 'bb' },
  { id: 3, kind: 'event', title: 'Deploy window', due_date: '2026-07-31', scheduled_time: '16:00', scheduled_end: '17:00', accent: GREEN },
  { id: 20, kind: 'task', title: 'Draft the rollout dossier', due_date: '2026-07-28', accent: AMBER },
  { id: 21, kind: 'task', title: 'Regenerate the token mirrors', due_date: TODAY, accent: TEAL },
];

/* `sourceColorOf` colours the drag ghost for source-coloured events — this is
   the hook BeigeBoard uses to inject its own calendar-source palette. */
const sourceColorOf = (s?: string) => (s === 'bb' ? AMBER : TEAL);

/** The provider feeding a real Week grid. `useCalendarDrag()` inside the
 *  provider yields the adapter the view takes as its `drag` prop. */
const DraggableWeek = () => {
  const drag = useCalendarDrag();
  return <WeekView items={items} today={TODAY} drag={drag} />;
};

export const AroundAWeekGrid = () => (
  <Faces height={520} stacked>
    <div style={{ height: 560, display: 'flex', flexDirection: 'column' }}>
      <CalendarDragProvider sourceColorOf={sourceColorOf}>
        <DraggableWeek />
      </CalendarDragProvider>
    </div>
  </Faces>
);

/** The same grid with NO provider and no adapter — the read-and-light mount.
 *  Select, toggle and quick-add still work; only drag is absent. */
export const WithoutDrag = () => (
  <Faces height={520} stacked>
    <div style={{ height: 560, display: 'flex', flexDirection: 'column' }}>
      <WeekView items={items} today={TODAY} />
    </div>
  </Faces>
);

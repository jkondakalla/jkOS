import { DayView } from '@jkos/ui';
import { Faces } from './_faces';

/* The single-day time grid.
 *
 * `mode="agenda"` is NOT shown here, deliberately. BeigeBoard mounts DayView as
 * `dayMode="grid"` only (apps/beigeboard/src/views/TodayView.tsx) — nothing in
 * the app reaches the agenda body, and the agenda still carries v0 chrome the
 * suite has moved off (the accent-strip-down-the-left "Next" card in
 * `NextCard`, DayView.tsx, and the same strip again in `CarriedStrip`). Showing
 * it would teach a deprecated card variant, so the grid is the whole story here.
 *
 * `today`/`date` are pinned so the captures are deterministic. */
const TODAY = '2026-07-30';

const AMBER = '#b8860b';
const TEAL = '#4ecdc4';
const PLUM = '#8a2060';
const GREEN = '#2a7040';

const items = [
  { id: 1, kind: 'event', title: 'Standup', due_date: TODAY, scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 2, kind: 'event', title: 'Design sync', due_date: TODAY, scheduled_time: '13:00', scheduled_end: '14:00', accent: TEAL },
  { id: 3, kind: 'event', title: 'Suite health sweep', due_date: TODAY, scheduled_time: '15:30', scheduled_end: '16:30', accent: PLUM },
  { id: 4, kind: 'task', title: 'Regenerate the token mirrors', due_date: TODAY, accent: TEAL },
  { id: 5, kind: 'task', title: 'Draft the rollout dossier', due_date: TODAY, accent: AMBER },
  { id: 6, kind: 'task', title: 'Sweep the prober gaps', due_date: TODAY, completed: true, accent: TEAL },
  { id: 7, kind: 'event', title: 'Deploy window', due_date: TODAY, scheduled_time: '16:45', scheduled_end: '17:15', accent: GREEN },
];

const host = (h: number): React.CSSProperties => ({ height: h, display: 'flex', flexDirection: 'column' });

/** The default body: one column of timeline, with the untimed lane above it and
 *  the now-line marking the position in the day. */
export const Grid = () => (
  <Faces height={520} stacked>
    <div style={host(560)}>
      <DayView items={items} today={TODAY} date={TODAY} />
    </div>
  </Faces>
);

/** `density="compact"` for a small mount — the same grid, one notch tighter. */
export const Compact = () => (
  <Faces height={420} stacked>
    <div style={host(440)}>
      <DayView items={items} today={TODAY} date={TODAY} density="compact" />
    </div>
  </Faces>
);

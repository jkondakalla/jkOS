import { WeekView } from '@jkos/ui';
import { Faces } from './_faces';

/* A week of BeigeBoard-shaped records. `today` is pinned so the preview is
   deterministic — 2026-07-30 is the Thursday of the Mon 07-27 … Sun 08-02 week. */
const TODAY = '2026-07-30';

const AMBER = '#b8860b';
const TEAL = '#4ecdc4';
const PLUM = '#8a2060';
const GREEN = '#2a7040';

const items = [
  // Timed events across the week.
  { id: 1, kind: 'event', title: 'Standup', due_date: '2026-07-27', scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 2, kind: 'event', title: 'Token parity review', due_date: '2026-07-27', scheduled_time: '11:00', scheduled_end: '12:00', accent: TEAL },
  { id: 3, kind: 'event', title: 'Standup', due_date: '2026-07-28', scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 4, kind: 'event', title: 'Full Press wave planning', due_date: '2026-07-28', scheduled_time: '14:00', scheduled_end: '15:30', accent: PLUM },
  { id: 5, kind: 'event', title: 'Standup', due_date: '2026-07-29', scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 6, kind: 'event', title: 'Deploy window', due_date: '2026-07-29', scheduled_time: '16:00', scheduled_end: '17:00', accent: GREEN },
  { id: 7, kind: 'event', title: 'Standup', due_date: TODAY, scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 8, kind: 'event', title: 'Design sync', due_date: TODAY, scheduled_time: '13:00', scheduled_end: '14:00', accent: TEAL },
  { id: 9, kind: 'event', title: 'Suite health sweep', due_date: TODAY, scheduled_time: '15:30', scheduled_end: '16:30', accent: PLUM },
  { id: 10, kind: 'event', title: 'Standup', due_date: '2026-07-31', scheduled_time: '09:30', scheduled_end: '09:45', accent: AMBER },
  { id: 11, kind: 'event', title: 'Retro', due_date: '2026-07-31', scheduled_time: '15:00', scheduled_end: '16:00', accent: GREEN },

  // Untimed tasks — these ride the lane above the grid.
  { id: 20, kind: 'task', title: 'Draft the rollout dossier', due_date: '2026-07-28', accent: PLUM },
  { id: 21, kind: 'task', title: 'Cut the staging release', due_date: '2026-07-29', accent: GREEN },
  { id: 22, kind: 'task', title: 'Regenerate the token mirrors', due_date: TODAY, accent: TEAL },
  { id: 23, kind: 'task', title: 'Sweep the prober gaps', due_date: TODAY, completed: true, accent: TEAL },
  { id: 24, kind: 'task', title: 'Write the colophon copy', due_date: '2026-07-31', accent: AMBER },
];

/** The full interactive week grid — seven lanes, the untimed lane above them,
 *  and the now-line marking today by light. */
export const Week = () => (
  <Faces height={520} stacked>
    <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
      <WeekView items={items} today={TODAY} />
    </div>
  </Faces>
);

/** `density="compact"` tightens the air for small mounts (ORDECK's `bb-week`
 *  widget) — the lane framing is preserved, only the gaps and padding shrink. */
export const Compact = () => (
  <Faces height={520} stacked>
    <div style={{ height: 420, display: 'flex', flexDirection: 'column' }}>
      <WeekView items={items} today={TODAY} density="compact" />
    </div>
  </Faces>
);

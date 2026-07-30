import { CalendarView } from '@jkos/ui';
import { Faces } from './_faces';

/* The MONTH grid. `today` is pinned so the preview is deterministic. */
const TODAY = '2026-07-30';

const AMBER = '#b8860b';
const TEAL = '#4ecdc4';
const PLUM = '#8a2060';
const GREEN = '#2a7040';

const items = [
  { id: 1, kind: 'event', title: 'Offsite', due_date: '2026-07-06', end_date: '2026-07-08', accent: TEAL },
  { id: 2, kind: 'task', title: 'Wave 24 review', due_date: '2026-07-09', accent: AMBER },
  { id: 3, kind: 'event', title: 'Design sync', due_date: '2026-07-14', accent: TEAL },
  { id: 4, kind: 'task', title: 'Token parity gate', due_date: '2026-07-16', accent: PLUM },
  { id: 5, kind: 'event', title: 'Release freeze', due_date: '2026-07-20', end_date: '2026-07-22', accent: '#b42010' },
  { id: 6, kind: 'task', title: 'Draft the dossier', due_date: '2026-07-23', accent: AMBER },
  { id: 7, kind: 'task', title: 'Cut the release', due_date: '2026-07-28', accent: GREEN },
  { id: 8, kind: 'event', title: 'Suite health sweep', due_date: TODAY, accent: PLUM },
  { id: 9, kind: 'task', title: 'Regenerate token mirrors', due_date: TODAY, accent: TEAL },
  { id: 10, kind: 'task', title: 'Sweep the prober gaps', due_date: TODAY, completed: true, accent: TEAL },
  { id: 11, kind: 'task', title: 'Write the colophon copy', due_date: '2026-07-31', accent: AMBER },
  { id: 12, kind: 'event', title: 'Retro', due_date: '2026-08-03', accent: GREEN },
];

const host = (h: number): React.CSSProperties => ({ height: h, display: 'flex', flexDirection: 'column' });

/** The month grid, with today lit and multi-day events banded across the rows. */
export const Month = () => (
  <Faces height={520} stacked>
    <div style={host(560)}>
      <CalendarView items={items} today={TODAY} />
    </div>
  </Faces>
);

/** `readonly` drops the drag and quick-add affordances. */
export const Readonly = () => (
  <Faces height={520} stacked>
    <div style={host(520)}>
      <CalendarView items={items} today={TODAY} readonly selectedId={8} />
    </div>
  </Faces>
);

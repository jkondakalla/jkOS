import { TaskChip, Lab } from '@jkos/ui';
import { Faces } from './_faces';

/* The kit is domain-free: a host injects normalized records. These mirror the
   shape BeigeBoard stores (id / kind / title / due_date / scheduled_time).

   Both faces on every cell: on paper a faint chip is a raised tinted row with a
   neutral-ink pressed title; on the tube the same chip emits, and the tint
   carries its own halation instead of a bevel. */
const task = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'task',
  title,
  due_date: '2026-07-30',
  ...extra,
});

const AMBER = '#b8860b';
const TEAL = '#4ecdc4';
const PLUM = '#8a2060';

const lane: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '16px 18px',
  width: 260,
};

const labelled = (label: string, children: React.ReactNode) => (
  <div style={lane}>
    <Lab size="xs" style={{ marginBottom: 4 }}>
      {label}
    </Lab>
    {children}
  </div>
);

/** The default faint chip — a raised tinted row with a neutral-ink pressed title. */
export const Faint = () => (
  <Faces height={230}>
    {labelled(
      'faint · the default',
      <>
        <TaskChip item={task(1, 'Draft the rollout dossier')} accent={AMBER} />
        <TaskChip item={task(2, 'Review the token parity gate')} accent={TEAL} />
        <TaskChip item={task(3, 'Cut the staging release')} accent={PLUM} />
      </>,
    )}
  </Faces>
);

/** `variant="solid"` — the loud saturated tab with a cream-knockout title. */
export const Solid = () => (
  <Faces height={230}>
    {labelled(
      'solid · the loud tab',
      <>
        <TaskChip item={task(4, 'Deploy blocked on nginx')} accent="#b42010" variant="solid" />
        <TaskChip item={task(5, 'Ship staging')} accent="#2a7040" variant="solid" />
        <TaskChip item={task(6, 'Design review')} accent={PLUM} variant="solid" />
      </>,
    )}
  </Faces>
);

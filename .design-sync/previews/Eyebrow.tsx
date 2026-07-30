import { Eyebrow, TaskChip } from '@jkos/ui';
import { Faces } from './_faces';

/* Eyebrow is the calendar kit's small uppercase label — it renders the shared
   .jk-lab .jk-lab-sm face, so a kit surface labels itself exactly like the rest
   of the suite without importing @jkos/ui's <Lab>. */
const pad: React.CSSProperties = {
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  alignItems: 'flex-start',
};

/** The default label. */
export const Default = () => (
  <Faces height={190}>
    <div style={pad}>
      <Eyebrow>This week</Eyebrow>
      <Eyebrow>Untimed</Eyebrow>
      <Eyebrow>On the bench</Eyebrow>
    </div>
  </Faces>
);

/** Naming a lane above the chips it heads — the call site it exists for, and
 *  how every grid body labels its untimed lane. */
export const HeadingALane = () => (
  <Faces height={190}>
    <div style={{ ...pad, gap: 8, width: 280 }}>
      <Eyebrow>Untimed</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        <TaskChip item={{ id: 1, kind: 'task', title: 'Draft the rollout dossier' }} accent="#b8860b" />
        <TaskChip item={{ id: 2, kind: 'task', title: 'Review the parity gate' }} accent="#4ecdc4" />
      </div>
    </div>
  </Faces>
);

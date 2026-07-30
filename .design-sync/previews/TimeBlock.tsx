import { TimeBlock, Eyebrow } from '@jkos/ui';
import { Faces } from './_faces';

/* A scheduled event drawn on a timeline. It positions itself ABSOLUTELY against
   the kit's full laid-out day (06:00–22:00 at rowHeight(density) px/hour — see
   constants.ts), so a 13:00 block sits 420px down a comfortable grid. These
   cells therefore use MORNING times and short lanes, so the blocks land inside
   a card-sized host instead of below its fold.
 *
 * `now` is a frozen Date so the clock-derived chip state is deterministic. */
const NOW = new Date('2026-07-30T08:20:00');

const ev = (id: number, title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'event',
  title,
  due_date: '2026-07-30',
  scheduled_time: start,
  scheduled_end: end,
  ...extra,
});

const lane = (w: number, h: number): React.CSSProperties => ({
  position: 'relative',
  width: w,
  height: h,
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-sm)',
  background: 'var(--color-paper-2)',
  overflow: 'hidden',
});

const pad: React.CSSProperties = { padding: '18px 20px' };

/** Blocks on a day timeline, at the times they are scheduled for. */
export const OnADay = () => (
  <Faces height={330}>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Thursday 30 · morning</Eyebrow>
      <div style={lane(280, 300)}>
        <TimeBlock item={ev(1, 'Standup', '07:00', '07:15')} accent="#b8860b" surface="day" now={NOW} />
        <TimeBlock item={ev(2, 'Design sync', '08:00', '09:00')} accent="#4ecdc4" surface="day" now={NOW} />
        <TimeBlock item={ev(3, 'Suite health sweep', '09:30', '10:30')} accent="#8a2060" surface="day" now={NOW} />
      </div>
    </div>
  </Faces>
);

/** Two blocks sharing an hour — `slot` and `totalCols` split the lane between
 *  them instead of letting them stack. */
export const Overlapping = () => (
  <Faces height={330}>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Two at once</Eyebrow>
      <div style={lane(280, 250)}>
        <TimeBlock
          item={ev(1, 'Design sync', '08:00', '09:00')}
          accent="#4ecdc4"
          slot={0}
          totalCols={2}
          surface="day"
          now={NOW}
        />
        <TimeBlock
          item={ev(2, 'Deploy window', '08:30', '09:30')}
          accent="#2a7040"
          slot={1}
          totalCols={2}
          surface="day"
          now={NOW}
        />
      </div>
    </div>
  </Faces>
);

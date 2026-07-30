import { TimelinePreview, Eyebrow, HourLabel } from '@jkos/ui';
import { Faces } from './_faces';

/* The drag GHOST: while a drag is in flight the grid renders this to show where
   the drop will land and at what time. It reads the live `drag` state and
   returns null when `overFrac` is null, so a preview must supply a drag object
   that looks mid-gesture.
 *
 * `overFrac` is an HOUR of the kit's laid-out day, which starts at 06:00 and
 * runs at rowHeight(density) px/hour (60 comfortable, 48 compact — constants.ts).
 * The rules below are drawn on that same 60px pitch from 06:00, so the ghost
 * lands on them rather than floating between them. */
const sourceColorOf = (s: string | undefined) => (s === 'bb' ? '#b8860b' : '#4ecdc4');

const ROW = 60;
const FIRST_H = 6;
const HOURS = ['6 AM', '7 AM', '8 AM', '9 AM', '10 AM'];

const lane: React.CSSProperties = {
  position: 'relative',
  width: 270,
  height: 300,
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-sm)',
  background: 'var(--color-paper-2)',
  overflow: 'hidden',
};

const Rules = () => (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {HOURS.map((h, i) => (
      <div
        key={h}
        style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, display: 'flex', gap: 8 }}
      >
        <div style={{ width: 38, textAlign: 'right' }}>
          <HourLabel>{h}</HourLabel>
        </div>
        <div style={{ flex: 1, borderTop: '1px solid var(--color-line)' }} />
      </div>
    ))}
  </div>
);

const pad: React.CSSProperties = { padding: '18px 20px' };

/** `mode: 'create'` — dragging out a new block on empty time. The ghost is
 *  labelled with the span it would create. */
export const Creating = () => (
  <Faces height={340}>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Dragging out a new block</Eyebrow>
      <div style={lane}>
        <Rules />
        <TimelinePreview
          drag={{ mode: 'create', startFrac: FIRST_H + 1, overFrac: FIRST_H + 2.5 }}
          sourceColorOf={sourceColorOf}
        />
      </div>
    </div>
  </Faces>
);

/** `mode: 'timed'` — moving an existing event. The ghost keeps the item's own
 *  duration and colour, and is labelled with its title rather than a span. */
export const MovingAnEvent = () => (
  <Faces height={340}>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Moving an existing event</Eyebrow>
      <div style={lane}>
        <Rules />
        <TimelinePreview
          drag={{
            mode: 'timed',
            overFrac: FIRST_H + 1.5,
            item: {
              id: 1,
              kind: 'event',
              title: 'Design sync',
              scheduled_time: '13:00',
              scheduled_end: '14:00',
              source: 'bb',
            },
          }}
          sourceColorOf={sourceColorOf}
        />
      </div>
    </div>
  </Faces>
);

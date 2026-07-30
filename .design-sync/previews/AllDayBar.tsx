import { AllDayBar, Eyebrow } from '@jkos/ui';
import { Faces } from './_faces';

/* A multi-day event drawn across the week's all-day lane. It positions itself
   absolutely from `bar.startCol`/`endCol` as a percentage of SEVEN columns, so
   the host must be a positioned, full-week-width lane. `continuesLeft/Right`
   square off the ends that run past the visible week. */
/* NOTE the layout field is `ev`, not `item` — see layoutBars() in datetime.ts.
   `lane` is the stacking row within the all-day band. */
const bar = (
  id: number,
  title: string,
  startCol: number,
  endCol: number,
  extra: { continuesLeft?: boolean; continuesRight?: boolean; lane?: number } = {},
) => ({
  ev: { id, kind: 'event', title, due_date: '2026-07-27' },
  startCol,
  endCol,
  continuesLeft: !!extra.continuesLeft,
  continuesRight: !!extra.continuesRight,
  lane: extra.lane ?? 0,
});

const lane: React.CSSProperties = {
  position: 'relative',
  width: 470,
  height: 92,
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-sm)',
  background: 'var(--color-paper-2)',
  overflow: 'hidden',
};

const cols: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  pointerEvents: 'none',
};

const Grid = () => (
  <div style={cols}>
    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
      <div
        key={i}
        style={{
          borderRight: i < 6 ? '1px solid var(--color-line)' : 'none',
          fontFamily: 'var(--hub-font-mono)',
          fontSize: 8,
          color: 'var(--color-faint)',
          padding: '3px 5px',
        }}
      >
        {d}
      </div>
    ))}
  </div>
);

const pad: React.CSSProperties = { padding: '18px 20px' };

/** Bars of different spans, stacked in the lane. */
export const Spans = () => (
  <Faces height={130} stacked>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>All-day · Jul 27 – Aug 2</Eyebrow>
      <div style={lane}>
        <Grid />
        <AllDayBar bar={bar(1, 'Offsite', 0, 2)} color="#4ecdc4" top={18} height={18} />
        <AllDayBar bar={bar(2, 'Release freeze', 3, 4)} color="#b42010" top={40} height={18} />
        <AllDayBar bar={bar(3, 'On call', 5, 6)} color="#8a2060" top={62} height={18} />
      </div>
    </div>
  </Faces>
);

/** `continuesLeft` / `continuesRight` square off an end that runs past the
 *  visible week, so the bar reads as clipped rather than as finished. */
export const Continuing = () => (
  <Faces height={130} stacked>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Running past both edges</Eyebrow>
      <div style={lane}>
        <Grid />
        <AllDayBar
          bar={bar(1, 'Started last week', 0, 3, { continuesLeft: true })}
          color="#b8860b"
          top={18}
          height={18}
        />
        <AllDayBar
          bar={bar(2, 'Runs into next week', 4, 6, { continuesRight: true })}
          color="#2a7040"
          top={40}
          height={18}
        />
      </div>
    </div>
  </Faces>
);

import { HourLabel, Eyebrow } from '@jkos/ui';
import { Faces } from './_faces';

/* The mono gutter figure on a timeline's hour rules — deliberately faint, so it
   reads as a measure rather than as content. */
const pad: React.CSSProperties = { padding: '18px 20px' };

/** The label alone, across a morning. */
export const Hours = () => (
  <Faces height={230}>
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM'].map((h) => (
        <HourLabel key={h}>{h}</HourLabel>
      ))}
    </div>
  </Faces>
);

/** In a gutter beside hour rules — how it actually reads on a timeline. */
export const InAGutter = () => (
  <Faces height={230}>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Today</Eyebrow>
      <div style={{ width: 320 }}>
        {['7 AM', '8 AM', '9 AM', '10 AM', '11 AM'].map((h) => (
          <div key={h} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, height: 34 }}>
            <div style={{ width: 40, textAlign: 'right', paddingTop: 1 }}>
              <HourLabel>{h}</HourLabel>
            </div>
            <div style={{ flex: 1, borderTop: '1px solid var(--color-line)' }} />
          </div>
        ))}
      </div>
    </div>
  </Faces>
);

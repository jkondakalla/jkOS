import { NowLine, HourLabel, Eyebrow } from '@jkos/ui';
import { Faces } from './_faces';

/* The now-line: a lit accent dot plus its clock label, drawn across a timeline
   at the current time. The dot halates on the dark face. It renders as a
   fragment, so the caller owns the row it sits in. */
const pad: React.CSSProperties = { padding: '18px 20px' };

/** The mark on its own, at the three dot sizes a timeline uses. */
export const Sizes = () => (
  <Faces height={230}>
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 16, width: 320 }}>
      {[6, 8, 11].map((d) => (
        <div key={d} style={{ display: 'flex', alignItems: 'center' }}>
          <NowLine label="14:20" dot={d} />
        </div>
      ))}
    </div>
  </Faces>
);

/** Across a timeline, which is what makes it read as a POSITION in the day
 *  rather than a line drawn through it. */
export const OnATimeline = () => (
  <Faces height={230}>
    <div style={pad}>
      <Eyebrow style={{ marginBottom: 10 }}>Today</Eyebrow>
      <div style={{ width: 340 }}>
        {['12 PM', '1 PM', '2 PM', '3 PM'].map((h, i) => (
          <div key={h}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, height: 36 }}>
              <div style={{ width: 40, textAlign: 'right', paddingTop: 1 }}>
                <HourLabel>{h}</HourLabel>
              </div>
              <div style={{ flex: 1, borderTop: '1px solid var(--color-line)', position: 'relative' }}>
                {i === 2 && (
                  <div style={{ position: 'absolute', top: 8, left: 0, right: 0, display: 'flex', alignItems: 'center' }}>
                    <NowLine label="14:20" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </Faces>
);

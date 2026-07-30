import { Press, Chip, Lab, Sub } from '@jkos/ui';
import { Faces } from './_faces';

/* Press is the clearest statement of the two philosophies: on PAPER the type is
   struck INTO the sheet (white top catch-light, deepened accent lip below); on
   the TUBE the bevel is meaningless, so the same markup halates instead. Both
   faces are shown on every cell. */

const stack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 18px',
};

/** The default RAISED badge — accent struck off the sheet on paper, glowing on
 *  the tube. It is styled TEXT, not a filled pill, so give it a label to sit
 *  against rather than running several together. */
export const Badge = () => (
  <Faces height={150}>
    <div style={{ ...stack, gap: 10 }}>
      {[
        ['Wave', '26'],
        ['Committed', '3 / 12'],
        ['Next deploy', '16:00'],
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Lab size="xs" style={{ width: 110 }}>
            {label}
          </Lab>
          <Press>{value}</Press>
        </div>
      ))}
    </div>
  </Faces>
);

/** The chip CUT: type pressed INTO the sheet. `ink` keeps neutral ink on a
 *  faint tinted base; `rev` is the cream knockout on a solid tab.
 *
 *  Note the chips carry a `box` style: `.jk-chip` is a surface, so padding and
 *  the type face come from the call site (see Chip's preview / cardSurface). */
const box: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 8px',
  fontFamily: 'var(--hub-font-sans)',
  fontSize: 11.5,
};

export const ChipCuts = () => (
  <Faces height={210}>
    <div style={stack}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Chip solid={false} tint="#4ecdc4" style={box}>
          <Press variant="ink" tint="#4ecdc4">
            Draft the rollout dossier
          </Press>
        </Chip>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Chip tint="#4ecdc4" style={box}>
          <Press variant="rev">Ship staging</Press>
        </Chip>
        <Chip tint="#b42010" style={box}>
          <Press variant="rev">Blocked</Press>
        </Chip>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip small solid={false} tint="#2a7040" style={{ ...box, padding: '2px 6px', fontSize: 10.5 }}>
          <Press variant="sm" tint="#2a7040">
            09:30 standup
          </Press>
        </Chip>
      </div>
    </div>
  </Faces>
);

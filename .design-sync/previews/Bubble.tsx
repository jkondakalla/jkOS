import { Bubble, Lab } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' };

/** The two tones: primary is struck into the paper (and glows on the tube);
 *  secondary lies flat, one rung down. */
export const Tones = () => (
  <Faces height={170}>
    <div style={pad}>
      <div style={row}>
        <Bubble>Staging</Bubble>
        <Bubble>Wave 26</Bubble>
      </div>
      <div style={row}>
        <Bubble tone="secondary">Draft</Bubble>
        <Bubble tone="secondary">Archived</Bubble>
      </div>
    </div>
  </Faces>
);

/** Labelled, the way a bubble reads in real chrome. */
export const InContext = () => (
  <Faces height={170}>
    <div style={pad}>
      {[
        ['Environment', <Bubble key="v">staging</Bubble>],
        ['Branch', <Bubble key="v" tone="secondary">staging</Bubble>],
        ['Release', <Bubble key="v">Wave 26</Bubble>],
      ].map(([label, value]) => (
        <div key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Lab size="xs" style={{ width: 110 }}>
            {label}
          </Lab>
          {value}
        </div>
      ))}
    </div>
  </Faces>
);

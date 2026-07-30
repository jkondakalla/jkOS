import { Sub, Lab, Press } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 };

/** Flat SECONDARY text — one rung down from the struck primary accent. */
export const Default = () => (
  <Faces height={170}>
    <div style={pad}>
      <Sub>Full Press · the printed face</Sub>
      <Sub>16 schedules · 6 on the bench</Sub>
      <Sub>Last synced 14:20</Sub>
    </div>
  </Faces>
);

/** Against its neighbours: the accent is struck, the secondary lies flat, the
 *  mono label is chrome. The three-rung ladder in one line of copy. */
export const AgainstPrimary = () => (
  <Faces height={170}>
    <div style={pad}>
      <Lab size="xs">Deploy</Lab>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Press>staging</Press>
        <Sub>promoted 12 minutes ago</Sub>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Press>production</Press>
        <Sub>waiting on approval</Sub>
      </div>
    </div>
  </Faces>
);

import { TButton, Lab, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' };

/** The compact mono text button — the suite's default action. */
export const Default = () => (
  <Faces height={150}>
    <div style={pad}>
      <div style={row}>
        <TButton>Promote</TButton>
        <TButton>Rebuild</TButton>
        <TButton>Open logs</TButton>
      </div>
    </div>
  </Faces>
);

/** A real action bar — the loud action leading, the quiet one trailing. */
export const ActionBar = () => (
  <Faces height={150}>
    <div style={{ ...pad, maxWidth: 380 }}>
      <Lab size="xs">Promote staging → production</Lab>
      <Rule />
      <div style={{ ...row, justifyContent: 'flex-end', marginTop: 4 }}>
        <TButton quiet>Cancel</TButton>
        <TButton>Promote</TButton>
      </div>
    </div>
  </Faces>
);

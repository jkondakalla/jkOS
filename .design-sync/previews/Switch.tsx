import { useState } from 'react';
import { Switch, Lab, Sub, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };

/** Controlled on/off. Renders a real `<button role="switch">`, so the tap-floor
 *  and aria state come from the platform. */
export const OnOff = () => (
  <Faces height={220}>
    <div style={{ ...pad, flexDirection: 'row', alignItems: 'center', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch checked={false} />
        <Sub>off</Sub>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch checked />
        <Sub>on</Sub>
      </div>
    </div>
  </Faces>
);
/* NOTE: `disabled` is a real prop, but hub.css gives `.jk-switch` no disabled
   styling (only `.jk-slider:disabled` has any), so a disabled switch is pixel-
   identical to an enabled one. Showing it here would assert a state the DS does
   not actually render — the prop stays documented in Switch.d.ts instead. */

/** A real settings block — the call site switches actually live in. */
export const SettingsRows = () => {
  const [on, setOn] = useState({ crt: true, motion: false, offline: true });
  const rows: Array<[keyof typeof on, string, string]> = [
    ['crt', 'CRT overlay', 'Scanlines and halation on the dark face'],
    ['motion', 'Reduced motion', 'Freeze the choreography'],
    ['offline', 'Offline cache', 'Keep the library readable without a network'],
  ];
  return (
    <Faces height={220}>
      <div style={{ ...pad, maxWidth: 420 }}>
        <Lab size="xs">Effects</Lab>
        <Rule />
        {rows.map(([k, label, note]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
            <div>
              <div style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 14 }}>{label}</div>
              <Sub>{note}</Sub>
            </div>
            <Switch checked={on[k]} onChange={(next) => setOn((s) => ({ ...s, [k]: next }))} />
          </div>
        ))}
      </div>
    </Faces>
  );
};

import { useState } from 'react';
import { SettingsDrawer, SettingsSection, Switch, Sub } from '@jkos/ui';
import { Faces } from './_faces';

/* The drawer's data contract mirrors @jkos/auth-client's useJkOSPreferences()
   return value; the types are declared structurally in @jkos/ui so the package
   stays decoupled from auth-client. These fixtures are that exact shape. */
const user = { email: 'jag@jkos.net', name: 'Jag Kondakalla', role: 'owner' };
const theme = { mode: 'light' as const, primary: '#ffb000', secondary: '#4ecdc4' };
const effects = { scanLines: true, scanStrength: 0.4, artifacts: false };

/* The drawer is a fixed-position tray, so the card needs a positioned host with
   its own stacking context or it escapes to the viewport. */
const host: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  height: 560,
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-widget)',
  background: 'var(--color-paper)',
  isolation: 'isolate',
};

const noop = () => {};

/** The one settings tray the whole suite mounts — theme, accent pair, effects
 *  and the account row, painted entirely from the shared tokens. */
export const Open = () => {
  const [t, setT] = useState(theme);
  const [e, setE] = useState(effects);
  return (
    <Faces height={560} stacked>
      <div style={host}>
        <SettingsDrawer
          open
          onClose={noop}
          user={user}
          theme={t}
          effects={e}
          saving={false}
          patchTheme={(p) => setT((s) => ({ ...s, ...p }))}
          patchEffects={(p) => setE((s) => ({ ...s, ...p }))}
          authUrl="https://auth.jkos.net"
        />
      </div>
    </Faces>
  );
};

/** `saving` shows the in-flight state while a preference write is round-tripping. */
export const Saving = () => (
  <Faces height={560} stacked>
    <div style={host}>
      <SettingsDrawer
        open
        onClose={noop}
        user={user}
        theme={theme}
        effects={effects}
        saving
        patchTheme={noop}
        patchEffects={noop}
        authUrl="https://auth.jkos.net"
      />
    </div>
  </Faces>
);

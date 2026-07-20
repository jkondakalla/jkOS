import { useState, useEffect } from 'react';
import { injectJkOSTheme } from '@jkos/design';
import BootSequence from './components/BootSequence';
import AuthGuard from './components/AuthGuard';
import RoomHUD from './pages/hud/RoomHUD';
import WidgetWorkshop from './pages/WidgetWorkshop';

// ORDECK supplies its per-app inputs to the @jkos/design factory, scoped to the
// HUD theme (html.od-v2) — the portal's only face now that the legacy canvas
// deck is gone. Like BeigeBoard: serif → Fraunces (sans/mono inherit the IBM
// Plex factory defaults) and a softened radius scale. The neutral palette and
// the od-v2 accent/shadow helpers still live in hud.css; this call owns the
// font + radius inputs so every HUD shape retunes from one place. Accents stay
// user-driven (applyJkOSTheme, in useJkOSPreferences).
injectJkOSTheme({
  selector: 'html.od-v2',
  radius: { base: '10px', xs: '4px', sm: '7px', lg: '16px', soft: '8px', button: '9px' },
});

// The HUD is the portal's only view; its styles are scoped under html.od-v2
// (a future customizable-grid view can branch off this class again).
document.documentElement.classList.add('od-v2');

export default function App() {
  const [booted, setBooted] = useState(false);
  // Tiny path switch (no router dep): /widgets is the admin workshop, else the HUD.
  const isWidgets = window.location.pathname.replace(/\/+$/, '') === '/widgets';

  // Keep the od-v2 scope class pinned even if something else toggles it.
  useEffect(() => { document.documentElement.classList.add('od-v2'); }, []);

  return (
    <>
      <BootSequence onDone={() => setBooted(true)} />
      {booted && (
        <AuthGuard>
          {isWidgets ? <WidgetWorkshop /> : <RoomHUD />}
        </AuthGuard>
      )}
    </>
  );
}

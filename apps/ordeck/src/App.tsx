import { useState, useEffect } from 'react';
import BootSequence from './components/BootSequence';
import AuthGuard from './components/AuthGuard';
import Dashboard from './pages/Dashboard';
import RoomHUD from './pages/hud/RoomHUD';

const VIEW_KEY = 'ordeck-view';
type View = 'hud' | 'canvas';

function loadView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'canvas' ? 'canvas' : 'hud'; }
  catch { return 'hud'; }
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>(loadView);

  // The room HUD (v2) is scoped under html.od-v2; the legacy canvas keeps the
  // CRT scanline/vignette body overlays (gated on html:not(.od-v2)).
  useEffect(() => {
    document.documentElement.classList.toggle('od-v2', view === 'hud');
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  return (
    <>
      <BootSequence onDone={() => setBooted(true)} />
      {booted && (
        <AuthGuard>
          {view === 'hud'
            ? <RoomHUD onOpenCanvas={() => setView('canvas')} />
            : <Dashboard onOpenHUD={() => setView('hud')} />}
        </AuthGuard>
      )}
    </>
  );
}

import { useState, useEffect, useRef } from 'react';
import { SettingsDrawer } from '@jkos/ui';
import { useJkOSPreferences, AUTH_URL } from '../../hooks/useJkOSPreferences';
import { WeatherSection } from '../../components/settings/WeatherSection';
import {
  useClock, useWeather, useSystems, useToday, useStudy, useApps,
  useMonthCalendar,
} from './useHudData';
import { HudGrid } from '../../hud/HudGrid';
import { renderWidget, type WidgetCtx } from '../../hud/registry';
import {
  loadHudState, saveHudState, removeToShelf, placeFromShelf, shelvedWidgets, setBreakpointLayout,
} from '../../hud/state';
import type { HudState } from '../../hud/types';
import '../../styles/hud.css';

/* ORDECK v3 "room HUD" — the portal's default face.
   A custom responsive grid (12-col desktop → 2-col mobile) arranges native,
   data-driven widgets from a normalized HUD document (hud/state). The old
   fixed three-column layout and the Module-Federation remote-widget path are
   retired; widgets now read app data Ordeck already pulls (BeigeBoard's
   /api/bb/* is the reference integration). Edit mode shelves/places cards;
   drag, resize, the asset shelf, long-press, and the admin creator build on
   this foundation in later phases. */

export default function RoomHUD() {
  const { theme, effects, lazuros, user, saving, patchTheme, patchEffects, patchLazuros } =
    useJkOSPreferences();

  const clock   = useClock();
  const weather = useWeather();
  const systems = useSystems(lazuros.enabled);
  const today   = useToday();
  const study   = useStudy();
  const apps    = useApps(AUTH_URL);
  const cal     = useMonthCalendar();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen]         = useState(false);
  const [editMode, setEditMode]         = useState(false);
  const [hud, setHud]                   = useState<HudState>(loadHudState);
  const popRef = useRef<HTMLDivElement>(null);

  const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
  const toggleMode = () => patchTheme({ mode: isDark ? 'light' : 'dark' });

  // Every HUD mutation persists immediately — placement is the user's document.
  const update = (next: HudState) => { setHud(next); saveHudState(next); };
  const shelve = (id: string) => update(removeToShelf(hud, id));
  const place  = (id: string) => update(placeFromShelf(hud, id, window.innerWidth));
  // Hand the card's definition to the workshop (works for any placed spec card,
  // published or not) and open the editor.
  const editInWorkshop = (id: string) => {
    const def = hud.widgets[id];
    if (!def) return;
    try { localStorage.setItem('ordeck-widget-edit', JSON.stringify(def)); } catch { /* ignore */ }
    window.location.href = '/widgets';
  };

  useEffect(() => {
    if (!appsOpen) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setAppsOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [appsOpen]);

  useEffect(() => {
    if (!editMode) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditMode(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [editMode]);

  // Merge admin-published widgets (jkAuth registry) into the registry so they
  // show on the add strip and render via the spec factory. Server wins; this
  // runtime merge isn't persisted to the user's local HUD doc.
  useEffect(() => {
    fetch(`${AUTH_URL}/auth/widgets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { widgets: [] }))
      .then((d) => {
        const list = Array.isArray(d.widgets) ? d.widgets : [];
        if (!list.length) return;
        setHud((h) => {
          const widgets = { ...h.widgets };
          for (const w of list) if (w && typeof w.id === 'string') widgets[w.id] = w;
          return { ...h, widgets };
        });
      })
      .catch(() => {});
  }, []);

  function toggleEdit() {
    setEditMode(m => !m);
  }

  // Widgets registered but unplaced — the add strip (asset shelf, Phase 2).
  // AI-backed widgets honor the suite-wide LazurOS kill switch.
  const shelf = shelvedWidgets(hud).filter(w => !w.ai || lazuros.enabled);

  const sysDot = systems.up === systems.total ? 'var(--hub-green)'
    : systems.up === 0 ? 'var(--hub-red)' : 'var(--hub-warn)';

  const ctx: WidgetCtx = { clock, weather, systems, today, study, cal, authUrl: AUTH_URL };

  return (
    <div className={`hud-root${editMode ? ' edit-mode' : ''}`}>

      {/* ── Top strip ── */}
      <div className="hud-top" style={{ position: 'relative' }}>
        <button className="hud-logo" onClick={() => setAppsOpen(o => !o)} title="jkOS apps">jk</button>
        <span className="hud-wordmark">ORDECK</span>
        <span style={{ flex: 1 }} />

        <span className="hud-syschip">
          <span className="hud-dot pulse" style={{ background: sysDot }} />
          {systems.up} OF {systems.total} SYSTEMS UP
        </span>

        <button className="hud-topbtn" onClick={toggleMode} title="Toggle theme">
          {isDark ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />
            </svg>
          )}
        </button>

        <button className="hud-topbtn" data-active={settingsOpen} onClick={() => setSettingsOpen(o => !o)} title="Profile & settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

        {/* Edit mode — click to enter, click again (or Esc) to exit.
            Long-press entry (Feature 2) replaces this toggle in a later phase. */}
        <button
          className="hud-topbtn"
          data-active={editMode}
          onClick={toggleEdit}
          title={editMode ? 'Done editing' : 'Edit HUD cards'}
        >
          {editMode ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          )}
        </button>

        {appsOpen && (
          <div className="hud-apps-pop" ref={popRef}>
            {apps.length === 0 && (
              <div className="hud-empty" style={{ padding: 12 }}>NO APPS REGISTERED</div>
            )}
            {apps.map(a => (
              <a key={a.id} href={a.origin}>
                <span className="hud-app-glyph">{a.name.slice(0, 2).toUpperCase()}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="hud-app-name" style={{ display: 'block' }}>{a.name}</span>
                  <span className="hud-app-domain">{a.origin.replace(/^https?:\/\//, '')}</span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit mode bar: place shelved widgets back onto the canvas ── */}
      {editMode && shelf.length > 0 && (
        <div className="hud-edit-bar">
          <span>add widget</span>
          {shelf.map(w => (
            <button key={w.id} className="hud-edit-restore" onClick={() => place(w.id)}>
              + {w.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Main grid (custom engine) ── */}
      <HudGrid
        state={hud}
        editMode={editMode}
        onRemove={shelve}
        onEdit={editInWorkshop}
        onRequestEdit={() => setEditMode(true)}
        onLayoutChange={(bpName, items) => update(setBreakpointLayout(hud, bpName, items))}
        renderWidget={(def) => renderWidget(def, ctx)}
      />

      {/* ── Bottom strip ── */}
      <div className="hud-bottom">
        <span>ORDECK V3</span>
        <span>·</span>
        <span>{isDark ? 'PHOSPHOR' : 'PAPER'}</span>
        {user && (
          <>
            <span>·</span>
            <span>{String((user as any).name ?? (user as any).email ?? 'OPERATOR').toUpperCase()}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {editMode && (
          <span style={{ color: 'var(--accent-ink)', fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
            EDIT MODE · ESC TO EXIT
          </span>
        )}
        <span className="ready">
          <span className="hud-dot" />
          READY
        </span>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        theme={theme}
        effects={effects}
        lazuros={lazuros}
        saving={saving}
        patchTheme={patchTheme}
        patchEffects={patchEffects}
        patchLazuros={patchLazuros}
        authUrl={AUTH_URL}
        extra={<WeatherSection />}
      />
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { SettingsDrawer } from '@jkos/ui';
import { authFetch } from '@jkos/auth-client';
import { useJkOSPreferences, AUTH_URL } from '../../hooks/useJkOSPreferences';
import { WeatherSection } from '../../components/settings/WeatherSection';
import { useApps } from './useHudData';
import { useHudContext } from './useHudContext';
import { HudGrid } from '../../hud/HudGrid';
import { WidgetTray } from '../../hud/WidgetTray';
import { renderWidget } from '../../hud/registry';
import { activeBreakpoint, layoutForBreakpoint, autoBalance } from '../../hud/engine';
import {
  loadHudState, saveHudState, defaultHudState, mergePublished,
  removeToShelf, placeFromShelf, shelvedWidgets, setBreakpointLayout,
  WIDGET_EDIT_KEY,
} from '../../hud/state';
import type { Breakpoint, BreakpointName, GridItem, HudState } from '../../hud/types';
import '../../styles/hud.css';

/* ORDECK v3 "room HUD" — the portal's default face.
   A custom responsive grid (12-col desktop → 2-col mobile) arranges native,
   data-driven widgets from a normalized HUD document (hud/state). The old
   fixed three-column layout and the Module-Federation remote-widget path are
   retired; widgets now read app data Ordeck already pulls (BeigeBoard's
   /api/beigeboard/* is the reference integration). Edit mode shelves/places cards;
   drag, resize, the asset shelf, long-press, and the admin creator build on
   this foundation in later phases. */

export default function RoomHUD() {
  const { theme, effects, lazuros, user, saving, patchTheme, patchEffects, patchLazuros } =
    useJkOSPreferences();

  // All widget slices in one context (single BeigeBoard fetch shared across them).
  const ctx  = useHudContext(lazuros.enabled);
  const apps = useApps(AUTH_URL);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen]         = useState(false);
  const [editMode, setEditMode]         = useState(false);
  // Render defaults instantly; hydrate from jkAuth prefs once it resolves.
  const [hud, setHud]                   = useState<HudState>(defaultHudState);
  // The tier the grid is ACTUALLY showing, reported from its container width.
  // Resolving from window.innerWidth here would disagree with the grid just
  // past the 768/1024 boundaries (the canvas padding) and mutate a tier the
  // user isn't looking at; the window fallback only covers the first frame.
  const [gridBp, setGridBp]             = useState<Breakpoint | null>(null);
  // Cards the user hand-placed since entering edit mode. Auto-balance packs
  // around these instead of moving them — their spot is intent, not accident.
  const [sessionMoved, setSessionMoved] = useState<ReadonlySet<string>>(new Set());
  // The layout as it was before the last auto-balance — one-click escape hatch.
  // Cleared by any other layout mutation, which makes the snapshot stale.
  const [undoBal, setUndoBal] = useState<{ bp: BreakpointName; items: GridItem[] } | null>(null);
  const hydratedRef = useRef(false);
  const popRef = useRef<HTMLDivElement>(null);

  const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
  const toggleMode = () => patchTheme({ mode: isDark ? 'light' : 'dark' });

  // Every HUD mutation persists immediately — placement is the user's document.
  // Suppressed until hydration completes so the initial defaults never overwrite
  // the user's stored doc.
  const update = (next: HudState) => { setHud(next); if (hydratedRef.current) saveHudState(next); };
  const currentBp = () => gridBp ?? activeBreakpoint(window.innerWidth);
  const shelve = (id: string) => {
    // A shelved card loses its session pin: if it comes back it lands at an
    // auto-chosen spot, which is no longer the user's hand placement.
    setSessionMoved((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev); next.delete(id); return next;
    });
    setUndoBal(null);
    update(removeToShelf(hud, id));
  };
  const place  = (id: string) => { setUndoBal(null); update(placeFromShelf(hud, id, currentBp())); };
  // Auto-balance: tidy the tier on screen — pull cards up into gaps while
  // keeping the arrangement recognisable; cards hand-placed this edit session
  // stay put (engine `keep`). No-op aware: the undo snapshot is only captured
  // when something actually moves, so "undo" never appears with nothing to undo.
  const balance = () => {
    const bp = currentBp();
    const items = layoutForBreakpoint(hud, bp);
    const balanced = autoBalance(items, bp.cols, { keep: sessionMoved });
    const changed = balanced.some((b) => {
      const cur = items.find((c) => c.i === b.i);
      return !cur || cur.x !== b.x || cur.y !== b.y;
    });
    if (!changed) return;
    setUndoBal({ bp: bp.name, items });
    update(setBreakpointLayout(hud, bp.name, balanced));
  };
  const undoBalance = () => {
    if (!undoBal) return;
    update(setBreakpointLayout(hud, undoBal.bp, undoBal.items));
    setUndoBal(null);
  };
  // Entering edit mode starts a fresh placement session: the pin set that
  // auto-balance honours and the balance-undo snapshot both reset.
  const enterEdit = () => { setSessionMoved(new Set()); setUndoBal(null); setEditMode(true); };
  // Hand the card's definition to the workshop (works for any placed spec card,
  // published or not) and open the editor.
  const editInWorkshop = (id: string) => {
    const def = hud.widgets[id];
    if (!def) return;
    try { localStorage.setItem(WIDGET_EDIT_KEY, JSON.stringify(def)); } catch { /* ignore */ }
    window.location.href = '/widgets';
  };
  // Open the workshop to compose a NEW widget — clear any stale "edit this card"
  // handoff so it starts blank rather than reloading a previously-edited card.
  const openWorkshop = () => {
    try { localStorage.removeItem(WIDGET_EDIT_KEY); } catch { /* ignore */ }
    window.location.href = '/widgets';
  };

  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

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

  // Hydrate the user's HUD doc from jkAuth prefs, THEN merge admin-published
  // widgets (jkAuth registry) on top so they show on the add strip and render
  // via the spec factory. Order matters: hydration replaces the whole doc, so
  // it must land before the (functional) merge — otherwise it would clobber it.
  // authFetch (not plain fetch) so an expired access token is refreshed instead
  // of a silent 401 leaving stale defs on screen. The merge runs on SUCCESS even
  // when the list is empty — that's how "everything unpublished" cleans up.
  useEffect(() => {
    let dead = false;
    (async () => {
      const loaded = await loadHudState();
      if (dead) return;
      setHud(loaded);
      hydratedRef.current = true;

      try {
        const r = await authFetch(`${AUTH_URL}/auth/widgets`);
        if (!r.ok) return;                       // signed out / error → keep the doc as-is
        const d = await r.json();
        const list = Array.isArray(d.widgets) ? d.widgets : [];
        if (dead) return;
        setHud((h) => mergePublished(h, list));
      } catch { /* add strip just shows the built-ins */ }
    })();
    return () => { dead = true; };
  }, []);

  function toggleEdit() {
    if (editMode) setEditMode(false);
    else enterEdit();
  }

  // Widgets registered but unplaced — the tray's tiles (asset shelf, Phase 2).
  // AI-backed widgets honor the suite-wide LazurOS kill switch. Memoised so the
  // tray (memo'd) skips the per-second clock re-render of this component.
  const shelf = useMemo(
    () => shelvedWidgets(hud).filter(w => !w.ai || lazuros.enabled),
    [hud, lazuros.enabled],
  );

  const sysDot = ctx.systems.up === ctx.systems.total ? 'var(--hub-green)'
    : ctx.systems.up === 0 ? 'var(--hub-red)' : 'var(--hub-warn)';

  // Focus mode: when a task is focused AND the Focus card is on the canvas, the
  // grid dims every other card around it. Skipped if the card is shelved (else
  // there'd be nothing to highlight).
  const focusPlaced = !shelvedWidgets(hud).some((w) => w.id === 'focus');
  const highlightId = ctx.focus.active && focusPlaced ? 'focus' : undefined;

  return (
    <div className={`hud-root${editMode ? ' edit-mode' : ''}`}>

      {/* ── Top strip ── */}
      <div className="hud-top" style={{ position: 'relative' }}>
        <button className="hud-logo" onClick={() => setAppsOpen(o => !o)} title="jkOS apps">jk</button>
        <span className="hud-wordmark">ORDECK</span>
        <span style={{ flex: 1 }} />

        <span className="hud-syschip">
          <span className="hud-dot pulse" style={{ background: sysDot }} />
          {ctx.systems.up} OF {ctx.systems.total} SYSTEMS UP
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

        {/* Widget Workshop — compose/publish a new widget (admin only). */}
        {isAdmin && (
          <button className="hud-topbtn" onClick={openWorkshop} title="Widget workshop">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M17.5 14.5v6M14.5 17.5h6" />
            </svg>
          </button>
        )}

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

      {/* ── Widget tray: slides down in edit mode — visual shelf + layout tools.
             Always mounted so it can animate closed (CSS owns visibility). ── */}
      <WidgetTray
        open={editMode}
        widgets={shelf}
        onPlace={place}
        onBalance={balance}
        canUndo={!!undoBal}
        onUndo={undoBalance}
      />

      {/* ── Main grid (custom engine) ── */}
      <HudGrid
        state={hud}
        editMode={editMode}
        highlightId={highlightId}
        onRemove={shelve}
        onEdit={editInWorkshop}
        onRequestEdit={enterEdit}
        onLayoutChange={(bpName, items, movedId) => {
          if (movedId) setSessionMoved((prev) => new Set(prev).add(movedId));
          setUndoBal(null);
          update(setBreakpointLayout(hud, bpName, items));
        }}
        onBreakpoint={setGridBp}
        sessionPinned={sessionMoved}
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
          <span style={{ color: 'var(--color-accent-ink)', fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
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

import { useState, useCallback, useEffect } from 'react';
import { WidgetInstance, WidgetType } from '@jkos/types';
import { useJkOSPreferences } from '../hooks/useJkOSPreferences';
import { UnifiedSettingsPanel } from '../components/settings/UnifiedSettingsPanel';
import { FilmGrain, Halation, ScanLines, Artifacts } from '../components/Overlays';
import { AppLauncher } from '../components/AppLauncher';
import WidgetPalette from '../components/WidgetPalette';
import type { PaletteEntry, ActiveSession } from '../components/WidgetPalette';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Canvas, { CanvasRegistryEntry } from '../components/canvas/Canvas';
import BusStrip from '../components/BusStrip';
import RightRail from '../components/RightRail';
import { useSettings, SettingsPanel } from '../components/settings';
import { ContextSystem, ContextState } from '../components/ContextMenu';
import AiPanel from '../components/AiPanel';

// Core widgets
import AppsWidget from '../widgets/core/AppsWidget';
import ClockWidget from '../widgets/core/ClockWidget';
import ConnectionsWidget from '../widgets/core/ConnectionsWidget';
import PluginsWidget from '../widgets/core/PluginsWidget';
import LogWidget from '../widgets/core/LogWidget';
import { ScopeWidget } from '../widgets/core/ScopeWidget';
import { MemMapWidget } from '../widgets/core/MemMapWidget';

// Tool widgets
import StopwatchWidget from '../widgets/tools/StopwatchWidget';
import WorldClocksWidget from '../widgets/tools/WorldClocksWidget';
import CalcWidget from '../widgets/tools/CalcWidget';
import PomodoroWidget from '../widgets/tools/PomodoroWidget';
import CalendarWidget from '../widgets/tools/CalendarWidget';

// Deco widgets
import SpinningReelWidget from '../widgets/deco/SpinningReelWidget';
import NixieBankWidget from '../widgets/deco/NixieBankWidget';
import StatusLightsWidget from '../widgets/deco/StatusLightsWidget';
import GrillePanelWidget from '../widgets/deco/GrillePanelWidget';
import LabelStripWidget from '../widgets/deco/LabelStripWidget';
import TickerWidget from '../widgets/deco/TickerWidget';
import DataRainWidget from '../widgets/deco/DataRainWidget';
import GaugeBankWidget from '../widgets/deco/GaugeBankWidget';
import BlankPanelWidget from '../widgets/deco/BlankPanelWidget';

// ─── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY: Record<string, CanvasRegistryEntry> = {
  // ── Core ──────────────────────────────────────────────────────────────────
  apps: {
    type: 'apps', label: 'APP REGISTRY', title: 'APPS', code: 'APP',
    glyph: '◈', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: 'jkOS SUITE',
    component: AppsWidget, w: 12, h: 8,
  },
  clock: {
    type: 'clock', label: 'CHRONOMETER', title: 'CHRONO', code: 'CLK',
    glyph: '⌚', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: 'UTC · LOCAL · JDAY',
    component: ClockWidget, w: 6, h: 5,
  },
  plugins: {
    type: 'plugins', label: 'PLUGIN MANAGER', title: 'PLUGINS', code: 'PLG',
    glyph: '⬡', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: 'LOADED MODULES',
    component: PluginsWidget, w: 10, h: 7,
  },
  connections: {
    type: 'connections', label: 'CONNECTIONS', title: 'CONNS', code: 'CON',
    glyph: '⇌', color: '#4ecdc4', header: 'classic', led: 'cyan',
    subtitle: 'ACTIVE LINKS',
    component: ConnectionsWidget, w: 7, h: 7,
  },
  log: {
    type: 'log', label: 'OPERATOR LOG', title: 'LOG', code: 'LOG',
    glyph: '▤', color: '#5cd66a', header: 'classic', led: 'green',
    subtitle: 'SYSTEM OUTPUT',
    component: (p) => <LogWidget widgetId={p.widgetId} />, w: 8, h: 6,
  },
  scope: {
    type: 'scope', label: 'OSCILLOSCOPE', title: 'SCOPE', code: 'OSC',
    glyph: '∿', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: 'CH1+CH2 · LIVE',
    component: ScopeWidget, w: 8, h: 6,
  },
  memmap: {
    type: 'memmap', label: 'MEMORY MAP', title: 'MEM', code: 'MEM',
    glyph: '▦', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: '256 × 64KB',
    component: MemMapWidget, w: 7, h: 6,
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  stopwatch: {
    type: 'stopwatch', label: 'STOPWATCH', title: 'SWATCH', code: 'STW',
    glyph: '⏱', color: '#ffb000', header: 'tab', led: 'amber',
    subtitle: 'LAP TIMER',
    component: (p) => <StopwatchWidget widgetId={p.widgetId} />, w: 5, h: 5,
  },
  worldclocks: {
    type: 'worldclocks', label: 'WORLD CLOCKS', title: 'ZONES', code: 'WCK',
    glyph: '🌐', color: '#4ecdc4', header: 'tab', led: 'cyan',
    subtitle: '4 TIMEZONES',
    component: WorldClocksWidget, w: 8, h: 5,
  },
  calc: {
    type: 'calc', label: 'CALCULATOR', title: 'CALC', code: 'CAL',
    glyph: '⊞', color: '#c08aff', header: 'chip', led: 'amber',
    subtitle: '4-FUNCTION',
    component: (p) => <CalcWidget widgetId={p.widgetId} />, w: 5, h: 7,
  },
  pomodoro: {
    type: 'pomodoro', label: 'POMODORO', title: 'POMO', code: 'PMD',
    glyph: '◉', color: '#ff4530', header: 'band', led: 'amber',
    subtitle: 'FOCUS TIMER',
    component: (p) => <PomodoroWidget widgetId={p.widgetId} />, w: 5, h: 6,
  },
  calendar: {
    type: 'calendar', label: 'CALENDAR', title: 'CAL', code: 'DATE',
    glyph: '▦', color: '#5cd66a', header: 'classic', led: 'green',
    subtitle: 'MONTH VIEW',
    component: CalendarWidget, w: 7, h: 6,
  },

  // ── Deco ──────────────────────────────────────────────────────────────────
  reel: {
    type: 'reel', label: 'TAPE REEL', title: 'REEL', code: 'RWD',
    glyph: '⏺', color: '#8a5f00', header: 'strip', led: 'amber',
    subtitle: 'CASSETTE · A',
    component: SpinningReelWidget, w: 5, h: 5,
  },
  nixie: {
    type: 'nixie', label: 'NIXIE BANK', title: 'NIXIE', code: 'NIX',
    glyph: '7', color: '#ff8c28', header: 'chip',
    subtitle: 'COUNTER TUBES',
    component: NixieBankWidget, w: 5, h: 4,
  },
  status: {
    type: 'status', label: 'STATUS LIGHTS', title: 'STATUS', code: 'STS',
    glyph: '●', color: '#5cd66a', header: 'strip', led: 'green',
    subtitle: 'BANK · 01',
    component: StatusLightsWidget, w: 6, h: 5,
  },
  grille: {
    type: 'grille', label: 'SPEAKER GRILLE', title: 'GRILLE', code: 'SPK',
    glyph: '▤', color: '#4a4232', header: 'classic',
    subtitle: 'MONITOR · 8Ω',
    component: GrillePanelWidget, w: 5, h: 5,
  },
  label: {
    type: 'label', label: 'LABEL STRIP', title: 'LABEL', code: 'LBL',
    glyph: '▬', color: '#ffb000', header: 'chip',
    subtitle: 'DYMO · EDITABLE',
    component: (p) => <LabelStripWidget widgetId={p.widgetId} />, w: 6, h: 3,
  },
  ticker: {
    type: 'ticker', label: 'NEWS TICKER', title: 'TICKER', code: 'TKR',
    glyph: '▶', color: '#ffb000', header: 'strip', led: 'amber',
    subtitle: 'SCROLLING TEXT',
    component: (p) => <TickerWidget widgetId={p.widgetId} />, w: 10, h: 3,
  },
  datarain: {
    type: 'datarain', label: 'DATA RAIN', title: 'RAIN', code: 'DRN',
    glyph: '↓', color: '#4ecdc4', header: 'chip', led: 'cyan',
    subtitle: 'STREAM 0x----',
    component: DataRainWidget, w: 6, h: 7,
  },
  gauges: {
    type: 'gauges', label: 'GAUGE BANK', title: 'GAUGES', code: 'GBK',
    glyph: '◎', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: 'V · A · Ω',
    component: GaugeBankWidget, w: 7, h: 5,
  },
  blank: {
    type: 'blank', label: 'BLANK PANEL', title: 'BLANK', code: 'BLK',
    glyph: '□', color: '#3a3528', header: 'classic',
    subtitle: 'RESERVED',
    component: BlankPanelWidget, w: 4, h: 4,
  },

  // ── Remote ────────────────────────────────────────────────────────────────
  plex: {
    type: 'plex', label: 'PLEX MEDIA', title: 'PLEX', code: 'PLX',
    glyph: '◈', color: '#e5a00d', header: 'classic', led: 'green',
    subtitle: 'MEDIA SERVER',
    component: null, remote: true, w: 10, h: 8,
  },
  lazuros: {
    type: 'lazuros', label: 'LAZUROS COMPUTE', title: 'LAZUROS', code: 'LAZ',
    glyph: '⎔', color: '#4ecdc4', header: 'classic', led: 'cyan',
    subtitle: '8-CORE MONITOR',
    component: null, remote: true, w: 10, h: 8,
  },
  beigeboard: {
    type: 'beigeboard', label: 'BEIGEBOARD', title: 'BB', code: 'BRD',
    glyph: '▣', color: '#ffb000', header: 'classic', led: 'amber',
    subtitle: 'TASK SURFACE',
    component: null, remote: true, w: 10, h: 8,
  },
  recipe: {
    type: 'recipe', label: 'RECIPE LIBRARY', title: 'RECIPES', code: 'RCP',
    glyph: '◉', color: '#5cd66a', header: 'classic', led: 'green',
    subtitle: 'FOOD DATABASE',
    component: null, remote: true, w: 9, h: 8,
  },
};

// Palette-friendly list derived from registry
const SIDEBAR_REGISTRY: PaletteEntry[] = [
  // Core
  { ...REGISTRY.apps,        type: 'apps',        led: 'amber' },
  { ...REGISTRY.clock,       type: 'clock',       led: 'amber' },
  { ...REGISTRY.plugins,     type: 'plugins',     led: 'amber' },
  { ...REGISTRY.connections, type: 'connections', led: 'cyan'  },
  { ...REGISTRY.log,         type: 'log',         led: 'green' },
  { ...REGISTRY.scope,       type: 'scope',       led: 'amber' },
  { ...REGISTRY.memmap,      type: 'memmap',      led: 'amber' },
  // Tools
  { ...REGISTRY.stopwatch,   type: 'stopwatch',   led: 'amber', tool: true },
  { ...REGISTRY.worldclocks, type: 'worldclocks', led: 'cyan',  tool: true },
  { ...REGISTRY.calc,        type: 'calc',        led: 'amber', tool: true },
  { ...REGISTRY.pomodoro,    type: 'pomodoro',    led: 'amber', tool: true },
  { ...REGISTRY.calendar,    type: 'calendar',    led: 'green', tool: true },
  // Deco
  { ...REGISTRY.reel,      type: 'reel',      led: 'amber', deco: true },
  { ...REGISTRY.nixie,     type: 'nixie',                   deco: true },
  { ...REGISTRY.status,    type: 'status',    led: 'green', deco: true },
  { ...REGISTRY.grille,    type: 'grille',                  deco: true },
  { ...REGISTRY.label,     type: 'label',                   deco: true },
  { ...REGISTRY.ticker,    type: 'ticker',    led: 'amber', deco: true },
  { ...REGISTRY.datarain,  type: 'datarain',  led: 'cyan',  deco: true },
  { ...REGISTRY.gauges,    type: 'gauges',    led: 'amber', deco: true },
  { ...REGISTRY.blank,     type: 'blank',                   deco: true },
  // Remote
  { ...REGISTRY.plex,        type: 'plex',        led: 'green', remote: true },
  { ...REGISTRY.lazuros,     type: 'lazuros',     led: 'cyan',  remote: true },
  { ...REGISTRY.beigeboard,  type: 'beigeboard',  led: 'amber', remote: true },
  { ...REGISTRY.recipe,      type: 'recipe',      led: 'green', remote: true },
];

// Context-facing registry (subset of CanvasRegistryEntry fields)
const CONTEXT_REGISTRY = Object.fromEntries(
  Object.entries(REGISTRY).map(([k, v]) => [k, {
    type: v.type, title: v.title, code: v.code,
    glyph: v.glyph, color: v.color, header: v.header,
    subtitle: v.subtitle, led: v.led,
  }])
);

// ─── Layout state ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ordeck-layout-v2';

interface LayoutState {
  widgets: WidgetInstance[];
  nextId: number;
}

// AppsWidget removed from default — AppLauncher is the portal hero now.
// Keep the widget available in the palette for users who want it pinned.
const DEFAULT_LAYOUT: WidgetInstance[] = [
  { id: 1, type: 'clock',       x: 1,  y: 1, w: 6,  h: 5 },
  { id: 2, type: 'connections', x: 8,  y: 1, w: 7,  h: 8 },
  { id: 3, type: 'log',         x: 16, y: 1, w: 8,  h: 6 },
  { id: 4, type: 'scope',       x: 1,  y: 7, w: 6,  h: 6 },
];

function loadLayout(): LayoutState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LayoutState;
  } catch { /* ignore */ }
  return null;
}

function saveLayout(state: LayoutState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { theme, effects, lazuros, user, saving, patchTheme, patchEffects, patchLazuros } =
    useJkOSPreferences();

  const [state, setState] = useState<LayoutState>(() => {
    const saved = loadLayout();
    return saved ?? { widgets: DEFAULT_LAYOUT, nextId: DEFAULT_LAYOUT.length + 1 };
  });
  const [settings, setSetting, resetSettings] = useSettings();
  const [configOpen, setConfigOpen]   = useState(false);
  const [aiOpen, setAiOpen]           = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextState, setContextState] = useState<ContextState | null>(null);

  useEffect(() => { saveLayout(state); }, [state]);

  const updateWidget = useCallback((id: number, patch: Partial<WidgetInstance>) => {
    setState(s => ({
      ...s,
      widgets: s.widgets.map(w => w.id === id ? { ...w, ...patch } : w),
    }));
  }, []);

  const closeWidget = useCallback((id: number) => {
    setState(s => ({ ...s, widgets: s.widgets.filter(w => w.id !== id) }));
  }, []);

  const focusWidget = useCallback((id: number) => {
    setState(s => {
      const target = s.widgets.find(w => w.id === id);
      if (!target) return s;
      return { ...s, widgets: [...s.widgets.filter(w => w.id !== id), target] };
    });
  }, []);

  const addWidget = useCallback((type: WidgetType) => {
    setState(s => {
      const entry = REGISTRY[type];
      const defaults = entry ? { w: entry.w, h: entry.h } : { w: 8, h: 6 };
      const offset = s.widgets.length % 5;
      const newWidget: WidgetInstance = {
        id: s.nextId, type,
        x: 1 + offset * 2,
        y: 1 + offset * 2,
        ...defaults,
      };
      return { widgets: [...s.widgets, newWidget], nextId: s.nextId + 1 };
    });
  }, []);

  const resetLayout = useCallback(() => {
    if (confirm('Reset surface to default layout?')) {
      setState({ widgets: DEFAULT_LAYOUT, nextId: DEFAULT_LAYOUT.length + 1 });
    }
  }, []);

  const clearAll = useCallback(() => {
    if (confirm('Clear all widgets from surface?')) {
      setState(s => ({ ...s, widgets: [] }));
    }
  }, []);

  const openContext = useCallback((id: number, x: number, y: number) => {
    setContextState({
      widgetId: id,
      anchor: { x, y },
      showPalette: true,
      windows: [],
      openWindow: (win) => setContextState(cs => cs ? { ...cs, windows: cs.windows.find(w => w.id === win) ? cs.windows : [...cs.windows, { id: win }] } : cs),
      closeWindow: (win) => setContextState(cs => cs ? { ...cs, windows: cs.windows.filter(w => w.id !== win) } : cs),
    });
  }, []);

  const closeContext = useCallback(() => setContextState(null), []);

  const contextAction = useCallback((id: number, action: string) => {
    if (action === 'close') {
      closeWidget(id);
      closeContext();
    } else if (action === 'duplicate') {
      setState(s => {
        const src = s.widgets.find(w => w.id === id);
        if (!src) return s;
        return {
          widgets: [...s.widgets, { ...src, id: s.nextId, x: src.x + 1, y: src.y + 1 }],
          nextId: s.nextId + 1,
        };
      });
    } else if (action === 'reset-overrides') {
      updateWidget(id, { overrides: undefined });
    }
  }, [closeWidget, closeContext, updateWidget]);

  const sessions: ActiveSession[] = state.widgets.map(w => ({
    id: w.id,
    label: REGISTRY[w.type]?.label ?? w.type.toUpperCase(),
  }));

  const contentTop = settings.showBus
    ? 'calc(var(--hub-header-h) + var(--hub-bus-h))'
    : 'var(--hub-header-h)';

  return (
    <>
      <Header
        widgetCount={state.widgets.length}
        onOpenConfig={() => setConfigOpen(o => !o)}
        configOpen={configOpen}
        onOpenAI={() => setAiOpen(o => !o)}
        aiOpen={aiOpen}
        onOpenProfile={() => setProfileOpen(o => !o)}
        profileOpen={profileOpen}
        onOpenPalette={() => setPaletteOpen(o => !o)}
        paletteOpen={paletteOpen}
      />

      {settings.showBus && <BusStrip />}

      {/* Vignette overlay — opacity driven by --crt-vignette-opacity CSS var */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.85) 100%)',
          opacity: 'var(--crt-vignette-opacity)' as any,
          pointerEvents: 'none',
          zIndex: 9991,
        }}
      />

      {/* Main content: AppLauncher spine + Widget Canvas */}
      <div style={{
        position: 'fixed',
        top: contentTop,
        left: 0,
        right: settings.showRail ? 'var(--hub-rail-w)' : 0,
        bottom: 'var(--hub-footer-h)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        filter: effects.halation ? 'url(#hub-halation)' : undefined,
      }}>
        <AppLauncher user={user} />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Canvas grid texture */}
          <div
            className="canvas-grid"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}
          />
          <Canvas
            widgets={state.widgets}
            registry={REGISTRY}
            onUpdateWidget={updateWidget}
            onCloseWidget={closeWidget}
            onFocusWidget={focusWidget}
            onContextWidget={openContext}
          />
        </div>
      </div>

      {/* Widget Palette — drawer overlay */}
      <WidgetPalette
        registry={SIDEBAR_REGISTRY}
        sessions={sessions}
        active={paletteOpen}
        onAdd={addWidget}
        onClose={() => setPaletteOpen(false)}
        onResetLayout={resetLayout}
        onClearAll={clearAll}
      />

      {settings.showRail && (
        <div style={{
          position: 'fixed',
          top: contentTop,
          right: 0,
          bottom: 'var(--hub-footer-h)',
          width: 'var(--hub-rail-w)',
        }}>
          <RightRail />
        </div>
      )}

      <Footer widgetCount={state.widgets.length} />

      <ContextSystem
        state={contextState}
        widgets={state.widgets}
        registry={CONTEXT_REGISTRY}
        onUpdate={updateWidget}
        onAction={contextAction}
        onClose={closeContext}
      />

      <SettingsPanel
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        settings={settings}
        set={setSetting}
        reset={resetSettings}
      />

      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />

      <UnifiedSettingsPanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        theme={theme}
        effects={effects}
        lazuros={lazuros}
        saving={saving}
        patchTheme={patchTheme}
        patchEffects={patchEffects}
        patchLazuros={patchLazuros}
      />

      {/* Suite-wide CRT overlays — driven by user preferences */}
      {effects.halation  && <Halation />}
      {effects.grain     && <FilmGrain strength={effects.grainStrength} />}
      {effects.scanLines && <ScanLines strength={effects.scanStrength} />}
      {effects.artifacts && <Artifacts />}
    </>
  );
}

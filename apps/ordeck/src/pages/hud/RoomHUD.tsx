import { useState, useEffect, useRef } from 'react';
import { SettingsDrawer } from '@jkos/ui';
import { useJkOSPreferences, AUTH_URL } from '../../hooks/useJkOSPreferences';
import { WeatherSection } from '../../components/settings/WeatherSection';
import RemoteWidget from '../../widgets/core/RemoteWidget';
import {
  useClock, useWeather, useSystems, useToday, useStudy, useApps, isNow,
  useMonthCalendar, type CalDay,
} from './useHudData';
import '../../styles/hud.css';

/* ORDECK v2 "room HUD" — the portal's default face (Claude Design, 2026-06).
   Calm three-column glanceable dashboard: clock + weather + calendar | today |
   systems + study. Edit mode lets the user show/hide cards without the canvas. */

const BB_URL    = 'https://beigeboard.jkos.net';
const SYLIB_URL = 'https://sylibos.jkos.net';

const CARD_STORAGE = 'ordeck-hud-hidden';

function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CARD_STORAGE) ?? '[]')); }
  catch { return new Set(); }
}
function saveHidden(s: Set<string>) {
  localStorage.setItem(CARD_STORAGE, JSON.stringify([...s]));
}

const MO_FULL = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
const DAY_ABBR = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// Friendly labels for the edit-mode restore strip (keys are the localStorage ids).
const CARD_LABELS: Record<string, string> = {
  weather: 'Weather', calendar: 'Calendar', today: 'Today',
  systems: 'Systems', study: 'Study',
};

/* ── Remote widgets from other jkOS apps ───────────────────────────────────
   The hook that lets another jkOS app surface a widget on the HUD. Each id maps
   to a Module-Federation remote declared in vite.config.ts (`<id>-plugin`); the
   plugin exposes a default <Widget>. Widgets are opt-in — disabled by default,
   enabled from edit mode, persisted in localStorage. They render through
   RemoteWidget, which lazy-loads the remote and degrades to a graceful
   "MODULE FAULT" card when the plugin's remoteEntry.js isn't being served yet.
   `ai` widgets follow the suite-wide LazurOS kill switch. */
const REMOTE_WIDGETS: { id: string; label: string; ai?: boolean }[] = [
  { id: 'beigeboard', label: 'BeigeBoard' },
  { id: 'plex',       label: 'Plex' },
  { id: 'recipe',     label: 'Recipe' },
  { id: 'sylibos',    label: 'SylibOS' },
  { id: 'lazuros',    label: 'LazurOS', ai: true },
];
const WIDGET_STORAGE = 'ordeck-hud-widgets';

function loadWidgets(): string[] {
  try { const v = JSON.parse(localStorage.getItem(WIDGET_STORAGE) ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveWidgets(ids: string[]) {
  localStorage.setItem(WIDGET_STORAGE, JSON.stringify(ids));
}

function MiniCalendar({ cal, editMode, onHide }: {
  cal: ReturnType<typeof useMonthCalendar>;
  editMode: boolean;
  onHide: () => void;
}) {
  const today = new Date();
  const yr = cal.year; const mo = cal.month;
  const first = new Date(yr, mo, 1).getDay();  // 0=Sun
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const dayMap = new Map<string, CalDay>();
  for (const d of cal.days) dayMap.set(d.date, d);

  return (
    <div className="hud-card hud-calendar" style={{ position: 'relative' }}>
      {editMode && (
        <button className="hud-edit-remove" onClick={onHide} title="Hide calendar">×</button>
      )}
      <div className="hud-calendar-head">
        <span className="hud-eyebrow">CALENDAR</span>
        <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>
          {MO_FULL[mo].toUpperCase()} {yr}
        </span>
      </div>
      <div className="hud-cal-grid">
        {DAY_ABBR.map(d => (
          <div key={d} className="hud-cal-dow">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const iso = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const info = dayMap.get(iso);
          const isToday = day === today.getDate() && mo === today.getMonth() && yr === today.getFullYear();
          return (
            <div key={iso} className={`hud-cal-day${isToday ? ' today' : ''}${info ? ' has-tasks' : ''}`}>
              <span className="hud-cal-num">{day}</span>
              {info && (
                <span className="hud-cal-dot" style={{
                  background: info.doneCount === info.count ? 'var(--hub-green)' : 'var(--hub-amber)',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const [hidden, setHidden]             = useState<Set<string>>(loadHidden);
  const [widgets, setWidgets]           = useState<string[]>(loadWidgets);
  const popRef = useRef<HTMLDivElement>(null);

  const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
  const toggleMode = () => patchTheme({ mode: isDark ? 'light' : 'dark' });

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

  function hide(card: string) {
    setHidden(s => { const n = new Set(s); n.add(card); saveHidden(n); return n; });
  }
  function show(card: string) {
    setHidden(s => { const n = new Set(s); n.delete(card); saveHidden(n); return n; });
  }
  function toggleEdit() {
    setEditMode(m => !m);
  }
  function enableWidget(id: string) {
    setWidgets(w => { const n = w.includes(id) ? w : [...w, id]; saveWidgets(n); return n; });
  }
  function disableWidget(id: string) {
    setWidgets(w => { const n = w.filter(x => x !== id); saveWidgets(n); return n; });
  }

  // Available to add: not already enabled, and AI widgets honor the kill switch.
  const addableWidgets = REMOTE_WIDGETS.filter(
    w => !widgets.includes(w.id) && (!w.ai || lazuros.enabled),
  );
  // Enabled widgets that should actually render (drop AI widgets if AI is off).
  const liveWidgets = widgets.filter(id => {
    const meta = REMOTE_WIDGETS.find(w => w.id === id);
    return meta ? (!meta.ai || lazuros.enabled) : true;
  });

  const doneCount = today.tasks.filter(t => t.done).length;
  const sysDot = systems.up === systems.total ? 'var(--hub-green)'
    : systems.up === 0 ? 'var(--hub-red)' : 'var(--hub-warn)';

  const showWeather  = !hidden.has('weather');
  const showCalendar = !hidden.has('calendar');
  const showToday    = !hidden.has('today');
  const showSystems  = !hidden.has('systems');
  const showStudy    = !hidden.has('study');

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

        {/* Edit mode button — replaces canvas shortcut.
            Click once to enter, click again (or Esc) to exit. */}
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

      {/* ── Edit mode bar: restore hidden cards + add app widgets ── */}
      {editMode && (hidden.size > 0 || addableWidgets.length > 0) && (
        <div className="hud-edit-bar">
          {hidden.size > 0 && (
            <>
              <span>{hidden.size} hidden</span>
              {[...hidden].map(id => (
                <button key={id} className="hud-edit-restore" onClick={() => show(id)}>
                  + {CARD_LABELS[id] ?? id}
                </button>
              ))}
            </>
          )}
          {hidden.size > 0 && addableWidgets.length > 0 && <span className="hud-edit-sep" />}
          {addableWidgets.length > 0 && (
            <>
              <span>add widget</span>
              {addableWidgets.map(w => (
                <button key={w.id} className="hud-edit-restore" onClick={() => enableWidget(w.id)}>
                  + {w.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="hud-grid">

        {/* Left: clock + weather (compact) + monthly calendar */}
        <div className="hud-col">
          <div className="hud-clock">
            <div className="hud-clock-time">
              <span className="hud-clock-hm">{clock.hm}</span>
              <span className="hud-clock-ss">{clock.ss}</span>
            </div>
            <div className="hud-clock-meta">
              <span className="hud-clock-date">{clock.dateLine}</span>
              <span className="hud-clock-utc">UTC {clock.utcShort} · DAY {clock.jday}</span>
            </div>
          </div>

          {showWeather && (
            <div className="hud-card hud-weather-compact" style={{ position: 'relative' }}>
              {editMode && (
                <button className="hud-edit-remove" onClick={() => hide('weather')} title="Hide weather">×</button>
              )}
              <div className="hud-weather-head">
                <span className="hud-eyebrow">WEATHER</span>
                <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>
                  {weather.source === 'accuweather' ? 'ACCUWEATHER' : weather.label}
                </span>
              </div>
              {weather.offline ? (
                <div style={{ color: 'var(--hub-cream-faint)', fontFamily: 'var(--hub-font-mono)', fontSize: 11, padding: '4px 0' }}>
                  WEATHER FEED OFFLINE
                </div>
              ) : (
                <>
                  <div className="hud-weather-compact-row">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--hub-amber)" strokeWidth="1.4" strokeLinecap="round" style={{ flex: 'none', filter: 'drop-shadow(var(--glow))' }}>
                      <circle cx="12" cy="12" r="4.5" />
                      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" />
                    </svg>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="hud-weather-compact-temp">
                        <b>{weather.loaded ? weather.temp : '--'}</b>
                        <span>°F</span>
                      </div>
                      <div className="hud-weather-compact-desc">
                        {weather.loaded ? `${weather.desc} · feels ${weather.feels}°` : 'Loading…'}
                      </div>
                    </div>
                    <div className="hud-weather-hilo" style={{ marginLeft: 0 }}>
                      <span className="hi">H {weather.loaded ? weather.hi : '--'}°</span>
                      <span className="lo">L {weather.loaded ? weather.lo : '--'}°</span>
                    </div>
                  </div>

                  {weather.slots.length > 0 && (
                    <div className="hud-weather-strip" style={{ paddingTop: 10, marginTop: 10 }}>
                      {weather.slots.map(s => (
                        <div className="hud-weather-slot" key={s.label}>
                          <span className="t">{s.label}</span>
                          <span className="v">{s.temp}°</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {showCalendar && (
            <MiniCalendar
              cal={cal}
              editMode={editMode}
              onHide={() => hide('calendar')}
            />
          )}
        </div>

        {/* Middle: today's tasks */}
        <div className="hud-col">
          {showToday && (
            <div className="hud-card hud-today" style={{ flex: 1, position: 'relative' }}>
              {editMode && (
                <button className="hud-edit-remove" onClick={() => hide('today')} title="Hide today">×</button>
              )}
              <div className="hud-today-head">
                <span className="hud-eyebrow">TODAY</span>
                <span className="hud-eyebrow-src">BEIGEBOARD</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="hud-today-count">{doneCount} / {today.tasks.length}</span>
                  <span className="hud-bar">
                    <span style={{ width: today.tasks.length ? `${(doneCount / today.tasks.length) * 100}%` : '0%' }} />
                  </span>
                </span>
              </div>

              {!today.authed ? (
                <div className="hud-empty">
                  <span>SIGN IN TO SEE YOUR DAY</span>
                  <a href={`${AUTH_URL}/auth/login?redirect_to=${encodeURIComponent('https://jkos.net')}`}>LOG IN</a>
                </div>
              ) : today.offline ? (
                <div className="hud-empty">
                  <span>BEIGEBOARD OFFLINE</span>
                  <a href={BB_URL}>OPEN BEIGEBOARD →</a>
                </div>
              ) : today.tasks.length === 0 ? (
                <div className="hud-empty">
                  <span>{today.loaded ? 'NOTHING SCHEDULED TODAY' : 'LOADING…'}</span>
                  <a href={BB_URL}>OPEN BEIGEBOARD →</a>
                </div>
              ) : (
                <div className="hud-today-list">
                  {today.tasks.map(t => {
                    const now = isNow(t, clock.hm);
                    return (
                      <div key={t.id} className={`hud-task${t.done ? ' done' : ''}${now ? ' now' : ''}`}>
                        <span className="hud-task-time">{t.time ?? '—'}</span>
                        {now ? (
                          <span style={{ minWidth: 0 }}>
                            <span className="hud-task-title" style={{ display: 'block' }}>{t.title}</span>
                            <span className="hud-task-sub">{t.tag}{t.endTime ? ` · until ${t.endTime}` : ''}</span>
                          </span>
                        ) : (
                          <span className="hud-task-title">{t.title}</span>
                        )}
                        {t.done ? (
                          <span className="hud-task-check">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--hub-bg-0)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </span>
                        ) : now ? (
                          <span className="hud-now-chip"><span className="hud-dot pulse" />NOW</span>
                        ) : (
                          <span className="hud-task-tag">{t.tag}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: systems + study + app widgets */}
        <div className={`hud-col${liveWidgets.length ? ' scroll' : ''}`}>
          {showSystems && (
            <div className="hud-card hud-systems" style={{ position: 'relative' }}>
              {editMode && (
                <button className="hud-edit-remove" onClick={() => hide('systems')} title="Hide systems">×</button>
              )}
              <div className="hud-systems-head">
                <span className="hud-eyebrow">SYSTEMS</span>
                <span className="hud-systems-count">{systems.up} / {systems.total} UP</span>
              </div>
              <div className="hud-systems-list">
                {systems.rows.map(r => (
                  <div key={r.name} className={`hud-sys${r.status === 'down' ? ' down' : r.status === 'warn' ? ' warn' : ''}`}>
                    <span
                      className={`hud-dot${r.status === 'down' ? ' pulse' : ''}`}
                      style={{
                        background: r.status === 'up' ? 'var(--hub-green)'
                          : r.status === 'warn' ? 'var(--hub-warn)'
                          : r.status === 'down' ? 'var(--hub-red)'
                          : 'var(--hub-line-strong)',
                      }}
                    />
                    <span className="hud-sys-name">{r.name}</span>
                    <span className="hud-sys-val">{r.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showStudy && (
            <a className="hud-card hud-info" href={SYLIB_URL} style={{ position: 'relative' }}>
              {editMode && (
                <button className="hud-edit-remove" onClick={e => { e.preventDefault(); hide('study'); }} title="Hide study">×</button>
              )}
              <div className="hud-info-head">
                <span className="hud-eyebrow">STUDY</span>
                <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>SYLIBOS</span>
              </div>
              {study.available ? (
                <div className="hud-study-row">
                  <div className="hud-study-main">
                    <p className="hud-info-title">
                      {study.nextLesson ?? study.courseTitle ?? 'All caught up'}
                    </p>
                    <p className="hud-info-sub">
                      {study.todayDone} / {study.dailyGoal} today{study.courseTitle && study.nextLesson ? ` · ${study.courseTitle}` : ''}
                    </p>
                  </div>
                  {study.streak > 0 && (
                    <div className="hud-streak">
                      <b>{study.streak}</b>
                      <span>STREAK</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="hud-info-sub" style={{ margin: 0 }}>
                  {study.loaded ? 'SYLIBOS OFFLINE — OPEN →' : 'LOADING…'}
                </p>
              )}
            </a>
          )}

          {/* App widgets from other jkOS apps (Module Federation remotes) */}
          {liveWidgets.map(id => {
            const meta = REMOTE_WIDGETS.find(w => w.id === id);
            return (
              <div key={id} className="hud-card hud-widget" style={{ position: 'relative' }}>
                {editMode && (
                  <button className="hud-edit-remove" onClick={() => disableWidget(id)} title={`Remove ${meta?.label ?? id}`}>×</button>
                )}
                <div className="hud-widget-head">
                  <span className="hud-eyebrow">{(meta?.label ?? id).toUpperCase()}</span>
                  <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>WIDGET</span>
                </div>
                <div className="hud-widget-body">
                  <RemoteWidget type={id} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bottom strip ── */}
      <div className="hud-bottom">
        <span>ORDECK V2</span>
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

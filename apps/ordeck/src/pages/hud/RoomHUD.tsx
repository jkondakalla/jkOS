import { useState, useEffect, useRef } from 'react';
import { useJkOSPreferences, AUTH_URL } from '../../hooks/useJkOSPreferences';
import { UnifiedSettingsPanel } from '../../components/settings/UnifiedSettingsPanel';
import {
  useClock, useWeather, useSystems, useToday, useStudy, useApps, isNow,
} from './useHudData';
import '../../styles/hud.css';

/* ORDECK v2 "room HUD" — the portal's default face (Claude Design, 2026-06).
   Calm three-column glanceable dashboard: clock + weather | today | systems +
   study. The legacy widget canvas remains available via the grid button. */

const BB_URL     = 'https://beigeboard.jkos.net';
const SYLIB_URL  = 'https://sylibos.jkos.net';

interface Props {
  onOpenCanvas: () => void;
}

export default function RoomHUD({ onOpenCanvas }: Props) {
  const { theme, effects, lazuros, user, saving, patchTheme, patchEffects } =
    useJkOSPreferences();

  const clock   = useClock();
  const weather = useWeather();
  const systems = useSystems(lazuros.enabled);
  const today   = useToday();
  const study   = useStudy();
  const apps    = useApps(AUTH_URL);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen]         = useState(false);
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

  const doneCount = today.tasks.filter(t => t.done).length;
  const sysDot = systems.up === systems.total ? 'var(--hub-green)'
    : systems.up === 0 ? 'var(--hub-red)' : 'var(--hub-warn)';

  return (
    <div className="hud-root">

      {/* ── Top strip ── */}
      <div className="hud-top" style={{ position: 'relative' }}>
        <button className="hud-logo" onClick={() => setAppsOpen(o => !o)} title="jkOS apps">jk</button>
        <span className="hud-wordmark">ORDECK</span>
        <span style={{ flex: 1 }} />

        <span className="hud-syschip">
          <span className="hud-dot pulse" style={{ background: sysDot }} />
          {systems.up} OF {systems.total} SYSTEMS UP
        </span>

        <button className="hud-topbtn" data-active={appsOpen} onClick={() => setAppsOpen(o => !o)} title="Apps">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </button>

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

        <button className="hud-topbtn" onClick={onOpenCanvas} title="Widget canvas">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
          </svg>
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

      {/* ── Main grid ── */}
      <div className="hud-grid">

        {/* Left: clock + weather */}
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

          <div className="hud-card hud-weather">
            <div className="hud-weather-head">
              <span className="hud-eyebrow">WEATHER</span>
              <span className="hud-eyebrow-src" style={{ marginLeft: 'auto' }}>{weather.label}</span>
            </div>

            {weather.offline ? (
              <div className="hud-empty">WEATHER FEED OFFLINE</div>
            ) : (
              <>
                <div className="hud-weather-now">
                  <svg className="hud-weather-icon" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="var(--hub-amber)" strokeWidth="1.4" strokeLinecap="round">
                    <circle cx="12" cy="12" r="4.5" />
                    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" />
                  </svg>
                  <div>
                    <div className="hud-weather-temp">
                      <b>{weather.loaded ? weather.temp : '--'}</b>
                      <span className="hud-weather-unit">°F</span>
                    </div>
                    <div className="hud-weather-desc">
                      {weather.loaded ? `${weather.desc} · feels like ${weather.feels}°` : 'Loading…'}
                    </div>
                  </div>
                  <div className="hud-weather-hilo">
                    <span className="hi">H {weather.loaded ? weather.hi : '--'}°</span>
                    <span className="lo">L {weather.loaded ? weather.lo : '--'}°</span>
                  </div>
                </div>

                <div className="hud-weather-strip">
                  {weather.slots.map(s => (
                    <div className="hud-weather-slot" key={s.label}>
                      <span className="t">{s.label}</span>
                      <span className="v">{s.temp}°</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Middle: today's tasks */}
        <div className="hud-col">
          <div className="hud-card hud-today" style={{ flex: 1 }}>
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
        </div>

        {/* Right: systems + study */}
        <div className="hud-col">
          <div className="hud-card hud-systems">
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

          <a className="hud-card hud-info" href={SYLIB_URL}>
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
        <span className="ready">
          <span className="hud-dot" />
          READY
        </span>
      </div>

      <UnifiedSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        theme={theme}
        effects={effects}
        saving={saving}
        patchTheme={patchTheme}
        patchEffects={patchEffects}
      />
    </div>
  );
}

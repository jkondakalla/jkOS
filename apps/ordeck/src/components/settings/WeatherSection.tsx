import { useState } from 'react';
import { SettingsSection, Field, NumField } from '@jkos/ui';
import { weatherConfig, saveWeatherConfigLive, type WeatherConfig } from '../../pages/hud/useHudData';

/* ORDECK-only settings: weather location + optional AccuWeather key.
   Rendered into the shared @jkos/ui SettingsDrawer via its `extra` slot, so the
   rest of the tray stays identical to the other apps. */

const FONT = 'var(--hub-font-mono)';
const TXT_MUTED = 'var(--color-muted)';
const TXT_FAINT = 'var(--color-faint)';
const LINE = 'var(--hub-line)';
const FIELD = 'color-mix(in srgb, var(--color-ink) 6%, transparent)';

export function WeatherSection() {
  const [cfg, setCfg] = useState<WeatherConfig>(weatherConfig);
  const [saved, setSaved] = useState(false);

  function patch(p: Partial<WeatherConfig>) {
    setCfg(c => ({ ...c, ...p }));
    setSaved(false);
  }

  function save() {
    // Clear cached location key when lat/lon changes — forces re-lookup — and
    // notify the live HUD to refetch immediately (no reload needed).
    saveWeatherConfigLive({ ...cfg, acWeatherLocKey: '' });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 };
  const lbl: React.CSSProperties = { fontSize: 10, color: TXT_FAINT, width: 52, flexShrink: 0, fontFamily: FONT, letterSpacing: '0.06em' };
  // Layout only — the face is the field primitive's.
  const inp: React.CSSProperties = { flex: 1, padding: '5px 9px', fontSize: 11 };

  return (
    <SettingsSection label="Weather">
      <div style={rowStyle}>
        <span style={lbl}>Label</span>
        <Field type="text" value={cfg.label} onChange={e => patch({ label: e.target.value })} style={inp} spellCheck={false} placeholder="SAN JOSE" />
      </div>
      <div style={rowStyle}>
        <span style={lbl}>Lat</span>
        <NumField value={cfg.lat} onChange={e => patch({ lat: parseFloat(e.target.value) || 0 })} wrapperStyle={{ flex: 1 }} style={inp} step="0.01" />
      </div>
      <div style={rowStyle}>
        <span style={lbl}>Lon</span>
        <NumField value={cfg.lon} onChange={e => patch({ lon: parseFloat(e.target.value) || 0 })} wrapperStyle={{ flex: 1 }} style={inp} step="0.01" />
      </div>
      <div style={{ ...rowStyle, marginBottom: 14 }}>
        <span style={lbl}>AW Key</span>
        <Field type="password" value={cfg.accuweatherKey} onChange={e => patch({ accuweatherKey: e.target.value })}
          style={inp} spellCheck={false} placeholder="AccuWeather API key (optional)" autoComplete="off" />
      </div>
      <div style={{ fontSize: 9, color: TXT_FAINT, fontFamily: FONT, letterSpacing: '0.06em', marginBottom: 10, lineHeight: 1.5 }}>
        {cfg.accuweatherKey
          ? 'AccuWeather active · 50 req/day free tier (auto 60-min refresh)'
          : 'No key → open-meteo (unlimited, no hourly strip on AccuWeather plan)'}
      </div>
      <button type="button" onClick={save} style={{
        padding: '7px 14px', border: `1px solid ${LINE}`,
        background: saved ? 'color-mix(in srgb, var(--hub-green) 15%, transparent)' : FIELD,
        color: saved ? 'var(--hub-green)' : TXT_MUTED,
        fontFamily: FONT, fontSize: 9.5, letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s', outline: 'none',
      }}>
        {saved ? 'SAVED ✓' : 'SAVE LOCATION'}
      </button>
    </SettingsSection>
  );
}

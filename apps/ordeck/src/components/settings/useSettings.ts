import { useState, useEffect } from 'react';
import type { Settings } from './types';
import { SETTINGS_KEY, DEFAULT_SETTINGS } from './data';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function useSettings(): [Settings, (k: keyof Settings, v: Settings[keyof Settings]) => void, () => void] {
  const [s, setS] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }, [s]);

  // Layout chrome only. Visual effects (scanlines/vignette/glow) are owned by
  // the server-synced preferences (useJkOSPreferences) — writing those vars
  // from two places is what caused the blacked-out screen bug.
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--canvas-grid-opacity', String(s.gridDensity));
    r.style.setProperty('--screw-display', s.showScrews ? 'inline-block' : 'none');
  }, [s]);

  const set = (k: keyof Settings, v: Settings[keyof Settings]) =>
    setS(prev => ({ ...prev, [k]: v }));
  const reset = () => setS({ ...DEFAULT_SETTINGS });

  return [s, set, reset];
}

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

  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--crt-scanline-opacity', String(s.scanlines));
    r.style.setProperty('--crt-vignette-opacity', String(s.vignette));
    r.style.setProperty('--canvas-grid-opacity', String(s.gridDensity));
    r.style.setProperty('--screw-display', s.showScrews ? 'inline-block' : 'none');
    if (s.boldGlow) {
      r.style.setProperty('--hub-amber-glow', 'color-mix(in srgb, var(--hub-amber) 60%, transparent)');
    } else {
      r.style.removeProperty('--hub-amber-glow');
    }
  }, [s]);

  const set = (k: keyof Settings, v: Settings[keyof Settings]) =>
    setS(prev => ({ ...prev, [k]: v }));
  const reset = () => setS({ ...DEFAULT_SETTINGS });

  return [s, set, reset];
}

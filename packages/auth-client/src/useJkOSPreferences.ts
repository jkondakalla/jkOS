import { useState, useEffect, useCallback, useRef } from 'react';
import { getProfile, patchProfile } from './client';
import { applyTheme, normaliseTheme } from './theme';
import { DEFAULT_THEME, DEFAULT_EFFECTS, DEFAULT_LAZUROS } from './defaults';
import type { JkOSTheme, EffectsPreferences, LazurPreferences, JkosUser } from './types';

export interface ApplyContext {
  theme:   JkOSTheme;
  effects: EffectsPreferences;
  isDark:  boolean;
}

export interface UseJkOSPreferencesOptions {
  /**
   * Hook for app-specific application after the shared theme is applied —
   * e.g. ORDECK sets CRT overlay vars + dispatches an `ordeck-mode` event.
   * Runs on initial load, every patch, and on OS dark-mode changes in 'system' mode.
   */
  onApply?: (ctx: ApplyContext) => void;
}

/**
 * Single source of truth for theme + effects + AI prefs across the suite.
 * One GET /auth/profile on mount; optimistic local update + PATCH on change.
 * Apps extend behavior via `onApply` rather than copying the hook.
 */
export function useJkOSPreferences(opts: UseJkOSPreferencesOptions = {}) {
  const { onApply } = opts;
  const [theme,   setTheme]   = useState<JkOSTheme>(DEFAULT_THEME);
  const [effects, setEffects] = useState<EffectsPreferences>(DEFAULT_EFFECTS);
  const [lazuros, setLazuros] = useState<LazurPreferences>(DEFAULT_LAZUROS);
  const [user,    setUser]    = useState<JkosUser | null>(null);
  const [saving,  setSaving]  = useState(false);

  const apply = useCallback((t: JkOSTheme, eff: EffectsPreferences) => {
    const isDark = applyTheme(t);
    onApply?.({ theme: t, effects: eff, isDark });
    return isDark;
  }, [onApply]);

  // Fold a fetched profile into local state + apply theme. Shared by the initial
  // load and the on-visibility refresh, so a change made in one app/tab lands in
  // any other open one (applyTheme is idempotent — re-applying is harmless).
  const hydrate = useCallback((data: Awaited<ReturnType<typeof getProfile>>) => {
    if (!data) return;
    if (data.user) setUser(data.user);
    const eff = data.preferences.effects
      ? { ...DEFAULT_EFFECTS, ...data.preferences.effects }
      : DEFAULT_EFFECTS;
    if (data.preferences.effects) setEffects(eff);
    if (data.preferences.theme) {
      const t = normaliseTheme(data.preferences.theme);
      setTheme(t);
      apply(t, eff);
    }
    if (data.preferences.lazuros) {
      setLazuros(prev => ({ ...prev, ...data.preferences.lazuros }));
    }
  }, [apply]);

  useEffect(() => {
    getProfile().then(hydrate).catch(() => {});
  }, [hydrate]);

  // Live cross-app/tab sync: when this tab becomes visible again, re-pull prefs
  // so a theme/accent change made elsewhere shows without a reload. Skipped while
  // a local save is in flight so an optimistic edit isn't clobbered by stale data.
  const savingRef = useRef(false);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || savingRef.current) return;
      getProfile().then(hydrate).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [hydrate]);

  // Re-apply when the OS dark preference changes (only matters in 'system' mode).
  useEffect(() => {
    if (theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => apply(theme, effects);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, effects, apply]);

  const patch = useCallback(async (preferences: object) => {
    setSaving(true);
    savingRef.current = true;
    try { await patchProfile(preferences as any); }
    finally { setSaving(false); savingRef.current = false; }
  }, []);

  const patchTheme = useCallback((partial: Partial<JkOSTheme>) => {
    const next = { ...theme, ...partial };
    setTheme(next);
    apply(next, effects);
    patch({ theme: next });
  }, [theme, effects, apply, patch]);

  const patchEffects = useCallback((partial: Partial<EffectsPreferences>) => {
    const next = { ...effects, ...partial };
    setEffects(next);
    const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
    onApply?.({ theme, effects: next, isDark });
    patch({ effects: next });
  }, [theme, effects, onApply, patch]);

  const patchLazuros = useCallback((partial: Partial<LazurPreferences>) => {
    const next = { ...lazuros, ...partial };
    setLazuros(next);
    patch({ lazuros: next });
  }, [lazuros, patch]);

  return { theme, effects, lazuros, user, saving, patchTheme, patchEffects, patchLazuros };
}

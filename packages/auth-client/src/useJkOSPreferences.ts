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

  // Optimistic-lock cursor (ARCH-7.2): the version the server last handed us. A
  // ref (not state) because `patch` reads it synchronously across a save + retry,
  // and it must not trigger re-renders. Updated on every hydrate and every
  // successful patch; on a 409 it's refreshed from the conflict response.
  const versionRef = useRef(0);

  // Fold a fetched profile into local state + apply theme. Shared by the initial
  // load and the on-visibility refresh, so a change made in one app/tab lands in
  // any other open one (applyTheme is idempotent — re-applying is harmless).
  const hydrate = useCallback((data: Awaited<ReturnType<typeof getProfile>>) => {
    if (!data) return;
    if (typeof data.prefs_version === 'number') versionRef.current = data.prefs_version;
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

  // Version-aware save with one conflict retry (ARCH-7.2): send the slice with our
  // known version; if another tab wrote first the server 409s, so we re-pull the
  // fresh blob (hydrate applies it + advances the version) and re-send our slice
  // once. Deep-merge on the server means the retry preserves the other tab's slice.
  const patch = useCallback(async (preferences: object) => {
    setSaving(true);
    savingRef.current = true;
    try {
      let res = await patchProfile(preferences as any, versionRef.current);
      if (res.conflict) {
        const fresh = await getProfile();
        if (fresh) hydrate(fresh);
        else if (typeof res.prefs_version === 'number') versionRef.current = res.prefs_version;
        res = await patchProfile(preferences as any, versionRef.current);
      }
      if (typeof res.prefs_version === 'number') versionRef.current = res.prefs_version;
    } finally { setSaving(false); savingRef.current = false; }
  }, [hydrate]);

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

  // No patchLazuros: the AI kill switch is set in ONE place (the jkAuth portal, which
  // PATCHes /auth/profile directly). Apps read `lazuros.enabled` to hide AI surfaces;
  // none of them owns the switch, so none of them writes it.
  return { theme, effects, lazuros, user, saving, patchTheme, patchEffects };
}

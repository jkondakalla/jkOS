/**
 * Design/utils/applyJkOSTheme.ts — suite-wide mode + accent appliers.
 *
 * Single source of truth for jkOS mode switching and user accent application.
 * Imported by @jkos/auth-client (and re-exported to the apps) — do not duplicate.
 *
 * The accent CHAIN lives in hub.css: --accent-raw / --accent-2-raw deepen for
 * paper and stay raw + glow for dark, then derive --accent / --hub-amber* etc.
 * So applying a user's pair is just writing the two raw inputs; the per-mode
 * deepening is no longer computed here (that removes the old double-deepen).
 */

/**
 * localStorage keys this design layer owns. The mode key is WRITTEN here (by
 * applyJkOSMode) and READ by every app's pre-hydration mode bootstrap to avoid a
 * theme flash — a cross-package contract, so the literal lives in one place. Import
 * it (`import { STORAGE_KEYS } from '@jkos/design'`) instead of re-typing 'jkos-mode'.
 */
export const STORAGE_KEYS = {
  mode: 'jkos-mode',
} as const;

export interface JkOSAccentPair {
  primary?: string;
  secondary?: string;
}

/**
 * Resolves the user's mode preference, sets data-mode on <html>,
 * and returns whether dark mode is now active.
 */
export function applyJkOSMode(
  mode: 'system' | 'light' | 'dark' | string | undefined
): boolean {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);
  document.documentElement.setAttribute('data-mode', isDark ? 'dark' : 'paper');
  try { localStorage.setItem(STORAGE_KEYS.mode, isDark ? 'dark' : 'paper') } catch {}
  return isDark;
}

/**
 * Writes the user's saved accent pair onto the two raw inputs. hub.css derives
 * everything else per mode. The second arg is accepted for backward compat and
 * ignored — deepening is now done in CSS, not here.
 */
export function applyJkOSTheme(
  theme: JkOSAccentPair | null | undefined,
  _isDark?: boolean
): void {
  if (!theme?.primary) return;
  const root = document.documentElement;
  root.style.setProperty('--accent-raw', theme.primary);
  if (theme.secondary) root.style.setProperty('--accent-2-raw', theme.secondary);
}

import { applyJkOSMode, applyJkOSTheme } from '@jkos/design';
import type { JkOSTheme } from './types';
import { DEFAULT_THEME } from './defaults';

/**
 * Accepts the canonical flat theme, or migrates the legacy nested
 * { mode, dark, light } shape to flat. Never throws.
 */
export function normaliseTheme(raw: any): JkOSTheme {
  if (!raw) return DEFAULT_THEME;
  if (raw.primary) return raw as JkOSTheme;
  return {
    mode:      raw.mode ?? 'system',
    primary:   raw.dark?.primary   ?? DEFAULT_THEME.primary,
    secondary: raw.dark?.secondary ?? DEFAULT_THEME.secondary,
  };
}

/**
 * Suite-wide theme application: sets data-mode + accent CSS vars on <html>
 * via @jkos/design. The flat accent pair is applied to both modes.
 * Returns whether dark mode is now active.
 */
export function applyTheme(theme: JkOSTheme): boolean {
  const isDark = applyJkOSMode(theme.mode);
  applyJkOSTheme(
    {
      mode:  theme.mode,
      dark:  { primary: theme.primary, secondary: theme.secondary },
      light: { primary: theme.primary, secondary: theme.secondary },
    },
    isDark,
  );
  return isDark;
}

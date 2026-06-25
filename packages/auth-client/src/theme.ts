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
 * Suite-wide theme application: sets data-mode + the accent pair on <html> via
 * @jkos/design. The per-mode treatment — paper deepens the pair for legibility,
 * dark uses it raw + glow — is derived in hub.css from --accent-raw / --accent-2-raw,
 * so this only writes the two raw inputs. Returns whether dark mode is now active.
 */
export function applyTheme(theme: JkOSTheme): boolean {
  const isDark = applyJkOSMode(theme.mode);
  applyJkOSTheme({ primary: theme.primary, secondary: theme.secondary });
  return isDark;
}

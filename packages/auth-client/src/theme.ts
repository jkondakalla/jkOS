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

// Preset accents are tuned for dark mode, where glow makes them pop. On the
// beige paper of light mode the same vivid hue washes out, so we deepen it
// toward a warm leather tone — unless the user hand-picked an exact color
// (customAccent), which is always honored as-is. Returns a CSS color-mix()
// string so the hue is preserved while value/chroma shift for paper.
function darkenForPaper(hex: string): string {
  return `color-mix(in srgb, ${hex} 64%, #2a1c0e)`;
}

/**
 * Suite-wide theme application: sets data-mode + accent CSS vars on <html>
 * via @jkos/design. Dark mode uses the vivid accent; light mode deepens preset
 * accents (but not custom-picked ones) so they read on paper.
 * Returns whether dark mode is now active.
 */
export function applyTheme(theme: JkOSTheme): boolean {
  const isDark = applyJkOSMode(theme.mode);
  const deepen = !theme.customAccent;
  applyJkOSTheme(
    {
      mode:  theme.mode,
      dark:  { primary: theme.primary, secondary: theme.secondary },
      light: {
        primary:   deepen ? darkenForPaper(theme.primary)   : theme.primary,
        secondary: deepen ? darkenForPaper(theme.secondary) : theme.secondary,
      },
    },
    isDark,
  );
  return isDark;
}

/**
 * Design/utils/applyJkOSTheme.ts — suite-wide theme utilities
 *
 * Single source of truth for jkOS mode switching and user accent application.
 * Imported by ORDECK, BeigeBoard, and SylibOS — do not duplicate these functions.
 */

export interface JkOSTheme {
  mode: 'system' | 'light' | 'dark' | string;
  dark?:  { primary: string; secondary?: string };
  light?: { primary: string; secondary?: string };
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
  return isDark;
}

/**
 * Applies the user's saved accent colors to CSS custom properties,
 * overriding the per-app token defaults.
 */
export function applyJkOSTheme(
  theme: JkOSTheme | null | undefined,
  isDark: boolean
): void {
  if (!theme) return;
  const colors = isDark ? theme.dark : theme.light;
  if (!colors?.primary) return;

  const root = document.documentElement;
  const p = colors.primary;
  const s = colors.secondary;

  root.style.setProperty('--accent',      p);
  root.style.setProperty('--hub-amber',   p);
  root.style.setProperty('--hub-amber-bright',
    `color-mix(in srgb, ${p} 55%, #ffffff)`);
  root.style.setProperty('--hub-amber-dim',
    `color-mix(in srgb, ${p} 72%, #1a1400)`);
  root.style.setProperty('--hub-amber-deep', isDark
    ? `color-mix(in srgb, ${p} 26%, #000000)`
    : `color-mix(in srgb, ${p} 20%, var(--hub-bg-2))`);
  root.style.setProperty('--hub-amber-glow',
    `color-mix(in srgb, ${p} 38%, transparent)`);
  root.style.setProperty('--accent-base', p);

  if (!s) return;

  root.style.setProperty('--hub-cyan', s);
  root.style.setProperty('--hub-cyan-dim',
    `color-mix(in srgb, ${s} 50%, #000000)`);
  root.style.setProperty('--hub-cyan-glow',
    `color-mix(in srgb, ${s} 38%, transparent)`);
  root.style.setProperty('--accent-secondary', s);
}

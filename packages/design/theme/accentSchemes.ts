/**
 * accentSchemes.ts — the canonical suite-wide accent palette.
 *
 * The accent chooser (in @jkos/ui's SettingsDrawer) offers exactly five slots:
 * the four named preset pairs below plus one "Custom" slot where the user picks
 * their own pair. This is the single source of truth — the drawer renders these,
 * @jkos/auth-client's DEFAULT_THEME is the first one, and matchAccentScheme()
 * maps a stored { primary, secondary } back to whichever slot is selected.
 *
 * Lives in @jkos/design (framework-free) because both @jkos/ui and
 * @jkos/auth-client depend on it but not on each other.
 *
 * Each pair is the user's raw accents: hub.css deepens them for paper and shows
 * them raw + glow in dark, so a scheme is just two source colours — never a
 * per-mode treatment. Both accents are co-equal and always in use.
 */

export interface JkOSAccentScheme {
  id: string;
  label: string;
  primary: string;
  secondary: string;
}

/** The four preset accent schemes. Slot one is the house default (amber · cyan). */
export const ACCENT_SCHEMES: JkOSAccentScheme[] = [
  { id: 'amber-cyan',   label: 'Amber · Cyan',   primary: '#ffb000', secondary: '#4ecdc4' },
  { id: 'green-violet', label: 'Green · Violet', primary: '#5cd66a', secondary: '#c08aff' },
  { id: 'ice-coral',    label: 'Ice · Coral',    primary: '#a8d8ff', secondary: '#ff6b5a' },
  { id: 'gold-mint',    label: 'Gold · Mint',    primary: '#ffd000', secondary: '#5affc1' },
];

/** The fifth slot: the user's own pair. Not a preset — selected when no preset matches. */
export const CUSTOM_SCHEME_ID = 'custom';

const norm = (c: string | undefined) => (c ?? '').trim().toLowerCase();

/**
 * Maps a stored accent pair to its scheme id: a preset id if both colours match
 * a preset, else CUSTOM_SCHEME_ID. Lets the chooser highlight the right slot from
 * the flat { primary, secondary } theme without persisting a separate scheme id.
 */
export function matchAccentScheme(primary?: string, secondary?: string): string {
  if (!primary) return CUSTOM_SCHEME_ID;
  const hit = ACCENT_SCHEMES.find(
    s => norm(s.primary) === norm(primary) && norm(s.secondary) === norm(secondary),
  );
  return hit ? hit.id : CUSTOM_SCHEME_ID;
}

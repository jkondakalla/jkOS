/**
 * theme.ts — token-backed font aliases + default resolvers for the card kit.
 * The fonts mirror BeigeBoard's lib/theme (serif → Fraunces, sans → IBM Plex)
 * but reference the @jkos/design tokens directly so the kit carries no app dep.
 */

import type { CalendarItem, CardResolvers } from './types';

export const FONT_HEAD = 'var(--hub-font-serif)';
export const FONT_BODY = 'var(--hub-font-sans)';
export const FONT_NUM = 'var(--hub-font-serif)';

/** Sensible resolvers when a host injects none: accent from the item itself, a
 *  neutral source colour. Hosts override via the view's `resolvers` prop. */
export const DEFAULT_RESOLVERS: CardResolvers = {
  accentOf: (item: CalendarItem) => item.accent ?? null,
  sourceColorOf: () => 'var(--color-muted)',
};

export function mergeResolvers(partial?: Partial<CardResolvers>): CardResolvers {
  return {
    accentOf: partial?.accentOf ?? DEFAULT_RESOLVERS.accentOf,
    sourceColorOf: partial?.sourceColorOf ?? DEFAULT_RESOLVERS.sourceColorOf,
  };
}

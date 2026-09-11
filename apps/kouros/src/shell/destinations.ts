// destinations.ts — where the beacon can take you, and where everything else
// lives now that the tab bar is gone on a phone.
//
// ⚠️ **THIS FILE IS THE REACHABILITY ARGUMENT.** Retiring the tab bar means every
// screen it used to reach has to be reachable some other way, and "we'll wire it
// up later" is how an app ends up with a view nobody can open. The radial carries
// three PRIMARY destinations; the corner runes carry the secondary ones
// (runeBindings.ts's CORNER_DESTINATIONS); everything deeper — an artist, an
// album, a playlist, Now Playing — is an ordinary link from one of those, exactly
// as it was before.
//
// Three, not four or six: the fan opens inside one thumb's arc, and a sector
// narrower than about 40° cannot be hit reliably while the thumb is also
// covering the screen. The tab bar's fourth slot (Search) became a corner rune
// rather than a fourth sector for that reason.

import type { View } from '../hooks/useHashRoute';

export interface Destination {
  /** The route this lands on — also how the beacon knows which sector is the
   *  one you are already looking at. */
  view: View;
  href: string;
  label: string;
  /** Mono glyph. There is no icon library in this suite (DESIGN.md §1) and the
   *  radial's slabs are small, so these are typographic marks rather than SVG. */
  glyph: string;
  /** Other views that count as "you are here" — a detail page is still under its
   *  destination, so the beacon's resting glyph doesn't flicker as you browse. */
  covers?: View[];
}

/** Index 0 is the LEFTMOST slab on screen — `fanAngles` returns the same order,
 *  so this array reads the way the menu looks. */
export const DESTINATIONS: readonly Destination[] = [
  {
    view: 'home',
    href: '#/',
    label: 'HOME',
    glyph: '◉',
    covers: ['artist', 'album', 'browse', 'artists', 'playlists', 'playlist', 'search', 'now'],
  },
  { view: 'queue', href: '#/queue', label: 'QUEUE', glyph: '≡' },
  { view: 'map', href: '#/map', label: 'VIBE MAP', glyph: '✲' },
];

/** Which destination the current route sits under, or 0. Used for the beacon's
 *  resting glyph and to light the sector you are already on. */
export function activeDestination(view: View): number {
  const i = DESTINATIONS.findIndex((d) => d.view === view || (d.covers?.includes(view) ?? false));
  return i < 0 ? 0 : i;
}

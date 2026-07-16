import { Bubble } from '@jkos/ui';
import type { View } from '../hooks/useHashRoute';

interface NavBarProps {
  active: View;
}

const LINKS: { view: View; href: string; label: string }[] = [
  { view: 'home', href: '#/', label: 'Home' },
  { view: 'artists', href: '#/artists', label: 'Artists' },
  { view: 'playlists', href: '#/playlists', label: 'Playlists' },
  { view: 'search', href: '#/search', label: 'Search' },
];

/** The app's own content nav. AppShell (@jkos/ui, 20.1) supplies the brand/
 *  settings header frame but no routed-content nav (every app's routing is its
 *  own) — KourOS renders this row itself, just below that header, inside
 *  <Content>. `jk-bubble-primary`/`-secondary` is the suite's struck/flat
 *  segmented-control idiom (same classes LibraryToolbar's SegButton uses in
 *  papyros); 'artist'/'album' both count as "under Artists" for the highlight
 *  — those pages are only ever reached BY navigating from Artists, never
 *  linked from this bar directly. */
export default function NavBar({ active }: NavBarProps) {
  const artistsActive = active === 'artists' || active === 'artist' || active === 'album';
  const playlistsActive = active === 'playlists' || active === 'playlist';
  return (
    <nav className="kr-nav" aria-label="KourOS">
      {LINKS.map(({ view, href, label }) => {
        const isActive = view === 'artists' ? artistsActive : view === 'playlists' ? playlistsActive : active === view;
        return (
          <Bubble
            key={view}
            as="a"
            href={href}
            tone={isActive ? 'primary' : 'secondary'}
            aria-current={isActive ? 'page' : undefined}
            className="kr-nav-link"
          >
            {label}
          </Bubble>
        );
      })}
    </nav>
  );
}

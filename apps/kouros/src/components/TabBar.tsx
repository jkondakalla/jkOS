import type { View } from '../hooks/useHashRoute';
import { IconHome, IconLibrary, IconMap, IconSearch } from './icons';

interface TabBarProps {
  active: View;
}

/** The four destinations. Four, not seven: a phone tab bar with more than five
 *  targets makes each one too small to hit reliably, and Playlists / Artists are
 *  reachable one level in from Browse rather than competing for a slot here. */
const TABS: Array<{
  view: View;
  href: string;
  label: string;
  icon: () => JSX.Element;
  /** Other views that should keep this tab lit — a detail page is still "under" it. */
  covers?: View[];
}> = [
  { view: 'home', href: '#/', label: 'Home', icon: IconHome },
  {
    view: 'browse', href: '#/browse', label: 'Library', icon: IconLibrary,
    covers: ['artists', 'artist', 'album', 'playlists', 'playlist'],
  },
  { view: 'search', href: '#/search', label: 'Search', icon: IconSearch },
  { view: 'map', href: '#/map', label: 'Map', icon: IconMap },
];

/**
 * Bottom tab bar on a phone, left rail on a desktop — one component, the
 * difference is entirely in shell.css. Glass, so cover art scrolls beneath it
 * rather than colliding with an opaque strip at the bottom of every screen.
 */
export default function TabBar({ active }: TabBarProps) {
  return (
    <nav className="kr-tabbar kr-glass kr-gloss" aria-label="KourOS">
      {TABS.map(({ view, href, label, icon: Icon, covers }) => {
        const current = active === view || (covers?.includes(active) ?? false);
        return (
          <a
            key={view}
            className="kr-tab"
            href={href}
            aria-current={current ? 'page' : undefined}
          >
            <Icon />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}

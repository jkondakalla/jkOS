import { useEffect, useState } from 'react';

// useHashRoute — a small hand-rolled hash router (no react-router dependency, matching
// ORDECK's precedent of a tiny path switch with no router dep). PapyrOS's Wave-5 shell
// needs exactly two routes:
//   '#/'          → the Library view
//   '#/book/<id>' → the BookDetail view
// Anything else (including a bare '', pre-hash load) falls back to '/' (Library).

export interface HashRoute {
  /** The hash path, always leading-slash, e.g. '/' or '/book/42'. */
  path: string;
  /** Parsed :bookId for '/book/<id>', else null (covers Library + any unknown route). */
  bookId: number | null;
}

function parse(hash: string): HashRoute {
  const path = (hash.replace(/^#/, '') || '/') as string;
  const match = path.match(/^\/book\/(\d+)$/);
  return { path, bookId: match ? Number(match[1]) : null };
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(() => parse(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

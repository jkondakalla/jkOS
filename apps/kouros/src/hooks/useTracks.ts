import { useEffect, useState } from 'react';
import { listTracks, type Track } from '../api';

export interface UseTracksResult {
  tracks: Track[];
  loading: boolean;
  error: boolean;
}

/** The full `tracks` catalog. ToDo.md §3 18.3 asks Artists to "derive the artist
 *  list client-side from the tracks dataset" — and there IS no server-side
 *  artists/albums endpoint, nor an exact-match artist filter (only a PREFIX one,
 *  wrong tool for grouping — see views/library/format.ts's trackArtist() header)
 *  — so Home/Artists/Artist/Album all fetch the whole catalog once and group or
 *  filter it themselves. Search is the one view that skips this hook and calls
 *  `listTracks` with real server-side filters instead.
 *
 *  `reloadKey` lets a caller force a refetch (Home bumps it after an admin
 *  rescan, the same `reloadKey` idiom papyros's Library.tsx uses). */
export function useTracks(reloadKey = 0): UseTracksResult {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    listTracks().then(
      (rows) => { if (alive) { setTracks(rows); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [reloadKey]);

  return { tracks, loading, error };
}

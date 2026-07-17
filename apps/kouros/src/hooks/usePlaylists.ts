import { useCallback, useEffect, useState } from 'react';
import { listPlaylists, type Playlist } from '../api';

export interface UsePlaylistsResult {
  playlists: Playlist[];
  loading: boolean;
  error: boolean;
  /** Force a refetch (rename/create/delete call this after a successful write —
   *  same `reloadKey` idiom useTracks/Home.tsx already use). */
  reload: () => void;
}

export interface UsePlaylistsOptions {
  /** Skip the fetch entirely while false (default true). AddToPlaylistMenu
   *  passes `open` here — a "+" button sitting in a dense track list must not
   *  fire an owner-scoped GET /api/playlists per row on mount; it only needs
   *  the list once the picker is actually opened. */
  enabled?: boolean;
}

/** The signed-in user's `playlists` (18.6) — Playlists.tsx's list view and
 *  AddToPlaylistMenu's picker both need "all of my playlists", never a
 *  filtered subset, so both share this one hook instead of each hand-rolling
 *  the same fetch+loading+error triad (the useTracks.ts precedent). There is
 *  no single-playlist GET route (defineCollection only mounts LIST/POST/
 *  PATCH/DELETE — see discovery.js/collection.js) — PlaylistDetail.tsx also
 *  uses this hook and finds its one row by id client-side, same shape as
 *  Album.tsx filtering the whole `tracks` catalog down to one album. */
export function usePlaylists(opts: UsePlaylistsOptions = {}): UsePlaylistsResult {
  const { enabled = true } = opts;
  const [reloadKey, setReloadKey] = useState(0);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    setError(false);
    listPlaylists().then(
      (rows) => { if (alive) { setPlaylists(rows); setLoading(false); } },
      () => { if (alive) { setError(true); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [enabled, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { playlists, loading, error, reload };
}

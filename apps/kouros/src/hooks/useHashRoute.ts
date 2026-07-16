import { useEffect, useState } from 'react';

// useHashRoute — KourOS's hand-rolled hash router (no dependency, matching
// papyros/ORDECK's precedent — a shared useHashRoute was explicitly Tier-3'd in
// ToDo.md §3 Wave 20's crib: "two hand-rolled routers doesn't justify it", so a
// third per-app copy is the correct call here too). Five routes:
//
//   '#/'                             → Home (recently-added / recently-played)
//   '#/artists'                      → Artists (grid of artist tiles)
//   '#/artist/<artist>'              → one artist's albums
//   '#/album/<artist>/<album>'       → one album's track list
//   '#/search[?q=<term>]'            → Search
//   '#/playlists'                    → Playlists (the user's own list, 18.6)
//   '#/playlist/<id>'                → one playlist's tracks (18.6)
//
// Anything else falls back to Home. `artist`/`album` come from free-text tag
// values (not database ids, unlike papyros's `/book/<id>`), so they travel
// %-encoded — always build a link via artistHref/albumHref/searchHref below,
// never hand-format the hash string (the encoding is load-bearing: a name
// containing '/' would otherwise split across the ALBUM_RE/ARTIST_RE segments).
// `playlist/<id>` is a real database id (like papyros's `/book/<id>`), so it
// stays a plain \d+ match — no encode/decode needed, same as that precedent.

export type View = 'home' | 'artists' | 'artist' | 'album' | 'search' | 'playlists' | 'playlist';

export interface HashRoute {
  view: View;
  /** Decoded artist name — set for 'artist' and 'album' views. */
  artist: string | null;
  /** Decoded album name — set for 'album' only. */
  album: string | null;
  /** The `?q=` query param — only Search reads this (its persisted search box,
   *  so a shared/bookmarked search link opens pre-filled). */
  query: string;
  /** The `playlists.id` — set for 'playlist' only. */
  playlistId: number | null;
}

const ALBUM_RE = /^\/album\/([^/]+)\/([^/]+)$/;
const ARTIST_RE = /^\/artist\/([^/]+)$/;
const PLAYLIST_RE = /^\/playlist\/(\d+)$/;

function parse(hash: string): HashRoute {
  const raw = hash.replace(/^#/, '') || '/';
  const [rawPath, rawQuery] = raw.split('?');
  const path = rawPath || '/';
  const query = new URLSearchParams(rawQuery || '').get('q') ?? '';

  const albumMatch = path.match(ALBUM_RE);
  if (albumMatch) {
    return {
      view: 'album',
      artist: decodeURIComponent(albumMatch[1]!),
      album: decodeURIComponent(albumMatch[2]!),
      query,
      playlistId: null,
    };
  }
  const artistMatch = path.match(ARTIST_RE);
  if (artistMatch) {
    return { view: 'artist', artist: decodeURIComponent(artistMatch[1]!), album: null, query, playlistId: null };
  }
  const playlistMatch = path.match(PLAYLIST_RE);
  if (playlistMatch) {
    return { view: 'playlist', artist: null, album: null, query, playlistId: Number(playlistMatch[1]) };
  }
  if (path === '/artists') return { view: 'artists', artist: null, album: null, query, playlistId: null };
  if (path === '/search') return { view: 'search', artist: null, album: null, query, playlistId: null };
  if (path === '/playlists') return { view: 'playlists', artist: null, album: null, query, playlistId: null };
  return { view: 'home', artist: null, album: null, query, playlistId: null };
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

// ─── Link builders ──────────────────────────────────────────────────────────────

export function artistHref(artist: string): string {
  return `#/artist/${encodeURIComponent(artist)}`;
}

export function albumHref(artist: string, album: string): string {
  return `#/album/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`;
}

export function searchHref(query?: string): string {
  return query ? `#/search?q=${encodeURIComponent(query)}` : '#/search';
}

export function playlistsHref(): string {
  return '#/playlists';
}

export function playlistHref(id: number): string {
  return `#/playlist/${id}`;
}

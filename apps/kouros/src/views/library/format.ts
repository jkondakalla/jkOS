// format.ts — pure helpers for KourOS's library views: duration formatting, cover
// placeholder initials, and the artist/album grouping the client derives from the
// flat `tracks` catalog. No React/DOM here so these stay trivially testable in
// isolation if a later wave adds coverage (mirrors papyros's views/library/format.ts).
import type { Track } from '../../api';

// ─── Duration ───────────────────────────────────────────────────────────────────

/** `duration` (seconds) → "m:ss" / "h:mm:ss" clock label. Music tracks are short
 *  enough that a clock reads better here than papyros's coarse audiobook
 *  "Xh Ym" label (that one's for multi-hour books; a 3:45 track wants seconds). */
export function formatClock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Sum of a track list's durations, formatted the same way — album/artist totals. */
export function formatTotalDuration(tracks: Track[]): string {
  return formatClock(tracks.reduce((sum, t) => sum + (t.duration || 0), 0));
}

// ─── Cover placeholder ──────────────────────────────────────────────────────────

/** Up to two initials for the accent-tinted placeholder tile (no cover art / 404). */
export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// ─── Artist/album derivation ──────────────────────────────────────────────────────
// discovery.js is explicit: "Artist→album→track hierarchy is DERIVED at read time
// from these same filters — no separate artists/albums table." So grouping is
// entirely client-side over the fetched catalog (useTracks). The server's `artist`
// dataset filter is a PREFIX match (built for Search's type-ahead box); it is the
// wrong tool for grouping — "Beatles" would also match "Beatlesque Consort" — so
// Artists/Artist/Album never use it, only trackArtist()/trackAlbum() below.

export const UNKNOWN_ARTIST = 'Unknown Artist';
export const UNKNOWN_ALBUM = 'Unknown Album';

/** The artist a track groups under — `albumartist` wins when present (keeps a
 *  compilation's tracks together under its billed artist, e.g. "Various Artists"),
 *  else the track's own `artist`, else the Unknown bucket. Same fallback order
 *  18.2's scanner already applies when it WRITES `albumartist` (mapTags falls back
 *  to `artist` when the container has no album-artist frame); applied again here
 *  for the rarer case where even that scanner-side fallback came back null. */
export function trackArtist(t: Track): string {
  return (t.albumartist && t.albumartist.trim()) || (t.artist && t.artist.trim()) || UNKNOWN_ARTIST;
}

export function trackAlbum(t: Track): string {
  return (t.album && t.album.trim()) || UNKNOWN_ALBUM;
}

export interface ArtistTileData {
  artist: string;
  trackCount: number;
  albumCount: number;
  /** A representative track to source a cover from (disc/track order's first
   *  track that actually has one) — null falls back to the initials tile. */
  cover: Track | null;
}

/** One tile per distinct `trackArtist()` bucket, sorted A→Z with the Unknown
 *  bucket always last (mirrors papyros's STANDALONE_KEY-last convention). */
export function groupTracksByArtist(tracks: Track[]): ArtistTileData[] {
  const buckets = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = trackArtist(t);
    const list = buckets.get(key);
    if (list) list.push(t); else buckets.set(key, [t]);
  }
  const tiles: ArtistTileData[] = [];
  for (const [artist, list] of buckets) {
    const albums = new Set(list.map(trackAlbum));
    const sorted = sortAlbumTracks(list);
    tiles.push({
      artist,
      trackCount: list.length,
      albumCount: albums.size,
      cover: sorted.find((t) => t.cover_path) ?? null,
    });
  }
  tiles.sort((a, b) => {
    if (a.artist === UNKNOWN_ARTIST) return 1;
    if (b.artist === UNKNOWN_ARTIST) return -1;
    return a.artist.localeCompare(b.artist);
  });
  return tiles;
}

export interface AlbumTileData {
  album: string;
  year: number | null;
  trackCount: number;
  tracks: Track[];   // already in disc/track order
  cover: Track | null;
}

/** One tile per distinct `trackAlbum()` bucket WITHIN one artist's already-
 *  filtered track list (Artist.tsx passes only that artist's tracks in). Sorted
 *  newest-year first — a discography reads newest-first — Unknown-year and the
 *  Unknown-album bucket both sort last. */
export function groupTracksByAlbum(tracks: Track[]): AlbumTileData[] {
  const buckets = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = trackAlbum(t);
    const list = buckets.get(key);
    if (list) list.push(t); else buckets.set(key, [t]);
  }
  const tiles: AlbumTileData[] = [];
  for (const [album, list] of buckets) {
    const sorted = sortAlbumTracks(list);
    const year = list.find((t) => t.year != null)?.year ?? null;
    tiles.push({
      album,
      year,
      trackCount: list.length,
      tracks: sorted,
      cover: sorted.find((t) => t.cover_path) ?? null,
    });
  }
  tiles.sort((a, b) => {
    if (a.album === UNKNOWN_ALBUM) return 1;
    if (b.album === UNKNOWN_ALBUM) return -1;
    if (a.year == null && b.year == null) return a.album.localeCompare(b.album);
    if (a.year == null) return 1;
    if (b.year == null) return -1;
    return b.year - a.year || a.album.localeCompare(b.album);
  });
  return tiles;
}

/** Disc/track order — the canonical order for one album's playback + track list
 *  (task 18.3: "Album page (track list — disc/track order...)"). Missing disc/
 *  track numbers sort after numbered ones; title breaks any remaining tie. Also
 *  the order Album.tsx hands to `requestPlay` as `trackIds` — "an album click
 *  plays the album's tracks in disc/track order from index 0". */
export function sortAlbumTracks(tracks: Track[]): Track[] {
  const rows = [...tracks];
  rows.sort((a, b) => {
    const discDiff = (a.disc_no ?? Infinity) - (b.disc_no ?? Infinity);
    if (discDiff !== 0) return discDiff;
    const trackDiff = (a.track_no ?? Infinity) - (b.track_no ?? Infinity);
    if (trackDiff !== 0) return trackDiff;
    return a.title.localeCompare(b.title);
  });
  return rows;
}

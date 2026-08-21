// views/library/format.ts — the app's formatting vocabulary.
//
// One rule runs through all of it: DURATIONS AND COUNTS ARE MACHINE STATE, so
// they render in mono with tabular figures, while titles and names are the work's
// own and render in the serif. That is Jag's "serif for music metadata, mono for
// system state" split, and it only holds if the formatting agrees with the
// typography — a duration written "1 hour 4 minutes" belongs in prose, not in a
// column that has to line up with the one above it.

/** m:ss, or h:mm:ss past an hour. Tabular figures in the CSS keep columns aligned. */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** A coarse duration for a SET rather than a track — "48 min", "3 hr 12 min".
 *  A run or an album is described by roughly how long it is, never to the second. */
export function formatSpan(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m ? `${h} hr ${m} min` : `${h} hr`;
  return `${m} min`;
}

export function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

/** The artist a track should be FILED under. Album artist wins so a compilation
 *  or a record with guests stays one record instead of shattering into one entry
 *  per performer — the same rule backend/src/routes/browse.js groups by, kept in
 *  step here for the views that still group a list they already hold. */
export function trackArtist(t: { artist?: string | null; albumartist?: string | null }): string {
  return (t.albumartist || t.artist || 'Unknown artist').trim();
}

export function trackAlbum(t: { album?: string | null }): string {
  return (t.album || 'Unknown album').trim();
}

export interface AlbumGroup<T> {
  album: string;
  artist: string;
  year: number | null;
  tracks: T[];
}

/** Group a flat track list into albums, in disc/track order. For views that
 *  ALREADY hold a track list (an artist page, a playlist) — never for browsing
 *  the catalog, which goes through /api/albums so SQLite does the grouping. */
export function groupByAlbum<T extends {
  album?: string | null; artist?: string | null; albumartist?: string | null;
  year?: number | null; disc_no?: number | null; track_no?: number | null; title?: string;
}>(tracks: T[]): AlbumGroup<T>[] {
  const byKey = new Map<string, AlbumGroup<T>>();
  for (const t of tracks) {
    const artist = trackArtist(t);
    const album = trackAlbum(t);
    const key = `${artist}\u0000${album}`;
    let g = byKey.get(key);
    if (!g) {
      g = { album, artist, year: t.year ?? null, tracks: [] };
      byKey.set(key, g);
    }
    g.tracks.push(t);
    if (t.year && (!g.year || t.year < g.year)) g.year = t.year;
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.tracks.sort((a, b) =>
      (a.disc_no ?? 0) - (b.disc_no ?? 0)
      || (a.track_no ?? 0) - (b.track_no ?? 0)
      || String(a.title ?? '').localeCompare(String(b.title ?? '')));
  }
  groups.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.album.localeCompare(b.album));
  return groups;
}

export interface ArtistGroup<T> {
  artist: string;
  tracks: T[];
  albums: number;
}

/** Group a flat track list by artist — kept for callers that already hold the
 *  tracks (search results, a playlist), not for the catalog. */
export function groupTracksByArtist<T extends {
  artist?: string | null; albumartist?: string | null; album?: string | null;
}>(tracks: T[]): ArtistGroup<T>[] {
  const byArtist = new Map<string, { tracks: T[]; albums: Set<string> }>();
  for (const t of tracks) {
    const artist = trackArtist(t);
    let g = byArtist.get(artist);
    if (!g) { g = { tracks: [], albums: new Set() }; byArtist.set(artist, g); }
    g.tracks.push(t);
    g.albums.add(trackAlbum(t));
  }
  return [...byArtist.entries()]
    .map(([artist, g]) => ({ artist, tracks: g.tracks, albums: g.albums.size }))
    .sort((a, b) => a.artist.localeCompare(b.artist));
}

'use strict';
// scan.js (KourOS library service, ToDo §3 18.2) — thin app-specific config on top of
// the shared `defineLibraryScanner` brick (`@jkos/weave/libraryScanner`, ToDo §3 17.2),
// exactly the same shape as papyros's src/library/scan.js. What's app-specific here:
//   - which folder/extensions to scan (MUSIC_DIR, MUSIC_EXTENSIONS) and which table to
//     write (`tracks`) — `unit: 'file'` (17.2's second unit shape), one row per audio
//     file anywhere under MUSIC_DIR, NOT one row per folder: an album's tracks are
//     siblings, not a single aggregated "book" the way a multi-file audiobook rip is.
//   - `mapTags`: the tag→column glue. `album_artist` — note the underscore — is the
//     tag key ffprobe ACTUALLY reports across every container this app scans (verified
//     directly: ffmpeg normalizes MP4's `aART` atom, ID3's TPE2 frame, and a FLAC/Ogg
//     Vorbis-comment `ALBUMARTIST` field all down to one generic `album_artist` tag on
//     the way out — ToDo §3 18.2's prose names the tag "albumartist", but that's the
//     Vorbis-comment SPELLING, not ffprobe's normalized key). The `tracks` table COLUMN
//     is named `albumartist` (no underscore, matching the ToDo's literal wording); this
//     mapping is the one place the two names meet. Falls back to `artist` when a file
//     carries no dedicated album-artist tag (the common case for a standalone single,
//     not part of a various-artists compilation).
//   - `track`/`disc` are "N/total"-style tags (e.g. "3/12") — parsed with the brick's
//     own `parseTrackNumber` (pulls the leading integer), same helper the 'dir'-unit
//     PapyrOS path never needed to import directly (its per-track ordering used it
//     internally; here it's also an app-facing column).

const { defineLibraryScanner, parseTrackNumber } = require('@jkos/weave/libraryScanner');
const { extractYear, parseGenres } = require('./tags');

const MUSIC_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav']);

// The `tracks` columns mapTags(ctx) below must return — the brick owns
// path/files/duration/chapters/mtime/cover_path generically.
const TRACKS_COLUMNS = ['title', 'artist', 'album', 'albumartist', 'track_no', 'disc_no', 'year', 'genres'];

/**
 * The app-specific half of the row: a track's OWN tags (a 'file'-unit ctx always has
 * exactly one file — `files[0]`, no multi-file aggregation to choose among like
 * papyros's book-folder mapTags does) → the `tracks`-table columns. `title` falls back
 * to the file's own basename (ctx.unitName, already extension-stripped — see
 * `collectFileUnits` in the brick) when the file carries no title tag.
 */
function mapTags({ unitName, files }) {
  const t = files[0].tags;
  return {
    title: t.title || unitName,
    artist: t.artist || null,
    album: t.album || null,
    albumartist: t.album_artist || t.artist || null,
    track_no: parseTrackNumber(t.track),
    disc_no: parseTrackNumber(t.disc),
    year: extractYear(t.date),
    genres: JSON.stringify(parseGenres(t.genre)),
  };
}

/**
 * Build a library scanner bound to one db/musicDir/dataDir. Safe to call before the
 * `tracks` migration has run — the brick prepares its statements inside scanLibrary(),
 * not here (server.js constructs the scanner once at module load, before runMigrations()).
 * @param {{ db: import('better-sqlite3').Database, musicDir: string, dataDir: string, concurrency?: number, onScanComplete?: (counts: object) => void }} opts
 */
function createScanner({ db, musicDir, dataDir, concurrency = 4, onScanComplete } = {}) {
  if (!db) throw new Error('createScanner: db is required');
  if (!musicDir) throw new Error('createScanner: musicDir is required');
  if (!dataDir) throw new Error('createScanner: dataDir is required');

  return defineLibraryScanner({
    db,
    table: 'tracks',
    dir: musicDir,
    dataDir,
    extensions: MUSIC_EXTENSIONS,
    unit: 'file',           // one row per audio file — Wave 18's model (17.2's 2nd shape)
    columns: TRACKS_COLUMNS,
    mapTags,
    concurrency,
    onScanComplete,
  });
}

module.exports = {
  createScanner,
  MUSIC_EXTENSIONS,
};

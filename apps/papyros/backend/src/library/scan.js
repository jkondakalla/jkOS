'use strict';
// scan.js (PapyrOS library service, task 2.3) — thin app-specific config on top of the
// shared `defineLibraryScanner` brick (`@jkos/weave/libraryScanner`, ToDo §3 17.2). The
// generic ladder (walk AUDIOBOOKS_DIR → ffprobe pool → mtime-incremental skip → upsert
// ON CONFLICT(path) → prune vanished rows) now lives in the brick; this file supplies
// only what's audiobook-specific:
//   - which folder/extensions to scan (AUDIOBOOKS_DIR, AUDIO_EXTENSIONS) and which table
//     to write (`books`, one row per immediate subdirectory — a "book" — multi-file rips
//     aggregated, per Wave 2),
//   - `mapTags`: the tag→column glue the brick can't own — title falls back to the book
//     folder's name when there's no title tag, an `album` tag equal to that title is not
//     a real series (a ripper that copied the title into album), and metadata_source
//     records whether any embedded tag actually contributed. mapTagsToColumns itself
//     (author/narrator/series/year/genres from one file's tags) stays in ./probe.js,
//     pure and unit-tested exactly as before (probe.smoke.mjs).
//
// `createScanner({ db, audiobooksDir, dataDir, concurrency, onScanComplete })` keeps its
// exact pre-brick signature and return shape ({ scanLibrary, isScanning }) — server.js's
// construction site is untouched. Zero behavior change: same table writes, same
// incremental semantics, same single-flight (now enforced by the brick), same cover
// extraction ladder (also now the brick's default) — see library.smoke.mjs /
// playback.smoke.mjs, unchanged.

const { defineLibraryScanner } = require('@jkos/weave/libraryScanner');
const { mapTagsToColumns } = require('./probe');

const AUDIO_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp3', '.flac', '.ogg', '.opus', '.aac', '.wma']);

// The `books` columns mapTagsToColumns (./probe.js) doesn't already produce — the brick
// owns path/files/duration/chapters/mtime/cover_path generically; these seven are what
// this app's mapTags(ctx) below must return.
const BOOKS_COLUMNS = ['title', 'author', 'narrator', 'series', 'year', 'genres', 'metadata_source'];

/**
 * The app-specific half of the row: takes the brick's per-unit ctx (the book folder's
 * name + every probed file, sorted) and produces the `books`-table columns. Mirrors
 * exactly what buildBookRow used to do inline, pre-brick:
 *   - only the first (sorted) file's tags are trusted for book-level metadata — a
 *     multi-file audiobook's chapter/title tags vary per track, but the BOOK's
 *     title/author/narrator/series/year/genres are one set of facts, not nineteen;
 *   - title falls back to the folder name when there's no title tag;
 *   - series re-applies the album==title junk-series guard against the FINAL title
 *     (mapTagsToColumns can only compare per-file tags; a rip with per-track titles or
 *     no title tag slips past that check there);
 *   - metadata_source is 'embedded' iff at least one of these actually came from a tag.
 */
function mapTags({ unitName, files }) {
  const cols = mapTagsToColumns(files[0].tags);
  const title = cols.title || unitName;
  const normT = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  const series = cols.series && normT(cols.series) !== normT(title) ? cols.series : null;
  const hasEmbeddedMeta = [cols.title, cols.author, cols.narrator, cols.series, cols.year].some((v) => v != null)
    || cols.genres.length > 0;

  return {
    title,
    author: cols.author,
    narrator: cols.narrator,
    series,
    year: cols.year,
    genres: JSON.stringify(cols.genres),
    metadata_source: hasEmbeddedMeta ? 'embedded' : null,
  };
}

/**
 * Build a library scanner bound to one db/audiobooksDir/dataDir. Safe to call before the
 * `books` migration has run — the brick prepares its statements inside scanLibrary(),
 * not here (server.js constructs the scanner once at module load, before boot() runs
 * runMigrations()).
 * @param {{ db: import('better-sqlite3').Database, audiobooksDir: string, dataDir: string, concurrency?: number, onScanComplete?: (counts: object) => void }} opts
 */
function createScanner({ db, audiobooksDir, dataDir, concurrency = 4, onScanComplete } = {}) {
  if (!db) throw new Error('createScanner: db is required');
  if (!audiobooksDir) throw new Error('createScanner: audiobooksDir is required');
  if (!dataDir) throw new Error('createScanner: dataDir is required');

  return defineLibraryScanner({
    db,
    table: 'books',
    dir: audiobooksDir,
    dataDir,
    extensions: AUDIO_EXTENSIONS,
    unit: 'dir',           // one row per immediate subdirectory (a book) — Wave 2's model
    columns: BOOKS_COLUMNS,
    mapTags,
    concurrency,
    onScanComplete,
  });
}

module.exports = {
  createScanner,
  AUDIO_EXTENSIONS,
};

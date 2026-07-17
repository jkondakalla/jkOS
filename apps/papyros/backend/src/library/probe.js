'use strict';
// probe.js (PapyrOS library service, task 2.2) — the ffprobe-tag → `books`-column
// mapping (mapTagsToColumns) plus its year/genre helpers. This is the ONE app-specific
// piece of the library ladder (ToDo §3 17.2): everything else — walking, spawning
// ffprobe, parsing its JSON, the concurrency pool, mtime-incremental skip, the
// ON CONFLICT(path) upsert, pruning vanished rows — moved to the shared brick
// (`@jkos/weave/libraryScanner`, used by src/library/scan.js). `probeFile` / `parseProbe`
// / `normalizeTags` are the brick's generic, app-agnostic ffprobe wrapper + JSON parser;
// re-exported here UNCHANGED so nothing importing them from `./probe` (probe.smoke.mjs,
// scan.js) had to change when the mapping moved. `parseProbe` stays pure (no I/O) there
// too — feed it a hand-authored ffprobe JSON fixture and it behaves identically to the
// real exec path, with zero process spawning.
//
// ffprobe tag casing is inconsistent across containers/taggers (an .m4b from one
// tool emits `artist`, another emits `ARTIST`) — mapTagsToColumns re-normalizes via
// normalizeTags() so the mapping never depends on the source's casing.

const { probeFile, parseProbe, normalizeTags } = require('@jkos/weave/libraryScanner');

/** Pull a 4-digit year out of a `date` tag ("2023", "2023-05-14", "05/2023", …). */
function extractYear(dateStr) {
  if (dateStr == null) return null;
  const match = String(dateStr).match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

/** Genre values that carry zero signal in an audiobook library — every row would
 *  wear them ("Audiobook" is iTunes' primaryGenreName for the whole medium;
 *  "(Un)abridged" is an edition fact, not a genre). Filtered at parse AND serve
 *  time (serve-time also cleans rows written before this filter existed). */
const NOISE_GENRES = new Set(['audiobook', 'audiobooks', 'audio book', 'audio books', 'unabridged', 'abridged']);

/** Drop noise genres from an array (case-insensitive), preserving order. PURE. */
function cleanGenres(genres) {
  if (!Array.isArray(genres)) return [];
  return genres.filter((g) => typeof g === 'string' && g.trim() && !NOISE_GENRES.has(g.trim().toLowerCase()));
}

/**
 * Split a `genre` tag into a trimmed, order-preserving, de-duplicated array.
 * Handles the common multi-genre delimiters taggers use: `;`, `,`, `/`.
 * Noise genres (see NOISE_GENRES) are dropped.
 */
function parseGenres(genreStr) {
  if (genreStr == null) return [];
  const seen = new Set();
  const genres = [];
  for (const raw of String(genreStr).split(/[;,/]+/)) {
    const g = raw.trim();
    if (g && !seen.has(g)) {
      seen.add(g);
      genres.push(g);
    }
  }
  return cleanGenres(genres);
}

/**
 * PURE. Map ffprobe format tags → the `books` table's metadata columns.
 * Re-normalizes its input, so it's safe to call directly with a raw (possibly
 * weird-cased) tags object OR with the already-normalized `tags` a parseProbe()
 * call produced — either way the mapping is idempotent.
 *
 *   ffprobe tag    → column     decision
 *   -------------    --------    ------------------------------------------------
 *   title          → title      direct
 *   artist         → author     primary author source
 *   album_artist   → author     fallback when `artist` is absent (many taggers
 *                                duplicate author into both fields; some only set
 *                                album_artist)
 *   composer       → narrator   audiobook convention: narrator has no dedicated
 *                                ffprobe/ID3 tag, so audiobook tools (Audiobook
 *                                Builder, m4b-tool, Audible/OverDrive exports)
 *                                consistently store it in the composer atom/frame
 *   album          → series     audiobook convention: the `album` tag carries the
 *                                series/collection name (books in a series share
 *                                one "album"). BUT standalone books are near-always
 *                                tagged album == title (rippers copy it), which
 *                                would give every book a junk "series" equal to its
 *                                own name — an album that matches the title
 *                                (case/space-insensitive) maps to NO series.
 *   date           → year       first 4-digit run extracted from whatever date
 *                                format the tagger used
 *   genre          → genres     split into an array (see parseGenres)
 */
function mapTagsToColumns(tags) {
  const t = normalizeTags(tags);
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  const series = t.album && norm(t.album) !== norm(t.title) ? t.album : null;
  return {
    title: t.title || null,
    author: t.artist || t.album_artist || null,
    narrator: t.composer || null,
    series,
    year: extractYear(t.date),
    genres: parseGenres(t.genre),
  };
}

module.exports = {
  cleanGenres,
  probeFile,
  parseProbe,
  normalizeTags,
  extractYear,
  parseGenres,
  mapTagsToColumns,
};

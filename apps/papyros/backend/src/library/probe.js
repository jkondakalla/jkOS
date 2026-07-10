'use strict';
// probe.js (PapyrOS library service, task 2.2) — pure ffprobe wrapper + the
// ffprobe-tag → `books`-column mapping that the scanner (2.3) will call per file.
//
// Two layers, deliberately kept apart so the mapping can be unit-tested with zero
// process spawning:
//   1. probeFile(path)         — the ONLY impure piece: execFile('ffprobe', […]),
//                                 promisified, JSON-parsed, handed to parseProbe.
//   2. parseProbe / mapTagsToColumns / normalizeTags / extractYear / parseGenres
//                               — pure functions over plain objects. Feed them a
//                                 hand-authored ffprobe JSON fixture and they behave
//                                 identically to the real exec path.
//
// ffprobe tag casing is inconsistent across containers/taggers (an .m4b from one
// tool emits `artist`, another emits `ARTIST`) — every tag read here goes through
// normalizeTags() first so the mapping never depends on the source's casing.

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * Run the exact probe command PapyrOS standardizes on and parse its output.
 *   ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters <file>
 * Returns the same shape as parseProbe(): { tags, duration, chapters, codec }.
 */
async function probeFile(filePath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', filePath],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return parseProbe(JSON.parse(stdout));
}

/** Lowercase every key of a tags object; ffprobe's tag casing varies by container/tagger. */
function normalizeTags(tags) {
  const out = {};
  if (!tags || typeof tags !== 'object') return out;
  for (const [key, value] of Object.entries(tags)) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

/**
 * PURE. Turn a raw ffprobe JSON payload (format/streams/chapters) into the shape
 * the scanner consumes:
 *   tags     — normalized (lowercase-keyed) format-level tag map
 *   duration — total seconds as a number, or null if ffprobe didn't report one
 *   chapters — [{ start, end, title }] with start/end in seconds (numbers)
 *   codec    — the first audio stream's codec_name, or null if there is none
 */
function parseProbe(json) {
  const format = (json && json.format) || {};
  const streams = Array.isArray(json && json.streams) ? json.streams : [];
  const rawChapters = Array.isArray(json && json.chapters) ? json.chapters : [];

  const tags = normalizeTags(format.tags);

  const duration = format.duration != null ? Number(format.duration) : null;

  const audioStream = streams.find((s) => s && s.codec_type === 'audio');
  const codec = (audioStream && audioStream.codec_name) || null;

  const chapters = rawChapters.map((c) => {
    const chapterTags = normalizeTags(c && c.tags);
    return {
      start: c && c.start_time != null ? Number(c.start_time) : null,
      end: c && c.end_time != null ? Number(c.end_time) : null,
      title: chapterTags.title != null ? chapterTags.title : null,
    };
  });

  return {
    tags,
    duration: Number.isFinite(duration) ? duration : null,
    chapters,
    codec,
  };
}

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

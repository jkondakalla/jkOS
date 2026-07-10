// probe.smoke.mjs (task 2.2) — unit tests for the pure half of
// backend/src/library/probe.js: parseProbe() and the ffprobe-tag → `books`-column
// mapping (mapTagsToColumns), plus their normalizeTags/extractYear/parseGenres
// helpers. Drives the REAL module (a plain CommonJS file, so no TS transpile is
// needed — just createRequire, same as lazuros' providers.smoke.mjs) against
// hand-authored ffprobe JSON fixtures. No `ffprobe` exec, no network, no DB.
//
// Run standalone:  node apps/papyros/backend/test/probe.smoke.mjs
// (task 2.5 chains this into the papyros backend `test` script / the gate — not
// wired here.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'probe');

const {
  probeFile,
  parseProbe,
  normalizeTags,
  extractYear,
  parseGenres,
  mapTagsToColumns,
} = require('../src/library/probe.js');

const loadFixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

let n = 0;
let failed = 0;
const test = (label, fn) => {
  try {
    fn();
    n++;
    console.log(`✓ ${label}`);
  } catch (err) {
    n++;
    failed++;
    console.error(`✗ ${label}`);
    console.error(`  ${err.message}`);
  }
};

// ── module shape ─────────────────────────────────────────────────────────────
test('exports all five functions plus the impure probeFile wrapper', () => {
  assert.equal(typeof probeFile, 'function');
  assert.equal(typeof parseProbe, 'function');
  assert.equal(typeof normalizeTags, 'function');
  assert.equal(typeof extractYear, 'function');
  assert.equal(typeof parseGenres, 'function');
  assert.equal(typeof mapTagsToColumns, 'function');
});

// ── fixture 1: m4b-style, full tags + chapters ────────────────────────────────
const m4b = loadFixture('m4b-full-chapters.json');
const m4bParsed = parseProbe(m4b);

test('parseProbe reads format.duration as a number', () => {
  assert.equal(m4bParsed.duration, 39650.123);
});
test('parseProbe picks codec_name from the audio stream, ignoring the video/cover stream', () => {
  assert.equal(m4bParsed.codec, 'aac');
});
test('parseProbe maps all 3 chapters with numeric start/end + title', () => {
  assert.equal(m4bParsed.chapters.length, 3);
  assert.deepEqual(m4bParsed.chapters[0], { start: 0, end: 620, title: 'Chapter 1' });
  assert.deepEqual(m4bParsed.chapters[1], { start: 620, end: 1330, title: 'Chapter 2' });
  assert.deepEqual(m4bParsed.chapters[2], { start: 1330, end: 2015.5, title: 'Chapter 3' });
});
test('parseProbe normalizes format tags to lowercase keys', () => {
  assert.equal(m4bParsed.tags.artist, 'J.R.R. Tolkien');
  assert.equal(m4bParsed.tags.title, 'The Fellowship of the Ring');
});

const m4bCols = mapTagsToColumns(m4bParsed.tags);
test('mapTagsToColumns: title passes through', () => {
  assert.equal(m4bCols.title, 'The Fellowship of the Ring');
});
test('mapTagsToColumns: artist → author', () => {
  assert.equal(m4bCols.author, 'J.R.R. Tolkien');
});
test('mapTagsToColumns: composer → narrator', () => {
  assert.equal(m4bCols.narrator, 'Rob Inglis');
});
test('mapTagsToColumns: album → series', () => {
  assert.equal(m4bCols.series, 'The Lord of the Rings');
});
test('mapTagsToColumns: date → year extracts the 4-digit year', () => {
  assert.equal(m4bCols.year, 1954);
});
test('mapTagsToColumns: genre → genres splits on `;` and trims', () => {
  assert.deepEqual(m4bCols.genres, ['Fantasy', 'Fiction', 'Adventure']);
});

// ── fixture 2: mp3-style, sparse/missing tags, no chapters ───────────────────
const mp3 = loadFixture('mp3-sparse-no-chapters.json');
const mp3Parsed = parseProbe(mp3);

test('parseProbe: no chapters array → empty list, not an error', () => {
  assert.deepEqual(mp3Parsed.chapters, []);
});
test('parseProbe: codec from the sole audio stream', () => {
  assert.equal(mp3Parsed.codec, 'mp3');
});

const mp3Cols = mapTagsToColumns(mp3Parsed.tags);
test('mapTagsToColumns: sparse tags → only title populated', () => {
  assert.equal(mp3Cols.title, 'Track 01');
});
test('mapTagsToColumns: missing artist/album_artist → author is null, not "undefined"', () => {
  assert.equal(mp3Cols.author, null);
});
test('mapTagsToColumns: missing composer → narrator is null', () => {
  assert.equal(mp3Cols.narrator, null);
});
test('mapTagsToColumns: missing album → series is null', () => {
  assert.equal(mp3Cols.series, null);
});

test('mapTagsToColumns: album equal to title (standalone rip) → series is null', () => {
  const cols = mapTagsToColumns({ title: 'Standalone Book', album: '  standalone  BOOK ' });
  assert.equal(cols.series, null);
});

test('parseGenres/cleanGenres: noise genres are dropped', () => {
  const cols = mapTagsToColumns({ title: 'X', album: 'Y', genre: 'Audiobooks; History; Unabridged' });
  assert.deepEqual(cols.genres, ['History']);
});
test('mapTagsToColumns: missing date → year is null', () => {
  assert.equal(mp3Cols.year, null);
});
test('mapTagsToColumns: missing genre → genres is an empty array', () => {
  assert.deepEqual(mp3Cols.genres, []);
});

// ── fixture 3: weird-cased tag keys ───────────────────────────────────────────
const weird = loadFixture('weird-cased-tags.json');
const weirdParsed = parseProbe(weird);

test('parseProbe: mixed/upper-cased tag keys still normalize to lowercase', () => {
  assert.equal(weirdParsed.tags.artist, 'Some Author');
  assert.equal(weirdParsed.tags.album_artist, 'Fallback Author');
  assert.equal(weirdParsed.tags.composer, 'The Narrator');
});

const weirdCols = mapTagsToColumns(weirdParsed.tags);
test('mapTagsToColumns is case-insensitive end to end (Title/ARTIST/COMPOSER/DATE/Genre)', () => {
  assert.deepEqual(weirdCols, {
    title: 'Weird Casing Test',
    author: 'Some Author',
    narrator: 'The Narrator',
    series: 'Weird Series',
    year: 2021,
    genres: ['Sci-Fi'],
  });
});

// mapTagsToColumns must also tolerate being fed RAW (un-normalized) tags directly,
// not just the already-normalized output of parseProbe — it re-normalizes itself.
test('mapTagsToColumns is idempotent: raw weird-case tags in vs. pre-normalized tags in agree', () => {
  const fromRaw = mapTagsToColumns(weird.format.tags);
  assert.deepEqual(fromRaw, weirdCols);
});

// artist absent, only album_artist present → author falls back correctly.
test('mapTagsToColumns: author falls back to album_artist when artist is missing', () => {
  const cols = mapTagsToColumns({ album_artist: 'Only Album Artist' });
  assert.equal(cols.author, 'Only Album Artist');
});
test('mapTagsToColumns: artist wins over album_artist when both are present', () => {
  const cols = mapTagsToColumns({ artist: 'Primary', album_artist: 'Secondary' });
  assert.equal(cols.author, 'Primary');
});

// ── fixture 4: multi-genre value (mixed delimiters + a duplicate) ────────────
const multiGenre = loadFixture('multi-genre.json');
const multiGenreParsed = parseProbe(multiGenre);
const multiGenreCols = mapTagsToColumns(multiGenreParsed.tags);

test('mapTagsToColumns: genre splits on mixed "/" and "," delimiters', () => {
  assert.deepEqual(multiGenreCols.genres, ['Mystery', 'Thriller', 'Crime']);
});
test('mapTagsToColumns: genre de-duplicates repeated values', () => {
  assert.equal(multiGenreCols.genres.filter((g) => g === 'Mystery').length, 1);
});

// ── helper unit coverage ──────────────────────────────────────────────────────
test('normalizeTags: handles a missing/undefined tags object without throwing', () => {
  assert.deepEqual(normalizeTags(undefined), {});
  assert.deepEqual(normalizeTags(null), {});
});
test('extractYear: plain 4-digit year string', () => {
  assert.equal(extractYear('1954'), 1954);
});
test('extractYear: full ISO date pulls the leading year', () => {
  assert.equal(extractYear('2021-08-15'), 2021);
});
test('extractYear: missing/empty date → null', () => {
  assert.equal(extractYear(undefined), null);
  assert.equal(extractYear(''), null);
});
test('parseGenres: single genre → single-element array', () => {
  assert.deepEqual(parseGenres('Fantasy'), ['Fantasy']);
});
test('parseGenres: missing genre → empty array', () => {
  assert.deepEqual(parseGenres(undefined), []);
});

test('probeFile is exported as the impure exec wrapper (not invoked in this suite)', () => {
  assert.equal(typeof probeFile, 'function');
  assert.equal(probeFile.constructor.name, 'AsyncFunction');
});

console.log(`\n${n - failed}/${n} assertions passed`);
if (failed) {
  console.error(`✗ probe.smoke: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ probe.smoke: all assertions passed');

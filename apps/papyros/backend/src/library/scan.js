'use strict';
// scan.js (PapyrOS library service, task 2.3) — walks AUDIOBOOKS_DIR and (re)builds the
// shared `books` catalog (2.1's migration). One immediate subdirectory of AUDIOBOOKS_DIR
// = one book; every audio file found anywhere under it (recursively — some rips use
// per-disc subfolders) is probed, ordered, and rolled up into that book's row.
//
// Factory style (house pattern, see apps/lazuros/backend/providers/*): createScanner
// takes its config — { db, audiobooksDir, dataDir, concurrency } — at the edge; nothing
// in here reads process.env directly. server.js reads the env and passes it in.
//
// Statements are prepared PER CALL (inside scanLibraryOnce), not hoisted to factory
// setup time — createScanner() is safe to call before the `books` migration has run
// (server.js constructs the scanner once at module load, before boot() runs
// runMigrations()); the table only needs to exist once scanLibrary() actually executes.
//
// Concurrency: file probing goes through a small bounded worker pool (default 4) —
// "design for N books, not 19" means never Promise.all an unbounded file list. Books
// are processed one at a time (each internally pooled), so at most `concurrency`
// ffprobe/ffmpeg child processes ever run at once regardless of library size.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { probeFile, mapTagsToColumns } = require('./probe');

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp3', '.flac', '.ogg', '.opus', '.aac', '.wma']);
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function isAudioFile(name) {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Pull the leading integer out of a `track` tag ("3/12", "03", "3") — or null. */
function parseTrackNumber(trackTag) {
  if (trackTag == null) return null;
  const m = String(trackTag).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Filename comparator that sorts "track2" before "track10" (numeric-aware). */
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Recursively collect every audio file under a book folder. Returns
 *  [{ abs, rel }] where `rel` is POSIX-slashed and relative to the book folder
 *  (so a per-disc rip like "Disc 1/track01.mp3" round-trips). */
function collectAudioFiles(bookDir) {
  const out = [];
  function walk(dir, relParts) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[papyros scan] cannot read "${dir}": ${err.message}`);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...relParts, entry.name]);
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        out.push({ abs: path.join(dir, entry.name), rel: [...relParts, entry.name].join('/') });
      }
    }
  }
  walk(bookDir, []);
  return out;
}

/** Bounded-concurrency map. `worker` is expected to catch its own per-item errors
 *  and return null on failure — a genuine bug (an unexpected throw) still propagates
 *  so it doesn't get silently swallowed alongside expected probe failures. */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => lane());
  await Promise.all(lanes);
  return results;
}

function ensureCoversDir(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'covers'), { recursive: true });
}

/** Extract a cover image for a book into <dataDir>/covers/<id>.<ext>. Tries the
 *  first audio file's embedded art first (ffmpeg -an -c:v copy), then a folder-level
 *  cover.(jpg|jpeg|png|webp). Returns a path RELATIVE to dataDir (e.g. 'covers/12.jpg'),
 *  or null if neither source produced anything. Both paths tolerate failure — most
 *  audiobook files carry no embedded art, and that's not an error. */
async function extractCover({ firstFileAbsPath, bookDir, dataDir, id }) {
  const coversDir = path.join(dataDir, 'covers');
  const embeddedDest = path.join(coversDir, `${id}.jpg`);
  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', firstFileAbsPath, '-an', '-c:v', 'copy', embeddedDest],
      { timeout: 15000 },
    );
    const st = fs.statSync(embeddedDest);
    if (st.size > 0) return path.relative(dataDir, embeddedDest);
  } catch {
    // No embedded art (or the audio file has no attached-pic stream) — expected, fall through.
  }
  try { fs.unlinkSync(embeddedDest); } catch { /* nothing to clean up */ }

  let entries;
  try {
    entries = fs.readdirSync(bookDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const coverEntry = entries.find(
    (e) => e.isFile() && /^cover\./i.test(e.name) && COVER_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
  );
  if (coverEntry) {
    const ext = path.extname(coverEntry.name).toLowerCase();
    const folderDest = path.join(coversDir, `${id}${ext}`);
    try {
      fs.copyFileSync(path.join(bookDir, coverEntry.name), folderDest);
      return path.relative(dataDir, folderDest);
    } catch (err) {
      console.warn(`[papyros scan] failed to copy folder cover for "${bookDir}": ${err.message}`);
    }
  }
  return null;
}

/** Probe every audio file in a book folder, order them, and aggregate the row this
 *  book upserts as. Returns null when the folder has no probeable audio (nothing to
 *  catalog — the caller skips it rather than writing an empty row). */
async function buildBookRow({ bookDir, concurrency }) {
  const audioFiles = collectAudioFiles(bookDir);
  if (!audioFiles.length) return null;

  const probed = await mapPool(audioFiles, concurrency, async (f) => {
    try {
      const result = await probeFile(f.abs);
      return { ...f, probed: result };
    } catch (err) {
      console.warn(`[papyros scan] probe failed for "${f.abs}": ${err.message}`);
      return null;
    }
  });
  const usable = probed.filter(Boolean);
  if (!usable.length) return null;

  usable.sort((a, b) => {
    const ta = parseTrackNumber(a.probed.tags.track);
    const tb = parseTrackNumber(b.probed.tags.track);
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if (ta != null && tb == null) return -1;
    if (ta == null && tb != null) return 1;
    return naturalCompare(a.rel, b.rel);
  });

  const files = usable.map((f, index) => ({
    index,
    path: f.rel,
    duration: f.probed.duration,
    codec: f.probed.codec,
  }));
  const duration = files.reduce((sum, f) => sum + (f.duration || 0), 0);

  // Chapters are only trusted from a genuinely single-file book's embedded chapter
  // list. Synthesizing chapters from multi-file boundaries is a PLAYER concern
  // (Wave 5) — it has the cumulative-offset math this scanner deliberately doesn't
  // duplicate — so a multi-file book's chapters stay empty here, not fabricated.
  const chapters = usable.length === 1 && usable[0].probed.chapters.length
    ? usable[0].probed.chapters
    : [];

  const cols = mapTagsToColumns(usable[0].probed.tags);
  const hasEmbeddedMeta = [cols.title, cols.author, cols.narrator, cols.series, cols.year].some((v) => v != null)
    || cols.genres.length > 0;

  const folderStat = fs.statSync(bookDir);
  const mtime = Math.floor(folderStat.mtimeMs / 1000);

  return {
    path: bookDir,
    title: cols.title || path.basename(bookDir),
    author: cols.author,
    narrator: cols.narrator,
    series: cols.series,
    year: cols.year,
    genres: JSON.stringify(cols.genres),
    duration,
    files: JSON.stringify(files),
    chapters: JSON.stringify(chapters),
    metadata_source: hasEmbeddedMeta ? 'embedded' : null,
    mtime,
    firstFileAbsPath: usable[0].abs,
  };
}

/** One full pass: upsert every book whose folder mtime changed (or is new), delete
 *  rows whose folder vanished, skip the rest. Returns { scanned, upserted, removed,
 *  skipped } — `scanned` counts every book folder examined this pass. */
async function scanLibraryOnce({ db, audiobooksDir, dataDir, concurrency }) {
  const counts = { scanned: 0, upserted: 0, removed: 0, skipped: 0 };
  ensureCoversDir(dataDir);

  let entries;
  try {
    entries = fs.readdirSync(audiobooksDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    console.error(`[papyros scan] cannot read AUDIOBOOKS_DIR "${audiobooksDir}": ${err.message}`);
    return counts;
  }

  const existingRows = db.prepare('SELECT id, path, mtime FROM books').all();
  const existingByPath = new Map(existingRows.map((r) => [r.path, r]));
  const seenPaths = new Set();

  const upsertStmt = db.prepare(`
    INSERT INTO books (path, title, author, narrator, series, year, genres, duration, files, chapters, metadata_source, mtime)
    VALUES (@path, @title, @author, @narrator, @series, @year, @genres, @duration, @files, @chapters, @metadata_source, @mtime)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title, author = excluded.author, narrator = excluded.narrator,
      series = excluded.series, year = excluded.year, genres = excluded.genres,
      duration = excluded.duration, files = excluded.files, chapters = excluded.chapters,
      metadata_source = excluded.metadata_source, mtime = excluded.mtime
    RETURNING id
  `);
  const setCoverStmt = db.prepare('UPDATE books SET cover_path = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM books WHERE id = ?');

  for (const entry of entries) {
    const bookDir = path.join(audiobooksDir, entry.name);
    seenPaths.add(bookDir);
    counts.scanned++;

    let folderStat;
    try {
      folderStat = fs.statSync(bookDir);
    } catch (err) {
      console.warn(`[papyros scan] cannot stat "${bookDir}": ${err.message}`);
      continue;
    }
    const mtime = Math.floor(folderStat.mtimeMs / 1000);
    const existing = existingByPath.get(bookDir);
    if (existing && existing.mtime === mtime) {
      counts.skipped++;
      continue;
    }

    const row = await buildBookRow({ bookDir, concurrency });
    if (!row) {
      console.warn(`[papyros scan] "${bookDir}" has no probeable audio files — skipping`);
      continue;
    }
    const { firstFileAbsPath, ...bookRow } = row;
    const { id } = upsertStmt.get(bookRow);

    let coverPath = null;
    try {
      coverPath = await extractCover({ firstFileAbsPath, bookDir, dataDir, id });
    } catch (err) {
      console.warn(`[papyros scan] cover extraction failed for "${bookDir}": ${err.message}`);
    }
    if (coverPath) setCoverStmt.run(coverPath, id);

    counts.upserted++;
  }

  for (const existing of existingRows) {
    if (!seenPaths.has(existing.path)) {
      deleteStmt.run(existing.id);
      counts.removed++;
    }
  }

  return counts;
}

/**
 * Build a library scanner bound to one db/audiobooksDir/dataDir. Safe to construct
 * before the `books` migration has run — statements are prepared inside scanLibrary(),
 * not here.
 * @param {{ db: import('better-sqlite3').Database, audiobooksDir: string, dataDir: string, concurrency?: number }} opts
 */
function createScanner({ db, audiobooksDir, dataDir, concurrency = 4 } = {}) {
  if (!db) throw new Error('createScanner: db is required');
  if (!audiobooksDir) throw new Error('createScanner: audiobooksDir is required');
  if (!dataDir) throw new Error('createScanner: dataDir is required');

  // A scan already in flight is JOINED, not duplicated — a second rescanLibrary call
  // (boot scan still running + an admin hits rescan, or a double-click) awaits the
  // same promise instead of starting a concurrent second pass over the same folders.
  let inFlight = null;

  function scanLibrary() {
    if (inFlight) return inFlight;
    inFlight = scanLibraryOnce({ db, audiobooksDir, dataDir, concurrency }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { scanLibrary, isScanning: () => inFlight !== null };
}

module.exports = {
  createScanner,
  AUDIO_EXTENSIONS,
  parseTrackNumber,
  naturalCompare,
  collectAudioFiles,
};

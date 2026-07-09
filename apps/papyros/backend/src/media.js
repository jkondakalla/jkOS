'use strict';
// src/media.js (Wave 3, tasks 3.2 + 3.3) — the playback backend: streams the ACTUAL
// audio bytes off disk (task 3.2: range-aware /api/stream, cover art, book detail), plus
// whole-book downloads for the offline cache (task 3.3: /api/download — single file
// streamed direct, multi-file zipped on the fly). Everything in routes/books.js is
// metadata; this file is the first place PapyrOS touches the audiobook files themselves.
//
// Factory style matches src/routes/books.js and src/routes/library.js — createMediaRouter
// takes its deps at the edge (server.js reads env, this file never touches process.env)
// and returns a plain express.Router. NOT mounted here — task 3.4 wires this into
// server.js alongside progress/session routes; until then this file is inert (no route
// in this repo currently requires it).
//
// Path resolution mirrors exactly how src/library/scan.js WROTE the catalog (read this
// file's header before touching path math here):
//   books.path       = the book's folder, an ABSOLUTE path already under audiobooksDir
//                       (server.js: path.join(audiobooksDir, entry.name) — scan.js never
//                       stores anything relative for the folder itself).
//   files[].path      = POSIX-slashed, RELATIVE to that book folder (collectAudioFiles),
//                       so a per-disc rip like "Disc 1/track01.mp3" round-trips.
//   cover_path        = RELATIVE to dataDir (extractCover returns path.relative(dataDir,
//                       ...)), e.g. "covers/12.jpg".
// So a playable file's absolute path is path.join(book.path, files[i].path), and a cover's
// absolute path is path.join(dataDir, book.cover_path).

const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');
const archiver = require('archiver');

/* Extension → MIME, the small fixed set the scanner's AUDIO_EXTENSIONS actually probes
   (scan.js). Anything else (shouldn't happen — the catalog is scanner-written) falls back
   to a generic binary type rather than guessing. */
const AUDIO_MIME_BY_EXT = {
  '.m4b': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
};

const COVER_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function audioMimeFor(filePath) {
  return AUDIO_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function coverMimeFor(filePath) {
  return COVER_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/jpeg';
}

/** JSON columns land as TEXT in sqlite — parse defensively (a hand-rolled table has no
 *  CHECK forcing valid JSON) so a corrupt row 500s with a clear cause instead of throwing
 *  a raw SyntaxError past the route handler. */
function parseJsonColumn(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Resolve `rel` against `baseDir` and assert the result is still inside baseDir. The
 *  catalog is entirely scanner-written (files[].path/cover_path never come from a user
 *  request), so this is belt-and-braces, not the primary defense — but :bookId/:fileIndex
 *  ARE user-supplied, so a defensive containment check on the path that ACTUALLY reaches
 *  the filesystem costs nothing and catches any future catalog/row corruption loudly (404)
 *  instead of silently serving outside the mount. Returns null on violation. */
function resolveContained(baseDir, rel) {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(baseDir, rel);
  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (resolved !== resolvedBase && !resolved.startsWith(prefix)) return null;
  return resolved;
}

/** Strip characters illegal in Windows/macOS/Linux filenames (\/:*?"<>|) plus control
 *  characters, then collapse whitespace and trim. Unicode letters are KEPT — book
 *  titles are frequently non-English — only the legacy ASCII `filename=` header
 *  parameter strips further, in attachmentHeader() below. Used for task 3.3's download
 *  route; the stream/cover routes above never turn a title into a filename. */
function sanitizeFilenameStem(raw) {
  return String(raw)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/["\\/:*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a `Content-Disposition: attachment` header value carrying BOTH the legacy
 *  ASCII `filename=` (quoted-string, non-ASCII bytes stripped — every client, however
 *  old, understands this one) and the RFC 6266/5987 `filename*=UTF-8''...` form
 *  (percent-encoded, full Unicode — every modern browser prefers this one when it's
 *  present) for the same underlying name, so a non-English title downloads with its
 *  real name in a modern browser and a sane ASCII fallback everywhere else. */
function attachmentHeader(stem, ext) {
  const full = `${stem}${ext}`;
  const asciiStem = stem.replace(/[^\x20-\x7e]/g, '').trim() || 'download';
  const asciiName = `${asciiStem}${ext}`;
  const encoded = encodeURIComponent(full).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/**
 * @param {{ db: import('better-sqlite3').Database, audiobooksDir: string, dataDir: string }} deps
 */
function createMediaRouter({ db, audiobooksDir, dataDir }) {
  if (!db) throw new Error('createMediaRouter: db is required');
  if (!audiobooksDir) throw new Error('createMediaRouter: audiobooksDir is required');
  if (!dataDir) throw new Error('createMediaRouter: dataDir is required');

  const router = Router();

  const getBookStmt = db.prepare('SELECT * FROM books WHERE id = ?');

  // ── GET /api/stream/:bookId/:fileIndex ──────────────────────────────────────────
  // Range-aware file streaming — the one route that actually moves audio bytes. A
  // player (Wave 5) issues a Range request per the HTML5 <audio> / MSE contract; a
  // plain GET (curl, prefetch, a download) gets the whole file.
  router.get('/api/stream/:bookId/:fileIndex', (req, res) => {
    const book = getBookStmt.get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Not found' });

    const fileIndex = Number.parseInt(req.params.fileIndex, 10);
    if (!Number.isInteger(fileIndex) || String(fileIndex) !== req.params.fileIndex.trim()) {
      return res.status(404).json({ error: 'Not found' });
    }
    const files = parseJsonColumn(book.files, []);
    const file = Array.isArray(files) ? files.find((f) => f.index === fileIndex) : null;
    if (!file || typeof file.path !== 'string') return res.status(404).json({ error: 'Not found' });

    // book.path is itself the (already-absolute, scanner-written) book folder —
    // resolveContained(audiobooksDir, book.path) with an ABSOLUTE second argument just
    // normalizes it (path.resolve ignores the base once an absolute segment shows up),
    // so this re-asserts the folder itself is still under audiobooksDir (could only have
    // drifted via direct DB tampering, but cheap to check every request). The per-file
    // path is then resolved against that folder, same containment check again.
    const bookDir = resolveContained(audiobooksDir, book.path);
    if (!bookDir) return res.status(404).json({ error: 'Not found' });
    const filePath = resolveContained(bookDir, file.path);
    if (!filePath) return res.status(404).json({ error: 'Not found' });

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!stat.isFile()) return res.status(404).json({ error: 'Not found' });

    const total = stat.size;
    const mime = audioMimeFor(filePath);
    const rangeHeader = req.headers.range;

    let start = 0;
    let end = total - 1;
    let status = 200;

    if (rangeHeader) {
      // Only the single-range "bytes=start-end" / "bytes=start-" / "bytes=-suffix" forms
      // are handled — multi-range ("bytes=0-1,10-20") is not a real audiobook-player use
      // case and falls through to the unsatisfiable branch below.
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        res.set('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      if (m[1] === '') {
        // Suffix range: "bytes=-500" → last 500 bytes.
        const suffixLen = Number.parseInt(m[2], 10);
        start = Math.max(0, total - suffixLen);
        end = total - 1;
      } else {
        start = Number.parseInt(m[1], 10);
        end = m[2] === '' ? total - 1 : Number.parseInt(m[2], 10);
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.set('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      end = Math.min(end, total - 1);
      status = 206;
    }

    res.status(status);
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Type', mime);
    res.set('Content-Length', String(end - start + 1));
    if (status === 206) res.set('Content-Range', `bytes ${start}-${end}/${total}`);

    const stream = fs.createReadStream(filePath, { start, end });
    // Guard against a leaked fd if the client disconnects mid-stream (a scrub/seek that
    // abandons the in-flight request is the common case for a Range-served player).
    res.on('close', () => { stream.destroy(); });
    stream.on('error', (err) => {
      console.error(`[papyros] stream read failed for "${filePath}": ${err.message}`);
      stream.destroy();
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  });

  // ── GET /api/cover/:bookId ───────────────────────────────────────────────────────
  // Cacheable cover-art read. `private` (not `public`) because covers sit behind the
  // identity gate the same as every other /api route — a shared/public cache must not
  // retain them — but `max-age=86400` still lets the SAME browser skip refetching a
  // cover it already has on every book-list render.
  router.get('/api/cover/:bookId', (req, res) => {
    const book = getBookStmt.get(req.params.bookId);
    if (!book || !book.cover_path) return res.status(404).json({ error: 'Not found' });

    const coverPath = resolveContained(dataDir, book.cover_path);
    if (!coverPath) return res.status(404).json({ error: 'Not found' });

    let stat;
    try {
      stat = fs.statSync(coverPath);
    } catch {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!stat.isFile()) return res.status(404).json({ error: 'Not found' });

    res.set('Content-Type', coverMimeFor(coverPath));
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Last-Modified', stat.mtime.toUTCString());
    res.set('Content-Length', String(stat.size));

    const stream = fs.createReadStream(coverPath);
    res.on('close', () => { stream.destroy(); });
    stream.on('error', (err) => {
      console.error(`[papyros] cover read failed for "${coverPath}": ${err.message}`);
      stream.destroy();
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  });

  // ── GET /api/download/:bookId ───────────────────────────────────────────────────
  // Task 3.3 — whole-book download, the route the Wave-7 offline cache pulls from (a
  // client that wants "this book available offline" fetches this ONE route rather than
  // reassembling it from N /api/stream calls itself). Single-file books stream the file
  // straight through unchanged; multi-file books are zipped ON THE FLY straight into the
  // response — nothing is ever written to disk server-side.
  router.get('/api/download/:bookId', (req, res) => {
    const book = getBookStmt.get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Not found' });

    const files = parseJsonColumn(book.files, []);
    if (!Array.isArray(files) || files.length === 0) return res.status(404).json({ error: 'Not found' });

    // Same containment re-assertion as /api/stream above — see that route's comment for
    // why this is checked on every request rather than trusted from the DB row.
    const bookDir = resolveContained(audiobooksDir, book.path);
    if (!bookDir) return res.status(404).json({ error: 'Not found' });

    const stem = sanitizeFilenameStem((book.title && String(book.title).trim()) || `book-${book.id}`)
      || `book-${book.id}`;

    if (files.length === 1) {
      // ── single file: stream it directly, attachment-flagged — no zip involved ────
      const file = files[0];
      if (!file || typeof file.path !== 'string') return res.status(404).json({ error: 'Not found' });
      const filePath = resolveContained(bookDir, file.path);
      if (!filePath) return res.status(404).json({ error: 'Not found' });

      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        return res.status(404).json({ error: 'Not found' });
      }
      if (!stat.isFile()) return res.status(404).json({ error: 'Not found' });

      res.set('Content-Type', audioMimeFor(filePath));
      res.set('Content-Length', String(stat.size));
      res.set('Content-Disposition', attachmentHeader(stem, path.extname(filePath)));

      const stream = fs.createReadStream(filePath);
      // Same fd-leak guard as /api/stream and /api/cover above.
      res.on('close', () => { stream.destroy(); });
      stream.on('error', (err) => {
        console.error(`[papyros] download read failed for "${filePath}": ${err.message}`);
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });
      stream.pipe(res);
      return;
    }

    // ── multi-file: zip-stream every track, in catalog (== playback) order ───────
    const ordered = files
      .filter((f) => f && typeof f.path === 'string')
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (ordered.length === 0) return res.status(404).json({ error: 'Not found' });

    // Resolve + stat EVERY entry before writing any response bytes, so a missing or
    // corrupted file 404s cleanly instead of surfacing mid-download as a truncated zip
    // on a response that's already committed to 200.
    const resolved = [];
    for (const f of ordered) {
      const filePath = resolveContained(bookDir, f.path);
      if (!filePath) return res.status(404).json({ error: 'Not found' });
      try {
        const st = fs.statSync(filePath);
        if (!st.isFile()) return res.status(404).json({ error: 'Not found' });
      } catch {
        return res.status(404).json({ error: 'Not found' });
      }
      resolved.push({ filePath, index: f.index });
    }

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', attachmentHeader(stem, '.zip'));
    // Deliberately NO Content-Length: the zip is assembled as it streams (even
    // store-only needs the central directory built from the entries actually written),
    // so the final size isn't known up front. Node/Express fall back to chunked
    // transfer-encoding once Content-Length is absent, which is exactly right here.

    const archive = archiver('zip', {
      // Audio files (mp3/m4a/flac/...) are already compressed — re-deflating them buys
      // ~0 size reduction for real CPU + latency cost, so store-only (level 0) just
      // containers the bytes instead of re-encoding them.
      zlib: { level: 0 },
    });

    archive.on('warning', (err) => {
      console.error(`[papyros] download zip warning for book ${book.id}: ${err.message}`);
    });
    archive.on('error', (err) => {
      console.error(`[papyros] download zip failed for book ${book.id}: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    // Client disconnect mid-zip (a large multi-file book on a flaky connection is the
    // realistic case) — abort() stops archiver from reading further source files into a
    // socket nobody's reading from, same fd-leak guard as the plain streams above.
    res.on('close', () => { archive.abort(); });

    archive.pipe(res);
    const padWidth = String(resolved.length).length;
    resolved.forEach((f, i) => {
      const label = Number.isInteger(f.index) ? f.index : i;
      // Index-prefixed original filename (not the bare relative path) — guarantees a
      // naive zip-viewer's default alphabetical sort matches catalog/playback order even
      // when the underlying filenames themselves don't happen to sort that way.
      archive.file(f.filePath, { name: `${String(label).padStart(padWidth, '0')} - ${path.basename(f.filePath)}` });
    });
    archive.finalize();
  });

  // ── GET /api/book/:bookId ────────────────────────────────────────────────────────
  // The detail route routes/books.js's list deliberately excludes files/chapters/path
  // from (discovery.js: BOOK_SHAPE) — everything the list carries PLUS the per-track
  // manifest a player needs to build a playlist. The filesystem `path` column is
  // deliberately left off the wire: the FE streams by (bookId, fileIndex) through
  // /api/stream, never by a raw path, so there is nothing for it to do client-side.
  // 4.2 adds `description` here (migration 6, server.js) — detail-only, same asymmetry
  // as files/chapters above: a blurb is too heavy for the browse-grid list row, so it's
  // NOT in BOOK_SHAPE and never appears on GET /api/books, only here.
  router.get('/api/book/:bookId', (req, res) => {
    const book = getBookStmt.get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Not found' });

    const files = parseJsonColumn(book.files, []).map((f) => ({
      index: f.index,
      duration: f.duration,
      codec: f.codec,
    }));
    const chapters = parseJsonColumn(book.chapters, []);
    const genres = parseJsonColumn(book.genres, []);

    res.json({
      id: book.id,
      title: book.title,
      subtitle: book.subtitle,
      author: book.author,
      narrator: book.narrator,
      series: book.series,
      series_seq: book.series_seq,
      year: book.year,
      genres,
      description: book.description,
      duration: book.duration,
      cover_path: book.cover_path,
      metadata_source: book.metadata_source,
      ext_ref: book.ext_ref,
      updated_at: book.updated_at,
      files,
      chapters,
    });
  });

  return router;
}

module.exports = { createMediaRouter };

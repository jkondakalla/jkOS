'use strict';
// src/media.js — the playback backend, now a thin adapter over the shared media brick
// (@jkos/weave/mediaRoutes, ToDo §3 Wave 17, 17.3). Everything generic — range-aware
// streaming, cover art, whole-book download (1 file direct, N zipped store-only), and
// the compat/transcode DECISION ENGINE with its single-flight + atomic-rename +
// prepare-only-generation invariants — lives in the brick. This file supplies only the
// papyros-SPECIFIC config: how a bookId maps to files on disk (WITH containment), the
// audiobook mime maps, and the Firefox-m4b compat ladder — plus the app-specific
// GET /api/book/:id detail route (the book wire shape a player builds its playlist from),
// which the brick deliberately does not own.
//
// Path resolution mirrors how src/library/scan.js WROTE the catalog:
//   books.path   = the book's folder, an ABSOLUTE path already under audiobooksDir.
//   files[].path = POSIX-slashed, RELATIVE to that folder (so "Disc 1/track01.mp3"
//                  round-trips); a playable file is path.join(book.path, files[i].path).
//   cover_path   = RELATIVE to dataDir (e.g. "covers/12.jpg").

const path = require('node:path');
const { Router } = require('express');
const archiver = require('archiver');
const { defineMediaRoutes } = require('@jkos/weave/mediaRoutes');   // 17.3 media brick
const { containPath } = require('@jkos/files');                    // 17.1 containment resolver
const { cleanGenres } = require('./library/probe');                // serve-time noise-genre filter

/* Extension → MIME, the small fixed set the scanner's AUDIO_EXTENSIONS actually probes.
   Anything else (shouldn't happen — the catalog is scanner-written) falls back to a
   generic binary type rather than guessing. App config injected into the brick. */
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

/* ── The Firefox-m4b compat ladder — papyros-supplied config, not brick literals ──────
   Some .m4b rips (44.1kHz encodes are the reproducible case) carry a `moov` Firefox's
   strict `mp4parse` rejects (NS_ERROR_DOM_MEDIA_METADATA_ERR) even though ffmpeg decodes
   them cleanly. Fix: normalize the container SERVER-SIDE, like every real media server.
   As the brick's decision engine sees it: rung 0 direct-play → rung 1 lossless remux
   (rewrites `moov` cleanly; near-certain fix, zero re-encode cost) → rung 2 AAC re-encode
   fallback (the rare file a clean remux alone doesn't save). Variants land under
   <dataDir>/compat/<bookId>-<fileIndex>.c<level>.m4a — the brick's default variantName +
   this cacheDir reproduce exactly that path. */
const COMPAT_DIR_NAME = 'compat';
const COMPAT_LADDER = [
  { level: 0, strategy: 'direct' },
  {
    level: 1, strategy: 'remux', ext: '.m4a', contentType: 'audio/mp4',
    args: (src, out) => ['-y', '-i', src, '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', out],
  },
  {
    level: 2, strategy: 'reencode', ext: '.m4a', contentType: 'audio/mp4',
    args: (src, out) => ['-y', '-i', src, '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', out],
  },
];

/* A module-level reference to the brick instance so prepareAllCompat (the post-scan
   pre-generation sweep, called SEPARATELY by server.js) shares the SAME single-flight map
   as the mounted routes — a poll-triggered prepare and the background sweep can never run
   two ffmpegs for the same variant. createMediaRouter is called exactly once at boot. */
let sharedMedia = null;

/**
 * @param {{ db: import('better-sqlite3').Database, audiobooksDir: string, dataDir: string }} deps
 */
function createMediaRouter({ db, audiobooksDir, dataDir }) {
  if (!db) throw new Error('createMediaRouter: db is required');
  if (!audiobooksDir) throw new Error('createMediaRouter: audiobooksDir is required');
  if (!dataDir) throw new Error('createMediaRouter: dataDir is required');

  const getBookStmt = db.prepare('SELECT * FROM books WHERE id = ?');

  /** bookId → the files on disk, WITH containment (a bookId/fileIndex reaching a route is
   *  user-supplied). book.path is the (already-absolute, scanner-written) book folder —
   *  containPath re-asserts it is still under audiobooksDir (could only drift via DB
   *  tampering, cheap to check every request); each file path is then resolved against
   *  that folder, same check again. A file that fails containment gets a null path — the
   *  brick treats null as not-found (404 for stream; 404 for the whole download). */
  function resolveFile(bookId) {
    const book = getBookStmt.get(bookId);
    if (!book) return null;
    const bookDir = containPath(audiobooksDir, book.path);
    if (!bookDir) return null;
    const files = parseJsonColumn(book.files, [])
      .filter((f) => f && typeof f.path === 'string' && Number.isInteger(f.index))
      .map((f) => ({ index: f.index, path: containPath(bookDir, f.path) }));
    const name = (book.title && String(book.title).trim()) || `book-${book.id}`;
    return { id: book.id, name, files };
  }

  /** bookId → the absolute cover path (containment-checked against dataDir), or null. */
  function resolveCover(bookId) {
    const book = getBookStmt.get(bookId);
    if (!book || !book.cover_path) return null;
    return containPath(dataDir, book.cover_path);
  }

  const media = defineMediaRoutes({
    resolveFile,
    resolveCover,
    contentType: audioMimeFor,
    coverContentType: coverMimeFor,
    ladder: COMPAT_LADDER,
    cacheDir: path.join(dataDir, COMPAT_DIR_NAME),
    archiver,   // papyros already depends on archiver; the brick never hard-depends on it
    onError: (ctx, err) => console.error(`[papyros] ${ctx}: ${err && err.message ? err.message : err}`),
  });
  sharedMedia = media;

  const router = Router();
  // Brick routes: GET /api/stream/:id/:fileIndex (+ ?compat=N), POST .../prepare,
  // GET /api/cover/:id, GET /api/download/:id — same URLs/status/headers as before.
  media.mount(router);

  // ── GET /api/book/:bookId — app-specific detail route (stays here) ───────────────
  // Everything the list carries PLUS the per-track file manifest + chapters + description
  // BOOK_SHAPE (discovery.js) deliberately excludes. `compat_ready` (per file) tells the
  // player it can START on the normalized level-1 remux (Firefox-safe) instead of
  // discovering a decode failure first — asked of the brick, which owns the freshness rule.
  router.get('/api/book/:bookId', (req, res) => {
    const book = getBookStmt.get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Not found' });

    const files = parseJsonColumn(book.files, []).map((f) => ({
      index: f.index,
      duration: f.duration,
      codec: f.codec,
      compat_ready: Number.isInteger(f.index)
        ? media.prepared({ id: book.id, fileIndex: f.index, level: 1 })
        : false,
    }));
    const chapters = parseJsonColumn(book.chapters, []);
    const genres = cleanGenres(parseJsonColumn(book.genres, []));

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

/** Pre-generate the level-1 (lossless remux) compat variant for EVERY catalog file.
 *  Fired after each scan by server.js (PAPYROS_AUTO_COMPAT=1 — compose-only, never in
 *  tests: playback.smoke asserts 404-before-prepare, which a background sweep would race).
 *  Sequential on purpose: -c copy remuxes are I/O-bound and the library lives on a NAS
 *  mount — one at a time keeps the disk polite; freshness-skip makes re-runs cheap no-ops.
 *  Goes through the brick's ensurePrepared so it shares the routes' single-flight map. */
async function prepareAllCompat({ db }) {
  const media = sharedMedia;
  if (!media) return { made: 0, fresh: 0, failed: 0 };
  const rows = db.prepare('SELECT id, files FROM books ORDER BY id').all();
  let made = 0, fresh = 0, failed = 0;
  for (const row of rows) {
    for (const f of parseJsonColumn(row.files, [])) {
      if (!f || !Number.isInteger(f.index)) continue;
      if (media.prepared({ id: row.id, fileIndex: f.index, level: 1 })) { fresh += 1; continue; }
      const r = await media.ensurePrepared({ id: row.id, fileIndex: f.index, level: 1, wait: true });
      if (r.status === 'ready') made += 1;
      else if (r.status !== 'invalid') failed += 1;
    }
  }
  return { made, fresh, failed };
}

module.exports = { createMediaRouter, prepareAllCompat };

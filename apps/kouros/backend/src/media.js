'use strict';
// src/media.js — the playback backend, app config over the shared media brick
// (@jkos/weave/mediaRoutes, ToDo §3 17.3 — same brick papyros's src/media.js configures).
// Music is direct-play ONLY: no `ladder`/`cacheDir` in the spec below — unlike papyros's
// Firefox-m4b compat remux/re-encode ladder, there is no known browser-compat gap for
// the container/codec set MUSIC_EXTENSIONS scans (mp3/m4a/aac/flac/ogg/opus/wav all
// direct-play natively in every evergreen browser). Per
// packages/weave/src/server/mediaRoutes.js: `hasLadder` is false when `spec.ladder` is
// omitted, which skips mounting `POST .../prepare` entirely (no cacheDir requirement,
// no compat surface to test) — the brick only REQUIRES a ladder+cacheDir pair when one
// is actually supplied. If a real container-compat gap shows up later, this is where a
// ladder gets added — same shape as papyros's, zero brick changes.
//
// A `tracks` row is always exactly ONE file (unit:'file' scanning, src/library/scan.js)
// — `resolveFile` below returns a single-entry `files` array, `fileIndex` is always 0.
// This keeps the wire identical to papyros's `/api/stream/:id/:fileIndex` shape (the
// player's PlayerUrls seam doesn't need to know it's always index 0) without ever
// exercising the brick's multi-file zip-download path (so this app needs no `archiver`
// dependency — that branch is simply never reached).
//
// Path resolution: `tracks.path` is ALREADY an absolute path under MUSIC_DIR (the
// scanner's 'file'-unit mode writes `unitPath = the file's own absolute path` — see
// packages/weave/src/server/libraryScanner.js's `collectFileUnits`), so — unlike
// papyros, which joins a book's folder + a per-file relative path — containment-
// checking the row's `path` directly against MUSIC_DIR is the whole resolution.

const path = require('node:path');
const { Router } = require('express');
const { defineMediaRoutes } = require('@jkos/weave/mediaRoutes');   // 17.3 media brick
const { containPath } = require('@jkos/files');                    // 17.1 containment resolver

/* Extension → MIME, the small fixed set MUSIC_EXTENSIONS (src/library/scan.js) actually
   probes. Anything else (shouldn't happen — the catalog is scanner-written) falls back
   to a generic binary type rather than guessing. */
const AUDIO_MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
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

/**
 * @param {{ db: import('better-sqlite3').Database, musicDir: string, dataDir: string }} deps
 */
function createMediaRouter({ db, musicDir, dataDir }) {
  if (!db) throw new Error('createMediaRouter: db is required');
  if (!musicDir) throw new Error('createMediaRouter: musicDir is required');
  if (!dataDir) throw new Error('createMediaRouter: dataDir is required');

  const getTrackStmt = db.prepare('SELECT * FROM tracks WHERE id = ?');

  /** trackId → the one file on disk, WITH containment (a trackId reaching a route is
   *  user-supplied). `track.path` is the scanner-written absolute file path;
   *  containPath re-asserts it is still under musicDir (could only drift via DB
   *  tampering, cheap to check every request). A file that fails containment gets a
   *  null path — the brick treats null as not-found (404 for stream and download). */
  function resolveFile(trackId) {
    const track = getTrackStmt.get(trackId);
    if (!track) return null;
    const filePath = containPath(musicDir, track.path);
    if (!filePath) return null;
    const name = (track.title && String(track.title).trim()) || path.basename(track.path);
    return { id: track.id, name, files: [{ index: 0, path: filePath }] };
  }

  /** trackId → the absolute cover path (containment-checked against dataDir), or null. */
  function resolveCover(trackId) {
    const track = getTrackStmt.get(trackId);
    if (!track || !track.cover_path) return null;
    return containPath(dataDir, track.cover_path);
  }

  const media = defineMediaRoutes({
    resolveFile,
    resolveCover,
    contentType: audioMimeFor,
    coverContentType: coverMimeFor,
    onError: (ctx, err) => console.error(`[kouros] ${ctx}: ${err && err.message ? err.message : err}`),
  });

  const router = Router();
  // Brick routes: GET /api/stream/:id/:fileIndex, GET /api/cover/:id,
  // GET /api/download/:id — no POST .../prepare (no ladder supplied above).
  media.mount(router);
  return router;
}

module.exports = { createMediaRouter };

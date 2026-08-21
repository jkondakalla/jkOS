'use strict';
// vectors.js — the seam between KourOS's catalog and the music embedder's index
// (ToDo §8's `music/index.db`). KourOS never computes an embedding; it READS one,
// read-only, and degrades to metadata affinity for every track the embedder has
// not reached yet.
//
// ⚠️ THE JOIN IS NOT THE PATH ALONE, AND THAT IS NOT A STYLE CHOICE.
// Both databases store an absolute path, so joining on `path` is the obvious
// move — and when this was first measured it returned ZERO hits out of 163.
// The embedder's index was built against an artist-nested layout
//     /Music/AFI/AFI - AFI (2004) [16B-44.1kHz]/01. The Lost Souls.flac
// while the library is being re-downloaded FLAT, with the artist folded into
// both the album folder and the filename
//     /Music/AFI - Black Sails In The Sunset (1999) [FLAC] .../01. AFI - Strength Through Wounding.flac
// A path join would not have errored. It would have quietly reported 0%
// coverage, every "embedding-powered" surface would have silently served the
// metadata fallback, and the failure would have looked like "the embeddings
// aren't very good" rather than "the embeddings were never consulted".
//
// So resolution is TWO-TIER, in this order:
//   1. exact absolute path      — correct, free, and the normal case the moment
//                                 the embedder rescans the new layout
//   2. normalised artist||title — salvages an index built against the OLD layout
//
// Tier 2's artist/title come from the embedder path's SHAPE, because
// `music/index.db` stores no tags at all (its `tracks` table is
// id/path/mtime/size/duration/status/error/updated_at — vectors are the point,
// metadata is KourOS's job). See `contentKeyFromEmbedderPath`.
//
// Coverage is REPORTED, never assumed — `stats()` is served on the wire so a
// sparse vibe map reads as "the backfill is at 12%" instead of "the map is broken".
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/** The two arms ToDo §8.7 gated against each other. `local_vectors` (CLAP 512-d)
 *  won on every criterion and is preferred; `descriptors` (119-d) is the fallback
 *  arm, still far better than metadata affinity. */
const ARMS = ['local_vectors', 'descriptors'];

/** Lowercase, strip punctuation/diacritics, collapse whitespace. The one
 *  normaliser both tiers of the content key run through. */
function norm(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A KourOS row's content key — it has real tags, so this is just the two of them. */
function contentKeyFromTags(artist, title) {
  const a = norm(artist);
  const t = norm(title);
  return a && t ? `${a}||${t}` : null;
}

/** The same key recovered from an EMBEDDER path, which carries no tags.
 *  Handles BOTH library layouts, because the library is being re-downloaded from
 *  one into the other and an index may be built against either:
 *
 *    nested  /…/Music/<Artist>/<Artist> - <Album> (year)/07. Some Title.flac
 *    flat    /…/Music/<Artist> - <Album> (year) [FLAC]/07. <Artist> - Some Title.flac
 *
 *  The artist comes from the artist DIRECTORY when there is one, and otherwise
 *  from the album folder's "<Artist> - " prefix. Either way the filename's leading
 *  track number and any redundant "<Artist> - " prefix are stripped, so both
 *  layouts converge on the same "artist||title". Returns null when neither shape
 *  yields an artist.
 */
function contentKeyFromEmbedderPath(abs, libraryRootName = 'Music') {
  const parts = abs.split(path.sep).filter(Boolean);
  const i = parts.lastIndexOf(libraryRootName);
  // Need at least <root>/<container>/<file>; anything shallower has no artist to read.
  if (i < 0 || i + 2 >= parts.length) return null;

  // Which shape is this? DEPTH cannot tell them apart — a flat album with a
  // "Disc 2" subfolder and a nested album without one are both 4 segments deep
  // (the same path-depth ambiguity ToDo §8.7 caught silently deflating both arms).
  // The reliable tell is the SEPARATOR: a flat album folder is always
  // "<Artist> - <Album> …", while an artist directory is a bare name. So read the
  // first segment under the library root and ask whether it carries " - ".
  const head = parts[i + 1];
  const artist = head.includes(' - ') ? head.split(' - ')[0].trim() : head;
  if (!artist) return null;

  let base = path.basename(abs).replace(/\.[a-z0-9]+$/i, '');
  base = base.replace(/^\s*\d+\s*[-._)]*\s*/, '');            // "07. " / "07 - " / "07_"
  const artistPrefix = new RegExp(`^${artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-\\s*`, 'i');
  base = base.replace(artistPrefix, '');
  return contentKeyFromTags(artist, base);
}

/** Decode one float32 little-endian BLOB into a Float32Array of `dim`. */
function decodeVector(blob, dim) {
  if (!blob || blob.length !== dim * 4) return null;
  // Copy rather than view: better-sqlite3 hands back a Buffer into its own memory
  // whose byteOffset is rarely 4-aligned, and a Float32Array view demands alignment.
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = blob.readFloatLE(i * 4);
  return out;
}

/** L2-normalise in place so a later dot product IS the cosine (query.py's rule —
 *  "load the whole matrix → L2-normalise → M @ q"). A zero vector is left alone
 *  and reported by the caller rather than producing NaNs downstream. */
function l2Normalise(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  if (!(n > 0)) return false;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return true;
}

/**
 * Read one arm out of the embedder index into memory.
 *
 * The whole matrix is loaded deliberately: 15,326 × 512 float32 is 31 MB and one
 * matmul over it is milliseconds — query.py's TRAP 18 ("there is no ANN index, and
 * that is the design") applies verbatim on this side of the wire. An ANN index here
 * would buy nothing and cost a dependency, a build step, and approximate answers.
 *
 * @returns {{ arm: string, dim: number, byPath: Map<string, Float32Array>,
 *             byContentKey: Map<string, Float32Array>, total: number, degenerate: number } | null}
 */
function loadArm(db, arm, libraryRootName, normalise = true) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT t.path AS path, v.dim AS dim, v.vector AS vector
        FROM ${arm} v
        JOIN tracks t ON t.id = v.track_id
    `).all();
  } catch {
    return null;   // arm table absent — an older/partial index
  }
  if (!rows.length) return null;

  const byPath = new Map();
  const byContentKey = new Map();
  let dim = 0;
  let degenerate = 0;
  for (const r of rows) {
    const vec = decodeVector(r.vector, r.dim);
    if (!vec) continue;
    // The similarity arm is L2-normalised so a dot product IS the cosine. The
    // FEATURE arm must not be: its columns are physical quantities (Hz, dB,
    // log2 BPM) and normalising would erase exactly the scale that makes them
    // readable. Hence the flag rather than a second near-copy of this loop.
    if (normalise && !l2Normalise(vec)) { degenerate++; continue; }
    dim = r.dim;
    byPath.set(r.path, vec);
    const ck = contentKeyFromEmbedderPath(r.path, libraryRootName);
    // First writer wins: a duplicate (~20% of this library per ToDo §8.7) maps many
    // paths onto one content key, and any one of them is an equally correct answer.
    if (ck && !byContentKey.has(ck)) byContentKey.set(ck, vec);
  }
  if (!byPath.size) return null;
  return { arm, dim, byPath, byContentKey, total: byPath.size, degenerate };
}

/**
 * Open the embedder index (read-only) and pick the best available arm.
 * Returns a null-object when there is no index at all, so every caller can treat
 * "no embeddings on this host" as ordinary rather than exceptional.
 */
function openVectorSpace({ vectorDbPath, libraryRootName = 'Music' } = {}) {
  const empty = {
    available: false, arm: null, dim: 0, total: 0, degenerate: 0,
    byPath: new Map(), byContentKey: new Map(), source: vectorDbPath || null,
  };
  if (!vectorDbPath) return empty;
  if (!fs.existsSync(vectorDbPath)) {
    console.warn(`[kouros vectors] no embedder index at "${vectorDbPath}" — similarity falls back to metadata affinity`);
    return empty;
  }
  let db;
  try {
    // readonly + fileMustExist: the embedder owns this file and may be mid-backfill.
    db = new Database(vectorDbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    console.warn(`[kouros vectors] cannot open "${vectorDbPath}": ${err.message}`);
    return empty;
  }
  try {
    for (const arm of ARMS) {
      const loaded = loadArm(db, arm, libraryRootName);
      if (loaded) {
        console.log(`[kouros vectors] ${loaded.total} × ${loaded.dim}-d from "${arm}" (${vectorDbPath})`);
        return { available: true, source: vectorDbPath, ...loaded };
      }
    }
    console.warn(`[kouros vectors] "${vectorDbPath}" has no populated arm yet — metadata affinity only`);
    return empty;
  } finally {
    db.close();   // the matrix is in memory now; hold no handle on the embedder's file
  }
}



/**
 * The RAW descriptor arm, for the interpretable columns only (see space.js's
 * D_* constants). Same file, same two-tier keying, no L2 normalisation — this is
 * never a similarity space, it is a table of physical measurements.
 */
function openFeatureSpace({ vectorDbPath, libraryRootName = 'Music' } = {}) {
  const empty = {
    available: false, arm: null, dim: 0, total: 0, degenerate: 0,
    byPath: new Map(), byContentKey: new Map(), source: vectorDbPath || null,
  };
  if (!vectorDbPath || !fs.existsSync(vectorDbPath)) return empty;
  let db;
  try {
    db = new Database(vectorDbPath, { readonly: true, fileMustExist: true });
  } catch {
    return empty;
  }
  try {
    const loaded = loadArm(db, 'descriptors', libraryRootName, false);
    if (!loaded) return empty;
    console.log(`[kouros vectors] ${loaded.total} × ${loaded.dim}-d raw descriptors for readable features`);
    return { available: true, source: vectorDbPath, ...loaded };
  } finally {
    db.close();
  }
}

module.exports = {
  ARMS, norm, contentKeyFromTags, contentKeyFromEmbedderPath,
  decodeVector, l2Normalise, openVectorSpace, openFeatureSpace,
};

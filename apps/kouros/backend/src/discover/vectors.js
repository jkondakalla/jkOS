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
// So resolution is THREE-TIER, in this order:
//   1. exact absolute path      — correct and free, but see the warning below:
//                                 in the container it can never actually hit
//   2. ROOT-RELATIVE path       — everything after the library root, which the
//                                 two databases DO agree on. The workhorse.
//   3. normalised artist||title — salvages an index built against the OLD layout
//
// ⚠️ **TIER 1 CANNOT HIT IN DEPLOYMENT, AND THAT IS NOT A BUG IN TIER 1.** The
// embedder walks the host and stores `/mnt/Luna/Plex/Music/…`; KourOS reads a
// read-only bind mount and stores `/music/…`. Both are absolute, both are
// correct, and they share no prefix — so the "obvious" join is dead on arrival
// the moment this runs in a container, while continuing to work perfectly on a
// workstation where both processes see the same filesystem. That is the worst
// possible failure shape: green in dev, silently 0% in prod. Tier 2 exists
// because the two paths agree on every segment BELOW the library root, which is
// the part that actually identifies the file.
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

/** A multi-disc subfolder, which sits BETWEEN the album folder and the files.
 *  ToDo §8.7 found this exact shape silently deflating both arms by making a
 *  flat album look nested, so it is matched explicitly rather than guessed at
 *  from depth. */
const DISC_DIR = /^(disc|disk|cd)\s*\d+$/i;

/** Index of the last segment matching the library root, case-insensitively.
 *  Case matters: the host dataset is `…/Plex/Music` and the container mount is
 *  `/music`, and a case-sensitive compare would miss the second. */
function lastRootIndex(parts, libraryRootName) {
  const want = String(libraryRootName || '').toLowerCase();
  if (!want) return -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].toLowerCase() === want) return i;
  }
  return -1;
}

/** THE PRIMARY KEY: everything below the library root, lowercased.
 *
 *  `/mnt/Luna/Plex/Music/AFI - Black Sails/01. x.flac` → `afi - black sails/01. x.flac`
 *  `/music/AFI - Black Sails/01. x.flac`               → the same string
 *
 *  Layout-free, tag-free and exact — it identifies the FILE rather than
 *  reasoning about what the folder names mean. Returns null when the root does
 *  not appear in the path at all, which is the honest answer: without the root
 *  there is nothing to take a suffix from. */
function relKeyFromEmbedderPath(abs, libraryRootName = 'Music') {
  const parts = String(abs).split(path.sep).filter(Boolean);
  const i = lastRootIndex(parts, libraryRootName);
  if (i < 0 || i + 1 >= parts.length) return null;
  return parts.slice(i + 1).join('/').toLowerCase();
}

/** The content key recovered from an EMBEDDER path, which carries no tags.
 *  Handles BOTH library layouts, because the library is being re-downloaded from
 *  one into the other and an index may be built against either:
 *
 *    nested  /…/Music/<Artist>/<Artist> - <Album> (year)/07. Some Title.flac
 *    flat    /…/Music/<Artist> - <Album> (year) [FLAC]/07. <Artist> - Some Title.flac
 *
 *  ⚠️ **READ FROM THE FILE END, NEVER FROM THE ROOT END.** The previous version
 *  took the first segment below the library root as the artist directory, which
 *  is only true when the album sits exactly one level down. The retired rip has
 *  since been moved into `Old (Needs to be trimmed)/`, so that segment became the
 *  EXCLUDED FOLDER — it carries no " - ", was therefore read as a bare artist
 *  name, and every one of those 1,511 vectors keyed to the artist
 *  "old needs to be trimmed". Not one of them could ever match, and nothing
 *  anywhere said so.
 *
 *  Anchoring at the file makes the reader independent of how deep the library is
 *  buried: the album folder is the file's parent (skipping a `Disc N`), and the
 *  artist is either that folder's "<Artist> - " prefix or the directory above it.
 *  The artist directory is only accepted when it sits BELOW the library root, so
 *  a shallow path yields null instead of borrowing a mount component.
 */
function contentKeyFromEmbedderPath(abs, libraryRootName = 'Music') {
  const parts = String(abs).split(path.sep).filter(Boolean);
  if (parts.length < 2) return null;
  const rootIdx = lastRootIndex(parts, libraryRootName);

  let albumIdx = parts.length - 2;
  if (albumIdx > 0 && DISC_DIR.test(parts[albumIdx])) albumIdx--;
  if (albumIdx <= rootIdx) return null;      // the file sits directly in the root
  const album = parts[albumIdx];

  //  ⚠️ **THE DIRECTORY WINS OVER THE " - " PREFIX, NOT THE OTHER WAY ROUND.**
  //  This read the prefix first until 2026-08-26, which is right only while the
  //  library is entirely flat. The completed library carries BOTH layouts, and
  //  494 of its tracks sit in nested album folders whose TITLE contains a hyphen
  //  — `Taking Back Sunday/Live From Orensanz (Live From Orensanz, New York,
  //  NY - 2009)/…` — so prefix-first credited them to an artist named after half
  //  an album title. A parent directory below the root is an unambiguous
  //  statement about the artist; the prefix is a guess, and it is only needed
  //  when there is no such directory. Kept identical to `descriptors.artist_of`
  //  on the Python side, which is the same rule for the same reason.
  let artist = null;
  if (albumIdx - 1 > rootIdx) artist = parts[albumIdx - 1];
  else if (album.includes(' - ')) artist = album.split(' - ')[0].trim();
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

/* ── the corpus geometry ──────────────────────────────────────────────────────
   ⚠️ A COSINE IS NOT A SIMILARITY UNTIL YOU KNOW WHERE ZERO IS, AND FOR CLAP IT
   IS NOWHERE NEAR ZERO. This is the same trap ToDo §8.7 logged on the Python
   side — the one that first reported the WRONG WINNER at the gate. CLAP's space
   is a narrow anisotropic cone: every pair of tracks in the library scores at
   least +0.03 and two STRANGERS average +0.480 with a spread of 0.219. The
   descriptor arm is z-scored, so it is already centred and its strangers sit at
   -0.017. Read raw, the two arms are not on the same scale, a stranger presents
   to the UI as "0.48 similar", and any expression that MULTIPLIES a cosine by
   something else (queries.js's walking run does exactly that) gets a term that
   barely varies and is dominated by whatever it was multiplied against.

   So the offset and scale are FITTED over the corpus by `music/query.py --fit`
   and stored in the embedder index's `meta` table, keyed `calib_*:<arm>` — the
   same `<name>:<table>` convention as `config_sig:local_vectors`. KourOS READS
   that fit; it never assumes a zero point and never hardcodes one, because the
   right numbers depend on the library the space was built over.

   Absent (an index predating the fit), everything below degrades to the old raw
   behaviour and `stats()` says `calibrated: false` out loud — the same rule the
   rest of this seam follows about never passing one thing off as another. */
function loadCalibration(db, arm) {
  let mean = null, centre = null, spread = null, fittedSig = null, currentSig = null, nFit = 0;
  try {
    const rows = db.prepare(
      `SELECT key, value FROM meta WHERE key IN (?, ?, ?, ?, ?, ?)`
    ).all(
      `calib_mean:${arm}`, `calib_stranger_mean:${arm}`, `calib_stranger_spread:${arm}`,
      `calib_n_fit:${arm}`, `calib_sig:${arm}`, `config_sig:${arm}`,
    );
    for (const { key, value } of rows) {
      if (key === `calib_mean:${arm}`) mean = value;
      else if (key === `calib_stranger_mean:${arm}`) centre = Number(value);
      else if (key === `calib_stranger_spread:${arm}`) spread = Number(value);
      else if (key === `calib_n_fit:${arm}`) nFit = Number(value) || 0;
      else if (key === `calib_sig:${arm}`) fittedSig = value;
      else if (key === `config_sig:${arm}`) currentSig = value;
    }
  } catch {
    return null;   // no meta table — an index older than the fit
  }
  if (!mean || !Number.isFinite(centre) || !Number.isFinite(spread) || !(spread > 0)) return null;

  // base64 of the float32 bytes: `meta.value` is TEXT, and a float round-tripped
  // through decimal text is nearly — but not — the vector that was fitted.
  const buf = Buffer.from(mean, 'base64');
  if (buf.length % 4) return null;
  const vec = new Float32Array(buf.length / 4);
  for (let i = 0; i < vec.length; i++) vec[i] = buf.readFloatLE(i * 4);

  // A calibration fitted before a config change describes a space that no longer
  // exists. Refuse it rather than silently centring by the wrong axis.
  const stale = !!(fittedSig && currentSig && fittedSig !== currentSig);
  if (stale) {
    console.warn(`[kouros vectors] calibration for "${arm}" was fitted under config ${fittedSig} but the arm is ${currentSig} — ignoring it; re-run \`music/query.py --fit\``);
    return null;
  }
  return { mean: vec, strangerMean: centre, strangerSpread: spread, nFit };
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
function loadArm(db, arm, libraryRootName, normalise = true, calibration = null) {
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
  const byRelPath = new Map();
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
    // Centre BEFORE normalising, and only for a similarity arm: subtracting the
    // corpus axis is what turns "every pair looks alike" into a space whose
    // ordering is about the music rather than about the direction all of it
    // shares. A track landing exactly on the mean has no direction left — it is
    // counted degenerate and dropped, never emitted as NaN.
    if (normalise && calibration && calibration.mean.length === r.dim) {
      for (let d = 0; d < r.dim; d++) vec[d] -= calibration.mean[d];
    }
    if (normalise && !l2Normalise(vec)) { degenerate++; continue; }
    dim = r.dim;
    byPath.set(r.path, vec);
    const rel = relKeyFromEmbedderPath(r.path, libraryRootName);
    if (rel && !byRelPath.has(rel)) byRelPath.set(rel, vec);
    const ck = contentKeyFromEmbedderPath(r.path, libraryRootName);
    // First writer wins: a duplicate (~20% of this library per ToDo §8.7) maps many
    // paths onto one content key, and any one of them is an equally correct answer.
    if (ck && !byContentKey.has(ck)) byContentKey.set(ck, vec);
  }
  if (!byPath.size) return null;
  return { arm, dim, byPath, byRelPath, byContentKey, total: byPath.size, degenerate };
}

/**
 * Open the embedder index (read-only) and pick the best available arm.
 * Returns a null-object when there is no index at all, so every caller can treat
 * "no embeddings on this host" as ordinary rather than exceptional.
 */
function openVectorSpace({ vectorDbPath, libraryRootName = 'Music' } = {}) {
  const empty = {
    available: false, arm: null, dim: 0, total: 0, degenerate: 0, calibration: null,
    byPath: new Map(), byRelPath: new Map(), byContentKey: new Map(), source: vectorDbPath || null,
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
      const calibration = loadCalibration(db, arm);
      const loaded = loadArm(db, arm, libraryRootName, true, calibration);
      if (loaded) {
        console.log(
          `[kouros vectors] ${loaded.total} × ${loaded.dim}-d from "${arm}" (${vectorDbPath}) — ` +
          (calibration
            ? `calibrated over ${calibration.nFit} tracks, strangers ` +
              `${calibration.strangerMean.toFixed(4)} ± ${calibration.strangerSpread.toFixed(4)}`
            : 'UNCALIBRATED (run `music/query.py --fit`) — scores are raw cosines')
        );
        return { available: true, source: vectorDbPath, calibration, ...loaded };
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
    available: false, arm: null, dim: 0, total: 0, degenerate: 0, calibration: null,
    byPath: new Map(), byRelPath: new Map(), byContentKey: new Map(), source: vectorDbPath || null,
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
  decodeVector, l2Normalise, loadCalibration, openVectorSpace, openFeatureSpace,
  relKeyFromEmbedderPath, lastRootIndex, DISC_DIR,
};

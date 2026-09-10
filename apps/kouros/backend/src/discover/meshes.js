'use strict';
// meshes.js — the seam onto the pulsarmap mesh store (`music/meshes.db`,
// ALGORITHMS.md §9). KourOS never builds a mesh; it READS one, read-only, and
// says plainly when there is not one to read.
//
// ⚠️ SAME JOIN AS THE VECTORS, AND FOR THE SAME REASON — see vectors.js's header
// at length. The embedder walks the HOST (`/mnt/Luna/Plex/Music/…`) and KourOS
// reads a bind MOUNT (`/music/…`); both are absolute, both are correct, and they
// share no prefix. The two agree only BELOW the library root, so the store is
// keyed on that suffix, lowercased.
//
// ⚠️ **THE CATALOG SIDE OF THAT KEY IS NOT THE EMBEDDER SIDE.** The embedder's
// path carries the library root as a segment and is read by scanning for it;
// KourOS's path is under a mount usually NOT named after the library and is read
// by stripping that mount. This file imports `catalogRelKey` for exactly that
// reason — reaching for `relKeyFromEmbedderPath` here resolves every lookup to
// null in production and in the fixture, and the symptom is 'pending' on every
// track, which is indistinguishable from a fill that has not run.
//
// ⚠️ **UNLIKE THE VECTORS, THIS IS NOT LOADED INTO MEMORY.** `openVectorSpace`
// reads its whole matrix and closes the handle, because 47,441 × 512 floats is
// 31 MB. 47,441 meshes is ~800 MB, so meshes are read ONE AT A TIME, per request,
// over a handle held open for the process. That is also why this is a separate
// module from the space: the space is a snapshot rebuilt on a TTL, and a mesh
// store is a lookup table that is correct the moment a row lands in it.
const fs = require('fs');
const Database = require('better-sqlite3');
const { catalogRelKey } = require('./vectors');

/** What the store must agree with for its rows to be one picture. Read from
 *  `meta` and served on the wire, so a client can tell a store that was re-filled
 *  under different rules from one that simply has fewer rows. */
const RECIPE_KEY = 'mesh_recipe';

const UNAVAILABLE = {
  available: false, source: null, total: 0, failed: 0, recipe: null,
  get: () => null,
  stats: () => ({ available: false, meshes: 0, failed: 0, recipe: null, source: null }),
  close: () => {},
};

/**
 * Open the mesh store, or return an honest unavailable seam.
 *
 * OPTIONAL BY DESIGN, exactly like the vector index: it is produced by a separate
 * Python pipeline on a separate schedule, and a track with no mesh yet is the
 * expected steady state during a fill. Every caller must be able to say "not
 * built yet" without that being an error.
 */
function openMeshStore({ meshDbPath, libraryRootName = 'Music', musicDir = null } = {}) {
  if (!meshDbPath) return UNAVAILABLE;
  if (!fs.existsSync(meshDbPath)) {
    console.warn(`[kouros meshes] no mesh store at "${meshDbPath}" — the pulsarmap is unavailable`);
    return UNAVAILABLE;
  }
  let db;
  try {
    // readonly + fileMustExist: the embedder owns this file and may be mid-fill.
    db = new Database(meshDbPath, { readonly: true, fileMustExist: true });
    // Fail here rather than on the first request: a file that exists but is not a
    // mesh store (a stale `music-index.db` copied to the wrong name, say) would
    // otherwise throw inside a route and read as a 500 on one track.
    db.prepare('SELECT COUNT(*) AS n FROM meshes').get();
  } catch (err) {
    console.warn(`[kouros meshes] cannot open "${meshDbPath}": ${err.message}`);
    try { if (db) db.close(); } catch { /* already gone */ }
    return UNAVAILABLE;
  }

  const recipe = (() => {
    try {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(RECIPE_KEY);
      return row ? row.value : null;
    } catch { return null; }
  })();

  const selectMesh = db.prepare(
    'SELECT n_rows, n_mels, row_secs, value_lo, value_hi, reduction, config_sig, duration, rows ' +
    'FROM meshes WHERE rel_key = ?'
  );
  const countMeshes = db.prepare('SELECT COUNT(*) AS n FROM meshes');
  const countFailures = db.prepare('SELECT COUNT(*) AS n FROM failures');
  const selectFailure = db.prepare('SELECT error FROM failures WHERE rel_key = ?');

  const total = countMeshes.get().n;
  console.log(`[kouros meshes] ${total} mesh(es) from "${meshDbPath}" — ${recipe || 'no recipe recorded'}`);

  /**
   * One track's mesh, by its absolute path in KourOS's catalog.
   *
   * Returns `null` when the path carries no library root — the honest answer,
   * since without the root there is nothing to take a suffix from — and a
   * `{ state: 'failed' }` marker when the fill tried this track and could not.
   * ⚠️ **"Not built yet" and "tried and could not" must stay distinguishable.**
   * Collapsing them is the same mistake as a discovery surface that cannot tell
   * "no results" from "no index", which is the whole reason `discoveryStats`
   * exists.
   */
  function get(absPath) {
    const key = catalogRelKey(absPath, { musicDir, libraryRootName });
    if (!key) return null;
    const row = selectMesh.get(key);
    if (!row) {
      const bad = selectFailure.get(key);
      return bad ? { state: 'failed', key, error: bad.error } : null;
    }
    const want = row.n_rows * row.n_mels;
    if (!row.rows || row.rows.length !== want) {
      // A truncated BLOB reshaped against a remembered row count is a picture
      // with a wrapped time axis — plausible, and wrong.
      console.warn(`[kouros meshes] "${key}" stores ${row.rows ? row.rows.length : 0} bytes ` +
                   `but declares ${row.n_rows}x${row.n_mels} = ${want}`);
      return { state: 'failed', key, error: 'stored mesh is the wrong length' };
    }
    return {
      state: 'ok',
      key,
      rows: row.n_rows,
      bands: row.n_mels,
      row_seconds: row.row_secs,
      // The scale the bytes were quantised against. ⚠️ On the wire so the client
      // can dequantise without being told a constant separately — NOT so it can
      // be per track. The store refuses to hold two ranges at once; every mesh in
      // one store carries the same pair, and that is what makes two pictures
      // comparable at all.
      value_range: [row.value_lo, row.value_hi],
      reduction: row.reduction,
      config_sig: row.config_sig,
      duration: row.duration,
      // ⚠️ base64 in an ordinary JSON body, NOT a binary endpoint. ~17 KB of
      // uint8 is ~23 KB base64, which keeps this read inside every contract the
      // suite already enforces — pagination, wire time, defineCollection, the
      // completeness probe. A binary surface would sit outside all of them to
      // save 6 KB.
      data: Buffer.from(row.rows).toString('base64'),
    };
  }

  function stats() {
    return {
      available: true,
      meshes: countMeshes.get().n,
      failed: countFailures.get().n,
      recipe,
      source: meshDbPath,
    };
  }

  return { available: true, source: meshDbPath, total, recipe, get, stats, close: () => db.close() };
}

module.exports = { openMeshStore, RECIPE_KEY };

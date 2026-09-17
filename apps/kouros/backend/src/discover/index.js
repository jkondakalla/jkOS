'use strict';
// discover/index.js — the discovery SERVICE: owns the aligned space, caches the
// expensive projection, and hands the routes a small, stable surface.
//
// Why a service and not four free functions: the space is a 31 MB matrix and the
// vibe map is a projection plus a k-means over it. Neither may be rebuilt per request,
// and both go stale the moment the scanner upserts a track or the embedder
// finishes another slice of backfill. So exactly one object owns "the current
// view of the library", knows when it was built, and rebuilds on an explicit
// signal (a completed rescan) or when its TTL lapses — never in the middle of
// serving a request.
//
// ⚠️ **A LAPSED TTL IS A QUESTION, NOT A REBUILD.** The analysis files are replaced
// whole by `music/analyze.py`'s delivery (rsync writes a temp file and renames it),
// so "has it changed" is a `stat`, and the answer is almost always no. Reloading
// 47,000 vectors to find that out blocked the event loop every five minutes for
// nothing — and reading a REPLACED file needs the opposite: a mesh store held open
// forever keeps reading the unlinked inode, and never serves a single new mesh.
const fs = require('fs');
const { openVectorSpace, openFeatureSpace } = require('./vectors');
const { openMeshStore } = require('./meshes');
const { buildSpace } = require('./space');
const queries = require('./queries');
const mapmod = require('./map');

/** How long a built space is trusted before a read rebuilds it. The embedder runs
 *  for hours and the scanner runs on boot/rescan, so this is about eventual
 *  freshness, not consistency — a five-minute-old map is fine, a rebuild in the
 *  request path is not. */
const TTL_MS = 5 * 60 * 1000;

/** A source file's identity — inode, size and mtime of the file AND its `-wal`, or
 *  null when the file is not there.
 *
 *  ⚠️ The `-wal` half is not decoration. In dev, VECTOR_DB_PATH can point straight at
 *  the embedder's live `index.db`, where a backfill commits into `index.db-wal` and
 *  leaves the main file's stat untouched for hours; an identity of the main file
 *  alone would call that index unchanged while it gained thousands of vectors. */
function fileIdentity(p) {
  if (!p) return null;
  const one = (f) => {
    try { const s = fs.statSync(f); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return '-'; }
  };
  const main = one(p);
  return main === '-' ? null : `${main}|${one(`${p}-wal`)}`;
}

/**
 * @param {object} opts
 * @param {number} [opts.ttlMs] how long a source is trusted before its identity is re-read
 * @param {(what: string) => void} [opts.onAnalysisChanged] called when a delivered
 *   analysis file is replaced (or first appears) under a running server — see below
 */
function createDiscovery({ db, vectorDbPath, meshDbPath = null, libraryRootName = 'Music',
                          musicDir = null, ttlMs = TTL_MS, onAnalysisChanged = null }) {
  let space = null;
  let projection = null;
  let mapCache = null;
  let builtAt = 0;
  let building = false;
  // `undefined` = never looked; `null` = looked, no file. The difference is what
  // keeps the first build at boot from reading as "the analysis changed".
  let builtFrom;
  let lastNotified = 0;

  /* ⚠️ **NEW ANALYSIS MEANS NEW MUSIC, SO IT IS ALSO THE SIGNAL TO RESCAN.** The
     watcher on the workstation analyses a file only once it has landed on the
     shelf, and delivers only when it analysed something — so a replaced analysis
     file is the one event that reliably says the catalog is behind. Without this,
     an upload's vectors and mesh would arrive and its TRACK would not: nothing in
     KourOS walks MUSIC_DIR except the boot scan and an admin's rescan.
     Read-driven like the TTL itself (no timer — the suite has no scheduler), and
     debounced to one TTL, because one delivery replaces two files. */
  function sourceChanged(what, before, after) {
    console.log(`[kouros discover] ${what} changed on disk — reloading`);
    if (before === undefined || after === null || typeof onAnalysisChanged !== 'function') return;
    if (Date.now() - lastNotified < ttlMs) return;
    lastNotified = Date.now();
    try { onAnalysisChanged(what); } catch (err) {
      console.warn(`[kouros discover] onAnalysisChanged failed: ${err.message}`);
    }
  }

  /* The pulsarmap store, held OPEN across requests rather than snapshotted into
     memory like the vector space: 47,441 meshes is ~800 MB, so they are read one
     at a time. A row is correct the moment it lands.

     Two things can change under it, and both are normal: the file APPEARING (the
     store may not exist at boot), and the file being REPLACED by a delivery. Both
     are answered on the same TTL the space uses — an unavailable store is retried,
     an available one has its identity re-read and is reopened only if it moved. */
  let meshes = null;
  let meshesOpenedAt = 0;
  let meshIdentity;

  function meshStore() {
    const now = Date.now();
    if (meshes && now - meshesOpenedAt <= ttlMs) return meshes;
    const id = fileIdentity(meshDbPath);
    if (meshes && id === meshIdentity) { meshesOpenedAt = now; return meshes; }
    if (meshes) {
      if (meshes.available || id !== null) sourceChanged('mesh store', meshIdentity, id);
      try { meshes.close(); } catch { /* already closed */ }
    }
    meshIdentity = id;
    meshes = openMeshStore({ meshDbPath, libraryRootName, musicDir });
    meshesOpenedAt = now;
    return meshes;
  }

  function build() {
    const t0 = Date.now();
    // Read BEFORE opening, so a replacement that lands mid-build is seen next time
    // rather than recorded as the file this space was built from.
    builtFrom = fileIdentity(vectorDbPath);
    const vectorSpace = openVectorSpace({ vectorDbPath, libraryRootName });
    const featureSpace = openFeatureSpace({ vectorDbPath, libraryRootName });
    space = buildSpace({ db, vectorSpace, featureSpace, musicDir, libraryRootName });
    projection = null;
    mapCache = null;
    builtAt = Date.now();
    const st = space.stats;
    console.log(
      `[kouros discover] space built in ${builtAt - t0}ms — ${st.tracks} tracks, ` +
      `${st.measured} measured + ${st.inferred} inferred ` +
      `(${(st.coverage * 100).toFixed(1)}% coverage) ` +
      `[path ${st.byPath} · rel ${st.byRelPath} · content ${st.byContentKey}]`
    );
    // ⚠️ The failure this seam exists to make loud. A populated index that
    // resolves onto NOTHING is indistinguishable, from every surface downstream,
    // from an embedder that simply has not run yet — and the symptom reads as
    // "the recommendations are bad", not "the vectors were never consulted".
    if (vectorSpace.available && !st.measured) {
      console.error(
        `[kouros discover] ⚠️ the embedder index holds ${vectorSpace.total} vectors and NOT ONE ` +
        `resolved onto this catalog. Every discovery surface is about to serve metadata ` +
        `affinity while reporting an arm. Check that LIBRARY_ROOT_NAME ("${libraryRootName}") ` +
        `is the last path segment the two databases share, and that MUSIC_DIR ` +
        `("${musicDir || 'unset'}") is the mount those tracks were scanned from.`);
    }
    return space;
  }

  /** The current space, rebuilt if its source changed. Guarded against re-entry
   *  so two concurrent requests cannot both pay for a rebuild. */
  function current() {
    if (space && !building && Date.now() - builtAt > ttlMs) {
      const id = fileIdentity(vectorDbPath);
      if (id === builtFrom) {
        builtAt = Date.now();                // unchanged — trust it for another TTL
      } else {
        sourceChanged('vector index', builtFrom, id);
        space = null;
      }
    }
    if (!space && !building) {
      building = true;
      try { build(); } finally { building = false; }
    }
    return space;
  }

  /** Force a rebuild — wired to the scanner's onScanComplete, so a rescan that
   *  adds tracks is reflected without waiting out the TTL. */
  function invalidate() {
    space = null; projection = null; mapCache = null; builtAt = 0;
  }

  /** The projection through the stored basis — ONE per space build, shared by the
   *  map payload and every `near` query. (It used to be a PCA, run twice.) */
  function projected() {
    const s = current();
    if (!projection) projection = mapmod.buildProjection(s);
    return projection;
  }

  function map(opts) {
    const s = current();
    if (mapCache) return mapCache;
    mapCache = mapmod.vibeMap(s, projected(), opts);
    return mapCache;
  }

  /** One track's pulsarmap, by KourOS track id.
   *
   *  ⚠️ Three outcomes, and they are three different answers: `null` when the
   *  track id is not in the catalog at all, `{ state: 'unavailable' }` when there
   *  is no mesh store to read, and `{ state: 'pending' }` when the store is there
   *  and this track is simply not filled yet. A client that cannot tell the last
   *  two apart shows "coming soon" for a store that will never appear. */
  function mesh(trackId) {
    const store = meshStore();
    let row;
    try {
      row = db.prepare('SELECT path FROM tracks WHERE id = ?').get(trackId);
    } catch (err) {
      console.warn(`[kouros discover] mesh track lookup failed: ${err.message}`);
      return null;
    }
    if (!row || !row.path) return null;
    if (!store.available) return { state: 'unavailable', track_id: trackId };
    const found = store.get(row.path);
    if (!found) return { state: 'pending', track_id: trackId };
    return { track_id: trackId, ...found };
  }

  /** The space's own coverage, plus the mesh store's.
   *
   *  ⚠️ Mesh coverage joins this for the reason `discoveryStats` exists at all: a
   *  mesh that is merely NOT BUILT YET must be distinguishable from one that
   *  failed, and both from a store that is not there. Three states, reported,
   *  never inferred from an empty response. */
  function stats() {
    return { ...current().stats, meshes: meshStore().stats() };
  }

  return {
    build, invalidate, current,
    stats,
    mesh,
    similar: (id, opts) => queries.similar(current(), id, opts),
    radio: (ids, opts) => queries.radio(current(), ids, opts),
    run: (opts) => queries.makeRun(current(), opts),
    map,
    nearPoint: (point, opts) => {
      const s = current();
      return mapmod.nearPoint(s, projected(), point, opts);
    },
  };
}

module.exports = { createDiscovery, TTL_MS, fileIdentity };

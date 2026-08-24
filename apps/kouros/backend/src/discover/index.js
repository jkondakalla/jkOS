'use strict';
// discover/index.js — the discovery SERVICE: owns the aligned space, caches the
// expensive projection, and hands the routes a small, stable surface.
//
// Why a service and not four free functions: the space is a 31 MB matrix and the
// vibe map is a PCA plus a k-means over it. Neither may be rebuilt per request,
// and both go stale the moment the scanner upserts a track or the embedder
// finishes another slice of backfill. So exactly one object owns "the current
// view of the library", knows when it was built, and rebuilds on an explicit
// signal (a completed rescan) or when its TTL lapses — never in the middle of
// serving a request.
const { openVectorSpace, openFeatureSpace } = require('./vectors');
const { buildSpace } = require('./space');
const queries = require('./queries');
const mapmod = require('./map');
const { ORIGIN } = require('./space');

/** How long a built space is trusted before a read rebuilds it. The embedder runs
 *  for hours and the scanner runs on boot/rescan, so this is about eventual
 *  freshness, not consistency — a five-minute-old map is fine, a rebuild in the
 *  request path is not. */
const TTL_MS = 5 * 60 * 1000;

function createDiscovery({ db, vectorDbPath, libraryRootName = 'Music', musicDir = null }) {
  let space = null;
  let projection = null;
  let mapCache = null;
  let builtAt = 0;
  let building = false;

  function build() {
    const t0 = Date.now();
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

  /** The current space, rebuilt if stale. Guarded against re-entry so two
   *  concurrent requests cannot both pay for a rebuild. */
  function current() {
    if (!space || (Date.now() - builtAt > TTL_MS && !building)) {
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

  /** The map, plus the raw projection `nearPoint` needs. Both cached together:
   *  they come from the same PCA and would otherwise be computed twice. */
  function map(opts) {
    const s = current();
    if (mapCache) return mapCache;
    const built = mapmod.vibeMap(s, opts);
    mapCache = built;
    if (built.available) {
      // Recompute the coordinate arrays alongside the map so a pin drag is a
      // linear scan over cached numbers rather than a second PCA.
      const rowsIdx = [];
      for (let i = 0; i < s.n; i++) if (s.origin[i] !== ORIGIN.NONE) rowsIdx.push(i);
      const { mean, components } = mapmod.principalComponents(s.matrix, s.dim, rowsIdx, 2);
      const m = rowsIdx.length;
      const xs = new Float64Array(m), ys = new Float64Array(m);
      for (let r = 0; r < m; r++) {
        const off = rowsIdx[r] * s.dim;
        let x = 0, y = 0;
        for (let d = 0; d < s.dim; d++) {
          const v = s.matrix[off + d] - mean[d];
          x += v * components[0][d]; y += v * components[1][d];
        }
        xs[r] = x; ys[r] = y;
      }
      mapmod.scaleToUnit(xs); mapmod.scaleToUnit(ys);
      projection = { rowsIdx, xs, ys };
    }
    return mapCache;
  }

  return {
    build, invalidate, current,
    stats: () => current().stats,
    similar: (id, opts) => queries.similar(current(), id, opts),
    radio: (ids, opts) => queries.radio(current(), ids, opts),
    run: (opts) => queries.makeRun(current(), opts),
    map,
    nearPoint: (x, y, opts) => {
      map();   // ensure the projection exists
      const s = current();
      if (!projection) return [];
      return mapmod.nearPoint(s, projection, x, y, opts);
    },
  };
}

module.exports = { createDiscovery, TTL_MS };

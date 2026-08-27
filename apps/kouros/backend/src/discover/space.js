'use strict';
// space.js — the one similarity engine behind every "smart" surface in KourOS:
// `similar`, radio, Runs, and the vibe map. It aligns the embedder's vectors
// (src/discover/vectors.js) onto THIS catalog's track ids and answers questions
// about the resulting space.
//
// Three ideas carry the whole file:
//
// 1. ONE ALIGNED MATRIX, LOADED WHOLE. 15,326 × 512 float32 is 31 MB and a full
//    scan is a few milliseconds — query.py's TRAP 18 ("there is no ANN index, and
//    that is the design") holds identically here. Every query below is a linear
//    pass. No index, no approximation, no dependency.
//
// 2. ALBUM PROPAGATION, MARKED AS SUCH. The backfill reaches tracks in path order,
//    so at any moment most of the library has no vector. But ALGORITHMS.md §4 measured
//    same-album cosine at +0.43 — an album is genuinely a tight cluster — so a
//    track with no vector of its own inherits its ALBUM's centroid. That takes
//    coverage from "whatever the backfill reached" to "every album the backfill
//    touched at all", which is the difference between a usable vibe map and an
//    empty one. It is recorded in `origin` as INFERRED, never passed off as
//    measured, and the wire reports the split.
//
// 3. NO SILENT FALLBACK. When a track has no vector by any route, similarity falls
//    back to metadata affinity (artist / genre / era) — but the answer says so, so
//    the UI can label a row "similar" versus "same artist" honestly rather than
//    implying the embedder had an opinion it never had.
const path = require('path');
const { contentKeyFromTags, relKeyFromEmbedderPath, l2Normalise } = require('./vectors');

/* ── Interpretable descriptor slices (music/descriptors.py's LAYOUT, N_MFCC=20) ──
   The 119-d descriptor arm is NOT the similarity space here — the neural arm won
   ALGORITHMS.md §4's gate on every criterion — but it is the only READABLE one: these
   nine dimensions are physical quantities, not latent coordinates. They are what
   lets a Run have a real arc ("start calm, build, come down") and a vibe-map axis
   carry a name a person recognises instead of "PC1". Stored RAW (verified: tempo
   6.94 = 2^6.94 ≈ 123 BPM, centroid ≈ 2571 Hz), so this file percentile-ranks them
   itself rather than reading the embedder's fitted normaliser. */
const D_CENTROID = 104;   // brightness — spectral centre of mass
const D_FLATNESS = 107;   // fuzz/noisiness — tonal (0) vs noise-like (1)
const D_LOGRMS   = 109;   // energy — loudness
const D_TEMPO    = 116;   // log2(bpm)
const D_STRENGTH = 117;   // beat strength — how metronomic
const D_ONSET    = 118;   // onset rate — event density

/** ⚠️ THE COLUMN INDICES ABOVE ARE A CROSS-REPO COUPLING WITH NOTHING HOLDING IT.
 *  They are positions in `music/descriptors.py`'s LAYOUT, and `music/` deliberately
 *  shares no code with this repo (ALGORITHMS.md §4: "the isolation is the deliverable"). So
 *  a change to N_MFCC or to the order of the descriptor blocks would leave this
 *  file reading the WRONG COLUMN — tempo where flatness used to be — and nothing
 *  would raise: every value is a plausible float, the map would still draw, the
 *  runs would still sequence, and the axes would simply mean something else.
 *  The arm's width is the one witness available on this side of the wire, so it
 *  is checked, loudly, once per load. */
const DESCRIPTOR_DIM = 119;

/** The named, 0–1 percentile-ranked features every surface reads. Order is the
 *  wire order; `FEATURE_NAMES[i]` names column i of `space.features`. */
const FEATURE_NAMES = ['energy', 'brightness', 'fuzz', 'tempo', 'drive', 'density'];
const FEATURE_SOURCE = [D_LOGRMS, D_CENTROID, D_FLATNESS, D_TEMPO, D_STRENGTH, D_ONSET];
const NFEAT = FEATURE_NAMES.length;

/** How a row's vector was obtained — reported so the UI never implies a
 *  measurement that did not happen. */
// ⚠️ These are indices into a Uint8Array — integers, contiguous, and ORDERED so
// that "> NONE" means "has a vector" and ALBUM stays last as the only inferred
// one. ORIGIN_NAMES is indexed by the value, so the two must stay the same length.
const ORIGIN = { NONE: 0, PATH: 1, REL: 2, CONTENT: 3, ALBUM: 4 };
const ORIGIN_NAMES = ['none', 'measured', 'measured', 'measured', 'inferred'];

/** Album identity for propagation + "don't fill a radio station with one record".
 *  Album titles repeat across artists ("Greatest Hits"), so the key is both. */
function albumKeyOf(row) {
  const a = contentKeyFromTags(row.albumartist || row.artist, row.album || '');
  return a || `__single__${row.id}`;
}

/** Convert a raw feature column into 0–1 PERCENTILE ranks over the library.
 *  Percentiles, not z-scores: these drive UI positions and arc targets, where a
 *  uniform spread is what makes the surface usable, and they are immune to the
 *  long tails a raw loudness or tempo column always has. */
function percentileRank(values) {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((i) => Number.isFinite(values[i]))
    .sort((a, b) => values[a] - values[b]);
  const out = new Float32Array(n).fill(0.5);   // unknown sits at the median, not at an edge
  const m = order.length;
  if (m < 2) return out;
  for (let r = 0; r < m; r++) out[order[r]] = r / (m - 1);
  return out;
}

/**
 * Build the aligned space over the current catalog.
 *
 * @param {object}  o
 * @param {import('better-sqlite3').Database} o.db          KourOS's own database
 * @param {object}  o.vectorSpace   openVectorSpace() result — the similarity arm
 * @param {object} [o.featureSpace] a RAW (un-normalised) descriptor arm, for the
 *                                  interpretable columns; omit and features are null
 */
function buildSpace({ db, vectorSpace, featureSpace = null, musicDir = null, libraryRootName = 'Music' }) {
  if (featureSpace && featureSpace.available && featureSpace.dim !== DESCRIPTOR_DIM) {
    console.error(
      `[kouros discover] descriptor arm is ${featureSpace.dim}-d, expected ${DESCRIPTOR_DIM} — ` +
      `music/descriptors.py's LAYOUT has changed and this file's D_* column indices no longer ` +
      `point at the features they name. Refusing the readable features rather than reporting ` +
      `the wrong column as "tempo".`);
    featureSpace = null;
  }
  const rows = db.prepare(`
    SELECT id, path, title, artist, album, albumartist, year, genres, duration, cover_path
      FROM tracks
  `).all();

  const n = rows.length;
  const dim = vectorSpace && vectorSpace.available ? vectorSpace.dim : 0;
  const ids = new Int32Array(n);
  const index = new Map();
  const origin = new Uint8Array(n);
  const matrix = dim ? new Float32Array(n * dim) : null;

  // Metadata columns kept as plain arrays — the fallback affinity and the cluster
  // labeller both read them, and neither is hot enough to want a typed layout.
  const meta = {
    title: new Array(n), artist: new Array(n), album: new Array(n),
    albumKey: new Array(n), genres: new Array(n), year: new Int16Array(n),
    duration: new Float32Array(n), cover: new Uint8Array(n),
  };

  // ── Pass 1: resolve a vector per row, three tiers (see vectors.js's header) ───
  const albumRows = new Map();          // albumKey → row indices, for pass 2
  let nPath = 0, nRel = 0, nContent = 0;

  /** This catalog's root-relative key for a track — the counterpart of
   *  `relKeyFromEmbedderPath`. Prefers stripping MUSIC_DIR (exact, and correct
   *  even when the mount is not named after the library); falls back to scanning
   *  for the root segment when no mount is configured, which is the dev case
   *  where both processes see the same absolute path anyway. */
  const relKeyOf = (abs) => {
    if (musicDir) {
      const rel = path.relative(musicDir, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.split(path.sep).join('/').toLowerCase();
      }
    }
    return relKeyFromEmbedderPath(abs, libraryRootName);
  };
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    ids[i] = r.id;
    index.set(r.id, i);
    meta.title[i] = r.title || '';
    meta.artist[i] = r.artist || '';
    meta.album[i] = r.album || '';
    meta.year[i] = Number.isFinite(r.year) ? r.year : 0;
    meta.duration[i] = r.duration || 0;
    meta.cover[i] = r.cover_path ? 1 : 0;
    try { meta.genres[i] = JSON.parse(r.genres || '[]'); } catch { meta.genres[i] = []; }
    const ak = albumKeyOf(r);
    meta.albumKey[i] = ak;
    if (!albumRows.has(ak)) albumRows.set(ak, []);
    albumRows.get(ak).push(i);

    if (!dim) continue;
    let vec = vectorSpace.byPath.get(r.path);
    if (vec) { origin[i] = ORIGIN.PATH; nPath++; }
    if (!vec) {
      const rel = relKeyOf(r.path);
      if (rel) vec = vectorSpace.byRelPath.get(rel);
      if (vec) { origin[i] = ORIGIN.REL; nRel++; }
    }
    if (!vec) {
      const ck = contentKeyFromTags(r.artist, r.title);
      if (ck) vec = vectorSpace.byContentKey.get(ck);
      if (vec) { origin[i] = ORIGIN.CONTENT; nContent++; }
    }
    if (vec) matrix.set(vec, i * dim);
  }

  // ── Pass 2: album propagation ────────────────────────────────────────────────
  // A track with no vector of its own takes its album's centroid. Justified by
  // ALGORITHMS.md §4's measured same-album cosine of +0.43, and marked ORIGIN.ALBUM so
  // nothing downstream can mistake it for a measurement.
  let nAlbum = 0;
  if (dim) {
    for (const [, members] of albumRows) {
      const have = members.filter((i) => origin[i] !== ORIGIN.NONE);
      const need = members.filter((i) => origin[i] === ORIGIN.NONE);
      if (!have.length || !need.length) continue;
      const centroid = new Float32Array(dim);
      for (const i of have) {
        const off = i * dim;
        for (let d = 0; d < dim; d++) centroid[d] += matrix[off + d];
      }
      if (!l2Normalise(centroid)) continue;
      for (const i of need) {
        matrix.set(centroid, i * dim);
        origin[i] = ORIGIN.ALBUM;
        nAlbum++;
      }
    }
  }

  // ── Interpretable features, same two-tier resolution, same album propagation ──
  let features = null;
  if (featureSpace && featureSpace.available) {
    const raw = new Float32Array(n * NFEAT).fill(NaN);
    const fdim = featureSpace.dim;
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      let vec = featureSpace.byPath.get(r.path);
      if (!vec) {
        const ck = contentKeyFromTags(r.artist, r.title);
        if (ck) vec = featureSpace.byContentKey.get(ck);
      }
      if (!vec || vec.length !== fdim) continue;
      for (let f = 0; f < NFEAT; f++) raw[i * NFEAT + f] = vec[FEATURE_SOURCE[f]];
      seen[i] = 1;
    }
    for (const [, members] of albumRows) {
      const have = members.filter((i) => seen[i]);
      const need = members.filter((i) => !seen[i]);
      if (!have.length || !need.length) continue;
      for (let f = 0; f < NFEAT; f++) {
        let s = 0;
        for (const i of have) s += raw[i * NFEAT + f];
        const mean = s / have.length;
        for (const i of need) raw[i * NFEAT + f] = mean;
      }
    }
    // Percentile-rank each column independently, over the rows that actually have it.
    features = new Float32Array(n * NFEAT);
    for (let f = 0; f < NFEAT; f++) {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) col[i] = raw[i * NFEAT + f];
      const ranked = percentileRank(col);
      for (let i = 0; i < n; i++) features[i * NFEAT + f] = ranked[i];
    }
  }

  const covered = nPath + nRel + nContent + nAlbum;
  // The fitted geometry, carried through so a SCORE can be reported in stranger
  // units instead of as a raw cosine (see vectors.js's loadCalibration, and
  // ALGORITHMS.md §4's note that a raw cosine gap is not comparable between spaces).
  // Null when the index predates `music/query.py --fit` — reported, not assumed.
  const calibration = (vectorSpace && vectorSpace.calibration) || null;
  const stats = {
    tracks: n,
    dim,
    arm: vectorSpace && vectorSpace.arm,
    measured: nPath + nRel + nContent,
    inferred: nAlbum,
    // The tier breakdown, on the wire deliberately: tier 1 reading 0 in a
    // container is EXPECTED (the two roots differ), while tier 2 reading 0 with
    // a populated index means the join is broken and every "embedding" surface
    // is quietly serving album centroids or metadata.
    byPath: nPath,
    byRelPath: nRel,
    byContentKey: nContent,
    covered,
    uncovered: n - covered,
    coverage: n ? covered / n : 0,
    features: features ? FEATURE_NAMES : null,
    calibrated: !!calibration,
    strangerMean: calibration ? calibration.strangerMean : null,
    strangerSpread: calibration ? calibration.strangerSpread : null,
  };

  return { n, dim, ids, index, matrix, origin, features, meta, albumRows, stats,
           calibration, FEATURE_NAMES, ORIGIN, ORIGIN_NAMES };
}

module.exports = {
  buildSpace, albumKeyOf, percentileRank,
  FEATURE_NAMES, NFEAT, ORIGIN, ORIGIN_NAMES,
};
